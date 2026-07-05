---
"@link-assistant/hive-mind": patch
---

Handle Docker `oomKilled` status markers as terminal Telegram work-session failures and delay Docker backend-gone killed notifications long enough for start-command to publish a real terminal status or log footer.
