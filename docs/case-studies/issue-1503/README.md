# Case Study: Issue #1503 - False positive "Ready to merge" (iteration count as checkCount)

## Summary

The auto-restart-until-mergeable monitor posted a "Ready to merge" comment on
PR xlabtg/teleton-plugins#87 while CI check "Build (SDK with DTS)" was still in progress.
The root cause was that the `watchUntilMergeable` loop passed its total `iteration` counter
as `checkCount` to `getMergeBlockers`, causing the safety valve (`MAX_NO_RUNS_CHECKS=5`)
to fire prematurely after a new commit was pushed.

## Timeline

| Time (UTC) | Event                                                       |
| ---------- | ----------------------------------------------------------- |
| 11:35:28   | Initial .gitkeep commit `1ccd0e4` pushed (PR #87 created)   |
| 11:35:35   | PR #87 created on xlabtg/teleton-plugins                    |
| 11:38:12   | Fix commit `6e76a8d` pushed                                 |
| 11:39:05   | Revert .gitkeep commit `2f5b301` pushed (HEAD)              |
| 11:39:13   | CI workflow runs created for HEAD SHA                       |
| 11:39:17   | CI check-runs start (Lint, Build, Test, TypeScript, deploy) |
| 11:40:22   | "Ready to merge" comment posted (FALSE POSITIVE)            |
| 11:39:38   | CI / Build (SDK with DTS) completes (last check)            |

Note: The "Ready to merge" comment at 11:40:22 was posted 44 seconds after all checks
had actually completed at 11:39:38. The screenshot captured the state while CI was still
running (before 11:39:38), showing the inconsistency.

## Root Cause

### Primary: `iteration` used as `checkCount`

In `watchUntilMergeable` (solve.auto-merge.lib.mjs:558), the monitoring loop's `iteration`
counter (total check cycles since process start) was passed directly as `checkCount` to
`getMergeBlockers`:

```javascript
// BEFORE (buggy):
const { blockers } = await getMergeBlockers(owner, repo, prNumber, argv.verbose, iteration);
```

The `checkCount` parameter controls a safety valve in `getMergeBlockers`:

- When `no_checks` + `hasPRTriggers` + `workflowRuns.length === 0`
- If `checkCount >= MAX_NO_RUNS_CHECKS (5)` → conclude "CI was not triggered"

The `iteration` counter increments on EVERY check cycle, regardless of CI state. After 5+
iterations (including iterations where CI was pending/running for a previous commit), any
new push that hadn't registered workflow runs yet would immediately trigger the safety valve.

### Secondary: No SHA change detection

The counter was never reset when the PR's HEAD SHA changed (new push detected). This meant
the counter accumulated across different commits, making the safety valve progressively
less protective with each commit.

### Attack scenario

```
Iteration 1-5: CI pending on commit A (checkCount = 1, 2, 3, 4, 5)
Iteration 6:   New commit B pushed, no workflow runs yet (checkCount = 6)
                → checkCount >= 5 → Safety valve fires
                → "CI was not triggered" (FALSE POSITIVE)
```

## Fix

### 1. Per-SHA consecutive counter (solve.auto-merge.lib.mjs)

Track `consecutiveNoRunsChecks` separately from `iteration`, and reset it when:

- The HEAD SHA changes (new push detected)
- CI checks are found (status is not `no_checks`)

```javascript
// AFTER (fixed):
if (currentHeadSha !== lastKnownHeadSha) {
  lastKnownHeadSha = currentHeadSha;
  consecutiveNoRunsChecks = 0;
  readyToMergeCommentPosted = false;
}
consecutiveNoRunsChecks++;
const { blockers } = await getMergeBlockers(..., consecutiveNoRunsChecks, prBranch);
```

### 2. Branch-aware workflow file parsing (github-merge.lib.mjs)

`checkWorkflowsHavePRTriggers` now accepts an optional `ref` parameter to query workflow
files from the PR branch rather than only the default branch. This ensures the workflow
trigger analysis reflects the actual workflow configuration that will be used for the PR.

### 3. Counter reset on CI state change

When `getMergeBlockers` returns a CI status other than `no_checks` (e.g., `pending`,
`success`, `failure`), the counter is reset to 0. This prevents accumulation across
different CI states.

## Files Changed

- `src/solve.auto-merge.lib.mjs` — Per-SHA counter tracking, SHA change detection
- `src/github-merge.lib.mjs` — `checkWorkflowsHavePRTriggers` ref parameter
- `tests/test-false-positive-iteration-count-1503.mjs` — 11 unit tests

## Related Issues

- Issue #1480: Multi-layer false positive defense (grace period, workflow parsing)
- Issue #1442: Workflow runs API for CI detection
- Issue #1363: False positive ready-to-merge
- Issue #1345: No CI configured vs race condition
- Issue #1466: Non-executing workflow runs (action_required)

## Data Sources

- Full log: `ci-logs/issue-1503-full-log.txt`
- Screenshot: `ci-logs/issue-1503-screenshot.png`
- PR: https://github.com/xlabtg/teleton-plugins/pull/87
