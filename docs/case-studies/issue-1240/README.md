# Case Study: Issue #1240 -- `409: Conflict: terminated by other getUpdates request`

## Summary

The hive-telegram-bot process failed to start with a `TelegramError: 409: Conflict: terminated by other getUpdates request; make sure that only one bot instance is running`. This error originates from the Telegram Bot API when two or more clients simultaneously call `getUpdates` using the same bot token. The bot process exited with code 1 and did not attempt to retry.

## Error Details

```
TelegramError: 409: Conflict: terminated by other getUpdates request; make sure that only one bot instance is running
    at Telegram.callApi (.../telegraf-v-latest/lib/core/network/client.js:315:19)
    at async [Symbol.asyncIterator] (.../telegraf-v-latest/lib/core/network/polling.js:30:33)
    at async Polling.loop (.../telegraf-v-latest/lib/core/network/polling.js:73:30)
    at async Telegraf.launch (.../telegraf-v-latest/lib/telegraf.js:194:13)
```

Error response payload:

```json
{
  "ok": false,
  "error_code": 409,
  "description": "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running"
}
```

The `getUpdates` request included `timeout: 50` and `offset: 957693729`, indicating the bot had previously processed updates (high offset value) before this error occurred.

## Timeline / Sequence of Events

1. **Bot was previously running**: The high `offset: 957693729` value confirms the bot had been successfully processing updates for some time before the failure.
2. **A conflicting `getUpdates` call occurred**: Either a second process, a restart race, or a network condition caused Telegram's servers to detect two simultaneous `getUpdates` requests for the same bot token.
3. **Telegraf treated the error as fatal**: The Telegraf library's `polling.ts` treats 409 errors as critical/non-retryable, sets `skipOffsetSync = true`, and throws the error.
4. **`bot.launch()` promise rejected**: The rejection propagated to the `.catch()` handler in `telegram-bot.mjs` (line 1453).
5. **Bot process exited**: The catch handler called `process.exit(1)`, terminating the process with no retry attempt.

## Root Cause Analysis

### Root Cause 1: Telegram Bot API enforces single-consumer long polling

The Telegram Bot API allows only one active `getUpdates` connection per bot token at any time. When a second `getUpdates` request arrives, the API terminates the first one with a 409 response. This is documented behavior:

> "Each bot can have only one update listener attached at each given time."

The 409 response has two known variants:

- `"Conflict: terminated by other getUpdates request; make sure that only one bot instance is running"` -- another polling client exists
- `"Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first"` -- a webhook is set

### Root Cause 2: No retry logic in the bot startup code

The current `telegram-bot.mjs` code (lines 1391-1464) treats all errors from `bot.launch()` as terminal:

```javascript
.catch(error => {
    console.error('Failed to start bot:', error);
    // ...
    process.exit(1);  // <-- Exits immediately, no retry
});
```

There is no exponential backoff, no delay-and-retry, and no differentiation between transient vs. permanent errors.

### Root Cause 3: Telegraf treats 409 as a fatal, non-retryable error

In Telegraf's `polling.ts` source code, error codes 401 and 409 are treated identically as critical errors:

```typescript
// From telegraf/src/core/network/polling.ts
if (err.code === 401 || err.code === 409) {
  this.skipOffsetSync = true;
  throw err; // Fatal -- no internal retry
}
```

This contrasts with 429 (rate limit) and 500+ (server errors) which trigger internal retry with exponential backoff. The rationale is that 409 indicates a configuration problem (multiple instances), but this does not account for transient 409 errors during restarts.

### Root Cause 4: Possible causes of the 409 in a "single instance" scenario

Even when the operator believes only one bot instance is running, several scenarios can produce a 409:

1. **Process restart overlap**: If the bot process is restarted by a process manager (Docker `restart: unless-stopped`, systemd `Restart=always`, PM2), the new process may call `getUpdates` before the old process has fully released its long-polling connection. Long polling requests have a `timeout: 50` seconds in this codebase, meaning Telegram holds the connection for up to 50 seconds. A restart during that window creates a conflict.

