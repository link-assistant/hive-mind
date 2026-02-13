# Case Study: Merge Queue Stuck - Issue #1269

## Executive Summary

The `/merge` command in the Telegram bot became stuck after initializing with "Found 3 PRs with 'ready' label" and never completed merging any PRs. After 10-12 hours, no PRs were merged. This case study identifies multiple root causes related to async/await patterns, silent exception swallowing, and missing timeout protections.

## Timeline Reconstruction

Based on the issue report and code analysis:

1. **User Action**: User sent `/merge https://github.com/link-assistant/hive-mind` command
2. **Initial Response**: Bot replied with "Found 3 PRs with 'ready' label. Starting merge process..."
3. **Stuck State**: The queue started processing but never progressed
4. **Duration**: Queue remained stuck for 10-12+ hours without any merges
5. **Final State**: 3 PRs (1264, 1257, 1241) remained open with passing CI checks

## Root Cause Analysis

### Primary Root Cause: Fire-and-Forget Promise with Silent Error Swallowing

**Location**: `telegram-merge-command.lib.mjs:304-307`

```javascript
// Run the merge queue (this runs asynchronously)
processor.run().catch(error => {
  VERBOSE && console.error(`[VERBOSE] /merge: Unhandled error in run(): ${error.message}`);
  activeMergeOperations.delete(repoKey);
});
```

**Problem**:

1. `processor.run()` is called without `await`, making it fire-and-forget
2. Errors are only logged if `VERBOSE` mode is enabled
3. No user notification is sent when the processing fails
4. The Telegram message remains stuck in "Starting merge process..." state

### Secondary Root Cause: Callback Exception Traps

All callback handlers (`onProgress`, `onComplete`, `onError`, `onStatusUpdate`) follow this pattern:

```javascript
const callback = async data => {
  try {
    // Actual work
  } catch (err) {
    // Only log (maybe), never propagate
    VERBOSE && console.log(`[VERBOSE] Error: ${err.message}`);
  }
};
```

**Impact**: Exceptions in callbacks are silently absorbed, causing:

- Inconsistent state
- No user notification
- Processing continues with corrupted state

### Tertiary Root Cause: Missing Timeout Wrappers

**Location**: `github-merge.lib.mjs:495-496`

```javascript
if (onStatusUpdate) {
  await onStatusUpdate(ciStatus); // No timeout, could block forever
}
```

**Problem**:

- The `onStatusUpdate` callback has no timeout protection
- If Telegram API hangs or network issues occur, the entire CI polling is blocked
- The CI timeout (7 hours) continues ticking while waiting for callback
- This can exhaust the entire timeout without performing actual CI checks

## Detailed Issue Analysis

### Issue 1: Unhandled Promise Rejection (CRITICAL)

| Property | Value                          |
| -------- | ------------------------------ |
| File     | telegram-merge-command.lib.mjs |
| Lines    | 304-307                        |
| Severity | HIGH                           |
| Type     | Silent Exception               |

The `.catch()` handler only logs errors in verbose mode and removes the operation from the map. Users see no indication of failure, and the Telegram message remains in "Starting merge process..." state indefinitely.

### Issue 2: Silent Exception in Progress Callback (HIGH)

| Property | Value                          |
| -------- | ------------------------------ |
| File     | telegram-merge-command.lib.mjs |
| Lines    | 235-240                        |
| Severity | MEDIUM                         |
| Type     | Silent Exception               |

Progress updates stop silently without user awareness when exceptions occur in the callback.

### Issue 3: Infinite Wait in CI Polling (CRITICAL)

| Property | Value                |
| -------- | -------------------- |
| File     | github-merge.lib.mjs |
| Lines    | 487-520              |
| Severity | HIGH                 |
| Type     | Infinite Wait        |

If `onStatusUpdate` callback throws an exception, the loop terminates without returning a value, leaving a hanging promise.

### Issue 4: No Timeout on API Calls (HIGH)

| Property | Value                          |
| -------- | ------------------------------ |
| Files    | telegram-merge-command.lib.mjs |
| Lines    | 229, 246, 259                  |
| Severity | MEDIUM                         |
| Type     | Hanging Promise                |

`ctx.telegram.editMessageText()` calls have no timeout protection, which can block the entire processing pipeline.

## Evidence Supporting Analysis

### Code Evidence

1. **VERBOSE mode was likely disabled**: The error logging in catch blocks uses `VERBOSE && console.error(...)`, meaning errors wouldn't be logged if VERBOSE was false.

2. **7-hour CI timeout**: The config shows `ciTimeoutMs: 7 * 60 * 60 * 1000` (7 hours), which explains why the queue could hang for 10-12 hours.

