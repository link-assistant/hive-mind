---
'@link-assistant/hive-mind': patch
---

Fix branch checkout error showing null/null instead of actual repository URL

- Pass owner/repo/prNumber to branch error handlers for accurate error messages
- Add upstream remote fallback when PR branch not found in origin (handles bot PRs)
- Add case study documentation for issue #1120
