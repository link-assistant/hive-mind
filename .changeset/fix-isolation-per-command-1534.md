---
'@link-assistant/hive-mind': patch
---

Fix --isolation option not working in /solve and /hive Telegram commands (#1534): extract --isolation from user args before validation, so it's used for execution isolation (via $ CLI from start-command) instead of being forwarded to solve/hive as an unknown argument. Per-command --isolation takes precedence over bot-level ISOLATION_BACKEND setting.