2. **Docker/Coolify deployment restart**: The `coolify/docker-compose.yml` has `restart: unless-stopped`. If Docker restarts the container (e.g., after an OOM kill, health check failure, or deployment update), the new container starts while Telegram's server still considers the old long-polling connection active.

3. **Unclean process termination**: If the process is killed with `SIGKILL` (rather than `SIGTERM` or `SIGINT`), the graceful shutdown handlers (`process.once('SIGINT', ...)` and `process.once('SIGTERM', ...)`) never execute. The `bot.stop()` call never happens, and Telegram's server keeps the old long-polling connection alive until it times out naturally (up to 50 seconds).

4. **Network-level connection persistence**: If the TCP connection between the bot and Telegram's server is interrupted without a proper FIN/RST (e.g., due to a network partition, NAT timeout, or load balancer reset), Telegram's server may keep the old connection in a half-open state. When the bot reconnects, Telegram sees two simultaneous connections and returns 409.

5. **`deleteWebhook` with `drop_pending_updates` timing**: The bot calls `deleteWebhook({ drop_pending_updates: true })` before `bot.launch()`. If this call completes but the subsequent `getUpdates` conflicts with a stale connection from a prior run, the 409 occurs.

6. **Multiple service entries in deployment config**: If the deployment platform (Coolify, Docker Swarm) accidentally scales to more than one replica, or if there is a rolling deployment where old and new containers overlap.

7. **Manual debugging sessions**: If someone runs the bot manually while the service is still running (e.g., `node src/telegram-bot.mjs` while the Docker container is active).

## Impact

- The bot becomes completely unavailable (exits with code 1)
- All Telegram commands (`/solve`, `/solve_queue`, `/help`, etc.) stop working
- If no external process manager restarts the bot, it remains down indefinitely
- If a process manager does restart it, the restart itself can trigger another 409, creating a restart loop

## Proposed Solutions

### Solution 1: Add retry logic with exponential backoff (recommended)

Wrap `bot.launch()` in a retry loop with exponential backoff, capped at a maximum interval (e.g., 10 minutes as requested in the issue). Differentiate between:

- **Retryable errors**: 409 (Conflict), network errors, 5xx server errors
- **Non-retryable errors**: 401 (Unauthorized -- invalid token), which should still exit immediately

```javascript
async function launchBotWithRetry(bot, options, maxRetries = Infinity, maxDelayMs = 10 * 60 * 1000) {
  let attempt = 0;
  const baseDelayMs = 1000; // Start with 1 second

  while (true) {
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      await bot.launch(options);
      return; // Success
    } catch (error) {
      attempt++;

      // 401 is non-retryable (invalid token)
      if (error.code === 401) {
        console.error('Fatal: Invalid bot token (401 Unauthorized). Exiting.');
        process.exit(1);
      }

      // Calculate delay with exponential backoff + jitter, capped at maxDelayMs
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const jitter = delay * 0.1 * Math.random(); // 10% jitter
      const totalDelay = delay + jitter;

      console.warn(`Bot launch attempt ${attempt} failed (${error.code || 'unknown'}): ${error.message}. ` + `Retrying in ${Math.round(totalDelay / 1000)}s...`);

      await new Promise(resolve => setTimeout(resolve, totalDelay));
    }
  }
}
```

**Backoff schedule**: 1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 512s (max 600s = 10 min)

### Solution 2: Add a startup delay before calling `getUpdates`

Before calling `bot.launch()`, wait a short period (e.g., 5-10 seconds) to allow any previous long-polling connection to time out. This is especially important when using `restart: unless-stopped` in Docker.

```javascript
console.log('Waiting 5 seconds before starting polling to allow old connections to expire...');
await new Promise(resolve => setTimeout(resolve, 5000));
```

### Solution 3: Switch to webhook mode for production

Webhooks avoid the `getUpdates` conflict entirely because Telegram pushes updates to the bot's HTTP server rather than the bot pulling them. This eliminates the single-consumer constraint.

