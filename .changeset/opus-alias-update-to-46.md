---
"@link-assistant/hive-mind": patch
---

Set `opus` alias to target Opus 4.6 instead of Opus 4.5 (Issue #1433). Opus 4.6 offers a 1M token context window and comparable cost efficiency. The `isOpus46OrLater` function is updated to recognise the `opus` alias directly so Opus 4.6 features (128K output tokens, effort-level thinking) are applied automatically when using the default alias.
