---
'@link-assistant/hive-mind': minor
---

Add work session completion notifications to Telegram bot

The bot now monitors active screen sessions and sends notifications when they complete:

- Tracks sessions started by `/solve` and `/hive` commands
- Monitors sessions every 30 seconds using `screen -ls`
- Sends notification to the chat with session name, duration, and URL
- Updates `/help` command to document the notification feature

Users receive a message like:

```
Work Session Completed
Session: solve-owner-repo-123
Duration: 5m 32s
URL: https://github.com/owner/repo/issues/123
```
