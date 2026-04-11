---
'@link-assistant/hive-mind': patch
---

fix: always post GitHub comment when usage limit is reached in auto-restart mode (#1570)

- Fix silent waiting behavior in watchUntilMergeable() when usage limit is reached
- Previously the system would silently wait 40+ minutes without any user notification
- Now posts a GitHub comment to the PR using attachLogToGitHub() with usage limit details
- Comment includes reset time, session ID, and indicates auto-restart will resume automatically
- Log output now also shows the calculated resume time in UTC
