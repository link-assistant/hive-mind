---
'@link-assistant/hive-mind': patch
---

fix: escape owner/repo names for Telegram MarkdownV2 in /merge command

Fixed the `/merge` command silently failing when updating Telegram messages for repositories with hyphens in their names (e.g., `link-assistant/hive-mind`). The issue was caused by unescaped special characters in MarkdownV2 format.
