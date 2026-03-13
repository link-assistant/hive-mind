# Case Study: Issue #1296 - False Positive Error Detection for `--tool agent`

## Executive Summary

**Issue:** [#1296 - False positive error detection for `--tool agent`](https://github.com/link-assistant/hive-mind/issues/1296)

**Root Cause:** The error detection logic in `src/agent.lib.mjs` has a fallback pattern matching mechanism (lines 790-837) that detects `"type": "error"` or `"type": "step_error"` patterns in the raw output string. This fallback triggers even when the agent has successfully completed (exit code 0, `step_finish` with `reason: "stop"`), causing false positive error reporting.

**Specific Trigger:** When an agent encounters a timeout error during execution (e.g., `"The operation timed out."`), the error event is logged to output. Even if the agent recovers from this error and successfully completes (indicated by `step_finish` with `reason: "stop"` and exit code 0), the fallback pattern matching still detects the error message in the full output and reports it as a failure.

**Impact:**

1. Valid agent executions are incorrectly flagged as failures
2. Misleading error messages despite successful task completion
3. False negatives in CI/CD pipelines

**Fix Status:** Solution identified and implementation ready.

---

## Timeline / Sequence of Events

Based on the logs provided in the issue:

### Event 1: Agent Executes Successfully

- **Time:** 2026-02-15T00:01:54.716Z
- **Type:** `step_finish`
- **Session ID:** `ses_3a3d83adfffeCkqmlFB4bV7c68`
- **Details:**
  ```json
  {
    "type": "step_finish",
    "timestamp": 1771113714714,
    "part": {
      "id": "prt_c5e9a91a5001VWYa1WPGDHs2rd",
      "type": "step-finish",
      "reason": "stop",
      "tokens": {
        "input": 22868,
        "output": 159,
        "reasoning": 0,
        "cache": { "read": 0, "write": 0 }
      }
    }
  }
  ```
- **Significance:** This is a clear marker of successful completion. The `reason: "stop"` indicates normal termination.

### Event 2: False Positive Error Detection (BUG)

- **Time:** 2026-02-15T00:01:54.979Z
- **Location:** `src/agent.lib.mjs` - fallback pattern matching
- **Pattern Matched:** String pattern in full output containing `"The operation timed out."`
- **Error Generated:**
  ```json
  {
    "type": "error",
    "exitCode": 0,
    "errorDetectedInOutput": true,
    "errorType": "AgentError",
    "errorMatch": "The operation timed out.",
    "message": "Agent reported error: The operation timed out.",
    "sessionId": null,
    "limitReached": false,
    "limitResetTime": null
  }
  ```

**Critical Observation:**

- Exit code is 0 (success)
- `step_finish` with `reason: "stop"` was emitted (success marker)
- Error was detected via "fallback pattern match" - meaning JSON parsing failed and raw string scanning found error patterns

---

## Root Cause Analysis

### Primary Issue: Fallback Pattern Matching Not Respecting Success Markers

The error detection code at `src/agent.lib.mjs:790-837` contains fallback pattern matching:

```javascript
// Issue #1258: Fallback pattern match for error detection
// When JSON parsing fails (e.g., multi-line pretty-printed JSON in logs),
// we need to detect error patterns in the raw output string
// Issue #1290: Skip fallback when agent completed successfully with exit code 0
// The fallback can cause false positives when error events (like AI_JSONParseError)
// appear in the output but the agent recovered and completed successfully
if (!outputError.detected && !streamingErrorDetected && !(exitCode === 0 && agentCompletedSuccessfully)) {
  // Check for error type patterns in raw output (handles pretty-printed JSON)
  const errorTypePatterns = [
    { pattern: '"type": "error"', type: 'AgentError' },
    { pattern: '"type":"error"', type: 'AgentError' },
    { pattern: '"type": "step_error"', type: 'AgentStepError' },
    { pattern: '"type":"step_error"', type: 'AgentStepError' },
  ];
  // ...
}
```

The issue is that the condition `!(exitCode === 0 && agentCompletedSuccessfully)` depends on `agentCompletedSuccessfully` being set to `true`. However, `agentCompletedSuccessfully` is only set when specific completion events are detected:

```javascript
// Issue #1276: Detect successful completion events
if (data.type === 'session.idle' || (data.type === 'log' && data.message === 'exiting loop')) {
  agentCompletedSuccessfully = true;
}
```

**The bug:** The `step_finish` event with `reason: "stop"` is NOT being tracked as a success marker. This means when an agent completes via `step_finish`, the `agentCompletedSuccessfully` flag remains `false`, allowing the fallback pattern matching to trigger.

### Secondary Issue: Error Events Persisted in Output

When the agent encounters a timeout error during execution:

1. The agent emits an error event (`type: "error"`, `error: "The operation timed out."`)
2. The agent may recover and continue (retry logic)
3. The agent eventually completes successfully (`step_finish` with `reason: "stop"`)
4. The full output contains BOTH the error event AND the success event
5. The fallback pattern matching scans the FULL output and finds the error pattern

### Why Issue #1276 Fix Didn't Fully Work

Issue #1276 added tracking for `agentCompletedSuccessfully` using `session.idle` and `"exiting loop"` log messages. However:

1. Not all agent completion scenarios emit these specific events
2. The `step_finish` event with `reason: "stop"` is a more reliable indicator but was not included
3. The agent in this case likely completed via `step_finish` without emitting `session.idle`

---

## Evidence from Logs

### Success Marker (Present)

```json
{
  "type": "step_finish",
  "part": {
    "type": "step-finish",
    "reason": "stop" // <-- This is a success marker
  }
}
```

### Error Pattern Matched by Fallback (False Positive)

```
[2026-02-15T00:01:54.979Z] [WARNING] ⚠️  Error event detected via fallback pattern match: The operation timed out.
```

The warning explicitly states "via fallback pattern match", indicating that:

1. Streaming error detection didn't catch this as an error (correct - because it was followed by recovery)
2. JSON parsing-based detection didn't catch it as an error (correct - because step_finish showed success)
3. The fallback raw string scanning DID catch it (incorrect - false positive)

---

## Related Issues and Prior Art

### In This Repository (hive-mind)

1. **Issue #886** - False positive error detection for `--agent tool`
   - Similar root cause: pattern matching in successful tool outputs
   - Solution: Trust exit code, simplified error detection to JSON-only

2. **Issue #873** - Phantom error detection for `--tool agent`
   - Similar root cause: scanning all output including tool content
   - Solution: Parse JSON structure, skip completed tool outputs

3. **Issue #1276** - Added `agentCompletedSuccessfully` tracking
   - Partial fix: Added tracking for `session.idle` and `"exiting loop"`
   - Missed: `step_finish` with `reason: "stop"` as success marker

4. **Issue #1290** - Skip fallback when agent completed successfully
   - Condition added but depends on `agentCompletedSuccessfully` being set correctly

### In Agent Repository (link-assistant/agent)

1. **Issue #183** - `error: The operation timed out`
   - The exact error message seen in this case
   - Related to retry logic during rate limiting

2. **Issue #154** - Unhandled AI_RetryError causes exit code 0 despite failure
   - Related but opposite problem: agent NOT returning proper exit code
   - This was fixed, but reveals agent's error handling evolution

### External References

1. [Vercel AI SDK - AI_RetryError](https://ai-sdk.dev/docs/reference/ai-sdk-errors/ai-retry-error)
   - Agent uses Vercel AI SDK for retry logic
   - Timeout configuration available: `totalMs`, `stepMs`, `chunkMs`

2. [NDJSON Specification](https://jsonltools.com/ndjson-format-specification)
   - Agent outputs NDJSON format
   - Each line is an independent JSON object
   - Error detection should parse line-by-line, not scan raw strings

---

## Proposed Solutions

### Solution 1: Add `step_finish` with `reason: "stop"` as Success Marker (RECOMMENDED)

**Approach:** Update the success detection logic to recognize `step_finish` events with `reason: "stop"` as successful completion.

**Implementation:**

```javascript
// In the streaming loop, add detection for step_finish success:
if (data.type === 'step_finish' && data.part?.reason === 'stop') {
  agentCompletedSuccessfully = true;
}
```

This should be added to both stdout and stderr processing blocks (around lines 615-650 and 682-715).

**Pros:**

- ✅ Addresses root cause directly
- ✅ `step_finish` with `reason: "stop"` is a reliable success indicator
- ✅ Minimal code change
- ✅ Works with existing fallback protection at line 790

**Cons:**

- ⚠️ None significant

### Solution 2: Disable Fallback Pattern Matching When Exit Code is 0

**Approach:** If exit code is 0, trust it completely and skip fallback pattern matching.

**Implementation:**

```javascript
// Change condition at line 790 from:
if (!outputError.detected && !streamingErrorDetected && !(exitCode === 0 && agentCompletedSuccessfully)) {
// To:
if (!outputError.detected && !streamingErrorDetected && exitCode !== 0) {
```

**Pros:**

- ✅ Simple fix
- ✅ Aligns with issue #886's principle: "Trust the exit code"

**Cons:**

- ⚠️ May miss errors if agent incorrectly exits with code 0 (issue #154 scenario)
- ⚠️ Reduces defense-in-depth

### Solution 3: Clear Error Detection When Success Markers Appear

**Approach:** If a success marker (`step_finish` with `reason: "stop"`) appears AFTER any error events, clear the error detection flags.

**Implementation:**

```javascript
// Already partially implemented at lines 762-773
// Extend to also clear outputError.detected when step_finish success is seen:
if (data.type === 'step_finish' && data.part?.reason === 'stop') {
  agentCompletedSuccessfully = true;
  // Clear any previously detected errors since agent recovered
  streamingErrorDetected = false;
  streamingErrorMessage = null;
}
```

**Pros:**

- ✅ Handles recovery scenarios correctly
- ✅ More nuanced than just trusting exit code

**Cons:**

- ⚠️ Requires understanding temporal ordering of events

---

## Recommendation

**Implement Solution 1 (Add `step_finish` Success Marker Detection)** as the primary fix.

### Rationale:

1. **It addresses the root cause:** The bug is that `agentCompletedSuccessfully` is not being set when agent completes via `step_finish`

2. **It's minimal and low-risk:** Single addition to existing pattern detection

3. **It maintains defense-in-depth:** The fallback pattern matching still works for genuine failures

4. **It aligns with existing architecture:** The fix follows the pattern established in issue #1276

### Implementation Plan:

1. Add `step_finish` success detection to streaming loop (stdout processing)
2. Add `step_finish` success detection to streaming loop (stderr processing)
3. Add test case for this specific scenario
4. Update case study documentation

---

## Test Cases

### Test Case 1: Current Bug Scenario (Issue #1296)

- **Input:** Agent encounters timeout error, recovers, completes with `step_finish` reason `stop`
- **Expected:** No error reported (exit code 0, success marker present)
- **Current Result:** ❌ False positive error detected via fallback
- **After Fix:** ✅ No error detected

### Test Case 2: Genuine Failure

- **Input:** Agent encounters error, does NOT recover, exits with code 1
- **Expected:** Error detected and reported
- **Current Result:** ✅ Correctly detected
- **After Fix:** ✅ Still detected

### Test Case 3: Timeout Without Recovery

- **Input:** Agent encounters timeout error, fails to recover, exits with code 1
- **Expected:** Error detected and reported
- **Current Result:** ✅ Correctly detected
- **After Fix:** ✅ Still detected

---

## Files to Modify

| File                                   | Change                                                 |
| -------------------------------------- | ------------------------------------------------------ |
| `src/agent.lib.mjs`                    | Add `step_finish` success detection in streaming loops |
| `tests/test-agent-error-detection.mjs` | Add test case for timeout recovery scenario            |

---

## Conclusion

This issue is a continuation of the false positive error detection pattern addressed in issues #873, #886, #1276, and #1290. The root cause is that the `agentCompletedSuccessfully` flag is not being set when the agent completes via `step_finish` with `reason: "stop"`.

The fix is straightforward: add detection for this specific success marker in the streaming loop. This will ensure that the fallback pattern matching at line 790 is correctly bypassed when the agent has successfully completed.

### Key Insight

The issue statement captures this perfectly:

> "So if we have clear marker of success in the output, we can drop all error detection."

The `step_finish` event with `reason: "stop"` IS that clear marker. The fix ensures we recognize it.

---

## Artifacts

- Issue: https://github.com/link-assistant/hive-mind/issues/1296
- Related Agent Issue: https://github.com/link-assistant/agent/issues/183
- Prior Art: Issues #873, #886, #1276, #1290

## Research Sources

- [Vercel AI SDK - AI_RetryError Documentation](https://ai-sdk.dev/docs/reference/ai-sdk-errors/ai-retry-error)
- [Vercel AI SDK - Timeout Configuration](https://ai-sdk.dev/docs/ai-sdk-core/settings)
- [NDJSON Format Specification](https://jsonltools.com/ndjson-format-specification)
- [n8n AI Agent Structured Output Parser](https://github.com/n8n-io/n8n/issues/21174)
