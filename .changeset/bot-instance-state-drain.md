---
'@link-assistant/hive-mind': minor
---

Add a durable bot instance state and a drain mode for safe redeploys. `hive-telegram-bot --status [--json]` shows running (isolated or not), starting, queued and waiting tasks and whether intake is paused, without a bot token. `--drain`, `--resume-intake` and `--wait-for-idle` let a redeploy stop new tasks and wait until running ones finish. The state is kept in an indented `hive-mind-state.lino` file in a mountable state directory (`HIVE_MIND_STATE_DIR`), mirrored in a link-cli (`clink`, now in the Docker images) store with the transactions log. The two copies are checked against each other on every read, under a PID-owned lock. Queued tasks and notification subscribers are restored after a restart.

Restart recovery also restores queued task dependencies, the existing Telegram status messages, and per-chat `/stop` settings. Use `--state-migrate 0` or `--state-migrate 1` while the bot is stopped to migrate both stores, or set `HIVE_MIND_STATE_SCHEMA_TARGET` to migrate automatically on startup.
