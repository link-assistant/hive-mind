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

## Fix (Part 1: Missing Log Upload)

Before each early-return on failure in the auto-restart loop (inside
`startAutoRestartUntilMergeable`), add a log-attachment call using the same pattern as the
success path (lines 767-810), but pass `errorMessage` to trigger the "Solution Draft Failed"
comment format.

## Additional Finding: HTTP 529 Overloaded Error Not Retried (Part 2)

### Discovery

The auto-restart iteration that failed did so because of Anthropic API **HTTP 529** ("Overloaded")
errors. Examining the full execution log reveals:

```
post https://api.anthropic.com/v1/messages?beta=true failed with status 529 in 4361ms
  status: 529,
  'x-should-retry': 'true'    ← API explicitly says this IS retryable!
```

The Claude CLI exhausted its own internal retries ("no more retries left") and then returned a
result event with:

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": true,
  "num_turns": 1,
  "result": "API Error: 529 {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}"
}
```

### Why It Wasn't Retried

The hive-mind outer retry loop (`executeClaudeCommand` in `claude.lib.mjs`) only recognized
these overload patterns:

- `API Error: 500` + `Overloaded`
- `api_error` + `Overloaded`

But the 529 error has a **different** format:

- `API Error: 529` (not 500)
- `overloaded_error` (not `api_error`)

Since none of the detection patterns matched `529`, the error fell through to the generic
`tool_failure` path without being retried.

### Fix (Part 2)

Extended all transient error detection in `claude.lib.mjs` to also match:

- `API Error: 529` + `Overloaded` or `overloaded_error`
- `overloaded_error` + `Overloaded` (the error type used in 529 responses)

This applies to:

1. **Validation function** — overload detection in stdout/stderr/json and exception handler
2. **executeClaudeCommand** — assistant message content detection (`isOverloadError` flag)
3. **executeClaudeCommand** — `isTransientError` calculation from `lastMessage`
4. **executeClaudeCommand** — exception block `isTransientException` detection
5. **Error labels** — now display `(529)` vs `(500)` to distinguish the error source

### HTTP 529 vs 500 Overload

| Property         | HTTP 500 Overload                     | HTTP 529 Overload                    |
| ---------------- | ------------------------------------- | ------------------------------------ |
| Status code      | 500                                   | 529                                  |
| Error type       | `api_error`                           | `overloaded_error`                   |
| Message          | `Overloaded`                          | `Overloaded`                         |
| `x-should-retry` | Often `false`                         | `true`                               |
| Nature           | Server-side error (may be structural) | Explicit overload (always transient) |

HTTP 529 is a non-standard status code used by Anthropic to signal server overload. Unlike
500-based overloads (which may have `x-should-retry: false`), 529 always has
`x-should-retry: true`, making it inherently suitable for retry with backoff.