```javascript
bot.launch({
  webhook: {
    domain: 'https://bot.example.com',
    hookPath: '/telegram-webhook',
    port: 8443,
  },
});
```

However, this requires:

- A publicly accessible HTTPS endpoint
- SSL certificate setup
- Infrastructure changes (reverse proxy, firewall rules)

### Solution 4: Detect and kill stale processes before starting

Before starting the bot, check for and kill any existing bot processes:

```javascript
import { execSync } from 'child_process';
try {
  const result = execSync('pgrep -f "telegram-bot.mjs"', { encoding: 'utf8' });
  const pids = result
    .trim()
    .split('\n')
    .filter(pid => pid !== String(process.pid));
  for (const pid of pids) {
    console.warn(`Killing stale bot process: ${pid}`);
    process.kill(Number(pid), 'SIGTERM');
  }
  if (pids.length > 0) {
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for cleanup
  }
} catch {
  /* No stale processes */
}
```

### Solution 5: Use `dropPendingUpdates` with offset reset

The bot already uses `dropPendingUpdates: true`, which is correct. Additionally, calling `getUpdates` with `offset: -1` before starting polling can help clear the server-side state:

```javascript
try {
  await bot.telegram.callApi('getUpdates', { offset: -1, limit: 1, timeout: 0 });
} catch {
  /* ignore */
}
```

## Existing Libraries and Tools

