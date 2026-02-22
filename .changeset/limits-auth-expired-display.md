---
'@link-assistant/hive-mind': patch
---

feat: show all limits even when Claude authentication is expired (Issue #1343)

Previously, when Claude authentication expired, the `/limits` command would fail completely and show no information at all.

Now the command gracefully handles Claude auth failures:

- The error message (e.g., "Claude authentication expired. Please use /solve or /hive commands to trigger re-authentication of Claude.") is shown inline in the Claude limits sections
- All other limits sections (CPU, RAM, Disk space, GitHub API) continue to display normally
