---
'@link-assistant/hive-mind': patch
---

fix: Allow issues_list and pulls_list URLs for /hive command (Issue #1102)

- Accept issues_list URLs (e.g., `https://github.com/owner/repo/issues`) for /hive command
- Clean non-printable characters from URLs to prevent Markdown parsing errors
- Escape special characters in error messages
- Normalize issues_list URLs to base repo URLs before processing
