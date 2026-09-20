# Issue 2274 / PR 2275 CI/CD investigation

Collected and analyzed on 2026-09-20 UTC. This document is the index and
conclusion for the raw evidence stored beside it. All timestamps are UTC.

## Executive conclusion

The failing release was neither flaky nor a mergeability race. At 04:28:10 the
repository's `Main ruleset` gained a strict required `Pipeline Status` check.
The existing release fallback created its pull request with `GITHUB_TOKEN`, so
all three ordinary `pull_request` workflow runs were left in
`action_required`. No workflow could report the required check. Retrying
`gh pr merge` ten times therefore retried an invariant policy failure.

This happened four consecutive times after the rule change, creating PRs
#2268, #2272, #2273, and #2276. Every one of their twelve workflow runs is
`action_required`.

The implemented fix uses GitHub's documented exception: after creating a
release PR, the release job explicitly dispatches a non-publishing
`workflow_dispatch` validation run on that head, waits for it to finish
successfully, and only then attempts the merge. A failed validation aborts
before any merge attempt. The existing release and instant-release jobs both
use this shared landing helper.

No warning annotations or false-positive failures were found in the issue's
three linked runs. A separate failure on the original PR branch was a true
positive dependency-freshness finding caused by the branch being forked before
main's Agent 0.26.5 refresh; merging current `main` resolved it without
weakening the check.

## Scope and evidence

The investigation includes:

1. Issue #2274 and every issue comment, event, and timeline item; PR #2275 and
   all three GitHub comment/review channels, commits, files, and its complete
   diff. The issue and PR had no comments, reviews, screenshots, or attachment
   URLs when collected.
2. Complete job metadata and unabridged logs for the issue's linked main runs:
   Security `35519980723`, Checks and release `35519980846`, and Broken Link
   Checker `35519980669`.
3. Complete logs for all earlier and later main failures under the same
   ruleset: `35492495204`, `35495996039`, and `35526569064`.
4. Complete logs for the prepared branch's first Checks run `35526551346` and
   Security run `35526551243`, plus current run-list snapshots with timestamps
   and head SHAs.
5. The current definitions and complete version history of both repository
   rulesets. Version `50283211` proves exactly when the required status check
   was added; version `47323217` proves it was absent before then.
6. Metadata and workflow-run state for generated release PRs #2268, #2272,
   #2273, and #2276, plus the complete diff and all three comment/review
   channels for the issue-linked PR #2273.
7. The full repository tree and CI/CD checksums, the full tree and CI/CD
   checksums of
   `link-foundation/js-ai-driven-development-pipeline-template@e4f23d74`, and
   full workflow/script diffs. The clone itself was temporary; reproducible
   trees, checksums, diffs, and the exact template commit are stored here.
8. The pre-fix regression output, local installation/test logs, exact CI
   annotation lines, gate-coverage audit, online-source links, and the complete
   upstream report body. The local default suite passed all 495 selected test
   files; the live GitHub integration suite passed all four assertions.
9. The post-push candidate run list and complete logs for Workflows
   `35528498944`, Broken Link Checker `35528498960`, Security `35528498958`,
   and Checks and release `35528499102`. All four ran on `1e1de488` and
   succeeded; `final-ci-annotation-lines.txt` is empty.

The raw `.log` files are gzip-compressed in `ci-logs/` after collection to keep
the repository reasonably sized without discarding any line. The adjacent
`*-failure-context.txt` and `*-diagnostics.txt` files make the relevant regions
readable without expanding 45,000-line logs.

## Timeline

