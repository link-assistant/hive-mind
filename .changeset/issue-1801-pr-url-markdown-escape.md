---
'@link-assistant/hive-mind': patch
---

Fix Telegram work-session completion failing with "Bad Request: can't parse entities" when the discovered Pull request URL contained Markdown-significant characters (`_`, `*`, `` ` ``, `[`). `appendPullRequestLine` (issue #1688) inserted the raw URL into a Markdown message even though the surrounding `Issue:` line was already escaped by `buildTelegramInfoBlock`, so a repo slug like `save_visiogetbb/pull/8` opened an italic entity at byte offset 318 that never closed. The appended `Pull request:` line is now passed through `escapeMarkdown`, and `safeReply`/`safeEditMessageText`/`installTelegramFormattingFallback` now log the offending byte-offset window and the plain-text fallback under `--verbose` so future parse errors point straight to the unescaped character. Resolves #1801.
