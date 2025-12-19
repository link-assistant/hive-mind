---
"@link-assistant/hive-mind": patch
---

Make --auto-continue enabled by default

- Changed default value from false to true for --auto-continue in both hive and solve commands
- Smart handling of -s (--skip-issues-with-prs) flag interaction:
  - When -s is used, auto-continue is automatically disabled to avoid conflicts
  - Explicit --auto-continue with -s shows proper error message
  - Users can still use --no-auto-continue to explicitly disable
- This improves user experience as users typically want to continue working on existing PRs

Fixes #454
