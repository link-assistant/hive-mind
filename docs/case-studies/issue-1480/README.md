# Case Study: Issue #1480 - `Ready to merge` posted as false positive

## Summary

The auto-restart-until-mergeable monitor posted a "Ready to merge" comment on PR #1479
approximately 19 seconds after the last commit was pushed, while CI workflows had not yet
been registered in the GitHub Actions API. CI later started and failed (lint,
check-file-line-limits).

## Timeline

| Time (UTC) | Event                                                             |
| ---------- | ----------------------------------------------------------------- |
| 09:53:33   | Last commit `9ed29b7` pushed (Revert "Initial commit")            |
| ~09:53:50  | Auto-merge monitor runs `getMergeBlockers()`                      |
| ~09:53:50  | `getDetailedCIStatus()` returns `no_checks`                       |
| ~09:53:50  | `checkPRMergeable()` returns `mergeable: true`                    |
| ~09:53:50  | `getActiveRepoWorkflows()` returns `hasWorkflows: true`           |
| ~09:53:50  | `getWorkflowRunsForSha()` returns **0 runs** (not yet registered) |
| ~09:53:50  | Code concludes: "CI was definitively NOT triggered"               |
| 09:53:52   | "Ready to merge" comment posted (FALSE POSITIVE)                  |
| 09:55:18   | CI workflow actually starts running                               |
| 09:56:11   | CI finishes — `lint` and `check-file-line-limits` FAIL            |

## Root Cause

The fix for issue #1442 added `getWorkflowRunsForSha()` to distinguish between:

- Workflow runs triggered but check-runs not yet registered (race condition)
- CI not triggered at all (fork PR, `paths-ignore`, etc.)

The assumption was: if `workflow_runs` API returns 0 runs, CI was "definitively NOT
triggered." But this assumption is flawed — **GitHub Actions workflow runs also take time
to appear in the API after a push** (typically 30-120 seconds).

The race condition timeline:

```
Push → (0-30s) → Workflow runs appear in API → (0-30s) → Check-runs appear in API
```

The code only protected against the second race (workflow runs exist but check-runs don't)
but not the first race (workflow runs themselves don't exist yet).

## Code Path (before fix)

```
getMergeBlockers() → src/solve.auto-merge.lib.mjs:190
├── getDetailedCIStatus() → returns no_checks (no check-runs yet)
├── checkPRMergeable() → returns mergeable: true (no required status checks)
├── getActiveRepoWorkflows() → returns hasWorkflows: true
└── getWorkflowRunsForSha() → returns [] (workflow runs not registered yet)
    └── Line 265: noCiTriggered: true ← FALSE POSITIVE
```

## Fix

Instead of immediately concluding "CI not triggered" when `getWorkflowRunsForSha()` returns
0 runs, the code now:

1. Checks the time elapsed since the last commit was pushed
2. If less than a configurable grace period (default 120 seconds), treats it as a potential
   race condition and returns a `ci_pending` blocker to wait
3. Only concludes "CI not triggered" after the grace period has elapsed AND workflow runs
   are still empty
4. Additionally parses `.github/workflows/*.yml` files to check if any workflow has PR
   triggers (`on: pull_request` or `on: push` for PR branches), providing a second signal

## Related Issues

- Issue #1442: No CI timeout handling (introduced the flawed `getWorkflowRunsForSha` check)
- Issue #1466: Auto-restart stuck with `action_required` workflows
- Issue #1363: False positive "ready to merge" for repos with no required checks
- Issue #1345: Differentiate "no CI configured" vs "CI not triggered"
- Issue #1425: False positive "failed CI" detection

## Evidence

- False positive comment: https://github.com/link-assistant/hive-mind/pull/1479#issuecomment-4125186525
- CI run showing failures: PR #1479 statusCheckRollup shows lint FAILURE at 09:56:11
- Solution draft log: https://github.com/link-assistant/hive-mind/pull/1479#issuecomment-4125185439
