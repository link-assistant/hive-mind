# Telegraf GitHub Issues Research -- 409 Conflict Error

## Overview

This document compiles findings from the Telegraf (telegraf/telegraf) GitHub repository regarding the 409 Conflict error, polling lifecycle, and error recovery. These findings inform the root cause analysis and proposed solutions for hive-mind issue #1240.

---

## Issue #215: Can not catch error 409

**URL**: https://github.com/telegraf/telegraf/issues/215
**Status**: Closed (COMPLETED)

### Problem
Users could not catch HTTP 409 errors when the bot token was already in use elsewhere. Neither `try/catch` blocks nor the library's `bot.catch()` handler intercepted the error.

### Key Finding
The maintainer (dotcypress) clarified that `bot.catch()` only handles **pipeline errors** (errors in middleware/handlers), not **polling errors** (errors in the polling loop itself). Long polling continues after errors to handle temporary Telegram server outages.

### Resolution
The maintainer committed a fix: "stop on conflict" for error codes 401 and 409. After this fix, the polling loop terminates when receiving these error codes, allowing the error to propagate to the caller.

---

## Issue #241: Detecting of stop polling when error in handleUpdates

**URL**: https://github.com/telegraf/telegraf/issues/241
**Status**: Closed

### Problem
When an error occurred during polling, the bot stopped working silently. Users had no way to detect the error to resume polling or restart the server.

### Key Finding
Errors in `handleUpdates` caused polling to stop without notification. The user could not programmatically detect this state.

---

## PR #494: Adds the option to reconnect after a 409 error

**URL**: https://github.com/telegraf/telegraf/pull/494
**Status**: Closed (NOT MERGED)

### Proposal
Add automatic reconnection after a 409 error. The implementation required changing the `startPolling` function signature.

### Rejection Reason
The maintainer (dotcypress) rejected it because:
1. "New `startPolling` signature will break backward compatibility"
2. Recommended using webhooks instead for 24/7 operation

### Significance
This is direct evidence that **Telegraf intentionally does not auto-retry on 409 errors**. The maintainer's position is that 409 indicates a real conflict requiring manual intervention. Automatic reconnection was considered but rejected.

---

## Issue #704: ERROR 409 / Failed to process updates

**URL**: https://github.com/telegraf/telegraf/issues/704
**Status**: Closed

### Problem
A basic Telegraf bot crashed with 409 error.

### Root Cause
The user had **two `bot.launch()` calls** in their code (from copying the example).

### Significance
Demonstrates that accidental double-launch within the same process is a common cause.

---

## Issue #832: Stopping and relaunching a bot is broken

**URL**: https://github.com/telegraf/telegraf/issues/832
**Status**: Closed (COMPLETED)

### Problem
When implementing enable/disable functionality, calling `bot.stop()` followed by `bot.launch()` produced the 409 error. Additionally, message handlers fired multiple times proportional to the number of restarts.

### Root Cause
Insufficient delay between `bot.stop()` and `bot.launch()`. The polling connection had not fully terminated before the new one was established.

### Fix
1. Reduce polling timeout: `polling: { timeout: 1 }`
2. Increase delay between stop/launch: change from 1000ms to 3000ms

```javascript
bot.launch({ polling: { timeout: 1 } })
setInterval(() => {
  bot.stop(() => {
    bot.launch({ polling: { timeout: 1 } })
  })
}, 3000)
```

### Significance
Demonstrates that the **50-second polling timeout** in hive-mind's configuration creates a long window during which restarts can cause 409 errors. A lower timeout (e.g., 1-10 seconds) would reduce this window.

---

## Discussion #1234: Long polling silently hangs or swallows errors

**URL**: https://github.com/telegraf/telegraf/discussions/1234
**Status**: Resolved in PR #1262

### Problem
Three issues with long polling:
1. Without awaiting middleware, update confirmation/error handling/backpressure breaks
2. Bot silently hangs when handlers never resolve
3. Errors thrown after the `handlerTimeout` are swallowed

### Resolution
Throw an error after `handlerTimeout` expires. The maintainers acknowledged this was a pragmatic solution; more sophisticated alternatives may be developed later.

---

## Issue #1563: Should handle 429 flood wait errors during polling

**URL**: https://github.com/telegraf/telegraf/issues/1563
**Status**: Open

### Problem
The Telegraf polling loop does not handle 429 (rate limit) errors from the `getUpdates` call.

### Significance
Shows that even 429 errors (which include a `retry_after` value from Telegram) are not handled by Telegraf's polling loop in some versions. The `polling.ts` code does have retry logic for 429 and 5xx, but 409 is explicitly excluded from retry.

---

## Issue #1657: Add ability to recover from errors

**URL**: https://github.com/telegraf/telegraf/issues/1657
**Status**: Closed (resolved in v4.11.0)

### Problem
When a bot encounters a `TelegramError` (codes 401 or 409), the entire application crashes. In multi-bot setups, there is no way to know which bot failed.

### Community Analysis
A contributor (AshenCoon) analyzed the source code and found that errors thrown in `src/core/network/polling.ts` lacked proper handling in the calling code at `src/telegraf.ts`.

### Resolution in v4.11.0
- `bot.launch()` now returns a **catchable promise**
- In polling mode, `bot.launch()` resolves after `bot.stop()` or rejects on polling error
- The bot does NOT continue running after an error, even if caught
- Recovery requires creating a new bot instance and relaunching

### Key Quote from Maintainer
> "bot.catch() catches TelegramError, but you must always await all promises. Telegraf cannot catch unhandledRejection per bot, since it is per-process."

---

## Telegraf polling.ts Source Code Analysis

**URL**: https://github.com/telegraf/telegraf/blob/develop/src/core/network/polling.ts

### Error Classification

| Error Type | Handling | Retried? |
|------------|----------|----------|
| `FetchError` (network) | Retry with backoff | Yes |
| 429 (rate limit) | Retry after `retry_after` param (default 5s) | Yes |
| 500+ (server error) | Retry with backoff | Yes |
| 401 (unauthorized) | Set `skipOffsetSync`, throw | No (fatal) |
| 409 (conflict) | Set `skipOffsetSync`, throw | No (fatal) |
| Other errors | Throw | No |

### Key Observation
Telegraf's internal retry mechanism handles network errors, rate limits, and server errors, but explicitly treats 409 as fatal. **Application-level retry is the only option for 409 errors.**

---

## Summary of Findings

1. **Telegraf treats 409 as fatal** -- by design, not by accident
2. **PR to add auto-retry was rejected** -- maintainer recommends webhooks
3. **v4.11.0 made errors catchable** but does not retry them
4. **Polling timeout affects restart conflict window** -- timeout: 50 creates a 50-second danger zone
5. **Application-level retry is required** for production polling bots
6. **Reducing polling timeout** can mitigate restart conflicts
7. **Webhooks eliminate the problem entirely** but require infrastructure changes
