# Case Study: Issue #1258 - `"type": "error"` Treated as Success for `--tool agent`

## Summary

When using `--tool agent` to solve GitHub issues, an error from the underlying AI provider was emitted as a JSON event with `"type": "error"`, but the solve.mjs process incorrectly reported success with `✅ Agent command completed`.

## Timeline

### 2026-02-12T06:42:52Z (First occurrence)

1. User executed `solve` with `--tool agent --model kimi-k2.5-free` on issue veb86/zcadvelecAI#748
2. Agent CLI v0.8.17 started session `ses_xxx`
3. After ~39 seconds, an `AI_RetryError` occurred in the Vercel AI SDK
4. Agent emitted JSON error event: `{"type": "error", "errorType": "UnhandledRejection", "message": "Failed after 3 attempts. Last error: Cannot read properties of undefined (reading 'input_tokens')"}`
5. Agent process exited with code 0 (success) despite the error
6. `solve.mjs` logged `✅ Agent command completed` and treated it as success
7. Result: Comment posted indicating successful completion despite failure

### 2026-02-12T07:10:29Z (Second occurrence)

Same sequence repeated on PR #749 continuation attempt.

## Root Causes

### Root Cause 1: Vercel AI SDK Version Bug (in @link-assistant/agent)

**Location:** `@link-assistant/agent` package
**Dependency:** `ai@6.0.0-beta.99`

The agent package uses Vercel AI SDK v6.0.0-beta.99, which has a known issue ([vercel/ai#11217](https://github.com/vercel/ai/issues/11217)) where `usage.input_tokens` is `undefined` when using certain providers through the AI Gateway.

When the retry mechanism in `ai/dist/index.mjs:1940` tries to access `usage.input_tokens` on an undefined usage object, it throws an unhandled rejection.

**Fix:** Upgrade `ai` dependency in `@link-assistant/agent` to v6.0.1 or later.

### Root Cause 2: Agent Exit Code Not Reflecting Error

**Location:** `@link-assistant/agent`

The agent process exits with code 0 even when an unhandled rejection occurs. The error is emitted as a JSON event with `"type": "error"`, but the process exit code should be non-zero.

### Root Cause 3: Error Detection in solve.mjs Fails on Multi-line JSON

**Location:** `src/agent.lib.mjs` lines 590-661

The error detection has two mechanisms:

1. **Streaming detection** (lines 611-614, 645-650): Parses each line as JSON during streaming
2. **Post-hoc detection** (lines 672-692): Re-parses fullOutput after streaming ends

Both mechanisms assume NDJSON format (one JSON object per line). However:

1. The error JSON gets logged through the `log()` function which pretty-prints it across multiple lines with timestamps
2. When `fullOutput` is later parsed line-by-line, individual lines like `"type": "error",` are not valid JSON
3. The streaming detection should work, but there may be edge cases where the error event arrives as a multi-line chunk

**Evidence from logs:**

```
[2026-02-12T07:10:29.980Z] [INFO] {
[2026-02-12T07:10:29.980Z] [INFO]   "type": "error",
[2026-02-12T07:10:29.981Z] [INFO]   "errorType": "UnhandledRejection",
...
```

The timestamps on each line indicate the JSON was streamed as a single object but logged line-by-line.

## Proposed Solutions

### Solution 1: Fix in @link-assistant/agent (External Issue)

1. **Upgrade Vercel AI SDK** to v6.0.1+
2. **Add unhandled rejection handler** that sets exit code to 1
3. **Ensure error events trigger non-zero exit code**

### Solution 2: Fix in hive-mind (This Repository)

1. **Improve streaming error detection** (lines 611-614, 645-650):
   - Already implemented in Issue #1201
   - Should work for single-line JSON error events

2. **Add redundant check for error pattern in fullOutput**:

   ```javascript
   // After streaming ends, also check for raw error patterns
   if (!outputError.detected && !streamingErrorDetected) {
     // Fallback: check for error type string pattern in raw output
     if (fullOutput.includes('"type": "error"') || fullOutput.includes('"type":"error"')) {
       outputError.detected = true;
       outputError.type = 'AgentError';
       outputError.match = 'Error event detected in output (fallback pattern match)';
     }
   }
   ```

3. **Check for known error messages in output**:
   ```javascript
   // Also detect common error patterns
   const knownErrors = ['AI_RetryError', 'UnhandledRejection', 'Failed after'];
   for (const errorPattern of knownErrors) {
     if (fullOutput.includes(errorPattern)) {
       // Flag as potential error for further investigation
     }
   }
   ```

## Workaround

Until fixes are implemented, users can:

1. Check the solution draft log file for error events manually
2. Use `--tool claude` instead of `--tool agent` for more reliable error handling
3. Review PR comments - success messages despite errors will have log files that show the actual errors

## Related Issues and Links

- **Vercel AI SDK Issue:** [vercel/ai#11217](https://github.com/vercel/ai/issues/11217) - Gateway + ai@6: Usage is empty
- **Vercel AI SDK Fix:** Released in v6.0.1
- **hive-mind Issue #1201:** Previous fix for streaming error detection
- **hive-mind Issue #886:** Exit code trust implementation

## Files Affected

### External (requires issue in @link-assistant/agent)

- `@link-assistant/agent` - AI SDK upgrade and error handling

### This Repository

- `src/agent.lib.mjs` - Error detection improvements

## Evidence Files

- `raw-data/solution-draft-log-pr-1770878580417.txt` - First failure log
- `raw-data/solution-draft-log-pr-1770880233772.txt` - Second failure log

## Reproducible Example

```bash
# Using the exact command from the logs
solve https://github.com/veb86/zcadvelecAI/issues/748 \
  --tool agent \
  --model kimi-k2.5-free \
  --attach-logs \
  --verbose
```

The issue reproduces when:

1. Using `--tool agent` with models that return incomplete usage data
2. The AI provider/gateway returns responses where `usage.input_tokens` is undefined
3. The Vercel AI SDK retry mechanism tries to access this property
