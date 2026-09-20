# Case Study: Issue #1437 — Auto Retry Stuck With No Recovery Prospects

## Overview

- **Issue URL**: https://github.com/link-assistant/hive-mind/issues/1437
- **Title**: Auto retry stuck, with no clear prospects of recovering
- **Labels**: bug
- **Reporter**: @konard
- **Date**: 2026-03-17
- **Session ID**: `672be36f-1ddf-4d71-8639-66b662fd79c0`
- **Log file**: `./672be36f-1ddf-4d71-8639-66b662fd79c0.log` (55,382 lines, 5.4 MB)
- **Original gist**: https://gist.github.com/konard/6be043cca61d023154e4e2eb53c0148e

---

## Problem Statement

When the Anthropic API returns HTTP 500 Internal Server Error with the explicit header `x-should-retry: false`, Hive Mind's outer retry loop still retries the Claude session up to 10 times with exponential backoff (1 min → 2 min → 4 min → 8 min → ..., up to 30 min max). Each retry immediately fails again with another 500 + `x-should-retry: false`.

The result is a **stuck retry loop** with no recovery prospects:

- The API explicitly signals the error is not transient
- Every retry wastes money and time
- The user must manually CTRL+C after watching the session fail repeatedly
- The total stuck duration could reach up to **30 minutes × 10 retries = 5 hours** of waiting

---

## Evidence — Incident Details

**Command invoked:**

```bash
solve https://github.com/netkeep80/BinDiffSynchronizer/issues/136 \
  --model opus --attach-logs --verbose --no-tool-check \
  --auto-accept-invite --tokens-budget-stats
```

**Session context:**

- Solve v1.34.2
- Model: `claude-opus-4-6`
- Claude Code CLI: v2.1.73
- Anthropic SDK: v0.74.0
- Fork mode: working from `konard/netkeep80-BinDiffSynchronizer`
- Branch: `issue-136-f163485eeb63`
- Draft PR: `https://github.com/netkeep80/BinDiffSynchronizer/pull/147`

---

## Timeline Reconstruction

| Timestamp       | Event                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `19:00:17Z`     | `solve` started (v1.34.2)                                                                                                                                                  |
| `19:00:26Z`     | Temp dir created, fork mode enabled                                                                                                                                        |
| `19:00:31Z`     | Cloned `konard/netkeep80-BinDiffSynchronizer`                                                                                                                              |
| `19:00:40Z`     | Draft PR #147 created                                                                                                                                                      |
| `19:00:43Z`     | Claude execution started                                                                                                                                                   |
| `19:00:43Z`     | Session ID captured: `672be36f-1ddf-4d71-8639-66b662fd79c0`                                                                                                                |
| `~19:00–19:36Z` | Claude active for ~36 minutes, completing **219 turns**                                                                                                                    |
| `19:36:17Z`     | `req_011CZ9DQYZB1ECZaoge4G1VF` → **HTTP 529** (Overloaded), `x-should-retry: true`, no more retries left; Claude SDK retried and got this after exhausting its own retries |
| `19:36:18Z`     | Claude SDK sends a new request `log_42f85c`                                                                                                                                |
| `19:36:35Z`     | `req_011CZ9DRTWaz2QXRwFPE5vig` → **HTTP 500** Internal Server Error, `x-should-retry: false`, 17352ms duration                                                             |
| `19:36:35Z`     | Claude CLI emits synthetic `{"type":"result","is_error":true,"result":"API Error: 500...","num_turns":219,"total_cost_usd":13.58}`                                         |
| `19:36:35Z`     | Hive Mind: detects `isInternalServerError = true` → triggers outer retry loop                                                                                              |
| `19:36:35Z`     | **Retry 1/10 announced — 1 minute wait**                                                                                                                                   |
| `19:37:35Z`     | Retry 1 starts with `--resume 672be36f-...`                                                                                                                                |
| `~19:37–19:39Z` | Session resumes — 6 turns, 1 API request succeeds (200 OK), 1 fails                                                                                                        |
| `19:39:20Z`     | `req_011CZ9DdoukzzFYW3ZoxqKq8` → **HTTP 500**, `x-should-retry: false`, 14950ms                                                                                            |
| `19:39:20Z`     | **Retry 2/10 announced — 2 minute wait**                                                                                                                                   |
| `19:41:21Z`     | Retry 2 starts                                                                                                                                                             |
| `19:41:56Z`     | `req_011CZ9Dq7nbhoYdjUpdhbpnF` → **HTTP 500**, `x-should-retry: false`, 1 turn only                                                                                        |
| `19:41:56Z`     | **Retry 3/10 announced — 4 minute wait**                                                                                                                                   |
| `19:45:56Z`     | Retry 3 starts                                                                                                                                                             |
| `19:46:31Z`     | `req_011CZ9EBPi7chAMvsRNNVqZm` → **HTTP 500**, `x-should-retry: false`, 1 turn only                                                                                        |
| `19:46:31Z`     | **Retry 4/10 announced — 8 minute wait**                                                                                                                                   |
| `~19:46–19:54Z` | Countdown: 7 min... 6 min... 5 min... 4 min... 3 min... 2 min... 1 min...                                                                                                  |
| `19:54:03Z`     | **User interrupts with CTRL+C** during the 8-minute wait                                                                                                                   |
| `19:54:03Z`     | Log sanitized and uploaded to Gist                                                                                                                                         |

