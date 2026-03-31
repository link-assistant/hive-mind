---
'@link-assistant/hive-mind': minor
---

Add work session completion notifications and isolation mode to Telegram bot

Session notifications:
- Tracks sessions started by `/solve` and `/hive` commands
- Monitors sessions every 30 seconds and sends completion notifications
- Sends notification with session name, duration, URL, and exit status
- Persistent session tracking via ExecutionStore from start-command

Isolation mode (`--isolation` option, experimental):
- New `--isolation` flag for Telegram bot: `screen`, `tmux`, or `docker`
- Uses `$` CLI from link-foundation/start with GUID-based session tracking
- Tracks session completion via `$ --status <uuid>` for reliable detection
- Solve queue supports isolation-aware execution and process counting
- Each isolated session gets a unique UUID for unambiguous tracking
- Without `--isolation`, uses existing `start-screen` command (unchanged)
