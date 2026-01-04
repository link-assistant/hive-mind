---
'@link-assistant/hive-mind': patch
---

Fix Telegram message getting stuck at "Starting solve command..."

- Add error handling to `executeAndUpdateMessage` function to catch Telegram API errors
- Fix critical bug where `messageInfo` was being cleared before the final message update
- Add proper error logging for message edit failures in both immediate and queued execution paths
