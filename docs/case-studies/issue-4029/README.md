# Case study: false positives, false negatives, warnings and errors in CI/CD (issue #4029)

Issue: [#4029](https://github.com/link-assistant/hive-mind/issues/4029).
Implementation: [PR #4030](https://github.com/link-assistant/hive-mind/pull/4030).
Research date: 2026-11-10 UTC. Evidence: [`dev/log/issues/4029/pulls/4030`](../../../dev/log/issues/4029/pulls/4030/README.md).
Previous round: [issue #4025](../issue-4025/README.md) (PR #4026, merged 2026-11-09 16:40 as `b245deb`).

## Requirements

| #   | Requirement (issue text)                                                                       | Where it is addressed                                                    |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| R1  | Find and fix every false positive, false negative, warning and error in CI/CD                  | Findings F1–F9 below                                                     |
| R2  | Checks and release: failure (run 42657172126)                                                  | F1, F2, F3                                                               |
| R3  | Cleanup Test Repositories: cancelled (run 42614826072)                                         | F5 (the ruleset part stays blocked on an administrator, B1)              |
| R4  | E2E Hello World Matrix: skipped                                                                | F8: skipped by design, no change                                         |
| R5  | Formal AI Draft, Dependency Graph, Security, Links, Workflows, Dependabot: success             | Checked for hidden problems: F4, F6, F7, F9                              |
| R6  | Compare all CI/CD files with the js, python, rust and cpp templates; reuse best practices      | [Template comparison](#template-comparison)                              |
| R7  | If a template has the same defect, report it there                                             | [Template comparison](#template-comparison)                              |
| R8  | Follow `docs/CI-CD-BEST-PRACTICES.md`                                                          | Pinned tools, fail-closed gates, bounded waits, tests for workflow logic |
| R9  | Collect logs and data into `dev/log/issues/4029/pulls/4030`; timeline; root causes; case study | This file and the evidence folder                                        |
| R10 | Debug output where data is missing; upstream reports with reproduction, workaround, fix        | [Upstream](#upstream), `experiments/issue-4029/`                         |

## Timeline (UTC)

| When             | Event                                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-23       | `@openai/codex` 0.164.0 is published. The images pin it, and `src/codex-stock-skills-0.164.0.json` records its stock skills. 0.165.0 (10-27) and 0.166.0 (10-29) ship the same skills.          |
| 2026-11-01 22:11 | `f5fe35f03` adds the capability lifecycle gate (`scripts/verify-capability-lifecycle.mjs`) on the issue-3785 branch.                                                                            |
| 2026-11-05 23:15 | Last green Checks and release on main: 42128193502.                                                                                                                                             |
| 2026-11-06 01:46 | `@openai/codex` 0.167.0 is published as npm `latest`. It is the first release whose stock skills differ from 0.164.0.                                                                           |
| 2026-11-0x       | On the PR #3786 branch `docker-pr-check` is cancelled (42586116026, 42584312863, 42583769147) or skipped and never succeeds (`release-runs-docker-pr-check.tsv`).                               |
| 2026-11-09 11:25 | PR #3786 merges as `e1f89c0`. Main run 42609000121 fails `docker-pr-check` at P3 with `CodexStockBaselineError`.                                                                                |
| 2026-11-09 12:10 | Scheduled Cleanup Test Repositories 42614826072 (on `e1f89c0`, before the #4025 fix) is cancelled at its 15-minute timeout.                                                                     |
| 2026-11-09 12:3x | Release 42614946918, dispatched by Formal AI Draft for PR #4028, runs for 109 minutes. The draft's reporter gives up at 80 minutes, so `dispatched / release.yml` on `cdeb7d0` stays `pending`. |
| 2026-11-09 16:40 | PR #4026 (issue #4025) merges as `b245deb`. Main run 42657172126 fails the same way (F1). The other main workflows are green.                                                                   |
| 2026-11-10 05:53 | Issue #4029 is opened. Formal AI Draft 42764915861 ends "Finished without changes" (the #4025 annotation fix works).                                                                            |
| 2026-11-10 05:56 | The first PR run (42765137804) fails `detect-changes`: 7 stale declarations from azure/setup-helm v5.1.0 and lino-objects-codec 0.9.6 (F3).                                                     |
| 2026-11-10 06:19 | Dispatched Cleanup dry run 42767772589 on `b245deb` succeeds in about 1 minute (F5).                                                                                                            |

## Findings, root causes and fixes

### F1. Checks and release red on main: lifecycle gate rejects a correct refusal (false positive)

**Symptom.** Runs 42609000121 and 42657172126 fail `docker-pr-check`:
`❌ Codex stock runtime differs from the pristine pinned CLI 0.164.0 baseline`,
right after the `P3 idle CLI updater` checkpoint.

**Root cause.** Phase P3 of the lifecycle gate lets the idle CLI updater
install npm `latest`. Since 2026-11-06 that is Codex 0.167.0, not the pinned
0.164.0. On its first real start, Codex rewrites `~/.codex/skills/.system`
with its own embedded stock skills. The production audit then correctly
refuses to launch with the typed `CodexStockBaselineError`. The gate treated
that intended fail-closed refusal as a regression. A second defect hid the
gate's existing exception: it compared `0.163.0` with the label
`codex-cli 0.164.0`, so the exception could never match.

`experiments/issue-4029/codex-stock-skills-drift.sh` reproduces this with the
real binaries and no Docker
([`experiment-codex-stock-skills-drift.txt`](../../../dev/log/issues/4029/pulls/4030/experiment-codex-stock-skills-drift.txt)):

- starting 0.163.0 or 0.167.0 produces stock skills the audit refuses;
- starting the pinned 0.164.0 again restores the verified runtime;
- 0.165.0 and 0.166.0 match the baseline (`experiment-codex-0.165-0.166.txt`).

This explains why main was green until the 0.167.0 release.

**Fix.**

- `codexStockRefusalExpected()` compares bare versions.
- P3 accepts the typed refusal only while a Codex other than the pinned one
  has run in the home.
- P3 then starts the image's pinned binaries and checks that the home is
  clean again before P4, which is the documented recovery.
- Production behaviour is unchanged: the images still pin 0.164.0 and exclude
  Codex from auto-updates.

The full gate was run locally inside the image with and without the fix:

- before: exit 1 at P3 (`local-lifecycle-before-fix.txt`);
- after: exit 0, all phases pass, and P3 logs `pinned image binaries restored the stock runtime after codex 0.167.0` (`local-lifecycle-after-fix.txt`).

**Test.** `tests/capability-lifecycle-unpinned-codex-4029.test.mjs`.

### F2. The image gate did not run when its own helpers changed (false negative)

**Root cause.** `docker-pr-check` mounts these files into the image under test:

- `scripts/verify-capability-lifecycle.mjs`;
- `scripts/capability-lifecycle-*.lib.mjs`;
- `scripts/mounted-native-runtime.lib.mjs`.

The `docker` output of `scripts/detect-code-changes.mjs` did not match them.
A PR that changed only those helpers skipped the very gate they implement.
`experiments/issue-4029/docker-trigger-coverage.mjs` lists every script the
job reaches that the trigger misses.

**Fix.** The trigger pattern now includes these helpers.

**Test.** `tests/issue-3785-image-gate-selection.test.mjs` adds the 4 paths.

**Limit.** On pull requests the Docker build is opt-in
(`vars.ENABLE_DOCKER_PR_BUILDS`, not set), so `docker-pr-check` runs only on
main pushes and `workflow_dispatch`. That is how F1 reached main untested;
see B2.

### F3. Dependency freshness gate red on every pull request

**Root cause.** Three new upstream releases made 7 declarations stale on every PR
(run 42765137804, `checks-and-release-42765137804-pr.log`):

- azure/setup-helm v5.1.0;
- lino-objects-codec 0.9.6;
- the nested links-notation 0.27.1, which the codec no longer needs.

The gate behaved as designed.

**Fix.** Update the 3 `release.yml` pins and the package, then refresh the
lockfile.

### F4. Dispatched checks left `pending` forever (false "still running")

**Root cause.** Formal AI Draft's `report-checks` mirrors the release, security,
links and workflows runs it dispatches as `dispatched / <workflow>` commit statuses.

- It stopped polling after 80 minutes and logged "stays pending until the next
  report". No next report ever ran.
- Release runs dispatched from drafts take up to 137 minutes (91, 96, 109, 128
  and 137 in `release-dispatch-durations.txt`).
- Release 42614946918 succeeded after 109 minutes, but PR #4028's commit kept a
  `pending` check.

PRs #3913, #3535 and #3534 had the same stale status.

**Fix.**

- The reporter waits `CHECKS_DEADLINE_MINUTES` (200).
- The job timeout is 215 minutes.
- A run still unfinished at the deadline gets a terminal `error` status with a
  link to the run (`unfinishedRunStatus`).

The 4 stale statuses were corrected by running the fixed reporter
(`stale-pending-status-correction.txt`).

**Tests.** `tests/formal-ai-draft-checks-3248.test.mjs`: the terminal status,
and the deadline and timeout relation.

### F5. Cleanup Test Repositories cancelled, and a misleading count

**Root cause of the cancellation.** Run 42614826072 ran on `e1f89c0`, about 4.5
hours before the #4025 fix (`b245deb`) reached main. That fix replaced about
3,400 sequential API calls with batched GraphQL reads and added a time budget.
The dispatched dry run 42767772589 on `b245deb` finishes in about 1 minute
(`cleanup-test-repositories-dry-run-42767772589.log`).

**Remaining defect.** The log said `Stale fixture branches: 1380`. The
repository has 1,108 `e2e/` fixture branches, and the other 272 are head
branches of PRs based on them. The count looked like a miscount.

**Fix.** The line now splits the total: `1380 (1108 e2e/ fixtures, 272 pull request heads based on them)`.

**Test.** `tests/cleanup-task-fixtures-budget-4025.test.mjs`.

**Blocked (B1, unchanged from #4025).** Ruleset 21204104
(`no-destruction-possible`, `~ALL`, deletion and non-fast-forward rules, no
bypass) prevents deleting any branch. The `retained by a repository rule`
warning is accurate. An administrator must exclude `refs/heads/e2e/**` and
add a bypass for the cleanup App.

### F6. `git init` "Using 'master'" hints in 7 workflows (noise)

**Root cause.** `actions/checkout` runs `git init` without a default branch, so
git prints a multi-line hint in every job. `release.yml` already sets
`init.defaultBranch=main` through `GIT_CONFIG_COUNT/KEY/VALUE`. A reusable
workflow does not inherit its caller's `env`, so `native-codex-build.yml` still
printed the hint inside release runs, and so did 6 other workflows.

**Fix.** Add the same workflow-level `env` block to:

- e2e-hello-world-matrix, formal-ai-draft and native-codex-build;
- the 4 native auth experiments.

**Test.** `tests/workflow-git-init-default-branch-4029.test.mjs` requires the
setting in every workflow that checks out or runs `git init`.

### F7. ShellCheck job prints a pipx PATH warning (noise)

**Root cause.** `pipx run --spec shellcheck-py==0.11.0.1 shellcheck` warns
`shellcheck is already on your PATH and installed at /usr/bin/shellcheck` on
the runner image (`workflows-42657172034.log`).

**Fix.** Install the same pinned `shellcheck-py` into a venv under
`$RUNNER_TEMP` and call that binary. It prints no warning and pins the same
version.

**Test.** `tests/workflow-shellcheck-4025.test.mjs`.

### F8. E2E Hello World Matrix skipped (correct, no change)

The job is opt-in through `vars.ENABLE_REAL_GITHUB_E2E`, and no Actions
variable is set (#4025 F6). Skipping is the documented behaviour, so this is
not a false negative.

### F9. Other green workflows: checked, nothing hidden

- **Formal AI Draft 42764915861** (this issue) ends red with
  `Finished without changes: Formal AI produced no change (terminal state:
planned_not_executed)`. The #4025 fix makes the reason accurate, and a draft
  with no change should be red.
- **gh-upload-log HTTP 408 retries** appear in some logs. They are transient,
  recover by themselves and do not affect results, so they are left as they are.
- **Dependency Graph `update-pip-graph`** shows the notice `The ubuntu-latest
label will migrate to Ubuntu 26`. It comes from GitHub's managed
  dependency-submission workflow, not from a file in this repository. All 51
  `runs-on` entries in this repository pin `ubuntu-24.04`.
- **Security, Broken Link Checker, Workflows and Dependabot** on `b245deb` have
  no warning or error annotations (`annotations-b245deb.txt`,
  `check-runs-b245deb.tsv`).

## Template comparison

TEMPLATE_COMPARISON_PLACEHOLDER

## Upstream

- **openai/codex.** Rewriting `~/.codex/skills/.system` on start is
  intended: each release ships its own stock skills. hive-mind pins the
  release and audits it, so there is no upstream defect to report. The
  observations used in the probe stay documented in the experiment script:
  `codex mcp list` does not materialize skills, and some startup side effects
  are skipped when `CODEX_HOME` is under `/tmp`.
- **Templates.** See [Template comparison](#template-comparison).

## Blocked

- **B1.** Ruleset 21204104 needs an administrator to exclude `refs/heads/e2e/**`
  and add a bypass for the cleanup App (F5). Until then the cleanup warning is
  accurate and stays.
- **B2.** `docker-pr-check`, which contains the F1 gate, runs on pull requests
  only when the owner sets `vars.ENABLE_DOCKER_PR_BUILDS`. This PR cannot run
  it. F1 was verified by running the gate locally inside the image with the
  branch's code (`local-lifecycle-after-fix.txt`). The first main push after
  merge runs it in CI.

## Verification

- Focused tests:
  - `capability-lifecycle-unpinned-codex-4029`;
  - `issue-3785-image-gate-selection`;
  - `formal-ai-draft-checks-3248`;
  - `cleanup-task-fixtures-budget-4025`;
  - `workflow-git-init-default-branch-4029`;
  - `workflow-shellcheck-4025`.

  Each new assertion fails without its fix.

- Full lifecycle gate run locally before and after the fix (F1).
- ShellCheck 0.11.0 from the venv command: exit 0.
- The 4 stale `pending` statuses were corrected to `success` with the fixed reporter.
- The full default suite and all workflows run as PR #4030 checks on the final commit.
