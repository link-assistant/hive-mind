# Case Study: Issue #1530 — Update message on session finish does not work

## Problem Statement

When a `/solve` command is executed via Telegram, the bot sends a message:
```
✅ Solve command started successfully!
📊 Session: solve-link-assistant-web-capture-9
🔔 You will receive a notification when the session finishes.
```

However, the message is **never updated** when the session finishes. The notification promise is misleading.

## Timeline of Events

1. **08:06:49 UTC** — User sends `/solve https://github.com/link-assistant/web-capture/pull/9` in Telegram
2. **08:06:49 UTC** — Bot receives command, starts `start-screen` to launch solve in a screen session
3. **08:06:49 UTC** — Bot calls `trackSession("solve-link-assistant-web-capture-9", ...)` with `messageId` in the in-memory `activeSessions` Map
4. **08:06:49 UTC** — Bot edits Telegram message to show "🔔 You will receive a notification..."
5. **08:07:09 UTC** — Claude Code starts executing inside the screen session
6. **08:19:56 UTC** — Solve command completes successfully with `✅ Process completed`
7. **08:19:56+ UTC** — Session monitoring polls `screen -ls` every 30 seconds
8. **Never** — Session is detected as finished → notification is never sent

## Root Cause Analysis

### Primary Root Cause: Screen session persists after command completion

In `src/start-screen.mjs` (line 200), when `autoTerminate` is `false` (the default), the screen session is created as:

```javascript
screenCommand = `screen -dmS ${sessionName} bash -c '${escapedCommand}; exec bash'`;
```

The `; exec bash` ensures the screen session **stays alive** after the solve command finishes. This is intentional (allows reattachment for review), but it breaks session monitoring.

The session monitor in `src/session-monitor.lib.mjs` (`monitorSessions`, line 156-216) checks:
```javascript
stillRunning = await checkScreenSessionExists(sessionName); // Uses `screen -ls`
```

Since the screen session persists indefinitely (bash shell remains), `checkScreenSessionExists` always returns `true`, and the completion notification is **never triggered**.

### Secondary Root Cause: In-memory session store

Session tracking data is stored in a JavaScript `Map` (`activeSessions` at line 34 of `session-monitor.lib.mjs`). If the bot process restarts during the 10-20 minutes a solve session typically runs, all tracking data is lost permanently.

### Contributing Factor: No `--auto-terminate` flag passed

The Telegram bot (`src/telegram-bot.mjs`, `executeStartScreen` function at line 347) calls `start-screen` without `--auto-terminate`, so the default behavior (persistent session) is always used.

## Evidence

- **Session log**: Full log available at the [gist](https://gist.githubusercontent.com/konard/f124db87ef8bee931033804aeae863e3/raw/8f3e7a4039139025f741163563b66c7d8fb3eef0/2342752c-2639-4d23-9689-b977ec29dbd9.log)
- **Screenshot**: Shows Telegram message with notification promise but no update (see issue #1530)
- **Code evidence**: `start-screen.mjs:200` shows `exec bash` keeping session alive; `telegram-bot.mjs` never passes `--auto-terminate`

## Solution

### Fix 1: Pass `--auto-terminate` when starting sessions from Telegram bot

When the bot starts a solve session via `start-screen`, it should pass `--auto-terminate` so the screen session terminates when the command finishes. This allows `screen -ls` based monitoring to detect completion.

### Fix 2: Improve session monitoring with verbose logging

Add detailed logging to `monitorSessions` to track what happens during each monitoring cycle, making future debugging easier.

### Fix 3: Remove misleading notification promise from message

Instead of promising "🔔 You will receive a notification when the session finishes", change the message text to avoid the broken promise. The notification should happen automatically when the fix works.

## Related Issues

- Issue #380: Original session monitoring implementation
- Issue #1062: Bug where `messageInfo` was cleared before use in queue path (fixed)
