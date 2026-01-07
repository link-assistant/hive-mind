---
'@link-assistant/hive-mind': patch
---

Use gh-upload-log for log file uploads (issue #587)

- Replace custom gist creation with gh-upload-log command
- Implement smart linking: 1 chunk = direct raw link, >1 chunks = repo link
- Update case study documentation with gh-upload-log v0.5.0 fixes
- Remove custom log compression in favor of gh-upload-log auto mode
