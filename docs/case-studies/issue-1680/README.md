# Issue 1680 Case Study: Start Screen-Isolated Telegram Session Monitoring

## Source Artifacts

- Issue metadata and comments: `source/issue-1680.json`, `source/issue-1680-comments.json`
- Reported screenshot: `source/issue-screenshot.png`
- Solution PR snapshot: `source/pr-1681.json`
- Maintainer-provided Telegram bot log: `source/hive-telegram-bot.log`
- Referenced external task: `source/external-ideav-crm-issue-2117.json`
- Referenced external PR: `source/external-ideav-crm-pr-2118.json`, `source/external-ideav-crm-pr-2118-comments.json`
- start-command evidence: `source/start-command-status-6a0ec9c3.json`, `source/start-command-e44d4086.log.gz`

## External Research

- GNU Screen documents that `screen -ls` lists session identifiers and that detached sessions can be resumed with `screen -r`: https://www.gnu.org/software/screen/manual/screen.pdf
- Node.js documents `setInterval()` as repeated callback scheduling, which is the monitor mechanism used by the Telegram bot: https://nodejs.org/download/release/latest-jod/docs/api/timers.html
- Telegraf issue #1749 records that awaiting `telegraf.launch()` in long-polling mode can block following startup code: https://github.com/telegraf/telegraf/issues/1749
- Telegraf release notes document the `bot.launch(..., onLaunch)` callback for code that must run when launch starts: https://github.com/telegraf/telegraf/releases

These sources support the local conclusion that screen socket presence is not enough state for a user-facing Telegram update. The bot must keep in-memory metadata for every currently executing detached session, start the periodic monitor while Telegraf is polling, and remove a session only after the user-facing Telegram message has been updated.

## Timeline

1. On 2026-04-25, the Telegram user ran `/codex https://github.com/ideav/crm/issues/2117`.
2. The bot posted a work-session message with session `6a0ec9c3-04b5-4c22-acc2-8f21e934036e` and `Isolation: screen`.
3. The detached start-command task ran as UUID `e44d4086-0b1b-47f2-8733-3abe937e43c5`, while the screen session name remained `6a0ec9c3-04b5-4c22-acc2-8f21e934036e`.
4. The referenced solve log ended successfully and created/merged `https://github.com/ideav/crm/pull/2118`.
5. The maintainer-provided Telegram bot log shows `Session 6a0ec9c3-04b5-4c22-acc2-8f21e934036e tracked in memory`.
6. The same log later shows `$ --status` returning `status: executed` and `exitCode: 0` for `e44d4086-0b1b-47f2-8733-3abe937e43c5`.
7. Those status checks were emitted while the solve queue calculated running work, not by the completion monitor; the log never shows `Session monitoring started` or a completion notification attempt.
8. Manual inspection showed no resumable screen for `6a0ec9c3-04b5-4c22-acc2-8f21e934036e`, while `$ --status` reported `status executed` and `exitCode 0`.
9. The Telegram message still showed `Solve command executing...`, so users had no final status in chat.

## Requirements Extracted

- Poll screen-isolated work sessions through `$ --status`.
- Update the original Telegram work-session message when the detached task finishes.
- Keep all currently executing task metadata in memory while the Telegram bot process is running.
- Delete a tracked task only after the original message update succeeds.
- Keep the existing in-memory fast path and non-isolation behavior.
- Add an automated regression test for the stuck-message scenario.
- Preserve issue evidence and linked task data under `docs/case-studies/issue-1680`.

## Root Cause

PRs #1671 and #1675 made terminal `$ --status` values authoritative and centralized the message format, and the bot did track `6a0ec9c3-04b5-4c22-acc2-8f21e934036e` in memory. The missing piece was startup sequencing: `telegram-bot.mjs` started `startSessionMonitoring()` in the `.then()` after `launchBotWithRetry()`, but Telegraf long polling can keep `bot.launch()` pending while the bot is already processing updates. As a result, the session monitor interval never started, so no code called `monitorSessions()` to edit the completed message.

A secondary reliability issue was that `monitorSessions()` removed a session from `activeSessions` even when Telegram message editing failed. That could permanently lose the in-memory mapping before the user-facing message was updated.

## Implemented Solution

- Started session monitoring before entering Telegraf long polling, and added an `onLaunch` callback path to `launchBotWithRetry()` for startup work that should not wait for the long-polling promise to settle.
- Kept `session-monitor.lib.mjs` state in memory only; no JSON store or `HIVE_MIND_SESSION_STORE_PATH` is introduced.
- Changed completion handling so a failed Telegram edit/send keeps the session in `activeSessions` for the next monitor tick. The session is removed only after the update succeeds, or when Telegram reports the message is already updated.
- Added `tests/test-issue-1680-session-monitoring.mjs`, which verifies terminal `$ --status` polling, retry after a Telegram edit failure, and removal only after a successful completion update.
- Added launcher coverage proving `onLaunch` can run before a long-polling `bot.launch()` promise settles.

## Residual Notes

This fix intentionally does not recover sessions across bot restarts. The maintainer clarified that the requirement is in-process tracking while the Telegram bot is running.
