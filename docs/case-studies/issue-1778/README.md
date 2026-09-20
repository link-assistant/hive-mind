# Issue 1778 Case Study: Terminal Watch Requester Access

## Summary

Issue #1778 reported that a user who started a Telegram task could not run `/terminal_watch` for that task because the command was restricted to the chat owner. The issue also requested `/watch` as an alias, while keeping the existing privacy rules: public repository output may stay in the group chat, private or unknown repository output must go to direct messages, and DM failures should ask the user to start the bot privately.

- Issue: <https://github.com/link-assistant/hive-mind/issues/1778>
- Fix PR: <https://github.com/link-assistant/hive-mind/pull/1779>

The selected fix authorizes the tracked `requesterUserId` before falling back to the existing chat-owner check. It also registers `/watch`, teaches the parser to strip `/watch`, and updates help text.

## Collected Data

- `data/issue-1778.json`: issue metadata, body, timestamps, and embedded screenshot URLs.
- `data/issue-1778-comments.json`: issue comments; empty at collection time.
- `data/pr-1779-before.json`: prepared draft PR metadata before the implementation update.
- `data/pr-1779-conversation-comments.json`, `data/pr-1779-review-comments.json`, `data/pr-1779-reviews.json`: PR discussion channels; empty at collection time.
- `data/related-prs-terminal-watch.json`: recent merged PRs related to Telegram, `/log`, and `/terminal_watch`.
- `data/code-search-requester-terminal-watch.txt`: GitHub code search for existing requester-aware terminal watch behavior; empty at collection time.
- `data/research-sources.json`: online references used for Telegram bot behavior.
- `assets/terminal-watch-denied.png`: screenshot showing `/terminal_watch is only available to the chat owner`.
- `assets/task-owner-detected.png`: screenshot showing the task message records `Requested by: @TheKgIt`.
- `data/local-test-issue-467-terminal-watch.log`: focused terminal watch regression test output.
- `data/local-test-issue-1720-terminal-watch-no-log.log`: related no-log-upload regression output.
- `data/local-test-issue-1686-log-command.log`: related `/log` privacy decision output.
- `data/local-test-issue-1700-isolation-parsing.log`: related isolation status parsing output.

## Requirements

1. Allow `/terminal_watch` for the user who started the task.
2. Add `/watch` as an alias for `/terminal_watch`.
3. Keep chat-owner access to all tasks.
4. Preserve display privacy: public repository sessions can post in the common chat, while private or unknown repository sessions are delivered only by direct message.
5. Detect failure to send the direct message and ask the user to send `/start` in private messages.
6. Collect issue data under `docs/case-studies/issue-1778`.
7. Perform case-study analysis, including related work and online research.
8. Implement and verify the solution in a single PR.

## Root Causes

- `registerTerminalWatchCommand` checked `getChatMember(...).status === 'creator'` before reading tracked session metadata. That meant the command could not distinguish a random group member from the user who started the session, even though `telegram-command-execution.lib.mjs` already stores `requesterUserId` in `baseSessionInfo`.
- The command parser removed only `/terminal_watch` from the input. `/watch <uuid>` would leave `/watch` as an unexpected argument.
- The bot registered only `terminal_watch`, so Telegram updates for `/watch` had no command handler.
- Help text described `/terminal_watch` as owner-only, so even after the authorization fix it would have documented the wrong behavior.

## Related Local Components

- `src/telegram-command-execution.lib.mjs`: records `requesterUserId` when a task is launched.
- `src/session-monitor.lib.mjs`: exposes tracked session metadata through `getTrackedSessionInfo(sessionName)`.
- `src/telegram-log-command.lib.mjs`: provides `decideLogDestination`, which already enforces public-chat vs DM privacy routing for logs and terminal watch.
- `src/telegram-terminal-watch-command.lib.mjs`: command parser, authorization, privacy routing, DM forwarding/copying, and watch startup.
- `src/telegram-bot.mjs`: user-facing help text.

## Online Research

- Telegram documents that bots cannot start conversations with users; a user must add the bot to a group or send the bot a message first. This supports the existing and required behavior of catching DM failures and telling the user to send `/start` privately: <https://core.telegram.org/bots>
- The Telegram Bot API documents unsuccessful API responses with an error code and description, and documents `sendMessage` for creating messages in target chats: <https://core.telegram.org/bots/api>
- The Telegram Bot API identifies the chat owner member status as `creator`, matching the repository's existing owner check: <https://core.telegram.org/bots/api#chatmemberowner>

## Solution Options

Selected solution: authorize the session requester using `sessionInfo.requesterUserId` before the chat-owner lookup, then preserve the existing creator fallback for all other users. This directly matches the issue and keeps the existing privacy decision function in one place.

Alternative 1: make `/terminal_watch` available to all group members for public repositories. This would be simpler but broader than requested and would change the command's authorization model.

Alternative 2: add a new Telegram command only for task requesters. This would avoid changing `/terminal_watch`, but the issue explicitly asked for `/terminal_watch` and `/watch`.

Alternative 3: duplicate `/log` authorization and privacy code in terminal watch. This would increase drift between two features that already intentionally share delivery rules through `decideLogDestination`.

## Implemented Solution

- Added requester authorization using tracked `requesterUserId`.
- Left non-requesters on the existing chat-owner path, preserving owner access to all tasks.
- Registered `/watch` with the same handler as `/terminal_watch`.
- Updated argument parsing and usage text so `/watch <uuid>` and reply-with-`/watch` work like `/terminal_watch`.
- Kept `decideLogDestination` unchanged for privacy routing.
- Kept the existing DM failure handling that asks the user to open a private chat and send `/start`.
- Added test injection for terminal watch status helpers so command authorization behavior can be tested without invoking the real isolation runner.
- Updated Telegram `/help` output to mention the alias and the new authorization model.

## Verification

- `npm ci`: installed dependencies from `package-lock.json`; the local environment warned that the package expects Node >=24 while this runner has Node 20.20.2.
- `git diff --check`: passed.
- `npm run format:check`: passed.
- `npm run lint`: passed.
- `npm test`: all 200 selected default test files passed.
- `npm run check:duplication`: exited successfully. It still reports the repository's existing duplicate-code findings in `npm-check-duplication.log`.
- `node tests/test-issue-467-terminal-watch.mjs`: 32 passed, 0 failed.
- `node tests/test-issue-1720-terminal-watch-no-log.mjs`: 7 passed, 0 failed.
- `node tests/test-issue-1686-log-command.mjs`: 45 passed, 0 failed.
- `node tests/test-issue-1700-isolation-parsing.mjs`: 14 passed, 0 failed.

Two exploratory full-suite runs are preserved as evidence:

- `npm-test-node20-default-interrupted.log`: an earlier no-env run interrupted while investigating the long queue-related test pause.
- `npm-test-short-poll-failed.log`: a run with `HIVE_MIND_CONSUMER_POLL_INTERVAL_MS=1` that failed because `solve-queue.test.mjs` correctly asserts the default interval is 60000 ms.

## Upstream Reporting

No upstream issue was filed. The behavior is local to hive-mind's Telegram command authorization and alias registration.
