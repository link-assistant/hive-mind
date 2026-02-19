# Case Study: Issue #1335 — Auto-restart cycle stuck and lead to 20+ hours of solve process hang

## Summary

A solve process running with `--auto-restart-until-mergeable` got stuck in an infinite loop for 20+ hours because the target repository had **no CI/CD checks configured**. The `watchUntilMergeable` loop in `solve.auto-merge.lib.mjs` treats `no_checks` (a status returned when a repo has zero CI workflows) identically to a transient race-condition state and simply waits 60 seconds before re-checking — forever, with no timeout or escape condition.

## Timeline of Events

| Time (UTC)             | Event                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| 2026-02-17 23:13:11    | solve started: `solve https://github.com/MILANA808/milana_site/pull/18 --auto-restart-until-mergeable` |
| 23:13 – 23:28          | Claude AI session ran (PR #18 on MILANA808/milana_site — a simple HTML site with no CI)                |
| 23:28:25               | Claude session ended, `watchUntilMergeable` loop started                                               |
| 23:28:28               | **First `no_checks` hit**: "CI/CD checks have not started yet"                                         |
| 23:28 – 09:27 next day | Loop ran **1,920 iterations**, one per minute, never exiting                                           |
| 2026-02-19 09:27:18    | Process manually killed with Ctrl+C                                                                    |

Total hang duration: **~10 hours** (the log captured only a portion; based on check count, the real total was ~32 hours of polling if not interrupted).

## Root Cause Analysis

### Primary Root Cause: No timeout for `no_checks` state in `watchUntilMergeable`

**File:** `src/solve.auto-merge.lib.mjs`, function `watchUntilMergeable`

The `getMergeBlockers()` function calls `getDetailedCIStatus()`, which returns `{ status: 'no_checks' }` when a repository's PR has **zero** check runs or commit statuses. This is a valid permanent condition for repos without any CI pipelines.

The code maps `no_checks` to a `ci_pending` blocker:

```js
if (ciStatus.status === 'no_checks') {
  blockers.push({
    type: 'ci_pending',
    message: 'CI/CD checks have not started yet (waiting for checks to appear)',
    details: [],
  });
}
```

Later in `watchUntilMergeable`, a `ci_pending` blocker is handled by:

- NOT setting `shouldRestart = true`
- Logging "Waiting for CI..."
- Sleeping 60 seconds
- Looping again

There is **no maximum wait time** for the `ci_pending` / `no_checks` state. The loop is `while (true)` with no break condition for this path.

### Secondary Root Cause: No distinction between transient `no_checks` and permanent `no_checks`

The comment in the code says `no_checks` is a "race condition after push" — meaning it was designed to handle the brief window between a git push and GitHub starting CI runners. However, a repo with **no CI configuration at all** will also return `no_checks` — permanently. The code makes no distinction.

### Contributing Factor: The target repository genuinely had no CI

`MILANA808/milana_site` is a simple HTML portfolio site with no `.github/workflows/` directory. It will never have CI checks. Any PR to this repository will always return `no_checks`.

### Contributing Factor (Agent tool): Same issue applies to `watchForFeedback` in `solve.watch.lib.mjs`

The `watchForFeedback` function (used for `--watch` mode and temporary auto-restart) also has an unbounded loop, but its primary exit conditions (PR merged, max iterations reached, all changes committed) work differently. However, the `--watch` mode version also has no timeout for the case where CI never appears.

## Evidence from Log

```
[2026-02-17T23:28:25.476Z] [INFO] 🔄 AUTO-RESTART-UNTIL-MERGEABLE MODE ACTIVE
[2026-02-17T23:28:26.360Z] [INFO] 🔍 Check #1:      11:28:25 PM
[2026-02-17T23:28:28.927Z] [INFO]   ⏳ Waiting for CI: CI/CD checks have not started yet
[2026-02-17T23:28:28.928Z] [INFO]   ⏱️ Next check in: 60 seconds...
...
[2026-02-19T09:27:12.070Z] [INFO] 🔍 Check #1920:   9:27:08 AM
[2026-02-19T09:27:12.069Z] [INFO]   ⏳ Waiting for CI: CI/CD checks have not started yet
[2026-02-19T09:27:18.744Z] [ERROR] ❌ Interrupted (CTRL+C)
```

**1,920 checks** × 60 seconds = **32 hours** of pointless polling before manual interruption.

## Comparison: `--tool claude` vs `--tool agent`

The issue title asks to ensure logic is in sync for both `--tool claude` and `--tool agent`. Both tools use the same `watchUntilMergeable` function (from `solve.auto-merge.lib.mjs`) and the same `watchForFeedback` function (from `solve.watch.lib.mjs`). The `executeToolIteration` function in `solve.restart-shared.lib.mjs` dispatches to the correct tool implementation. The stuck CI loop bug affects **both tools identically**.

## Proposed Solutions

### Solution 1 (Implemented): Add `no_checks` timeout to `watchUntilMergeable` (PRIMARY FIX)

Add a configurable maximum wait time for the `no_checks` / `ci_pending` state. If CI checks have not appeared within N minutes (default: 30 minutes), treat the repo as having no CI and exit the loop with a "mergeable" result.

**Implementation:**

- Add `noChecksTimeoutMs` config to `config.lib.mjs` (default: 30 minutes)
- In `watchUntilMergeable`, track when `no_checks` was first seen
- After `noChecksTimeoutMs` of continuous `no_checks`, log a warning and exit as "mergeable (no CI)"
- Apply the same fix to `watchForFeedback` for `--watch` mode

### Solution 2: Distinguish permanent `no_checks` from transient

After detecting `no_checks`, verify whether the repository has any workflow files in `.github/workflows/`. If it doesn't, immediately treat as "no CI configured" and exit. However, this requires an additional API call and may produce false negatives for repos that trigger CI via external services or via repository_dispatch.

### Solution 3: Add global process timeout

Add a top-level maximum runtime for the entire solve process (e.g., `--max-runtime-hours`). While useful, this is a blunt instrument and doesn't help with the CI-no-checks specific case.

## Related Issues

- Issue #1314: Billing limit CI handling (cancelled checks)
- Issue #1269: Callback timeout to prevent infinite blocking in `waitForCI`
- Issue #1124: Playwright MCP artifacts triggering auto-restart
- Issue #1190: Auto-restart-until-mergeable implementation

## Files Involved

- `src/solve.auto-merge.lib.mjs` — `watchUntilMergeable`, `getMergeBlockers`
- `src/solve.watch.lib.mjs` — `watchForFeedback`
- `src/github-merge.lib.mjs` — `getDetailedCIStatus`, `waitForCI`
- `src/config.lib.mjs` — configuration constants
- `src/solve.restart-shared.lib.mjs` — shared tool dispatch

## Log Reference

- Full log: `./full-log.txt` (18,374 lines)
- Gist URL: https://gist.githubusercontent.com/konard/26d45c8e8aece11df677043e4c41229e/raw/8b818ebde8874f26774210ea3355f3c9527522dc/2478274b-499c-49bd-90d4-8d5d55a84b12.log
