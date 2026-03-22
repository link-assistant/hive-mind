---
'@link-assistant/hive-mind': patch
---

Harden Telegram message formatting: escape special characters in user mentions, options text, and server overrides. Add safeReply with plain text fallback and diagnostic logging when Telegram rejects Markdown. Improve error messages with user identity context for root cause analysis.
