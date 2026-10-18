---
'@link-assistant/hive-mind': patch
---

`/fix` replies in Telegram now go Starting → Waiting for CI/CD → Executing, and dynamic values are escaped in every legacy-Markdown message (#3505):

- The CI wait is one simple `⏳ Waiting for CI/CD on <branch> to finish...` line. It no longer lists pending runs, whose raw `in_progress` status broke Telegram Markdown and made the reply fall back to plain text.
- No `✅ CI/CD on main finished` line stays in the reply, and `Executing...` is shown only once the task runs.
- The `Issue:` line is placed in the info block under `Repository:` with the first progress marker and never moves.
- A new ESLint rule `telegram-safety/no-unescaped-telegram-markdown` reports unescaped dynamic values in legacy-Markdown Telegram messages. All its hits were fixed: recovery lifecycle, `/tokens`, `/organize`, `/stop` and `/start` reasons, queue warnings and errors, and the leak notifier.
- A "Did you mean" suggestion containing a backtick no longer breaks its code span.
- The "stopped by user" completion reads `Work session stopped by user (@name)` instead of `stopped by user by @name`.