| Library                                                                  | Purpose                                                   | npm                   |
| ------------------------------------------------------------------------ | --------------------------------------------------------- | --------------------- |
| [p-retry](https://github.com/sindresorhus/p-retry)                       | Promise retry with exponential backoff                    | `p-retry`             |
| [async-retry](https://www.npmjs.com/package/async-retry)                 | Retry with configurable backoff (factor, min/max timeout) | `async-retry`         |
| [exponential-backoff](https://www.npmjs.com/package/exponential-backoff) | Exponential delay with jitter support ("full"/"none")     | `exponential-backoff` |

Since the project uses `use-m` for dynamic module loading, any of these can be used without adding to `package.json`:

```javascript
const { default: pRetry } = await use('p-retry');
```

## Related Telegraf GitHub Issues

| Issue                                                          | Title                                                 | Status                                         | Relevance                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| [#215](https://github.com/telegraf/telegraf/issues/215)        | Can not catch error 409                               | Closed (fixed: "stop on conflict" for 401/409) | Shows historical inability to catch 409                                |
| [#241](https://github.com/telegraf/telegraf/issues/241)        | Detecting of stop polling when error in handleUpdates | Closed                                         | Polling stops silently on error                                        |
| [#494](https://github.com/telegraf/telegraf/pull/494)          | Adds the option to reconnect after a 409 error        | Closed (not merged)                            | Rejected for breaking backward compat; told to use webhooks            |
| [#704](https://github.com/telegraf/telegraf/issues/704)        | ERROR 409 / Failed to process updates                 | Closed                                         | Caused by duplicate `bot.launch()` calls                               |
| [#832](https://github.com/telegraf/telegraf/issues/832)        | Stopping and relaunching a bot is broken              | Closed                                         | Stop/relaunch causes 409; fix: increase polling timeout, delay restart |
| [#1234](https://github.com/telegraf/telegraf/discussions/1234) | Long polling silently hangs or swallows errors        | Discussion                                     | Errors thrown after handlerTimeout are swallowed                       |
| [#1563](https://github.com/telegraf/telegraf/issues/1563)      | Should handle 429 flood wait errors during polling    | Open                                           | 429 gets backoff but 409 does not                                      |
| [#1657](https://github.com/telegraf/telegraf/issues/1657)      | Add ability to recover from errors                    | Closed (v4.11.0)                               | `bot.launch()` now returns catchable promise                           |

### Key takeaway from Telegraf history

Telegraf v4.11.0 made `bot.launch()` errors catchable, but **the framework explicitly does not retry on 409 errors**. The library's position is:

- 409 indicates a "real" conflict (multiple instances), not a transient error
- Recovery requires manual intervention (create new bot instance)
- For production 24/7 operation, webhooks are recommended over polling

This means **retry logic must be implemented at the application level**, which is exactly what this issue requests.

## Can This Happen with a Single Instance?

**Yes.** Based on extensive research across multiple Telegram bot frameworks and communities, the 409 error can occur even with a genuinely single instance in these scenarios:

1. **Restart race condition**: The most common single-instance cause. When a process manager restarts the bot, the old long-polling connection may still be held by Telegram's server (for up to the configured timeout -- 50 seconds in this case). The new instance's `getUpdates` call conflicts with the old one.

2. **Network timeout/reconnection**: If the network connection between the bot and Telegram's server is interrupted without a clean TCP teardown, Telegram may keep the old connection open. When the bot reconnects (same process, same instance), Telegram sees two connections. This has been reported by users running bots on Raspberry Pis with unstable network connections ([python-telegram-bot #4018](https://github.com/python-telegram-bot/python-telegram-bot/issues/4018)).

3. **Docker container restart overlap**: Docker's `restart: unless-stopped` policy can start a new container before the old one has fully terminated its network connections. Combined with the 50-second polling timeout, this creates a window for 409 errors.

4. **OOM kill or SIGKILL**: If the process is killed with `SIGKILL` (which cannot be caught), the graceful shutdown handlers never run, and `bot.stop()` is never called. The Telegram server keeps the old connection until timeout.

## Files Relevant to the Fix

- `src/telegram-bot.mjs` -- Lines 1391-1464: Bot launch and error handling code
- `coolify/docker-compose.yml` -- Line 79: `restart: unless-stopped` policy

## Recommended Implementation Priority

1. **Immediate**: Add retry with exponential backoff (Solution 1) -- addresses the symptom
2. **Immediate**: Add startup delay (Solution 2) -- reduces likelihood of restart race
3. **Future**: Evaluate webhook mode (Solution 3) -- eliminates the problem entirely
4. **Future**: Add stale process detection (Solution 4) -- defense in depth

## References

- [Telegram Bot API -- getUpdates](https://core.telegram.org/bots/api#getupdates)
- [Telegram Bot API -- BotCommand](https://core.telegram.org/bots/api#botcommand)
- [Telegraf.js v4.11.0 Release Notes](https://github.com/telegraf/telegraf/releases/tag/v4.11.0)
- [Telegraf polling.ts source](https://github.com/telegraf/telegraf/blob/develop/src/core/network/polling.ts)
- [node-telegram-bot-api #550](https://github.com/yagop/node-telegram-bot-api/issues/550)
- [pyTelegramBotAPI #1778](https://github.com/eternnoir/pyTelegramBotAPI/issues/1778)
- [python-telegram-bot #4018](https://github.com/python-telegram-bot/python-telegram-bot/issues/4018)
- [NestJS Telegram bot 409 fix](https://dev.to/endykaufman/nestjs-telegram-bot-fix-error-409-conflict-terminated-by-other-getupdates-request-22g8)
- [Telegraf PR #494 -- Reconnect after 409](https://github.com/telegraf/telegraf/pull/494)
- [Telegraf Issue #832 -- Stop/relaunch broken](https://github.com/telegraf/telegraf/issues/832)
- [Telegraf Issue #1657 -- Recover from errors](https://github.com/telegraf/telegraf/issues/1657)
- Issue #1240: https://github.com/link-assistant/hive-mind/issues/1240

## Lessons Learned

1. **Telegraf does not auto-retry on 409 errors** -- Application-level retry is required
2. **Long polling timeout creates a restart conflict window** -- The `timeout: 50` parameter means a 50-second window where restarts can cause 409
3. **`process.exit(1)` in error handlers prevents any retry** -- This should be replaced with retry logic
4. **Docker `restart: unless-stopped` can exacerbate the problem** -- The container restarts immediately, but the old connection lingers on Telegram's server
5. **The error is not always caused by "another instance"** -- Network issues, unclean termination, and restart timing can all cause it with a single instance