**Total stuck time**: ~18 minutes of retrying/waiting before user gave up

---

## Retry Pattern Summary

| Event             | Time      | HTTP Status | `x-should-retry` | num_turns | Cost   |
| ----------------- | --------- | ----------- | ---------------- | --------- | ------ |
| Original run ends | 19:36:35Z | 500         | **false**        | 219       | $13.58 |
| Retry 1/10 ends   | 19:39:20Z | 500         | **false**        | 6         | $0.21  |
| Retry 2/10 ends   | 19:41:56Z | 500         | **false**        | 1         | $0.00  |
| Retry 3/10 ends   | 19:46:31Z | 500         | **false**        | 1         | $0.00  |
| User CTRL+C       | 19:54:03Z | —           | —                | —         | —      |

**Key observation**: Every single 500 error carried `x-should-retry: false`. The Anthropic API explicitly said "do not retry." The Hive Mind outer loop ignored this signal completely.

---

## Root Cause Analysis

### Primary Root Cause: Outer Retry Loop Ignores `x-should-retry: false`

The core design flaw is that Hive Mind implements its own outer retry loop (in `src/claude.lib.mjs`) that is completely decoupled from the Anthropic SDK's retry decision. Here is what happens:

1. **Inside Claude CLI** (Anthropic SDK v0.74.0): When a 500 error returns with `x-should-retry: false`, the SDK logs `"error; not retryable"` and does NOT retry. It synthesizes a `{"type":"result","is_error":true}` response to inform the outer layer.

2. **Inside Hive Mind** (`executeClaudeCommand()` in `src/claude.lib.mjs`, lines 1200-1234): When `isInternalServerError` is detected (set at line 1049-1051), the outer retry logic triggers unconditionally — **without checking whether the API said `x-should-retry: false`**.

The `x-should-retry: false` header is only visible in the debug logs (via `ANTHROPIC_LOG=debug`). Hive Mind does not read it from the Claude CLI's structured JSON output. Instead, it only sees the error message in the result event.

**The relevant code** (`src/claude.lib.mjs`, lines ~1049-1051):

```javascript
if (lastMessage.includes('Internal server error') && !lastMessage.includes('Overloaded')) {
  isInternalServerError = true;
}
```

And the retry decision (lines ~1200-1219):

```javascript
const isTransientError = isOverloadError || isInternalServerError || is503Error || isRequestTimeout || ...;
if ((commandFailed || isTransientError) && isTransientError) {
  // ...always retries regardless of what API said...
  if (retryCount < maxRetries) {
    await waitWithCountdown(delay, log);
    retryCount++;
    return await executeWithRetry();
  }
}
```

There is no check for "did the API tell us not to retry?" — the `x-should-retry: false` signal is completely lost.

### Secondary Root Cause: `x-should-retry` Header Not Propagated

The `x-should-retry: false` header is available in the Claude CLI's debug output (via `ANTHROPIC_LOG=debug`) but is NOT included in the structured JSON events emitted by the CLI. It appears only in unstructured log lines like:

```
[log_42f85c] response error (error; not retryable) {
  ...
  'x-should-retry': 'false'
}
```

This means Hive Mind cannot easily read this header from the structured output. However, the **"error; not retryable"** text IS present in the stderr output and could be parsed.

