# Case Study: Issue #1287 - Agent Tool Error Handling and Log Upload

## Summary

When `--tool agent` fails (e.g., due to rate limit or other errors), the solve command should:

1. Exit with a proper failure exit code
2. Upload logs to a PR comment with clear "FAILED" marking (similar to `--tool claude` behavior)

The current implementation has a bug where failure logs are not uploaded to the PR when the agent fails because the sessionId check is too strict.

## Timeline of Events

### 2026-02-13T22:55:40Z - Command Started

```
solve https://github.com/netkeep80/aprover/issues/56 --tool agent --attach-logs --verbose --no-tool-check --auto-resume-on-limit-reset --tokens-budget-stats
```

### 2026-02-13T22:55:46Z - System Checks Completed

- Disk space verified (56807MB available)
- Memory verified (11565MB available)
- Agent connection validation passed

### 2026-02-13T22:56:08Z - Rate Limit Error Detected

API responded with HTTP 429 and error:

```json
{
  "type": "error",
  "error": {
    "type": "FreeUsageLimitError",
    "message": "Rate limit exceeded. Please try again later."
  }
}
```

Header: `retry-after: 3832` (seconds)

### 2026-02-13T22:56:14Z - Agent Failed After Retries

Error output:

```json
{
  "type": "error",
  "errorType": "UnhandledRejection",
  "message": "Failed after 3 attempts. Last error: Rate limit exceeded. Please try again later."
}
```

### 2026-02-13T22:56:15Z - Command Exited

The command properly detected failure and exited with error:

```
❌ AGENT execution failed
📁 Full log file: /home/hive/solve-2026-02-13T22-55-40-181Z.log
```

**But NO logs were uploaded to the PR!**

## Root Cause Analysis

### Primary Root Cause: Overly Strict sessionId Check

In `src/solve.mjs` at line 1115, the condition for uploading failure logs requires `sessionId` to be truthy:

```javascript
if (shouldAttachLogs && sessionId && global.createdPR && global.createdPR.number) {
```

However, when the agent fails early (e.g., rate limit before any work is done), no `sessionId` is assigned:

```json
{
  "sessionId": null,
  "limitReached": false,
  "limitResetTime": null
}
```

This causes the entire log upload block to be skipped, even though:

1. `--attach-logs` was explicitly enabled
2. A PR exists
3. The agent failed and error reporting is needed

### Secondary Issue: Inconsistent with Error Handler Pattern

The `handleFailure` function in `src/solve.error-handlers.lib.mjs` has a more lenient condition at line 43:

```javascript
if (shouldAttachLogs && getLogFile() && global.createdPR && global.createdPR.number) {
```

This does NOT require `sessionId`, which is correct since:

- Error logs should be uploaded regardless of whether a session was established
- The log file itself is the primary artifact to attach
- sessionId is optional metadata, not a prerequisite for log attachment

## Proposed Solution

### Fix 1: Remove sessionId Requirement for Failure Log Upload

Change line 1115 in `src/solve.mjs` from:

```javascript
if (shouldAttachLogs && sessionId && global.createdPR && global.createdPR.number) {
```

To:

```javascript
if (shouldAttachLogs && global.createdPR && global.createdPR.number) {
```

This aligns with the pattern used in `handleFailure()` and ensures logs are always uploaded when:

- `--attach-logs` is enabled
- A PR exists

### Fix 2: Enhance Error Detection for Agent Rate Limits

The agent tool should better detect and handle the `FreeUsageLimitError` by:

1. Recognizing the rate limit as a `limitReached` condition
2. Extracting `retry-after` header for `limitResetTime`
3. Using the enhanced `formatUsageLimitMessage()` for consistent UX

Current detection in `src/agent.lib.mjs` at line 851 only checks the last message:

```javascript
const limitInfo = detectUsageLimit(lastMessage);
```

But the rate limit error may appear in earlier JSON lines, not just the last message.

## Evidence Files

- `full-log.txt` - Complete solve command log (1736 lines)
- `error-details.json` - Structured error information from agent

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/1287
- Related files:
  - `src/solve.mjs` (lines 1097-1152) - Main failure handling
  - `src/agent.lib.mjs` (lines 836-904) - Agent error detection
  - `src/solve.error-handlers.lib.mjs` (lines 42-70) - Error handler pattern
  - `src/usage-limit.lib.mjs` - Usage limit detection utilities
