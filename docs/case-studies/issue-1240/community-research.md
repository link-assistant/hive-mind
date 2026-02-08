# Community Research -- Telegram Bot API 409 Conflict Error

## Overview

This document compiles findings from across the Telegram bot development community about the 409 Conflict error. The research covers multiple libraries, frameworks, and programming languages to provide a comprehensive understanding of the error.

---

## 1. Official Telegram Bot API Documentation

The Telegram Bot API documentation for `getUpdates` states:

> "Use this method to receive incoming updates using long polling. Returns an Array of Update objects."

**Constraint**: Only one `getUpdates` connection is allowed per bot token at any time. The API enforces this by returning a 409 Conflict error when a second client attempts to poll.

**Two distinct 409 error messages**:
- `"Conflict: terminated by other getUpdates request; make sure that only one bot instance is running"` -- Another polling client exists for the same token
- `"Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first"` -- A webhook is set, blocking polling

Source: https://core.telegram.org/bots/api#getupdates

---

## 2. Cross-Library Evidence

The 409 error is documented across every major Telegram bot library:

| Library | Language | Issue | URL |
|---------|----------|-------|-----|
| node-telegram-bot-api | JavaScript | #550 | https://github.com/yagop/node-telegram-bot-api/issues/550 |
| node-telegram-bot-api | JavaScript | #488 | https://github.com/yagop/node-telegram-bot-api/issues/488 |
| telegraf | JavaScript | #215, #704, #832 | https://github.com/telegraf/telegraf/issues/215 |
| pyTelegramBotAPI | Python | #25, #1778 | https://github.com/eternnoir/pyTelegramBotAPI/issues/25 |
| python-telegram-bot | Python | #582, #4018 | https://github.com/python-telegram-bot/python-telegram-bot/issues/582 |
| TelegramBots (Java) | Java | #1221 | https://github.com/rubenlagus/TelegramBots/issues/1221 |
| java-telegram-bot-api | Java | #261 | https://github.com/pengrad/java-telegram-bot-api/issues/261 |
| nestjs-telegraf | TypeScript | #1238 | https://github.com/nksmnf/nestjs-telegraf/issues/1238 |

This confirms the error is a **Telegram API-level constraint**, not a library-specific bug.

---

## 3. All Known Causes

### 3.1 Multiple instances with same token
The most common cause. Running two or more bot processes with the same API token, whether intentionally (dev+prod) or accidentally (stale process).

### 3.2 Process restart overlap
When a process manager (Docker, systemd, PM2) restarts the bot, the new instance starts before the old one's long-polling connection has fully closed. The long-polling timeout (commonly 30-50 seconds) creates a window for conflicts.

### 3.3 Unclean process termination
Killing a bot with `SIGKILL`, power failure, or OOM killer prevents graceful shutdown. The `bot.stop()` method never runs, and Telegram keeps the old connection until it times out.

### 3.4 Double `bot.launch()` or `startPolling()` calls
Accidentally calling the launch method twice in the same process creates two polling loops. This was the root cause in Telegraf Issue #704.

### 3.5 Webhook conflict
Setting a webhook and then trying to use `getUpdates` produces a variant of the 409 error. The bot must call `deleteWebhook()` before switching to polling.

### 3.6 Network-level connection persistence
If the TCP connection between the bot and Telegram is interrupted without a proper FIN/RST (network partition, NAT timeout, load balancer reset), Telegram may keep the old connection in a half-open state. When the bot reconnects, Telegram sees two connections.

Evidence: python-telegram-bot #4018 reports this on Raspberry Pi with unstable connectivity.

### 3.7 Deployment/CI environment overlap
Running automated tests or CI pipelines that start a bot with the same token as a production instance.

### 3.8 Multiple services on same platform
NestJS applications with multiple modules that each try to initialize the same Telegram bot.

---

## 4. How Other Projects Handle This Error

### 4.1 python-telegram-bot (Python)
- Does not auto-retry on 409
- Documents it in FAQ: "only one instance can call getUpdates"
- Recommends checking for stale processes
- Source: https://python-telegram-bot.readthedocs.io/

### 4.2 pyTelegramBotAPI (Python)
- Threaded polling can trigger 409 during restart
- Community recommends `remove_webhook()` before starting polling
- Source: https://github.com/eternnoir/pyTelegramBotAPI/issues/1778

