---
'@link-assistant/hive-mind': patch
---

fix: disable active session check for non-isolation sessions to prevent false positives (#1586)

- `hasActiveSessionForUrl()` now only considers isolation-backed sessions (with `--isolation screen|tmux|docker`)
- Plain `start-screen` sessions are no longer tracked in the in-memory session Map, since their completion cannot be reliably detected (screen stays alive via `exec bash`)
- This prevents the bot from incorrectly blocking `/solve` commands with "A working session is already running for this URL" when no actual session exists
