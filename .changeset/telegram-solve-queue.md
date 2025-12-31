---
"@link-assistant/hive-mind": minor
---

Add producer/consumer queue for /solve command in Telegram bot

This feature implements resource-aware throttling to prevent system overload when multiple /solve commands are submitted simultaneously:

- Stop new commands if RAM usage > 50%
- Stop new commands if CPU usage > 50%
- One-at-a-time mode if disk free < 5%
- Stop if Claude 5-hour session limit > 90%
- One-at-a-time mode if Claude weekly limit > 99%
- Stop if GitHub API > 80% when parallel claude commands running
- 1-minute minimum interval between command starts
- 5-minute cache for API limit checks
- Running claude process detection
- Queue status added to /limits command output
