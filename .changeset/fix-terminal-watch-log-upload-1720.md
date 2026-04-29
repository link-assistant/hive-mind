---
'@link-assistant/hive-mind': patch
---

Fix `/terminal_watch` uploading the full session log file when the watch
completes — addresses issue
[#1720](https://github.com/link-assistant/hive-mind/issues/1720).

Before this fix, `/terminal_watch` finished by calling
`bot.telegram.sendDocument(chatId, ...)` to attach the `<uuid>.log` file. That
had two unwanted effects:

- It duplicated work that the dedicated `/log` command already does.
- The bare `bot.telegram.sendDocument(chatId, ...)` call did not carry
  `message_thread_id`, so in forum-enabled supergroups the document landed in
  the **General** topic instead of the topic where `/terminal_watch` was
  invoked, and it was not threaded as a reply.

`/terminal_watch` now only updates the live "✅ Terminal watch complete"
message at the end of the session. To download the log, use
`/log <uuid>` — it correctly replies in the originating topic via
`ctx.replyWithDocument`, which Telegraf annotates with `message_thread_id`
automatically.

A new regression test (`tests/test-issue-1720-terminal-watch-no-log.mjs`)
guards both behaviours, and `tests/test-issue-467-terminal-watch.mjs` was
updated to assert that no document is uploaded by the watcher.