### Tertiary Root Cause: Retry Decay — Each Retry Has Fewer Turns

An important pattern visible in the data:

- Original: 219 turns (36 minutes of productive work)
- Retry 1: 6 turns (context partially restored from cache)
- Retry 2: 1 turn (immediately fails)
- Retry 3: 1 turn (immediately fails)

The declining turn count shows the session is increasingly degraded. After Retry 1, the session is essentially broken — it fails on the very first API call. This is a **strong signal that recovery is impossible** and the error is structural (not transient load).

### What `x-should-retry: false` Actually Means

According to Anthropic's SDK behavior and documentation:

- **`x-should-retry: true`** (seen at 19:36:17Z on HTTP 529): The server is temporarily overloaded. The SDK retried this automatically.
- **`x-should-retry: false`** (seen at 19:36:35Z on HTTP 500): The error is **not** a temporary load issue. This is a structural/persistent server error on this specific request. The SDK does not retry.

The distinction is important: HTTP 529 (overloaded) with `x-should-retry: true` is genuinely transient and worth retrying. HTTP 500 with `x-should-retry: false` is a different category of error that the server itself says is not worth retrying.

### Why the First Retry (Retry 1) Had 6 Turns

Retry 1 used `--resume 672be36f-...` to restore the session. During those 6 turns:

- Turn 1: Session context loaded from Anthropic's server-side cache
- Turns 2-5: Claude continued working (brief)
- Turn 6: Another 500 + `x-should-retry: false` hit

This suggests the server-side error is not related to the specific request content (which was resuming an existing session) but rather to the underlying infrastructure state for this session or this account.

---

## Online Research

### Anthropic API `x-should-retry` Header

