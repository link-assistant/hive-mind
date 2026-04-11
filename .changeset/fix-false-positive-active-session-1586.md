---
'@link-assistant/hive-mind': patch
---

fix: add timeout-based expiry for non-isolation active sessions to prevent false positives (#1586)

- Non-isolation (plain `start-screen`) sessions are now tracked with a 10-minute timeout
- Within the timeout window, duplicate `/solve` commands for the same URL are blocked (prevents accidental re-runs)
- After 10 minutes, non-isolation sessions auto-expire, preventing permanent false positives
- Isolation-backed sessions (`--isolation screen|tmux|docker`) have no timeout — their completion is reliably detected
- This prevents the bot from indefinitely blocking `/solve` commands with "A working session is already running for this URL"