| Time | Event and evidence |
| --- | --- |
| 2026-08-22 17:34 | The Main ruleset began requiring pull requests with no bypass actor. Issue #2175 / PR #2176 added `landViaPullRequest`, which had successfully created and merged release PRs through #2262. See `related-issue-2175.json`, `related-pr-2176.json`, and `related-release-prs.json`. |
| 2026-09-20 04:28:10 | Ruleset version `50283211` added strict required check `Pipeline Status` for GitHub Actions integration `15368`. Version `47323217` has no `required_status_checks` rule. See `repository-ruleset-7927725-version-*.json`. |
| 2026-09-20 05:45-05:58 | The first affected main run, `35492495204`, bumped 2.30.0 to 2.31.0. Direct push failed with GH013 and `Required status check "Pipeline Status" is expected`; PR #2268 was created; all ten merges failed; Release and Pipeline Status went red. See lines 44771-44834 and 45212-45215 in its log/context. |
| 2026-09-20 07:06-07:17 | Run `35495996039` repeated the same failure and created PR #2272. See lines 44753-44818 and 45196-45199. |
| 2026-09-20 15:33-15:48 | The issue-linked run `35519980846` repeated the same failure and created PR #2273. Its sibling Security and Broken Link runs succeeded with no warning/error annotations. |
| 2026-09-20 17:37:53 | Issue #2274 was opened, explicitly requesting the complete CI/CD sweep and template comparison. |
| 2026-09-20 17:39 | Draft PR #2275 was created. Its first Checks run correctly failed because its stale base still pinned Agent 0.26.3 while 0.26.5 was current. At essentially the same time, main received the pin refresh at `19933d4f`. See `run-35526551346-failure-context.txt`. |
| 2026-09-20 17:39-17:48 | Main run `35526569064` became the fourth identical release failure and created PR #2276. Its three PR workflows also concluded `action_required`. |
| 2026-09-20 investigation | Current `origin/main` was merged into the task branch (`8c4e0614`), resolving the dependency-freshness failure while retaining the guard. A failing regression was committed first (`dcf215b1`), followed by the implementation (`ba12d5a3`). |
| 2026-09-20 upstream | The identical template defect was reported as [link-foundation/js-ai-driven-development-pipeline-template#192](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/192), with four reproductions, workarounds, and a code-level fix plan. |
| 2026-09-20 verification | Dependency installation completed with zero vulnerabilities; all 495 default-suite files and the one GitHub integration file passed. ESLint, Prettier, duplication detection, secret scanning, extracted-module, and line-limit checks also exited successfully. The integration fixture is preserved by its existing test contract at [konard/test-feedback-lines-2eb45eaf](https://github.com/konard/test-feedback-lines-2eb45eaf). |
| 2026-09-20 18:15-18:35 | The pushed candidate `1e1de488` passed all four PR workflows. Checks and release completed all test, Docker/container, policy, and terminal `Pipeline Status` jobs successfully. See `final-ci-runs-1e1de488.json` and `ci-logs/final-run-*.log.gz`. |

## Requirements inventory and disposition

### Requirements in issue #2274

| ID | Requirement | Disposition |
| --- | --- | --- |
| I1 | Check and fix every CI/CD false positive | None found. The release failures and branch freshness failure are true positives; see the root-cause matrix. Expected warning/error strings printed inside tests were not GitHub annotations. |
| I2 | Check and fix every CI/CD false negative | Fixed the untested automation-created release-PR path. The new regression proves merge is impossible before explicit validation and prohibited after failed validation. Existing `ci-integrity-2150.test.mjs` confirms the terminal status gate observes all 26 other jobs. |
| I3 | Check and fix every CI/CD warning | The issue-linked logs contain zero warning annotations. The implementation initially pushed `release.yml` one line above its 1,350-line warning threshold; it was reduced to 1,348 and the headroom guard passes. |
| I4 | Check and fix every CI/CD error | Fixed the persistent Release error caused by the missing required status. The Pipeline Status errors were correct propagation of Release. The stale dependency error was resolved by merging the main fix, not by suppressing it. |
| I5 | Compare the complete CI/CD file tree with the JavaScript template | Done. Trees, SHA-256 inventories, full workflow/script diffs, and template-only/repository-only inventories are stored here. |
| I6 | Reuse every applicable template best practice | The local gate-coverage contract is equivalent to the template's checker and covers all jobs. The template's release fallback has the same defect, so copying it would regress the result; it was reported upstream. Product/scaffolding-only differences are documented below. |
| I7 | Report the same issue to the template project | Done: [template issue #192](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/192). |
| I8 | Follow `docs/CI-CD-BEST-PRACTICES.md` | The fix preserves protected-branch enforcement, least privilege, bounded jobs/retries, terminal gating, and changesets. The newly learned required-check rule was added to all four language variants. |
| I9 | Complete the work in one pull request | All issue work is in PR #2275 on `issue-2274-beb53fa7caf4`. |

### Additional execution requirements

| ID | Requirement | Disposition |
| --- | --- | --- |
| E1 | Download all related logs and compile data under `dev/log/issues/2274/pulls/2275` | Done; this directory is the evidence bundle and index. |
| E2 | Deep analysis, online research, timeline, requirements, root causes, and solution plans | This document. |
| E3 | Research known components/libraries | See “Online and reusable-component research.” No new runtime dependency is required. |
| E4 | Reproduce before fixing | `tests/release-required-checks-2274.test.mjs` failed before the implementation; output is in `regression-before-fix.log.gz`. |
| E5 | Add default-off tracing/verbose mode if evidence is insufficient | Not needed: the complete logs, ruleset versions, and generated-PR run states independently establish the cause. The shared command runner already accepts `verbose=false`; the new dispatch/watch calls preserve that switch. |
| E6 | Apply a repeated fix throughout the codebase | Both automatic and instant release jobs receive the narrow permissions and call the same corrected helper. Preflight distinguishes validation from publication. All four best-practice translations were updated. |
| E7 | Report defects in related projects with repro, workaround, and suggested fix | Template issue #192 contains all three. |

## Root-cause and solution matrix

### F1. Release pull requests can never acquire the required check

**Observed.** Each main release run successfully performed all checks, created
the version commit, and then received both GH013 messages on direct push:
`Changes must be made through a pull request` and `Required status check
"Pipeline Status" is expected`. The fallback created a PR, then ten merge
attempts returned either the explicit missing check or “the base branch policy
prohibits the merge.” Release exited 1 and the terminal gate correctly
propagated that failure.

Each generated PR has exactly three runs (Checks, Security, Broken Links), and
all twelve across the four PRs concluded `action_required` at their creation
timestamp. There is no `Pipeline Status` check to satisfy the ruleset.

**Root cause.** GitHub documents special recursion prevention for
`GITHUB_TOKEN`: PR opened/synchronize/reopened activity created by a workflow
requires approval, while other token-generated events generally do not create
runs. `workflow_dispatch` and `repository_dispatch` are the documented
exceptions. The fallback predated the status-check rule and assumed that PR
creation was sufficient; retrying mergeability cannot cause a workflow to run.

**Options considered.**

1. Remove the required check or grant the workflow a ruleset bypass. This makes
   releases work by weakening the policy and was rejected.
2. Use a PAT or GitHub App token to create the PR. This would trigger ordinary
   workflows, but adds a long-lived credential or another app when the built-in
   token already has a narrow dispatch mechanism.
3. Use `gh pr merge --auto`. Auto-merge waits for requirements; it does not
   manufacture the absent check, so the run still deadlocks.
4. Enable GitHub merge queue. This is a viable larger architecture for a busy
   repository, but requires ruleset changes and `merge_group` triggers. It does
   not belong in a targeted bug fix.
5. Explicitly dispatch validation on the generated head, await it, then merge.
   This preserves every branch rule, uses the existing workflow and CLI, and
   needs only job-scoped permissions. Chosen.

**Implemented solution.** `dispatchPullRequestValidation` runs:

```text
gh workflow run release.yml --ref <release-head> \
  --raw-field release_mode=validate-pr --raw-field bump_type=patch
gh run watch <returned-run-id> --exit-status --compact
```

It parses the run URL that `gh workflow run` documents as its output, waits for
the exact run rather than racing a list query, and propagates dispatch or
validation failure. Only after success does the existing bounded merge retry
run. `release.yml` accepts `validate-pr`, while publication jobs still require
`push` on main or `release_mode == instant`. `release-preflight.yml` treats
validation as report mode, not release mode. The two jobs that can reach the
helper have `actions: write`, which covers dispatching and reading the Actions
run watched by `gh run watch`; no unrelated Checks API permission was added.
The workflow retains `contents: read` by default.

**Regression tests.** `release-required-checks-2274.test.mjs` models a merge
that remains policy-blocked until dispatch/watch succeeds, asserts ordering,
and separately proves a failed validation never reaches merge. Existing issue
#2175 landing tests were updated so every fallback path exercises dispatch.

### F2. Merge retries emitted a misleading transient explanation

**Observed.** After each policy response, the helper logged “GitHub may still
be computing mergeability,” ten times over about 50 seconds.

**Root cause.** The retry exists for the real transient interval immediately
after PR creation, when GitHub's `mergeable` field is unknown. It had no phase
that established required-check completion, so the same retry received both
transient and permanent policy failures.

**Solution.** The status requirement is now resolved before the retry begins.
The retry remains useful for its original mergeability race, while validation
failures stop immediately at `gh run watch --exit-status`. The regression test
pins this ordering.

### F3. Prepared branch failed dependency freshness

**Observed.** Run `35526551346` reported:

```text
STALE Dockerfile:298: @link-assistant/agent 0.26.3 -> 0.26.5 (exact)
STALE Dockerfile.dind:313: @link-assistant/agent 0.26.3 -> 0.26.5 (exact)
Dependency freshness failed: 2 stale, 0 unresolved.
```

**Root cause.** The prepared branch SHA `02146eec` was forked from
`95f2d694`; main advanced to `19933d4f` with the 0.26.5 refresh at the same
time the PR's first run began. This was branch drift, not an error in the
freshness check.

**Solution.** Merge current main. Commit `8c4e0614` does so and contains the
pin refresh. Suppressing the check or duplicating the already-merged pin change
would create a false positive fix rather than resolve the actual state.

### W1. Warning audit

`ci-annotation-lines.txt` contains every `##[warning]`, `##[error]`,
`::warning`, and `::error` command found in the collected logs. There are no
warnings in the issue-linked runs or prepared-branch runs. The only annotations
are the true errors described above. Text such as “warning” inside test fixture
output is not a runner annotation and was not misclassified.

During implementation, `release.yml` briefly reached 1,351 lines. The
repository's early-warning threshold is 1,350. The final workflow is 1,348
lines, and both `check-file-line-limits.sh` and
`extracted-modules-2198.test.mjs` pass.

### FP1. False-positive audit

No false positive was found:

- GH013 is real: 2.31.0 did not land or publish and four release PRs remain
  open.
- Pipeline Status correctly reports a failed dependency, including Release.
- The Agent freshness report named the exact stale declarations and version;
  the corresponding main fix confirms it.
- Security and link-check siblings succeeded without annotations.

### FN1. False-negative audit

The automation-created release-PR path was missing from the test suite: unit
tests mocked `gh pr merge` as immediately successful and never modeled a
required check. That blind spot is now covered by the issue #2274 regression.

The terminal gate itself has no coverage hole. Running the template's
`check-status-gate-covers-all-jobs.mjs` against local `release.yml` reports:
`pipeline-status covers all 26 other job(s)`. The local
`ci-integrity-2150.test.mjs` independently derives and asserts the same set, so
copying the template script would add a duplicate check rather than coverage.

## Template and best-practice reconciliation

### Complete tree comparison

The comparison is against template commit `e4f23d74` from 2026-09-15. See:

- `template-file-tree.txt` and `repository-file-tree.txt`;
- `template-cicd-sha256.txt` and `repository-cicd-sha256.txt`;
- `template-vs-repository-github.diff.gz` and
  `template-vs-repository-scripts.diff.gz`;
- `template-only-*.txt` and `repository-only-*.txt`.

The template has one workflow absent here, `example-app.yml`, which is sample
application scaffolding. This repository instead has product-specific
`cleanup-test-repos.yml`, `formal-ai-draft.yml`, and a reusable
`release-preflight.yml`. Common release, security, link, and workflow checks
were compared directly.

Template-only script names mostly map to local modules with repository-specific
structure: `land-via-pull-request.mjs` to
`release-pull-request.lib.mjs`, `run-command.mjs` to
`run-command.lib.mjs`, `push-main-with-rebase-retry.mjs` to
`version-and-commit.lib.mjs`, and preflight/npm/change detection to their local
counterparts. Template sample-app, preview-image, multi-layout JS path, and
generic Docker smoke helpers do not apply to this repository's Helm/DinD
release topology. The complete uninterpreted inventory is preserved rather
than hiding those differences.

### Applicable findings

- **Required-check deadlock:** both projects have it. The template helper also
  creates the PR and immediately calls `mergePullRequestWithRetry`, with no
  validation dispatch. Reported upstream as issue #192; copying that helper
  was deliberately rejected.
- **Terminal gate coverage:** applicable and already present locally. The
  template's standalone checker and local independent test both find all 26
  dependencies covered.
- **Least privilege:** preserved. The template and local workflows both use a
  read-only default and job-scoped writes. This fix adds only Actions write to
  the two publisher jobs; it is sufficient to dispatch and watch the run.
- **Bounded jobs/retries:** preserved. Validation uses the existing 30-minute
  release-job timeout; merge retries remain bounded.
- **Release preflight:** local reusable preflight is more specialized than the
  template shell helper and is retained. Validation explicitly runs it in
  report mode, preventing a validation run from impersonating publication.

### `docs/CI-CD-BEST-PRACTICES.md` checklist

- §2 file limits: final workflow is within both the hard 1,500 cap and the
  1,350 warning threshold at 1,348 lines.
- §4 least privilege: narrow job permissions, read-only workflow default.
- §6 changesets: one patch changeset is included; the release model is
  unchanged.
- §9 release automation: protected-branch fallback now also satisfies required
  checks. The new principle is translated in English, Russian, Hindi, and
  Chinese.
- §10 retries: failed validation is not retried as mergeability; the genuine
  post-creation mergeability race remains bounded.
- §11 timeouts: no timeout was increased; validation remains inside the
  existing release timeout.

## Online and reusable-component research

Only primary documentation was used for the implementation decision:

- [GitHub Actions events documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows): token-created PR events require approval; `workflow_dispatch` and `repository_dispatch` are exceptions that create runs.
- [GitHub Actions workflow REST API](https://docs.github.com/en/rest/actions/workflows): creating a workflow dispatch requires Actions write permission.
- [GitHub CLI `gh workflow run`](https://cli.github.com/manual/gh_workflow_run): supports ref and raw inputs and returns the created run URL when available.
- [GitHub CLI `gh run watch`](https://cli.github.com/manual/gh_run_watch): watches a specific run and can return its failure status.
- [GitHub merge queue documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue): a viable larger alternative, but requires `merge_group` CI triggers and repository configuration.
- [GitHub protected-branch documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule): documents bypass actors, strict status checks, and merge queue configuration.

No third-party library is necessary. GitHub CLI is already installed on the
runner and already used by this helper. A PR-creation action such as the
existing `peter-evans/create-pull-request` would not solve the token-recursion
rule; the identity that opens/updates the PR is the relevant part. A PAT or
GitHub App installation token remains an operational alternative if dispatch
is ever disallowed, but would add credential lifecycle and scope.

## Upstream report

The complete report body is `template-upstream-issue-body.md`; the returned URL
is in `template-upstream-issue-url.txt`:

https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/192

It includes a minimal reproduction, links to all four real failures, manual and
credential-based workarounds, the explicit-dispatch solution, permission and
publication-safety requirements, and a regression-test plan.

## Verification map

| Claim | Verification |
| --- | --- |
| Bug reproduced before implementation | `regression-before-fix.log.gz` |
| Explicit validation precedes merge | `tests/release-required-checks-2274.test.mjs` |
| Failed validation cannot merge | Same test's failed-watch scenario |
| Every existing fallback path remains functional | `tests/release-pull-request-2175.test.mjs`, `tests/version-and-commit-2082.test.mjs` |
| Validation cannot publish | Static workflow assertions plus `release`/`instant-release` event predicates and preflight report-mode assertion |
| Terminal gate covers every job | `tests/ci-integrity-2150.test.mjs`; `status-gate-audit.txt` |
| Workflow cancellation and timeout policy retained | `tests/ci-workflow-cancellation-2082.test.mjs`, `tests/ci-workflow-timeouts-2082.test.mjs` |
| Documentation translations synchronized | `tests/test-docs-language-sync.mjs` |
| No line-limit warning | `scripts/check-file-line-limits.sh`, `tests/extracted-modules-2198.test.mjs` |
| Dependency installation is clean | `npm-ci.log.gz`: 0 vulnerabilities |
| Complete local default suite | `npm-test.log.gz`: all 495 selected test files passed |
| Live GitHub integration suite | `github-integration-test.log.gz`: 4/4 assertions and the selected integration file passed |
| Repository-wide static checks | `npm-lint.log.gz`, `npm-format-check.log.gz`, `npm-duplication.log.gz`, `npm-secretlint.log.gz` all exited 0 |
| Focused structural checks | `extracted-modules-test.log.gz`, `line-limits.log.gz`; workflow ends at 1,348 lines |
| Live PR candidate CI | `final-ci-runs-1e1de488.json`; all four workflows succeeded on the candidate head |
| Complete live PR candidate logs | `ci-logs/final-run-35528498944.log.gz`, `final-run-35528498960.log.gz`, `final-run-35528498958.log.gz`, and `final-run-35528499102.log.gz` |

The following evidence-only commit archives those successful runs without
changing the implementation. Its own live status is verified and summarized
in the PR description; any non-passing final-head run would be downloaded and
analyzed before the PR is handed off.
