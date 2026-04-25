# Issue 1680 Case Study: Persist Screen-Isolated Telegram Session Tracking

## Source Artifacts

- Issue metadata and comments: `source/issue-1680.json`, `source/issue-1680-comments.json`
- Reported screenshot: `source/issue-screenshot.png`
- Solution PR snapshot: `source/pr-1681.json`
- Referenced external task: `source/external-ideav-crm-issue-2117.json`
- Referenced external PR: `source/external-ideav-crm-pr-2118.json`, `source/external-ideav-crm-pr-2118-comments.json`
- start-command evidence: `source/start-command-status-6a0ec9c3.json`, `source/start-command-e44d4086.log.gz`

## External Research

- GNU Screen documents that `screen -ls` lists session identifiers and that detached sessions can be resumed with `screen -r`: https://www.gnu.org/software/screen/manual/screen.pdf
- Node.js documents `setInterval()` as repeated callback scheduling, which is the monitor mechanism used by the Telegram bot: https://nodejs.org/download/release/latest-jod/docs/api/timers.html

These sources support the local conclusion that screen socket presence is not enough state for a user-facing Telegram update. The bot must keep durable metadata that maps a detached work session to the Telegram message that should be edited when `$ --status` becomes terminal.

## Timeline

1. On 2026-04-25, the Telegram user ran `/codex https://github.com/ideav/crm/issues/2117`.
2. The bot posted a work-session message with session `6a0ec9c3-04b5-4c22-acc2-8f21e934036e` and `Isolation: screen`.
3. The detached start-command task ran as UUID `e44d4086-0b1b-47f2-8733-3abe937e43c5`.
4. The referenced solve log ended successfully and created/merged `https://github.com/ideav/crm/pull/2118`.
5. Manual inspection showed no resumable screen for `6a0ec9c3-04b5-4c22-acc2-8f21e934036e`, while `$ --status` reported `status executed` and `exitCode 0`.
6. The Telegram message still showed `Solve command executing...`, so users had no final status in chat.

## Requirements Extracted

- Poll screen-isolated work sessions through `$ --status`.
- Update the original Telegram work-session message when the detached task finishes.
- Preserve enough session metadata to survive bot process restarts.
- Keep the existing in-memory fast path and non-isolation behavior.
- Add an automated regression test for the stuck-message scenario.
- Preserve issue evidence and linked task data under `docs/case-studies/issue-1680`.

## Root Cause

PRs #1671 and #1675 made terminal `$ --status` values authoritative and centralized the message format, but `session-monitor.lib.mjs` still kept active session metadata only in memory. If the Telegram bot process restarted while a detached screen run was executing, the monitor lost the `sessionName -> chatId/messageId/url` mapping. After restart, `$ --status` still knew that the task had executed, but Hive Mind no longer knew which Telegram message to edit.

## Implemented Solution

- Added a JSON-backed session store at `~/.hive-mind/telegram-active-sessions.json` by default.
- Added `HIVE_MIND_SESSION_STORE_PATH` for deployments that need a custom storage path.
- Persisted session metadata when tracking starts and when tracking completes.
- Loaded persisted sessions when Telegram session monitoring starts, then ran an immediate monitor pass before continuing the regular interval.
- Kept persistence disabled for plain module imports and enabled it from `startSessionMonitoring()`.
- Added `tests/test-issue-1680-session-persistence.mjs`, which simulates a monitor restart and verifies that a terminal `$ --status` result edits the original Telegram message and clears the persisted store.

## Residual Notes

The store intentionally contains only metadata already needed for the bot update path: session name, chat/message IDs, URL, command, tool, isolation backend, and start time. It does not persist Telegram contexts or queue internals.
