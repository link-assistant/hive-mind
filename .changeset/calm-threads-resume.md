---
"@link-assistant/hive-mind": patch
---

Fix killed Telegram task resume instructions by recovering the last tool session from the complete task log, rejecting unrelated shared-directory session logs, and preserving the original slash-command alias through queued and restarted sessions.
