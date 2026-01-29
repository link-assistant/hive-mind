---
'@link-assistant/hive-mind': minor
---

Improve auto-resume-on-limit-reset functionality

- Add 5-minute buffer after limit reset to account for server time differences (configurable via HIVE_MIND_LIMIT_RESET_BUFFER_MS)
- Add --auto-restart-on-limit-reset option for fresh start without previous session context
- Remove CLI commands from GitHub comments when auto-resume is active (less confusing for users)
- Differentiate work session comments: "Auto Resume (on limit reset)" vs "Auto Restart (on limit reset)"
- Differentiate solution draft log comments based on session type
- Improve reset time formatting with relative time + UTC (e.g., "in 1h 23m (Jan 15, 7:00 AM UTC)")
