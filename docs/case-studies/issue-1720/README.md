# Case study: Issue #1720 — `/terminal_watch` should not attach the log file

- Issue: https://github.com/link-assistant/hive-mind/issues/1720
- Pull request: https://github.com/link-assistant/hive-mind/pull/1721
- Reporter: @konard
- Created: 2026-04-29
- Label: `bug`

## 1. Problem statement (verbatim from the reporter)

> At the moment attach is done in general topic of the chat without any reply.
> Also check that `/log` will not repeat such mistake, as we should always
> respect the chat topics if we are in the chat where they are enabled, and even
> better give logs as reply to message containing `/log` command.
> But `/terminal_watch` should not attach log, as for logs attachment we have
> `/log` command.

The screenshot from the report (`screenshots/issue-screenshot.png`) shows the
bot uploading a session `.log` document into a chat as a fresh message
(no reply, no topic) while a terminal watch finishes:

```
H Hive Mind  automaton
  ⬇ 938a9d28-8b2a-4cb0-aa37-35dc8bcac0d5.log
  20.5 KB - Download
  📄 Full log for session dc59873a-23e8-4526-ac21-06d50ecf47ee
  Status: executed
```

## 2. Requirements extracted from the report

| #   | Requirement                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `/terminal_watch` MUST NOT upload the full session log when the watch completes — log delivery is the responsibility of `/log`.                                       |
| R2  | When `/log` is used in a chat that has forum topics enabled, the log document MUST be posted into the same topic the command was issued in (never the General topic). |
| R3  | When `/log` is used, the log document SHOULD be sent as a reply to the message that contained the `/log` command (so it threads cleanly with the request).            |
| R4  | The previously known privacy and authorization rules of `/log` (#1686) and the rejection logic of `/log` + `/terminal_watch` (#1700) must remain intact.              |

## 3. Timeline / sequence of events

| Date       | Event                                                                                                                                                                                                                                       | Source      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 2025-12    | `/terminal_watch` introduced in PR #551 (issue #467). The watch handler editing a single message and **also** uploading the full log document on terminal status was added together.                                                        | PR #551     |
| 2026-04    | `/log` command introduced (issue #1686, PR #1687). `/log` correctly uses `ctx.replyWithDocument(...)` for the in-chat case, which Telegraf annotates with `message_thread_id` and `reply_to_message_id` from the originating `ctx.message`. | PR #1687    |
| 2026-04-25 | PR #1701 fixes false-rejections of `/log` and `/terminal_watch` (issue #1700). Auto-watch path is also tightened.                                                                                                                           | PR #1701    |
| 2026-04-29 | Issue #1720 filed — duplicate log delivery from `/terminal_watch` is unwanted, and the upload bypasses forum topics & threading because it is sent via `bot.telegram.sendDocument(chatId, ...)` instead of via the originating context.     | Issue #1720 |

## 4. Root cause analysis

### 4.1 R1 — `/terminal_watch` posts a duplicate log document

The watch loop in `src/telegram-terminal-watch-command.lib.mjs` calls
`sendLogDocument(...)` once the session reaches a terminal status:

```js
// src/telegram-terminal-watch-command.lib.mjs
if (completed) {
  stopped = true;
  activeWatches.delete(key);
  if (attachLogOnComplete) await sendLogDocument({ bot, chatId, logPath, sessionId, statusResult });
  return;
}
```

`attachLogOnComplete` defaults to `true` and is never overridden by the
command-registration path, so every successful `/terminal_watch` ends with a
log upload. That overlaps with `/log`'s job and creates the redundant document
in the screenshot.

### 4.2 R2 / R3 — the upload escapes forum topics & threading

`sendLogDocument` uses raw `bot.telegram.sendDocument(chatId, ...)`:

```js
// src/telegram-terminal-watch-command.lib.mjs
await bot.telegram.sendDocument(
  chatId,
  { source: logPath, filename: path.basename(logPath) },
  { caption: ..., parse_mode: 'Markdown' },
);
```

Unlike `ctx.reply*` helpers in Telegraf — which automatically pass
`message_thread_id: getThreadId(ctx)` and the appropriate
`reply_to_message_id` — the bare `bot.telegram.sendDocument(chatId, ...)`
sends to the chat root with no thread and no reply. In a forum chat this lands
in the **General** topic, exactly matching the symptom in the screenshot.

### 4.3 `/log` is already correct (verified)

`src/telegram-log-command.lib.mjs` chat-delivery branch:

```js
await ctx.replyWithDocument({ source: logPath, filename }, { reply_to_message_id: message.message_id, caption, parse_mode: 'Markdown' });
```

Telegraf's `Context#replyWithDocument` passes `message_thread_id` from
`ctx.message` automatically (see `node_modules/telegraf/lib/context.js`,
`getThreadId`), so the document goes back into the correct topic and as a
reply to the `/log` message. R2 / R3 are already satisfied for `/log`.

The DM branch sends with `ctx.telegram.sendDocument(userId, ...)` — that target
is a private chat with no topics, so threading is a no-op there. No change
required.

## 5. Solution plan

1. **Fix R1**: Remove the log upload from `/terminal_watch`'s completion path.
   The cleanest change is to drop `sendLogDocument` from the completion branch
   of `watchTerminalLogSession` and remove the now-unused helper. Keep the
   final "✅ Terminal watch complete" message edit so users still know the
   watch finished — they can call `/log <uuid>` to fetch the log.
2. **R2 / R3 (no-op for `/log`)**: Add a regression test that asserts
   `/log` propagates `message_thread_id` (via `ctx.replyWithDocument`) and
   replies to the originating message id, so future refactors do not silently
   regress topic/thread handling.
3. **Tests**: Update the existing `tests/test-issue-467-terminal-watch.mjs`
   so that `documents.length === 0` after a watch completes (was
   `documents.length === 1`).
4. **Changeset**: Add a `patch` changeset describing the user-visible change
   for the next release.

### Components / libraries reused

- Telegraf's `Context.replyWith*` helpers (already used) carry topic and
  thread IDs automatically — preferred over `bot.telegram.send*` whenever the
  destination is the originating chat.
- Existing `/log` command already implements the correct pattern; this case
  study is essentially "delete the duplicate path in `/terminal_watch`".

## 6. Reproducible example

1. Configure the Telegram bot with a forum-enabled supergroup.
2. From any topic in that supergroup, run a long-running session via the bot
   so that a session UUID is reported (`📊 Session: <uuid>`).
3. Reply to that status message with `/terminal_watch` (or run
   `/terminal_watch <uuid>` directly).
4. Wait until the session reaches a terminal status (e.g. `executed`).

**Expected (after fix)**: the watch message is updated to `✅ Terminal watch
complete`, and **no** log document is uploaded by `/terminal_watch`.

**Actual (before fix)**: a `<uuid>.log` document is uploaded into the
General topic, with no reply chain — see `screenshots/issue-screenshot.png`.

## 7. Related issues / PRs

- #467 / PR #551 — original `/terminal_watch` implementation that introduced
  the `sendLogDocument` upload on completion.
- #1686 / PR #1687 — `/log` command (correct topic/thread handling).
- #1700 / PR #1701 — fix for `/log` and `/terminal_watch` rejecting valid
  isolation sessions; introduced the `decideLogDestination` rejection logging
  which we leave untouched.

## 8. Files / data captured

- `raw-data/issue-1720.json` — full GitHub issue payload.
- `raw-data/pr-1721.json` — current draft PR metadata.
- `screenshots/issue-screenshot.png` — original bug screenshot from the issue.
