---
'@link-assistant/hive-mind': minor
---

Check Docker `live-restore` in the `--isolation docker` startup preflight and warn,
with the exact host-side fix, when a dockerd restart would kill the bot, every task
and the in-memory queue. Add `scripts/enable-docker-live-restore.sh`, which merges
`"live-restore": true` into `daemon.json` and reloads (never restarts) dockerd, and
document the host setting in DOCKER.md, the READMEs and the compose/Coolify guides.
