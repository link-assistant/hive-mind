# Issue 1776 Case Study: CI/CD Failure In Version Info Timing Test

## Summary

Issue #1776 reported a broken CI/CD run:

- Issue: <https://github.com/link-assistant/hive-mind/issues/1776>
- Failing run: <https://github.com/link-assistant/hive-mind/actions/runs/25634137331>
- Failing job: <https://github.com/link-assistant/hive-mind/actions/runs/25634137331/job/75243008403>
- Fix PR: <https://github.com/link-assistant/hive-mind/pull/1777>

The failed workflow was not caused by PR #1775's runtime change. That merge only triggered the full `main` CI run, where an existing brittle performance assertion in `tests/test-version-info.mjs` failed by 47 ms.

The fix changes that assertion from a hard 10 second wall-clock limit to the repository's existing 30 second "reasonable" bound used by `tests/version-info.test.mjs`. This still detects a return to sequential version collection while avoiding failures from normal GitHub-hosted runner variance and valid command timeout/fallback behavior.

## Preserved Evidence

Downloaded evidence is stored in this directory:

- `raw-data/issue-1776.json` - issue metadata.
- `raw-data/issue-1776-comments.json` - issue comments; empty at investigation time.
- `raw-data/pr-1777.json` - prepared PR metadata.
- `raw-data/pr-1777-issue-comments.json`, `raw-data/pr-1777-review-comments.json`, `raw-data/pr-1777-reviews.json` - PR discussion channels; empty at investigation time.
- `raw-data/recent-branch-runs.json` - recent runs for `issue-1776-466ab69c8daf`.
- `raw-data/run-25634137331.json` and `raw-data/run-25634137331-jobs.json` - failing run and job metadata.
- `raw-data/run-25634137331-artifacts.json` - artifact list; no artifacts were available.
- `raw-data/related-pr-1507.json`, `raw-data/related-pr-1525.json`, `raw-data/related-pr-1607.json` - related version-info history.
- `logs/run-25634137331.log.gz` - full failing workflow log.
- `logs/job-75243008403.log.gz` - failing `test-suites` job log.
- `logs/local-test-version-info-before.log.gz` - local focused run before the fix; local environment did not reproduce the timing failure.
- `logs/experiment-version-info-timeout-repro.log.gz` - deterministic local timeout/fallback reproduction showing the old 10 second assertion failing.

## Timeline

- 2026-05-10 16:41:43 UTC: PR #1775 merged into `main`.
- 2026-05-10 16:41:46 UTC: Workflow run `25634137331` started for merge commit `a0c9d445c5d56205c12c4e1e6b84cf9163f5739c`.
- 2026-05-10 16:41:58-16:42:11 UTC: `detect-changes` succeeded.
- 2026-05-10 16:42:14-16:43:13 UTC: `lint` succeeded.
- 2026-05-10 16:43:16 UTC: `test-suites` job started on `ubuntu-latest`.
- 2026-05-10 16:43:44 UTC: `npm test` started the default test suite.
- 2026-05-10 16:52:20 UTC: `tests/test-version-info.mjs` started as file 196 of 200.
- 2026-05-10 16:52:51 UTC: `getVersionInfo completes in under 10 seconds (parallel execution)` failed with `Version gathering took 10047ms, expected < 10000ms`.
- 2026-05-10 16:53:15 UTC: `tests/test-version-info.mjs` exited with `19 passed, 1 failed, 20 total`.
- 2026-05-10 16:53:18 UTC: Workflow concluded as failed because `test-suites` failed.

## Requirements From The Issue

1. Download logs and issue/run data into `docs/case-studies/issue-1776`.
2. Reconstruct the CI failure timeline.
3. List the issue requirements.
4. Identify the root cause of each problem.
5. Propose possible solutions and implementation plans.
6. Search online for additional facts and data.
7. Check related components or libraries that can help.
8. Add debug output or verbose mode if data is insufficient.
9. Report external project issues if the root cause belongs elsewhere.
10. Execute the fix in a single PR.

