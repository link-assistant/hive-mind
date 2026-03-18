# Case Study: Issue #1439 — Missing Log Upload on Failure in Auto-Restart Session

## Summary

When `--attach-logs` is enabled and a solve session uses `--auto-restart-until-mergeable`,
a tool execution failure inside the auto-restart loop causes the session to end **without
uploading the failure log** to the Pull Request. The user sees a generic "Work session end
comment" but has no log link to understand what went wrong.

## Timeline of Events (PR #147 in netkeep80/BinDiffSynchronizer)

| Time (UTC)       | Event                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------- |
| 2026-03-17T19:54 | Session 1 fails ("Session interrupted by user CTRL+C") — **failure log IS uploaded**      |
| 2026-03-17T19:57 | Session 2 starts                                                                          |
| 2026-03-17T20:18 | Session 2 fails ("CLAUDE execution failed") — **failure log IS uploaded**                 |
| 2026-03-17T20:38 | Session 3 starts                                                                          |
| 2026-03-17T21:02 | Session 3 fails ("CLAUDE execution failed") — **failure log IS uploaded**                 |
| 2026-03-18T11:49 | Session 4 starts. This session includes **auto-restart-until-mergeable**                  |
| 2026-03-18T12:27 | Session 4 main iteration completes. Log IS uploaded. Auto-restart triggered (CI failures) |
| 2026-03-18T12:37 | Auto-restart notification posted to PR                                                    |
| 2026-03-18T12:41 | Auto-restart iteration fails with API 529 (Anthropic overloaded)                          |
| 2026-03-18T12:41 | ❌ **Log NOT uploaded.** Only a bare "Work session end comment" is posted                 |

## Root Cause

In `src/solve.auto-merge.lib.mjs`, the auto-restart loop for `--auto-restart-until-mergeable`
handles **success** by uploading the log (lines 767-810), but **failure** paths return
immediately without uploading:

```js
// Line 753-758 (non-limit failure):
// Any other failure (not usage limit): stop the auto-restart loop
await log(formatAligned('❌', `${argv.tool.toUpperCase()} EXECUTION FAILED`, ''));
await log(formatAligned('', 'Action:', 'Stopping auto-restart — tool execution failed', 2));
return { success: false, reason: 'tool_failure', latestSessionId, latestAnthropicCost };

// Line 738-742 (failure after limit resume):
await log(formatAligned('❌', `${argv.tool.toUpperCase()} RESUME FAILED`, ''));
await log(formatAligned('', 'Action:', 'Stopping auto-restart — tool execution failed after limit reset', 2));
return { success: false, reason: 'tool_failure_after_resume', latestSessionId, latestAnthropicCost };
```

Back in `solve.mjs`, `logsAttached` is only set to `true` when `autoMergeResult.success` is `true`
(line 1404). Since the failure returns `success: false`, `logsAttached` remains `false` and
`endWorkSession` posts a plain "Work session end comment" with no log.

The first three sessions DID upload failure logs because those failed in the **outer** solve
flow (before auto-restart-until-mergeable), which has a different code path that does upload
the failure log.

## Affected Code Paths

1. `src/solve.auto-merge.lib.mjs:753-758` — `tool_failure` return (no log upload)
2. `src/solve.auto-merge.lib.mjs:738-742` — `tool_failure_after_resume` return (no log upload)

## Fix

Before each early-return on failure in the auto-restart loop (inside
`startAutoRestartUntilMergeable`), add a log-attachment call using the same pattern as the
success path (lines 767-810), but pass `errorMessage` to trigger the "Solution Draft Failed"
comment format.
