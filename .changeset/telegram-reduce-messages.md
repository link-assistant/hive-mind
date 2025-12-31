---
'@link-assistant/hive-mind': patch
---

Reduce Telegram messages by updating instead of sending new ones

The `/solve` and `/hive` commands now update the initial "Starting..." message with the success/error result instead of sending a separate message. This follows the same pattern already used by the `/limits` command.

**Before:** Two separate messages per command
**After:** Single message that gets updated with the result
