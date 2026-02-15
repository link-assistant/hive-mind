# Case Study: Issue #1276 - `"type": "status"` Treated as Error (False Positive)

## Issue Summary

When using `--tool agent`, the `solve` command incorrectly reports an error even when the agent completes successfully with exit code 0. The error message displayed is from a **status** message, not an actual error.

**Issue URL:** https://github.com/link-assistant/hive-mind/issues/1276
**Related PR:** https://github.com/veb86/zcadvelecAI/pull/761

## Timeline of Events

1. **2026-02-13T11:55:53Z** - Solve command started for issue #760
2. **2026-02-13T11:56:31Z** - Agent started, emitted status message with `"type": "status"`
3. **2026-02-13T12:01:32Z** - A timeout error occurred (`"type": "error"`, `"error": "The operation timed out."`)
4. **2026-02-13T12:01:33Z** - Agent **recovered** and continued processing
5. **2026-02-13T12:02:17Z** - Agent successfully completed (step 30, "exiting loop")
6. **2026-02-13T12:02:17Z** - Exit code was **0** (success)
7. **2026-02-13T12:02:17.830Z** - **FALSE POSITIVE**: Error detection triggered despite successful completion
8. **2026-02-13T12:02:17.831Z** - Solve reported execution failure

## Root Cause Analysis

### Primary Issue: Streaming Error Detection Not Cleared on Recovery

The streaming error detection at `src/agent.lib.mjs:612-616` sets `streamingErrorDetected = true` when it encounters an error event:

```javascript
if (data.type === 'error' || data.type === 'step_error') {
  streamingErrorDetected = true;
  streamingErrorMessage = data.message || data.error || line.substring(0, 100);
  await log(`...Error event detected in stream...`);
}
```

**Problem:** Once set, `streamingErrorDetected` is never cleared even if the agent recovers and completes successfully.

### Secondary Issue: Wrong Message Extraction in Fallback Detection

The fallback pattern matching at `src/agent.lib.mjs:774` extracts the error message with:

```javascript
const messageMatch = fullOutput.match(/"message":\s*"([^"]+)"/);
outputError.match = messageMatch ? messageMatch[1] : `Error event detected...`;
```

**Problem:** This regex matches the **first** `"message"` field in the output, which is from the status JSON:

```json
{
  "type": "status",
  "message": "Agent CLI in continuous listening mode. Accepts JSON and plain text input."
}
```

Not from the actual error JSON which uses `"error"` field:

```json
{
  "type": "error",
  "error": "The operation timed out."
}
```

### Third Issue: Exit Code Ignored When Error Detected During Streaming

At `src/agent.lib.mjs:802`:

```javascript
if (exitCode !== 0 || outputError.detected) {
  // Report error...
}
```

**Problem:** Even with exit code 0, if `outputError.detected` is true (from streaming detection), the execution is marked as failed.

## Evidence from Log File

### Status Message (Line 245-260)

```
[2026-02-13T11:56:31.982Z] [INFO] {
[2026-02-13T11:56:31.982Z] [INFO]   "type": "status",
[2026-02-13T11:56:31.983Z] [INFO]   "mode": "stdin-stream",
[2026-02-13T11:56:31.983Z] [INFO]   "message": "Agent CLI in continuous listening mode. Accepts JSON and plain text input.",
...
```

### Actual Timeout Error (Line 9446-9451)

```
[2026-02-13T12:01:32.081Z] [INFO] {
[2026-02-13T12:01:32.081Z] [INFO]   "type": "error",
[2026-02-13T12:01:32.081Z] [INFO]   "timestamp": 1770984092080,
[2026-02-13T12:01:32.082Z] [INFO]   "sessionID": "ses_3a923e22cffemlrNR08OAmZ4Hy",
[2026-02-13T12:01:32.082Z] [INFO]   "error": "The operation timed out."
}
```

### Agent Recovery and Completion (Line 11439-11440)

```
[2026-02-13T12:02:17.589Z] [INFO]   "message": "exiting loop"
}
```

### False Positive Error Detection (Line 11538-11554)

```
[2026-02-13T12:02:17.830Z] [WARNING] Error event detected via fallback pattern match: Agent CLI in continuous listening mode. Accepts JSON and plain text input.

[2026-02-13T12:02:17.831Z] [ERROR] Agent reported error: Agent CLI in continuous listening mode. Accepts JSON and plain text input.

[2026-02-13T12:02:17.832Z] [ERROR] {
  "type": "error",
  "exitCode": 0,  <-- EXIT CODE WAS 0 (SUCCESS)
  "errorDetectedInOutput": true,
  "errorType": "AgentError",
  "errorMatch": "Agent CLI in continuous listening mode. Accepts JSON and plain text input.",  <-- WRONG MESSAGE
  ...
}
```

## Proposed Solutions

### Solution 1: Trust Exit Code Over Streaming Detection

The agent's exit code is the authoritative indicator of success/failure. If exit code is 0, the agent completed successfully even if errors occurred during execution that were handled/recovered.

```javascript
// Change the condition at line 802 to prioritize exit code
if (exitCode !== 0) {
  // Only report error if exit code is non-zero
  // Ignore streaming-detected errors that were recovered from
}
```

### Solution 2: Clear Streaming Error on Successful Completion

Detect when the agent sends completion signals (like `"session.idle"`, `"message": "exiting loop"`) and clear the streaming error flag:

```javascript
if (data.type === 'session.idle' || (data.type === 'log' && data.message === 'exiting loop')) {
  // Agent completed successfully, clear any previous error flags
  streamingErrorDetected = false;
  streamingErrorMessage = null;
}
```

### Solution 3: Fix Message Extraction Regex

Update the fallback message extraction to also look for `"error"` field:

```javascript
const messageMatch = fullOutput.match(/"message":\s*"([^"]+)"/) || fullOutput.match(/"error":\s*"([^"]+)"/);
```

### Recommended Approach

**Combine Solution 1 and Solution 3:**

1. **Trust exit code**: If exit code is 0, treat as success regardless of streaming-detected errors
2. **Improve message extraction**: Extract from both `"message"` and `"error"` fields, and prefer the one closest to the `"type": "error"` pattern match

## Related Issues

- Issue #1201: Use streaming detection as primary, post-hoc as fallback
- Issue #1258: Fallback pattern matching for error detection
- Issue #886: Trust exit code - agent returns code 1 on errors

## Test Cases to Add

1. Agent emits `"type": "error"` during execution but recovers and exits with code 0
2. Agent emits `"type": "status"` with `"message"` field at startup
3. Agent fails with `"type": "error"` and exits with code 1
4. Agent times out but retries and completes successfully
5. Message extraction from `"error"` field vs `"message"` field

## Files to Modify

- `src/agent.lib.mjs`: Error detection logic (lines 720-870)
- `tests/agent.test.mjs`: Add test cases for false positive scenarios
