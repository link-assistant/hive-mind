# Case Study: Issue #1290 - Missing Auto-Restart Session Finish Report for `--tool agent`

## Issue Summary

When using `--tool agent` with `--attach-logs`, the auto-restart session does not report its completion with logs when it finishes (either with success or failure). This is inconsistent with `--tool claude` behavior.

## Timeline of Events

Based on the log file `solve-2026-02-14T08-28-31-968Z.log`:

1. **08:28:31** - `solve` starts with `--tool agent --model kimi-k2.5-free --attach-logs`
2. **08:28:58** - PR #778 is created on Jhon-Crow/godot-topdown-MVP
3. **08:29:05** - Agent execution begins (session `ses_3a4bb6d8dffeiS5FRAjqmkJinT`)
4. **08:33:25** - Agent session completes with "exiting loop" message
5. **08:33:26** - Agent command completes successfully
6. **08:33:35** - **First log upload**: "Solution draft log for PR #778" uploaded as Gist
7. **08:33:35** - Uncommitted changes detected (`?? pr_description.txt`)
8. **08:33:35** - AUTO-RESTART mode activated
9. **08:33:40** - Auto-restart 1/3 comment posted to PR
10. **08:33:41** - New agent session starts (session `ses_3a4b73b0effeFXKMNNCv1Lm3b2`)
11. **08:34:12** - **JSON Parse Error**: `AI_JSONParseError` occurs during streaming
12. **08:34:12** - Error type: `UsageLimit` detected
13. **08:34:12** - Agent tool execution fails with `Tool execution aborted`
14. **08:34:13** - Changes were already committed (detected clean git status)
15. **08:34:13** - Auto-restart mode exits - "CHANGES COMMITTED! Exiting auto-restart mode"
16. **08:34:13** - Changes pushed to remote branch
17. **08:34:13** - **NO FINAL REPORT/LOG UPLOAD** ❌

## Root Cause Analysis

There are **two distinct problems** found through deep analysis of the log file.

### Problem 1: Missing log upload on auto-restart failure

When the auto-restart loop completes (lines 1368-1400 in `solve.mjs`), logs are uploaded:

```javascript
if (shouldAttachLogs && prNumber && !logsAlreadyUploaded) {
  await log('📎 Uploading working session logs to Pull Request...');
  // ... upload logic
}
```

But the per-iteration log upload in `solve.watch.lib.mjs` only happens on `toolResult.success`.
When an iteration fails, no logs are uploaded, and the final log upload at `solve.mjs:1370`
may be skipped due to the `logsAlreadyUploaded` flag from `verifyResults()`.

### Problem 2: AI_JSONParseError falsely categorized as Usage Limit (the deeper bug)

The log shows this chain of events at `08:34:12`:

1. The `kimi-k2.5` model returns a **malformed SSE stream** — two JSON objects concatenated
   without proper framing: `chatcmpl-jQugNdata:{...}`
2. The agent's internal JSON parser fails with `AI_JSONParseError`
3. The agent emits a `{"type": "error"}` event with the error details
4. The agent then emits `session.idle` and exits with **exit code 0** (recovered)

**The false categorization happens through this chain:**

1. **Issue #1276 fix** correctly clears `streamingErrorDetected` because
   `exitCode === 0 && agentCompletedSuccessfully`
2. **Fallback pattern matching** (line 787-833 of `agent.lib.mjs`) then runs because
   both `outputError.detected` and `streamingErrorDetected` are now false
3. The fallback finds `"type": "error"` in the raw `fullOutput` and extracts
   `"Tool execution aborted"` as the error message (from a different event!)
4. **`detectUsageLimit(fullOutput)`** scans the **entire output** (36K+ lines) which
   contains C# game code with comments like:
   - `"loads a shell and resets"` (line 5083)
   - `"Also resets drag start"` (line 5083)
5. The **overly broad `'resets'` pattern** in `usage-limit.lib.mjs` (line 55)
   matches these English words, falsely triggering `limitReached = true`

**Evidence from the log:**

```
[08:34:12.293Z] ⚠️  Error event detected via fallback pattern match: Tool execution aborted
[08:34:12.301Z] ⏳ Usage Limit Reached!
[08:34:12.301Z] Your Agent usage limit has been reached.
```

```json
{
  "exitCode": 0,
  "errorType": "UsageLimit",
  "errorMatch": "Tool execution aborted",
  "limitReached": true,
  "limitResetTime": null
}
```

The error was NOT a usage limit — it was a stream parsing error from the model provider,
and the agent had already recovered and completed successfully.

## Solution

### Fix 1: Upload failure logs on auto-restart iteration failure (`solve.watch.lib.mjs`)

- Added log upload for failed auto-restart iterations when `--attach-logs` is enabled
- Added tracking variables `autoRestartIterationsRan` and `lastIterationLogUploaded`
- Updated return value to include these flags for `solve.mjs` to decide on final upload

### Fix 2: Make `'resets'` pattern more specific (`usage-limit.lib.mjs`)

Changed from a simple substring match:

```javascript
'resets', // Too broad - matches "loads a shell and resets"
```

To a regex that requires time-like content after "resets":

```javascript
/resets\s+(?:(?:at\s+)?[0-9]|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/i;
```

This matches `"resets 5am"`, `"resets Jan 15, 8am"`, `"resets at 10pm"` but NOT
`"loads a shell and resets"` or `"Also resets drag start"`.

### Fix 3: Skip fallback pattern matching when agent recovered (`agent.lib.mjs`)

Added `!(exitCode === 0 && agentCompletedSuccessfully)` to the fallback condition:

```javascript
if (!outputError.detected && !streamingErrorDetected && !(exitCode === 0 && agentCompletedSuccessfully)) {
```

This prevents the fallback from finding stale error events in the output when the agent
has already recovered and completed successfully.

### Fix 4: Final log upload condition in `solve.mjs`

Updated to check `autoRestartRanButNotUploaded`:

```javascript
const autoRestartRanButNotUploaded = watchResult?.autoRestartIterationsRan && !watchResult?.lastIterationLogUploaded;
if (shouldAttachLogs && prNumber && (!logsAlreadyUploaded || autoRestartRanButNotUploaded)) {
```

## Tests Added

- `test-usage-limit.mjs`: 2 new test groups for Issue #1290:
  - False positive tests: "resets" in code comments should NOT trigger usage limit
  - True positive tests: valid "resets" usage limit messages should still be detected
- `test-agent-error-detection.mjs`: 3 new tests for Issue #1290:
  - Fallback skipped when agent completed successfully
  - Fallback still runs when agent did NOT complete successfully
  - "resets" in code output does not trigger usage limit

## References

- Log file: `solve-2026-02-14T08-28-31-968Z.log` (36426 lines)
- PR with issue: https://github.com/Jhon-Crow/godot-topdown-MVP/pull/778
- Auto-restart comment: https://github.com/Jhon-Crow/godot-topdown-MVP/pull/778#issuecomment-3901417953
