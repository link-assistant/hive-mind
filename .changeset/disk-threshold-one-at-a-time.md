---
'@link-assistant/hive-mind': patch
---

Fix disk threshold to use one-at-a-time mode instead of blocking all commands

- When disk usage exceeds threshold (90%), now allows exactly one command to run
- Previously, disk threshold blocked ALL commands unconditionally (like RAM/CPU)
- Now matches behavior of Claude API thresholds (CLAUDE_5_HOUR_SESSION_THRESHOLD, CLAUDE_WEEKLY_THRESHOLD)
- Allows controlled task execution during high disk usage while preventing multiple tasks from exhausting resources

Fixes #1155
