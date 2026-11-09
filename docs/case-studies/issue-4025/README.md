# Case study: false failures, hidden failures and noise in CI/CD (issue #4025)

Issue: [#4025](https://github.com/link-assistant/hive-mind/issues/4025).
Implementation: [PR #4026](https://github.com/link-assistant/hive-mind/pull/4026).
Research date: 2026-11-09 UTC. Evidence: [`dev/log/issues/4025/pulls/4026`](../../../dev/log/issues/4025/pulls/4026/README.md).

## Requirements

| #   | Requirement (issue text)                                                                 | Where it is addressed                                                                                         |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| R1  | Find and fix every false positive, false negative, warning and error in CI/CD on `main`  | Findings F1–F12 below                                                                                         |
| R2  | Checks and release: failure (run 42570340658)                                            | F2, F3                                                                                                        |
| R3  | Broken Link Checker: failure (run 42570340566)                                           | F1                                                                                                            |
| R4  | Cleanup Test Repositories: cancelled (run 42472902848)                                   | F4 (the ruleset part is blocked on an administrator, B1)                                                      |
| R5  | E2E Hello World Matrix: skipped (run 42570805017)                                        | F6: skipped by design, no change                                                                              |
| R6  | Compare all CI/CD files with the JS and Python templates and reuse their best practices  | [Template comparison](#template-comparison)                                                                   |
| R7  | If a template has the same defect, report it there                                       | js-template#291, python-template#141                                                                          |
| R8  | Follow `docs/CI-CD-BEST-PRACTICES.md`                                                    | Pinned versions, retries, fail-closed steps, timeouts, concurrency, least privilege, tests for workflow logic |
| R9  | Everything in one pull request                                                           | PR #4026                                                                                                      |
| R10 | Collect logs and data into `dev/log/issues/4025/pulls/4026`; case study; upstream issues | This file, the evidence folder, and lycheeverse/lychee-action#348                                             |

## Timeline (UTC)

| When               | Event                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-20 → 11-08 | Cleanup Test Repositories is cancelled at its 15-minute timeout on 18 of 19 days (only 40177802029 on 10-25 succeeds; `cleanup-run-history.json`).                                                                        |
| before 2026-11-04  | E2E Hello World Matrix runs on main and fails (run 41776642750: claude/formal-ai, agent/nemotron-3-super-free, agent/formal-ai, codex/formal-ai, plus an act `setup-java` add-matcher error); it is then gated to opt-in. |
| 2026-11-09 05:58   | PR #4024 (issue #4023, location privacy) merges as `c6e68bc`.                                                                                                                                                             |
| 2026-11-09 05:59   | Broken Link Checker 42570340566: `Downloading from: …/lychee-v0.24.2/lychee-x86_64-unknown-linux-gnu.tar.gz`, then `exit code 22` 11 s later, before any link was checked.                                                |
| 2026-11-09 05:59   | Checks and release 42570340658, `detect-changes`: 19 "Stale dependency" warnings (agent 0.27.1 → 0.27.2, jscpd 5.4.2 → 5.4.3, lockfile).                                                                                  |
| 2026-11-09 06:03   | Same run, `test-suites`: three tests in `claude-prompt-argv-3282.test.mjs` fail; the fail-fast runner stops there.                                                                                                        |
| 2026-11-09 06:03   | E2E Hello World Matrix 42570805017: skipped (`vars.ENABLE_REAL_GITHUB_E2E` is not set; the repository has 0 Actions variables).                                                                                           |
| 2026-11-09 10:18   | Issue #4025 is opened.                                                                                                                                                                                                    |
| 2026-11-09 10:27   | Formal AI Draft 42599900381 for this issue exits 5 ("Finished without changes"); its annotation blames an HTTP 403 from gh-upload-log.                                                                                    |
| 2026-11-09 11:01   | PR run 42605582705: with the full suite and `--continue-on-failure`, `test-agent-verbose-env.mjs` fails too (F11); main never reached it.                                                                                 |
| 2026-11-09 11:17   | Security 42607903721: the new CodeQL result gate reports `1 clean report(s)` for both languages after the 44 alerts are fixed (F8).                                                                                       |
| 2026-11-09 11:24   | PR run 42608795713: `detect-changes` fails with `STALE package-lock.json#minimatch: minimatch 11.0.5 -> 10.2.6, 11.0.5` under the runner's npm 10.9.4 (F9).                                                               |
| 2026-11-09 11:25   | PR #3786 merges; it closes #3785, which 12 Dockerfile pin exceptions link (F12).                                                                                                                                          |
| 2026-11-09 11:40   | PR #3786 (issue #3785) lands on main with its own "fail every cancellation" gate and the same minimatch override; this branch merges it (F10).                                                                            |

## Findings, root causes and fixes

### F1. Broken Link Checker red with no broken link (false positive)

**Root cause.** `lycheeverse/lychee-action@v2` downloads lychee with a single
`curl -sfLO` and no retry
([action.yml#L88-L89](https://github.com/lycheeverse/lychee-action/blob/v2.9.0/action.yml#L88-L89)).
One transient error from GitHub's release download service is curl exit 22, and
that fails the job. The Python template hit the same failure in run
[34994688031](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/actions/runs/34994688031).
`experiments/issue-4025/lychee-action-curl-no-retry.sh` reproduces it without network.

Three related defects were found in the same workflow:

- `--cache` wrote `.lycheecache` into a workspace that is thrown away. The
  documented warm cache never existed, so every run re-checked every link.
- The failure message pointed to a report artifact that was never uploaded.
- `check-web-archive.mjs` treated a missing lychee report as "everything archived"
  (a false negative).

**Fix.** `scripts/install-lychee.sh` installs a pinned lychee with
`curl --retry --retry-all-errors` and checks the published SHA-256. lychee then
runs in a `run:` step. That step:

- writes `exit_code`;
- publishes the report to the job summary;
- fails when lychee writes no report (exit 2 is used both for "broken links"
  and for a bad command line);
- fails when zero links were checked;
- fails on any other non-zero exit.

`.lycheecache` is restored and saved with `actions/cache`, and only successes are
cached. The report is uploaded as an artifact, and the checkout no longer keeps
credentials. A missing report is now an error in `check-web-archive.mjs`.

**Test.** `tests/links-workflow-lychee-4025.test.mjs` runs the real step script
and the real installer against local stubs.

**Upstream.** lycheeverse/lychee-action#348, link-foundation/js-ai-driven-development-pipeline-template#291 and
link-foundation/python-ai-driven-development-pipeline-template#141. The templates
had already fixed the cache problem (js #278, python #131), so only the
download is reported there.

### F2. `test-suites` red on main only (failures hidden on pull requests)

**Root cause.** Pull requests ran an 18-file `pr-essential` subset, so a
regression in any of the other ~700 default-suite test files first appeared on main.
Run 41801786544 (line-limit test) and run 42570340658 (prompt tests broken by
PR #4024's location-privacy suffix) both show this. Main then stopped at the
first failing file, which hid the rest: `--continue-on-failure` found seven
broken tests, not three.

**Fix.**

- Both lanes now run the full default suite with `--continue-on-failure`.
- The tests that #4024 broke now expect the policy text: Claude argv, Gemini
  stdin, the Codex cancellation probe, and the prompt-size budget.
- Three tests that hard-coded dependency pins or built the Codex environment
  differently from production were rewritten so they no longer depend on the
  current pin.

### F3. "Stale dependency" warnings on every push to main

**Root cause.** The freshness gate warns on push and fails on pull requests.
New releases of `@link-assistant/agent` (0.27.2), `jscpd` (5.4.3) and
`peter-evans/create-pull-request` (v8.1.2) made every main run warn.

**Fix.** The four Dockerfiles, `package.json`, the lockfile (within allowed
ranges) and the SHA pin in `release.yml` are all updated.
`node scripts/check-dependency-freshness.mjs` reports
`All tracked dependency declarations are current.`

### F4. Cleanup Test Repositories cancelled every day

**Root cause.** Ruleset 21204104 (`no-destruction-possible`, `~ALL`, deletion
rule, no bypass actors) keeps every fixture branch, so stale branches pile up
(1,380 now). For each branch the script made about three sequential API calls:
the commit, the branch rules, and the ruleset. That came to about 3,400 calls
with no output until the end, so the 15-minute timeout killed it, and a
timeout shows up as "cancelled".

**Fix.**

- Commit dates are read over GraphQL, 100 branches per request, with a REST
  fallback.
- A deletion ruleset that covers every branch is detected once, and ruleset
  reads are memoized.
- The script logs progress, and `CLEANUP_VERBOSE=true` logs every API call
  (off by default).
- The script stops at `CLEANUP_TIME_BUDGET_MINUTES` with a warning.
- Runs are serialized with a concurrency group.

A read-only dry run now takes 35 s (`cleanup-dry-run-after-fix.txt`).

**Test.** `tests/cleanup-task-fixtures-budget-4025.test.mjs`.

**Blocked (B1).** The `Fixture branches retained` warning is accurate and stays.
The retained branches are of two kinds:

- `e2e/hello-world/*` and `e2e/integration/*` fixture branches;
- the same-repository `issue-*` head branches of solver PRs opened against them.

A repository administrator must change ruleset 21204104. Excluding
`refs/heads/e2e/**` covers the first kind. The second kind cannot be excluded
by pattern without also unprotecting real `issue-*` branches, so it needs a
bypass for the cleanup App instead. The script deletes both kinds as soon as
the rule allows. Only a person with admin rights can make this change.

### F5. Formal AI Draft failure annotated with an unrelated HTTP 403

**Root cause.** Every red issue-triggered draft exits 5
(`EXIT_CODE_SOLVE_NO_CHANGES`, issue #3211). `formal-ai-draft.mjs` annotated
the first error-looking line in the log. That line was the gh-upload-log 403
(`Resource not accessible by integration` on `/gists` and `/user`), which
solve recovers from: it detects the integration token and stops retrying. So
the annotation, and the health check that reads it, blamed a recovered
side-effect instead of the real outcome.

**Fix.** `draftFailureReason` prefers solve's
`⚠️  Finished without changes: <reason>` line. The draft stays red, which is
correct because it produced nothing, but it now says why.

**Test.** `tests/formal-ai-draft-3248.test.mjs` uses the real log lines from run 42599900381.

**Not reported upstream.** The 403 is a property of `GITHUB_TOKEN` (it cannot
create gists). hive-mind already handles it, so gh-upload-log has no defect to
report.

### F6. E2E Hello World Matrix skipped (correct, no change)

`e2e-hello-world-matrix.yml` runs only when `vars.ENABLE_REAL_GITHUB_E2E == 'true'`.
That opt-in is documented in `CHANGELOG.md` and `docs/CI-CD-BEST-PRACTICES.md`,
and the repository defines no Actions variables. "Skipped" is the true state.
Forcing the job green would be a false positive. Before the gate, the matrix
failed on main (archived log of run 41776642750).

### F7. Formatting and workflow lint coverage

The Workflows check did not lint changes under `.github/actions/**`, and zizmor
still had a policy for the lychee actions that are no longer used. Both are
fixed in 6db96f96a.

### F8. 44 CodeQL alerts on main behind a green Security check (false negative)

**Root cause.** `github/codeql-action/analyze` uploads its results and passes,
whatever it finds. Main had 44 open alerts (`codeql-open-alerts-main.txt`):

| Rule                                          | Alerts |
| --------------------------------------------- | -----: |
| `js/incomplete-url-substring-sanitization`    |     22 |
| `js/shell-command-injection-from-environment` |     10 |
| `js/incomplete-sanitization`                  |      8 |
| `js/clear-text-logging`                       |      2 |
| `js/redos`                                    |      1 |
| `js/identity-replacement`                     |      1 |

Some of them were real bugs:

- `use-m-single-flight` used a specifier pattern that backtracks exponentially
  (442 ms on 50 characters; `experiments/issue-4025/specifier-regex-equivalence.mjs`).
- The three MarkdownV2 escapers did not escape `\`, so `a\_b` reached Telegram
  with a bare `_`.
- Verbose `/limits` logged the last 8 characters of the OAuth tokens. Main's
  PR #3786 fixed the same lines while this PR was open, and the merge keeps
  main's version.

**Fix.** Each alert is fixed in code: 89239d21f for `src/` and 6bddbb1f5 for
`tests/`. `security.yml` writes the SARIF reports and gates on them with
`scripts/check-codeql-results.mjs` (adapted from the JS template). It keeps the
reports as an artifact and reports every result on pull requests
(`CODEQL_ACTION_DIFF_INFORMED_QUERIES=false`).

**Tests.** `codeql-results-gate-4025` and `codeql-source-alerts-4025`. Run
42607903721 logged `CodeQL result gate: 1 clean report(s)` for both languages
(`security-42607903721-codeql-gate.log`).

### F9. Dependabot alerts, and a lockfile that npm 10 and npm 11 disagree on

**Root causes.**

- Alert #9 (minimatch, GHSA-g3hv-75wg-m249) is real: ESLint 10 pulled in a
  vulnerable minimatch 10.x.
- Alert #8 (setuptools, GHSA-xmj3-9gf7-h52w) is a false positive. The dependency
  graph read an evidence copy of another project's `requirements.txt` under
  `docs/case-studies/issue-3863/` as a manifest of this repository.
- The first override used a ranged key, `"minimatch@>=7.0.0 <11.0.1"`. npm 11
  kept that tree, but the runner's npm 10.9.4 re-nested
  `@eslint/config-array/node_modules/minimatch@10.2.6` on
  `npm update --package-lock-only`. The freshness gate therefore failed the PR
  with a lockfile that was actually correct (`checks-42608795713-freshness-npm10.log`).

**Fix.**

- A bare `"minimatch": "^11.0.5"` override, which every dependent accepts
  (`@eslint/config-array` ^10.2.4 → 11.x via the override, `glob` ^11.0.5).
  npm 10.9.4 and npm 11.20 both leave a single `node_modules/minimatch@11.0.5`.
  Main's PR #3786 landed the same override.
  `experiments/issue-4025/minimatch-11-eslint-globs.mjs` checks ESLint's glob
  matching with 11.x.
- The copied manifest is renamed to `.txt.snapshot` (c81723999).

**Test.** `tests/dependency-overrides-4025.test.mjs` rejects ranged override
keys and requires a single patched minimatch. It fails on the ranged key.

### F10. Timeouts reported as a pass, and checks without a status

**Root causes.**

- GitHub reports a job killed by `timeout-minutes` as `cancelled`.
  `check-pipeline-status.sh` downgraded every non-main cancellation to a
  warning, so a PR job that timed out left the Pipeline Status green.
  `IS_MAIN` also required `event_name == 'push'`, which meant a
  `workflow_dispatch` on main got the PR policy.
- Links, Security and Workflows had no status gate at all, so a timed-out job
  left those runs grey rather than red.
- actionlint only reads inline `run:` blocks. Nothing linted the 27 standalone
  shell scripts and hooks. `shellcheck-before.txt` has 35 findings; the 4
  outside evidence folders are missing shebangs in `.husky/pre-commit` and the
  two `gitpod-*-auth.sh` files, and an `ls | grep` in
  `scripts/verify-docker-image.sh`.
- Jobs that never push kept the `GITHUB_TOKEN` in `.git/config` (zizmor
  `artipacked`).

**Fix.**

- The gate fails on any cancellation unless the ref head has moved past the
  tested commit (`git ls-remote`, compared with the PR head SHA, not the merge
  commit). It fails closed when the head cannot be resolved.
  `PIPELINE_STATUS_VERBOSE=1` prints its reasoning; this is off by default.
- PR #3786 (issue #3785) independently made every cancellation fail after a
  checkout timeout passed as "superseded". The merge keeps that behaviour for
  timeouts and unknown heads, and it keeps #3785's test and wording. It still
  excuses runs that a newer commit really replaced, because the new Links,
  Security and Workflows gates cancel in-progress runs on main too, and a
  red X there would be a false positive.
- Links, Security and Workflows each get a `pipeline-status` gate that
  observes every job.
- The Workflows check runs ShellCheck 0.11.0 (pinned via `shellcheck-py`) on
  tracked scripts and hooks. Evidence folders (`experiments/`, `dev/`,
  `docs/case-studies/`) are excluded.
- 18 read-only release jobs and the gates use `persist-credentials: false`.
  Checkout `with:` blocks are written as one-line maps, which keeps
  `release.yml` at 1,349 lines, under the 1,350-line warning of
  `check-file-line-limits.sh`.

**Tests.** `ci-integrity-2150` (supersede, timeout and unknown-head cases, plus
the wiring of all four gates) and `workflow-shellcheck-4025`.

### F11. A test broken on main that fail-fast hid

`tests/test-agent-verbose-env.mjs` matched the whole `agentEnv` line. PR #4024
added `...buildGeolocationEnv(argv)` to it, so the test failed on main. The
fail-fast runner stopped at `claude-prompt-argv-3282` first, so this failure
never showed up there. It appeared as soon as F2's `--continue-on-failure` ran
(`checks-42605582705-agent-verbose-env.log`). The test now matches the
inheritance (`{ ...process.env`) and no longer depends on the rest of the line.

### F12. Every pull request failed after PR #3786 merged (false positive)

**Root cause.** PR #3786 (issue #3785) pinned Codex 0.164.0, Qwen Code 0.27.0,
Gemini CLI 0.65.0 and OpenCode 1.19.5 in all three Dockerfiles. Each of the 12
pin lines linked #3785 as its freshness exception. An exception is valid only
while its issue is open. The PR body said "Fixes #3785", so the merge at
11:25 closed the issue and turned every exception into
`Exception issue is closed or invalid`. From then on `detect-changes` failed
on every pull request (Checks and release run 42611647973,
`checks-42611647973-closed-exception-issue.log`), and pushes to main got 12
"Unresolved dependency" warnings. Nothing had checked that the tracking issue
would outlive the pull request that added the exception.

**Fix.**

- The 12 pins now link #4027, an open issue that tracks upgrading these CLIs
  together with their storage adapters.
- On a pull request, `check-dependency-freshness.mjs` reads the event's PR body
  and collects the issues it closes (GitHub's `close`, `fix` and `resolve`
  keywords, as `#N`, `owner/repo#N` or an issue URL). An exception that links
  one of them is an error, which names the issue and asks for a separate
  tracking issue (`freshness-closing-issue-guard-local.txt`).

**Test.** `tests/dependency-freshness-closing-issue-4025.test.mjs`. It fails
without the guard.

## Template comparison

The workflows were compared file by file with
[js-ai-driven-development-pipeline-template](https://github.com/link-foundation/js-ai-driven-development-pipeline-template)
and
[python-ai-driven-development-pipeline-template](https://github.com/link-foundation/python-ai-driven-development-pipeline-template)
(default branches as of 2026-11-09).

**Already equivalent in hive-mind.**

- actionlint, zizmor, CodeQL, dependency review and npm audit.
- secretlint, jscpd, and ESLint with `--max-warnings 0`.
- A release `pipeline-status` gate whose coverage is tested.
- The fresh-merge simulation in `lint`, and timeouts on every job.
- The web-archive check and the link recheck step.

**Adopted in this PR.**

| Template practice                                     | hive-mind change                 |
| ----------------------------------------------------- | -------------------------------- |
| Persistent lychee cache, report artifact, fail closed | F1                               |
| Same test suite on pull requests and main             | F2                               |
| Fail on CodeQL results (`check-codeql-results`)       | F8                               |
| Supersede-aware cancellation in the status gate       | F10                              |
| A status gate per workflow                            | F10 (Links, Security, Workflows) |
| ShellCheck for standalone scripts                     | F10                              |
| `persist-credentials: false` on read-only checkouts   | F1, F8, F10                      |
| Workflow lint triggered by `.github/actions/**`       | F7                               |
| Concurrency for scheduled maintenance jobs            | F4                               |

**Same defect in the templates (reported).** Both templates install lychee
through `lycheeverse/lychee-action`, which downloads it with no retry:
[js#291](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/291),
[python#141](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/141)
and the root cause,
[lycheeverse/lychee-action#348](https://github.com/lycheeverse/lychee-action/issues/348).
The red main runs in both templates are configuration problems, not template
defects: js has no `NPM_TOKEN`, and python's PyPI trusted publisher is not
configured.

**Not adopted (low severity, no observed failure).**

- A weekly scheduled link check.
- `rerun-unacquired.yml`: no runner-acquisition failures appear in the last 60 main runs.
- Per-step time budgets (`run-with-budget-warning`).
- A dependency-graph prerequisite job.
- The fresh-merge simulation in `test-suites`; `lint` already covers it.
- zizmor `min-confidence: low` / a pedantic pass.
- actionlint pinned by digest instead of version.
- A package smoke test.
- lychee `--hidden --extensions` and a `lychee.toml` rate limit.
- `check-ci-workflows` pin checks.

## Blocked

- **B1.** Ruleset 21204104 needs an administrator to exclude
  `refs/heads/e2e/**` and add a bypass for the cleanup App (F4). Until then
  the cleanup warning `Fixture branches retained` is accurate and stays.

## Verification

- Focused tests:
  - lychee, cleanup and drafts: `links-workflow-lychee-4025`,
    `cleanup-task-fixtures-budget-4025`, `formal-ai-draft-3248`;
  - pins and prompts: `test-issue-2186`, `test-issue-2187`,
    `test-lino-arguments-cli`, `claude-prompt-argv-3282`,
    `test-gemini-support`, `optional-automation-2324`,
    `resource-aware-prompts-3837`;
  - CodeQL: `codeql-results-gate-4025`, `codeql-source-alerts-4025`;
  - dependencies and environment: `dependency-overrides-4025`,
    `dependency-freshness-closing-issue-4025`, the three earlier
    `dependency-freshness-*` tests, `test-agent-verbose-env`;
  - gates and ShellCheck: `ci-integrity-2150`, `workflow-shellcheck-4025`,
    `ci-workflow-cancellation-2082`;
  - all 30 tests that read `release.yml`.
- `actionlint` 1.7.12 and ShellCheck 0.11.0 (the job's file list) report nothing.
- `node scripts/check-dependency-freshness.mjs` with a simulated pull request
  event: all declarations are current with this PR's body; with a body that
  closes #4027 it reports 12 errors.
  `npm update --package-lock-only` with npm 10.9.4 leaves every package
  version unchanged. `npm audit`: 0 vulnerabilities.
- `bash scripts/check-file-line-limits.sh`: no warnings.
- The full default suite and all workflows run as PR #4026 checks on the final commit.
