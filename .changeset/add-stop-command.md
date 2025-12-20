---
'@link-assistant/hive-mind': minor
---

feat: add /stop command to forcefully stop running commands in Telegram bot

Implements button to forcefully stop commands in screen sessions (issue #524). Users can now stop running commands by sending CTRL+C to their screen sessions using `/stop` (all sessions) or `/stop <session-name>` (specific session).