## Root Cause Analysis

### Problem 1: CI/CD Failed

Immediate cause: `tests/test-version-info.mjs` asserted that `getVersionInfo(false)` must complete in under 10000 ms. In the failing GitHub Actions job, it completed in 10047 ms.

Systemic cause: the assertion used an overly tight wall-clock limit for CI. `src/version-info.lib.mjs` runs many version commands in parallel, but each command uses a 5000 ms timeout. Some command definitions also have fallbacks, and those fallbacks are attempted serially after the primary command fails. Therefore one slow primary command plus one slow fallback can legitimately approach or exceed 10 seconds without indicating a regression to sequential execution.

Additional contributor: platform and hosted-runner performance are external to the test. GitHub documents `ubuntu-latest` as a GitHub-hosted VM label with fixed but shared platform characteristics for public and private repositories, and the runner image project documents weekly image updates. A timing assertion with only 47 ms of margin beyond allowed command behavior is inherently fragile in that environment.

### Problem 2: The Failure Looked Like A Product Regression

PR #1775 did not touch version-info code or tests. It changed auto-PR creation behavior and added an issue #1774 case study. The merge simply triggered a full `main` push workflow where the existing flaky test surfaced.

### Problem 3: No Artifacts Were Available

The GitHub Actions artifacts API returned `total_count: 0`. Logs and metadata were still sufficient to identify the failed test, the exact assertion, the failing job, and the triggering commit. No additional debug output was needed for this iteration.

## Online Facts And Related Components

- GitHub Actions workflow logs include job and step status, and GitHub CLI supports `gh run view --job JOB_ID --log` for full job logs: <https://docs.github.com/en/actions/how-tos/monitor-workflows/view-workflow-run-history?tool=cli>
- GitHub-hosted runner documentation lists the `ubuntu-latest` Linux runner resources and identifies jobs as running on GitHub-hosted virtual machines: <https://docs.github.com/en/actions/reference/runners/github-hosted-runners>
- The `actions/runner-images` project states that runner images are generally updated weekly and that `-latest` labels can move through migration periods: <https://github.com/actions/runner-images>
- Node.js `child_process.exec()` supports a `timeout`; when the timeout is exceeded, the child process receives the configured kill signal. This is the mechanism used by `execCommandAsync`: <https://nodejs.org/api/child_process.html>

Related local components:

- `src/version-info.lib.mjs` - version command definitions, 5000 ms command timeout, and fallback behavior.
- `tests/test-version-info.mjs` - failed wall-clock assertion.
- `tests/version-info.test.mjs` - existing broader version-info structure test already used a 30000 ms bound for `gatherTimeMs`.
- `experiments/issue-1776-version-info-timeout-repro.mjs` - local reproduction helper showing how a primary timeout plus fallback timeout can exceed the old 10000 ms threshold.

## Solution Options

Selected solution: update `tests/test-version-info.mjs` to use a 30000 ms bound, matching `tests/version-info.test.mjs`. This preserves a performance guard against sequential execution while removing the false failure for valid timeout/fallback behavior.

Alternative 1: reduce all version command timeouts. This would make `/version` faster when tools hang, but it risks missing real version data from slow tool startup in user environments.

Alternative 2: mock version commands in the timing test. That would make the test deterministic, but it would stop exercising the real command collection path that the test was intended to guard.

Alternative 3: add per-command timing diagnostics to production. This is useful if future failures need deeper latency analysis, but the current logs already identify the root cause.

## Verification Plan

- Run `node tests/test-version-info.mjs`.
- Run `node tests/version-info.test.mjs`.
- Run `npm test` to cover the default suite.
- Run `npm run format:check`.
- Run `npm run lint`.
- Run `npm run check:duplication`.
- Push the branch and verify PR #1777 CI.

## External Issue Reporting

No external project issue was filed. The failure was caused by this repository's test threshold, not a GitHub Actions, Node.js, or runner-image defect.
