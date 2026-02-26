# Case Study: Issue #1353 — On timeout of `--tool claude` we must do auto restart with `--resume` to preserve context

## Overview

- **Issue URL**: https://github.com/link-assistant/hive-mind/issues/1353
- **Title**: On timeout of `--tool claude` we must do auto restart command with `--resume` to preserve the context of the session
- **Labels**: bug
- **Reporter**: @konard
- **Date**: February 2026

## Problem Statement

When Claude CLI (`--tool claude`) encounters a **"Request timed out"** error during execution, the current system incorrectly treats this as a fatal failure. It exits without attempting to resume the session, causing complete loss of:

1. All Claude session context and conversation history
2. All partially completed work (tool calls made, code written, etc.)
3. Token budget already consumed (session tokens are not recovered)

The correct behavior should be to **automatically restart the `claude` command with `--resume <session-id>`** to continue from where the timeout occurred, applying exponential backoff between restart attempts.

## Evidence — Log File

The log file from the incident is saved at: `./3af31f9f-00b4-4cc1-ba4f-a8896eb1ab16.log`

**Original log URL**: https://gist.githubusercontent.com/konard/f8236910a95aa5048acf5b6cc03ba405/raw/11414563efcc92e8280633c4bcb486f551649f41/3af31f9f-00b4-4cc1-ba4f-a8896eb1ab16.log

**Command invoked**:

```bash
/home/hive/.nvm/versions/node/v20.20.0/bin/node /home/hive/.bun/bin/solve \
  https://github.com/VermenkoLev/facer/issues/15 \
  --model opus \
  --base-branch issue-13-14931038bc80 \
  --attach-logs --verbose --no-tool-check \
  --auto-resume-on-limit-reset \
  --auto-restart-until-mergeable \
  --tokens-budget-stats
```

## Timeline Reconstruction

All timestamps from log file `3af31f9f-00b4-4cc1-ba4f-a8896eb1ab16.log`:

