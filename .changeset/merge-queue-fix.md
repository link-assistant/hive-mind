---
'@link-assistant/hive-mind': patch
---

fix: improve merge queue error handling and debugging (Issue #1269)

- Always log errors (not just in verbose mode) for critical merge queue failures
- Always notify users via Telegram when merge queue fails unexpectedly
- Add timeout wrapper (60s) for onStatusUpdate callback to prevent infinite blocking
- Add error handling for CI check failures in waitForCI loop
- Add comprehensive case study documentation in docs/case-studies/issue-1269/