3. **PRs had passing CI**: All 3 PRs (#1264, #1257, #1241) currently show all CI checks as SUCCESS, suggesting the issue was in the merge queue logic, not in CI failures.

### Telegraf Framework Context

Based on external research:

- Telegraf has known issues with [long polling silently hanging](https://github.com/telegraf/telegraf/discussions/1234)
- Handler timeout mechanism can cause errors thrown after timeout to be [swallowed](https://github.com/telegraf/telegraf/issues/1479)
- The bot is configured with `handlerTimeout: Infinity` (line 289 in telegram-bot.mjs), which prevents timeout-based cleanup

## Proposed Solutions

### Solution 1: Add Proper Error Propagation (Immediate)

Replace silent error swallowing with proper error handling and user notification:

```javascript
// Run the merge queue (this runs asynchronously)
processor
  .run()
  .then(() => {
    // Ensure cleanup on success
    activeMergeOperations.delete(repoKey);
  })
  .catch(async error => {
    console.error(`[ERROR] /merge error for ${repoKey}:`, error);

    // Always notify user about failure
    try {
      await ctx.telegram.editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, `❌ Merge queue failed unexpectedly.\n\nError: ${escapeMarkdownV2(error.message)}\n\nPlease try again or check logs.`, { parse_mode: 'MarkdownV2' });
    } catch (notifyError) {
      console.error(`Failed to notify user about error: ${notifyError.message}`);
    }

    activeMergeOperations.delete(repoKey);
  });
```

### Solution 2: Add Timeout Wrappers for Callbacks (Medium Priority)

Wrap all callbacks with timeout protection:

```javascript
import { setTimeout as setTimeoutPromise } from 'timers/promises';

async function withTimeout(promise, ms, operation = 'Operation') {
  const timeout = setTimeoutPromise(ms, null, { ref: false }).then(() => {
    throw new Error(`${operation} timed out after ${ms}ms`);
  });
  return Promise.race([promise, timeout]);
}

// In waitForCI:
if (onStatusUpdate) {
  await withTimeout(onStatusUpdate(ciStatus), 30000, 'Status update callback');
}
```

### Solution 3: Add Circuit Breaker Pattern (Long-term)

Implement a circuit breaker to stop processing if multiple callbacks fail:

```javascript
class CircuitBreaker {
  constructor(threshold = 3, resetTimeout = 60000) {
    this.failures = 0;
    this.threshold = threshold;
    this.resetTimeout = resetTimeout;
    this.lastFailure = null;
    this.isOpen = false;
  }

  async execute(fn, fallback) {
    if (this.isOpen) {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.isOpen = false;
        this.failures = 0;
      } else {
        return fallback ? await fallback() : null;
      }
    }

    try {
      const result = await fn();
      this.failures = 0;
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailure = Date.now();
      if (this.failures >= this.threshold) {
        this.isOpen = true;
      }
      throw error;
    }
  }
}
```

### Solution 4: Use AbortController for Cancellation (Long-term)

Implement proper cancellation using AbortController:

```javascript
async run(signal) {
  for (const item of this.items) {
    if (signal?.aborted) {
      this.status = MergeStatus.CANCELLED;
      break;
    }
    await this.processItem(item, signal);
  }
}

// Usage:
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), MAX_QUEUE_TIMEOUT);

try {
  await processor.run(controller.signal);
} finally {
  clearTimeout(timeoutId);
}
```

## Known External Issues

### Telegraf Framework Issues

| Issue                         | URL                                                   | Relevance                            |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------ |
| Long polling silently hangs   | https://github.com/telegraf/telegraf/discussions/1234 | Explains why errors may be swallowed |
| Promise timeout after 90000ms | https://github.com/telegraf/telegraf/issues/1479      | Shows need for timeout handling      |

### Recommended Libraries

| Library           | Purpose                                            | Link                                            |
| ----------------- | -------------------------------------------------- | ----------------------------------------------- |
| p-queue           | Promise queue with concurrency control             | https://github.com/sindresorhus/p-queue         |
| p-timeout         | Timeout a promise after a specified amount of time | https://github.com/sindresorhus/p-timeout       |
| async-await-queue | Async/await queue with concurrency                 | https://www.npmjs.com/package/async-await-queue |

## Recommendations

### Immediate Actions

1. **Enable verbose logging by default for merge operations** - At minimum, ensure errors are always logged regardless of VERBOSE flag
2. **Add error notification to users** - Always update the Telegram message when an error occurs
3. **Add basic timeout wrapper** - Wrap callbacks with a simple timeout

### Short-term Actions

1. **Implement proper error boundaries** - Don't swallow exceptions in callbacks
2. **Add operation monitoring** - Track and report long-running operations
3. **Add heartbeat mechanism** - Periodically update the Telegram message to show the queue is still alive

### Long-term Actions

1. **Use established queue libraries** - Consider p-queue or similar for robust queue management
2. **Add circuit breaker pattern** - Prevent cascade failures
3. **Implement proper cancellation** - Use AbortController for clean cancellation

## Files Modified/Created

This case study created the following files:

- `docs/case-studies/issue-1269/CASE-STUDY.md` (this file)
- `docs/case-studies/issue-1269/data/pr-list-ready-label.json`
- `docs/case-studies/issue-1269/data/pr-list-merged.json`
- `docs/case-studies/issue-1269/data/issue-1269-body.txt`
- `docs/case-studies/issue-1269/data/pr-1264.json`
- `docs/case-studies/issue-1269/data/pr-1257.json`
- `docs/case-studies/issue-1269/data/pr-1241.json`

## References

- Issue #1269: https://github.com/link-assistant/hive-mind/issues/1269
- Issue #1143 (Merge queue implementation): https://github.com/link-assistant/hive-mind/issues/1143
- Telegraf Discussion #1234: https://github.com/telegraf/telegraf/discussions/1234
- Telegraf Issue #1479: https://github.com/telegraf/telegraf/issues/1479
- p-queue: https://github.com/sindresorhus/p-queue