| Timestamp             | Event                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `13:50:25Z`           | `solve` started, version 1.25.1                                                                                                    |
| `13:50:33Z`           | Auto-continue: found existing branches for issue #15                                                                               |
| `13:50:37Z`           | New branch `issue-15-284c3e5493d4` created and pushed                                                                              |
| `13:50:45Z`           | Draft PR #19 created                                                                                                               |
| `13:50:54Z`           | Playwright MCP detected, vision: supported                                                                                         |
| `13:50:54Z`           | **Claude execution started** (claude-opus-4-5-20251101)                                                                            |
| `13:51:03Z`           | Session ID `3af31f9f-00b4-4cc1-ba4f-a8896eb1ab16` captured                                                                         |
| `13:51:03Z–13:56:53Z` | Claude active: ~15 tool-use turns, multiple API calls with `timeout: 600000`                                                       |
| `13:56:53Z`           | Last successful API request body logged                                                                                            |
| `13:57:03Z`           | **`[log_0912c9] connection timed out - error; no more retries left`**                                                              |
| `13:57:03Z`           | `durationMs: 10493, message: 'fetch failed'`                                                                                       |
| `13:57:42Z`           | Claude CLI automatically retries the API call                                                                                      |
| `13:57:52Z`           | **`[log_2321e1] connection timed out - error; no more retries left`**                                                              |
| `13:57:52Z`           | `durationMs: 10495, message: 'fetch failed'`                                                                                       |
| `13:57:52Z`           | Claude CLI emits: `{"type":"result","subtype":"success","is_error":true,"result":"Request timed out","session_id":"3af31f9f-..."}` |
| `13:57:52Z`           | Hive Mind: **"Result event received, starting 30s stream close timeout (Issue #1280)"**                                            |
| `13:57:52Z`           | Hive Mind: **"Detected error from Claude CLI (subtype: success)"** — `commandFailed = true`                                        |
| `13:58:22Z`           | 30s timeout expired: **SIGTERM sent to claude process** (Issue #1280 workaround)                                                   |
| `13:58:22Z`           | Exit code 143 (128 + SIGTERM)                                                                                                      |
| `13:58:22Z`           | **"❌ Claude command failed with exit code 143"**                                                                                  |
| `13:58:22Z`           | "Session ID for resuming: `3af31f9f-00b4-4cc1-ba4f-a8896eb1ab16`" (printed but not acted on)                                       |
| `13:58:22Z`           | Resume command shown: `(cd "/tmp/gh-issue-solver-1771854633856" && claude --resume 3af31f9f-... --model opus)`                     |
| `13:58:22Z`           | `showResumeCommand()` shows the resume command in logs                                                                             |
| `13:58:22Z–14:05:15Z` | Log attachment to PR (6+ minutes)                                                                                                  |
| `14:05:15Z`           | **"❌ CLAUDE execution failed"** — process exits                                                                                   |

**Key observation**: The system correctly identifies the session ID and even prints a resume command, but then **exits without using that resume command automatically**.

## Root Cause Analysis

### Primary Root Cause: "Request timed out" is Not Treated as a Retryable Error

The `executeClaudeCommand()` function in `src/claude.lib.mjs` handles several transient error types with automatic retry via `executeWithRetry()`:

- `API Error: 500` + `Overloaded` → retried (up to 10 times, 1min–30min backoff)
- `API Error: 500` + `Internal server error` → retried (up to 10 times, 1min–30min backoff) [added in #1331]
- `API Error: 503` → retried (up to 10 times, 1min–30min backoff) [added in #1331]

**However, `"Request timed out"` is NOT in the list of retried errors.**

When a timeout occurs inside Claude CLI:

1. Claude CLI's own retry logic exhausts (2 internal retries shown in log: `_0912c9` and `_2321e1`)
2. Claude CLI emits a synthetic response: `{"type":"result","subtype":"success","is_error":true,"result":"Request timed out"}`
3. Hive Mind detects `is_error === true` and sets `commandFailed = true`
4. The `isTransientError` check in `executeClaudeCommand()` does NOT match `"Request timed out"`
5. `commandFailed` path executes without retry, leading to fatal failure

**The `isTransientError` detection code (lines ~1163-1168 in claude.lib.mjs)**:

```javascript
const isTransientError = isOverloadError || isInternalServerError || is503Error ||
  (lastMessage.includes('API Error: 500') && (lastMessage.includes('Overloaded') || ...)) ||
  (lastMessage.includes('api_error') && lastMessage.includes('Overloaded')) ||
  lastMessage.includes('API Error: 503') || ...;
```

The string `"Request timed out"` matches none of these patterns.

### Secondary Root Cause: Interaction with Issue #1280 (SIGTERM)

The stream-close timeout (Issue #1280) compounds the issue:

1. Claude CLI sends the `result` event with `"Request timed out"` but keeps stdout open
2. Hive Mind's Issue #1280 workaround fires SIGTERM after 30 seconds
3. This sets exit code to 143 (SIGTERM)
4. Hive Mind now sees BOTH `commandFailed = true` (from `is_error`) AND exit code 143
5. The exit code 143 is NOT an EPERM or "command not found" (127), so it doesn't trigger special handling
6. The process falls through to the general failure path without any retry attempt

### Tertiary Root Cause: Retry with `--resume` Is Not Implemented for Timeouts

Even if timeout were detected as retryable, the existing retry mechanism in `executeWithRetry()` for transient errors already does session preservation:

```javascript
if (sessionId && !argv.resume) argv.resume = sessionId; // preserve session for resume
```

This pattern exists for API overload errors. The **same pattern must be applied to timeout errors**, ensuring that the `--resume <session-id>` flag is passed when restarting the `claude` command after a timeout.

Without `--resume`, restarting after a timeout would:

1. Start a brand new Claude session with no context
2. Lose all previously completed tool calls
3. Waste the tokens already consumed in the timed-out session

## Analysis of the Timeout Pattern

### What Happens Inside Claude CLI on Timeout

From the log, Claude CLI uses Anthropic's SDK with `timeout: 600000` (10 minutes per request) and `x-stainless-timeout: '600'`. When a network connection times out before the response arrives:

1. The SDK logs `"connection timed out - error; no more retries left"` to stderr (captured in verbose mode)
2. The SDK may auto-retry internally (2 retries visible: `log_0912c9` and `log_2321e1`)
3. After all SDK retries exhaust, Claude CLI synthesizes a result event with `is_error: true` and `result: "Request timed out"`
4. Claude CLI keeps stdout open (does not exit cleanly), triggering the Issue #1280 SIGTERM

### Why Session Preservation is Critical

From the log, the timed-out session had:

- `num_turns: 15` (15 complete conversation turns)
- `cache_read_input_tokens: 283744` (283K cached tokens — significant context built up)
- `cacheCreationInputTokens: 27987` (27K tokens of new cache written)
- Cost: `$0.381 USD` already consumed

Discarding this session and starting fresh would:

- Lose all 15 turns of context
- Re-process 283K+ tokens from scratch
- Cost additional ~$0.38+ USD for the same work

With `--resume`, the session context (including the 283K cached tokens) can be reused, making the retry much cheaper and faster.

### Exponential Backoff Rationale

The issue specifies:

- **Start delay**: 5 minutes (300,000ms)
- **Maximum delay**: 1 hour (3,600,000ms)

This is different from other transient errors (which start at 1 minute) because:

1. Timeouts typically indicate network instability — network issues often last longer than API errors
2. Claude CLI already retried twice internally before giving up — the external failure is more persistent
3. A minimum 5-minute wait allows the underlying network/infrastructure issue to resolve

## Proposed Solution

### Detection of Timeout Errors

Add `isRequestTimeout` flag and detection logic in `executeClaudeCommand()`:

**Pattern 1**: Result event with `is_error: true` and `result: "Request timed out"`

```javascript
if (data.type === 'result' && data.is_error === true) {
  const resultText = data.result || '';
  if (resultText.includes('Request timed out') || resultText === 'Request timed out') {
    isRequestTimeout = true;
  }
}
```

**Pattern 2**: Assistant message with text "Request timed out"

```javascript
if (item.type === 'text' && item.text && item.text.includes('Request timed out')) {
  isRequestTimeout = true;
}
```

**Pattern 3**: Stderr log output from Claude CLI SDK

```javascript
if (chunk.type === 'stderr' && errorOutput.includes('connection timed out')) {
  // Note: this is informational — actual detection is via result event
}
```

### Retry with Session Preservation

In the `isTransientError` check block (after the `for await` loop in `executeWithRetry()`):

```javascript
const isTransientError = isOverloadError || isInternalServerError || is503Error ||
  isRequestTimeout ||  // NEW: add timeout detection
  ...;

if ((commandFailed || isTransientError) && isTransientError) {
  if (retryCount < retryLimits.maxTransientErrorRetries) {
    // Use timeout-specific delay when applicable
    const initialDelay = isRequestTimeout
      ? retryLimits.initialRequestTimeoutDelayMs  // 5 minutes
      : retryLimits.initialTransientErrorDelayMs; // 1 minute
    const maxDelay = isRequestTimeout
      ? retryLimits.maxRequestTimeoutDelayMs      // 60 minutes
      : retryLimits.maxTransientErrorDelayMs;     // 30 minutes

    const delay = Math.min(initialDelay * Math.pow(retryLimits.retryBackoffMultiplier, retryCount), maxDelay);

    // CRITICAL: Preserve session for resume
    if (sessionId && !argv.resume) argv.resume = sessionId;

    await waitWithCountdown(delay, log);
    retryCount++;
    return await executeWithRetry();
  }
}
```

### Configuration Constants (src/config.lib.mjs)

```javascript
export const retryLimits = {
  // ... existing ...

  // Request timeout retry configuration (Issue #1353)
  // Network timeouts typically need longer waits than API errors
  maxRequestTimeoutRetries: parseIntWithDefault('HIVE_MIND_MAX_REQUEST_TIMEOUT_RETRIES', 10),
  initialRequestTimeoutDelayMs: parseIntWithDefault('HIVE_MIND_INITIAL_REQUEST_TIMEOUT_DELAY_MS', 5 * 60 * 1000), // 5 minutes
  maxRequestTimeoutDelayMs: parseIntWithDefault('HIVE_MIND_MAX_REQUEST_TIMEOUT_DELAY_MS', 60 * 60 * 1000), // 1 hour
};
```

### Files to Modify

1. **`src/config.lib.mjs`** — Add timeout retry configuration constants
2. **`src/claude.lib.mjs`** — Add timeout detection and retry logic with session preservation

## Comparison with Existing Retry Mechanisms

| Error Type                | Detection Pattern                       | Initial Delay | Max Delay  | Max Retries | Session Preserved |
| ------------------------- | --------------------------------------- | ------------- | ---------- | ----------- | ----------------- |
| 500 Overloaded            | `API Error: 500` + `Overloaded`         | 1 min         | 30 min     | 10          | Yes (since #1331) |
| 500 Internal server error | `Internal server error`                 | 1 min         | 30 min     | 10          | Yes (since #1331) |
| 503 Network error         | `API Error: 503`                        | 1 min         | 30 min     | 10          | Yes (since #1331) |
| **Request timeout**       | `result.is_error + "Request timed out"` | **5 min**     | **60 min** | **10**      | **YES (new)**     |

## Online Research: Timeout Pattern in Claude Code

### Anthropic Claude Code Issues Referenced

The "Request timed out" pattern in Claude Code is a known, recurring issue:

- **anthropics/claude-code#24478**: "CLI freeze/unresponsive after long tool chains" — Claude Code hangs and times out during network-intensive operations
- **anthropics/claude-code#1920**: "missing result event / hang" — Similar timeout/hang pattern
- **anthropics/claude-code#24481**: "hang in print mode" — Timeout-related hang

### Root Cause from Anthropic Side

The timeout in this log occurred during a network-intensive session where Claude was making multiple API calls with `x-stainless-timeout: '600'` (600 second timeout). The connection failure indicates:

1. **Network instability**: The `durationMs: 10493` (10.5 seconds until timeout) is much shorter than the 600-second configured timeout — suggesting the connection was dropped at the TCP level, not by timeout expiry
2. **CDN/Load balancer disconnection**: `fetch failed` with very short duration typically indicates the upstream (CDN or load balancer) closed the connection before the timeout
3. **No retries left**: Claude CLI's SDK had already exhausted its own retries before producing the synthetic result

## Workarounds (Before Fix)

### Manual Resume

After a timeout failure, users can manually resume using the command shown in the logs:

```bash
(cd "/tmp/gh-issue-solver-1771854633856" && claude --resume 3af31f9f-00b4-4cc1-ba4f-a8896eb1ab16 --model opus)
```

### Solve Command Resume

Users can also resume via the solve command:

```bash
solve https://github.com/VermenkoLev/facer/issues/15 --resume 3af31f9f-00b4-4cc1-ba4f-a8896eb1ab16 --model opus
```

Both commands were correctly shown in the log output. The issue is that these are not executed automatically.

## Related Issues

- **Issue #1280**: Stream doesn't close after result event — solved with SIGTERM timeout (now interacts with this issue)
- **Issue #1331**: Auto-resume on Internal Server Error with session preservation — same retry pattern needed for timeouts
- **Issue #942**: `--auto-resume-on-limit-reset` — usage limit handling (different from timeout)
- **Issue #1165**: Exit code detection from command result — relevant to how exit code 143 is processed
- **Issue #1088**: `error_during_execution` handling — shows precedent for nuanced error handling

## Debug Output Enhancement

If future debugging is needed, add more specific timeout logging:

```javascript
if (isRequestTimeout) {
  await log(`⏱️ Request timeout detected (attempt ${retryCount + 1}/${maxRetries})`);
  await log(`   Session ID preserved: ${sessionId}`);
  await log(`   Will retry with --resume in ${delay / 60000} minutes`);
}
```