### 4.3 node-telegram-bot-api (JavaScript)
- 409 terminates polling
- Recommends: ensure only one instance, avoid manual `startPolling()` when auto-polling is enabled
- Source: https://github.com/yagop/node-telegram-bot-api/issues/550

### 4.4 grammY (JavaScript/TypeScript)
- Documents long polling vs webhooks trade-offs
- Recommends webhooks for production deployment
- Provides built-in retry for transient errors but not 409
- Source: https://grammy.dev/guide/deployment-types

### 4.5 Home Assistant (Python)
- Large number of users report 409 after system migration, service restart, or running duplicate integrations
- Solution: ensure only one Telegram integration is configured
- Source: https://community.home-assistant.io/t/177544

### 4.6 NestJS Telegram Bot
- 409 occurs when multiple NestJS modules initialize the same bot
- Fix: restructure dependency injection to ensure single bot instance
- Source: https://dev.to/endykaufman/nestjs-telegram-bot-fix-error-409-conflict-terminated-by-other-getupdates-request-22g8

---

## 5. Recommended Retry Strategies

### 5.1 Do NOT blindly retry 409 without investigation

The 409 error usually indicates a real problem (multiple instances). Blindly retrying can cause:
- Rapid flip-flopping between instances
- Message processing loops (handlers fire multiple times)
- Increased API load

### 5.2 Recommended: Delay + Retry with exponential backoff

```
Attempt 1: wait 1s, retry
Attempt 2: wait 2s, retry
Attempt 3: wait 4s, retry
Attempt 4: wait 8s, retry
...
Attempt N: wait min(2^N, maxDelay), retry
```

**Max delay**: 5-10 minutes is reasonable. The old connection should time out within the polling timeout period (typically 30-50 seconds).

### 5.3 Before retrying: cleanup steps

1. Call `deleteWebhook()` to ensure no webhook is blocking polling
2. Call `getUpdates` with `offset: -1, limit: 1, timeout: 0` to clear server-side state
3. Wait at least `polling_timeout + 5` seconds for the old connection to expire
4. Then retry `bot.launch()`

### 5.4 Add jitter to prevent thundering herd

When multiple instances restart simultaneously (e.g., after a deployment), adding random jitter to the retry delay prevents them from all retrying at the same time:

```javascript
const jitter = baseDelay * 0.1 * Math.random();
const totalDelay = baseDelay + jitter;
```

---

## 6. Single Instance 409: Evidence

### Can the 409 error happen with truly only one instance?

**Yes**, based on the following evidence:

1. **python-telegram-bot #4018**: User on Raspberry Pi with unstable network observed 409 errors despite running only one instance. The user attributed it to "difficult connectivity between my bot host location and telegram servers/API."

2. **Telegraf #832**: Stop/relaunch within the same process produces 409 if the delay between stop and launch is insufficient. Even with `bot.stop()` called, the underlying HTTP connection may not be fully terminated before `bot.launch()` opens a new one.

3. **Docker restart scenario**: Docker's `restart: unless-stopped` starts the new container as soon as the old one exits. If the old container was killed (SIGKILL during OOM, or Docker's 10-second grace period expired), the long-polling connection lingers on Telegram's server.

4. **Telegram server-side connection timeout**: Telegram holds long-polling connections for the duration specified by the `timeout` parameter. Even after the client disconnects, the server may not immediately recognize the disconnection (especially with half-open TCP connections).

---

## 7. Webhook vs Polling Trade-offs

| Aspect | Long Polling | Webhooks |
|--------|-------------|----------|
| 409 Conflict risk | High (single-consumer constraint) | None (push-based) |
| Setup complexity | Low (no domain/SSL needed) | Medium (requires HTTPS endpoint) |
| Latency | Depends on polling interval | Near-instant (push) |
| Resource usage | Constant (open connection) | On-demand (per-update HTTP request) |
| Multiple instances | Not possible | Possible (with load balancer) |
| Best for | Development, simple bots | Production, high-traffic bots |

### Recommendation for production
Webhooks eliminate the 409 problem entirely but require:
- Public HTTPS endpoint (domain + SSL)
- Reverse proxy (nginx, Caddy)
- Firewall configuration
- Health monitoring

For bots that must use polling (no public endpoint), **application-level retry with exponential backoff** is the recommended mitigation.