The `x-should-retry` response header is documented in [Anthropic's API error documentation](https://docs.anthropic.com/en/api/errors) and implemented in their [Python](https://github.com/anthropics/anthropic-sdk-python) and [TypeScript](https://github.com/anthropics/anthropic-sdk-node) SDKs.

From the SDK source code:

- `x-should-retry: true` → The SDK will retry the request internally
- `x-should-retry: false` → The SDK will NOT retry, even if the status code is in the normally-retryable range (429, 500, 529)

The SDK documentation for `shouldRetryRequest()` shows that `x-should-retry: false` takes **highest precedence** over any other retry heuristic.

### Related Issues in anthropics/claude-code

- **anthropics/claude-code** GitHub issues around 500 errors and retry behavior are common patterns when the API is under load.
- The fact that concurrent requests at the same time succeeded (Retry 1's first 6 turns worked) suggests this is a specific session or context-size related issue, not general API unavailability.

### Anthropic Status During Incident

The incident occurred at 19:36-19:54Z UTC on 2026-03-17. The 529 (Overloaded) error at 19:36:17Z suggests the API was under load at that time. However, other tasks running concurrently worked fine, per the issue description: "Other tasks at the same time worked."

This pattern — some requests succeed while others fail — is consistent with a **request-specific issue** (e.g., specific session context, token budget exhaustion in a particular backend shard) rather than global API unavailability.

---

## Proposed Solutions

### Solution 1 (Recommended): Detect "Not Retryable" Signal and Fail Fast

Parse the `"error; not retryable"` string from verbose stderr output (visible when `ANTHROPIC_LOG=debug` is set via `--verbose` mode) to detect when the API has marked the error as non-retryable.

When all recent consecutive 500 errors carry the non-retryable signal, fail immediately rather than continuing the retry loop.

**Detection**: In the stderr handler (already streaming verbose API logs), look for:

```
"error; not retryable"
```

**Action**: If `isInternalServerError = true` AND the error was explicitly marked "not retryable," skip the outer retry loop and fail fast.

### Solution 2: Track Consecutive Non-Improving Retries

Track whether retries are making progress (increasing `num_turns`) or degrading (1 turn → fail). If `num_turns === 1` for N consecutive retries, the session is stuck and cannot recover. Fail immediately.

This approach doesn't require parsing verbose debug output — it uses the structured JSON event data already captured.

**Detection**: After each retry, compare `num_turns`:

- Original: 219
- Retry 1: 6 (reduced but non-trivial → allow retry)
- Retry 2: 1 (minimal, likely stuck → warn)
- Retry 3: 1 (minimal again → **fail fast**)

**Threshold**: If `num_turns === 1` for 2+ consecutive retries, declare the error non-recoverable.

### Solution 3: Limit Retries on "Not Retryable" 500 Errors

When `x-should-retry: false` behavior is detected (via `"error; not retryable"` in stderr), use a much lower retry limit (e.g., 2-3 retries) instead of 10.

Rationale: Give the system one or two chances in case the "not retryable" signal is itself wrong (API bugs do happen), but don't blindly retry 10 times.

### Solution 4 (Complementary): Parse `x-should-retry` from Verbose Log Lines

When `--verbose` mode is active (`ANTHROPIC_LOG=debug`), Hive Mind already receives and logs the full HTTP response headers including `x-should-retry`. Parsing these from the raw stderr stream would give the most accurate signal.

**Challenge**: The header appears in unstructured stderr text, not in the structured JSON events. This requires text parsing of the verbose debug output.

**Implementation**:

```javascript
// In the stderr handler:
if (chunk.type === 'stderr') {
  const errorOutput = chunk.data.toString();
  if (errorOutput.includes("'x-should-retry': 'false'") || errorOutput.includes('"x-should-retry": "false"')) {
    lastResponseShouldNotRetry = true;
  }
}
```

---

## Recommended Fix Implementation

The recommended fix combines **Solution 2** (track consecutive non-improving retries) and **Solution 1** (detect "not retryable" signal from stderr):

### Changes to `src/claude.lib.mjs`

1. **Track `notRetryableErrors` counter** — incremented each time stderr contains `"error; not retryable"`
2. **Track `lastRetryNumTurns`** — compare with current `num_turns` to detect stuck sessions
3. **Add early-exit condition** — if the error is marked not retryable AND we've already tried at least once with `num_turns <= 1`, fail immediately

### Changes to `src/config.lib.mjs`

Add `maxNotRetryableAttempts` configuration:

```javascript
// Maximum retries when API signals "not retryable" — give it one chance but fail fast
maxNotRetryableAttempts: parseIntWithDefault('HIVE_MIND_MAX_NOT_RETRYABLE_ATTEMPTS', 1),
```

---

## Debug Output Enhancement

The following verbose log messages should be added to make future diagnosis easier:

1. When `"error; not retryable"` is detected in stderr:

   ```
   ⚠️ API signaled error is not retryable (x-should-retry: false)
   ```

2. When comparing retry turn counts:

   ```
   📊 Retry turn count: current=1, previous=6 (degrading)
   ```

3. When failing fast due to stuck pattern:
   ```
   ❌ Stopping retries: consecutive failures with minimal progress (num_turns=1)
      This error is not recoverable. Check https://status.anthropic.com/
   ```

---

## Related Issues

- **Issue #1331**: Unified retry for all transient API errors (Overloaded, 503, Internal Server Error) — this is where the current retry logic was introduced
- **Issue #1353**: On timeout of `--tool claude` we must do auto restart with `--resume` — similar retry pattern for request timeouts
- **Issue #1280**: Stream doesn't close after result event — force-kill workaround
- **Issue #1088**: `error_during_execution` handling — nuanced error classification precedent
- **Issue #1354**: Track result event for accurate success/failure detection

---

## Upstream Issue to File

An issue should be filed in **anthropics/claude-code** requesting that the structured JSON result event include the `x-should-retry` header value from the API response. Currently the structured output (`{"type":"result","is_error":true,...}`) does not include whether the error was marked retryable by the server.

Proposed feature request:

- Include `"should_retry": false` in the `{"type":"result","is_error":true}` event when the HTTP response contained `x-should-retry: false`
- This would allow outer wrappers (like Hive Mind) to make informed retry decisions without parsing debug log text

---

## Cost Impact

| Phase                              | Cost        |
| ---------------------------------- | ----------- |
| Original 219-turn session          | $13.58      |
| Retry 1 (6 turns)                  | $0.21       |
| Retry 2 (1 turn)                   | ~$0.00      |
| Retry 3 (1 turn)                   | ~$0.00      |
| **Total wasted on failed retries** | **~$0.21**  |
| **Total cost of session**          | **~$13.79** |

The financial waste from the retries themselves was small ($0.21). The bigger cost was:

1. **18+ minutes of user time** watching the retry countdown
2. **Loss of the entire session's work** — 219 turns, 36 minutes of Claude activity, $13.58 of useful computation — all discarded because the session could not be resumed successfully after the 500 error
