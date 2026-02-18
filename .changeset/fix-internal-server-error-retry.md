---
'@link-assistant/hive-mind': patch
---

fix: add auto-resume with session preservation on Internal Server Error (Issue #1331)

When Claude tool returns `API Error: 500 Internal server error`, automatically retry with exponential backoff starting from 1 minute, capped at 30 minutes per retry, up to 10 retries. Session ID is preserved so Claude Code can resume from where it left off using `--resume <sessionId>`.
