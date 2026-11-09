# Case study: false failures, hidden failures and noise in CI/CD (issue #4025)

Issue: [#4025](https://github.com/link-assistant/hive-mind/issues/4025).
Implementation: [PR #4026](https://github.com/link-assistant/hive-mind/pull/4026).
Research date: 2026-11-09 UTC. Evidence: [`dev/log/issues/4025/pulls/4026`](../../../dev/log/issues/4025/pulls/4026/README.md).

## Requirements

| #   | Requirement (issue text)                                                                 | Where it is addressed                                                                                         |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| R1  | Find and fix every false positive, false negative, warning and error in CI/CD on `main`  | Findings F1–F7 below                                                                                          |
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

## Template comparison

See the section added after the file-by-file comparison below.

## Verification

- Focused tests: `links-workflow-lychee-4025`, `cleanup-task-fixtures-budget-4025`,
  `formal-ai-draft-3248`, `test-issue-2186`, `test-issue-2187`,
  `test-lino-arguments-cli`, `claude-prompt-argv-3282`, `test-gemini-support`,
  `optional-automation-2324`, `resource-aware-prompts-3837`.
- `node scripts/check-dependency-freshness.mjs`: all declarations current.
- Full default suite and all workflows: PR #4026 checks on the final commit.
