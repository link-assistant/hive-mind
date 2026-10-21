---
'@link-assistant/hive-mind': patch
---

The `--isolation docker` preflight now checks Docker live-restore (issue #2900). It warns, without blocking startup, when the task daemon or the mounted host daemon reports `LiveRestoreEnabled=false`, and gives the merge-and-reload fix (`systemctl reload docker`, never restart). docs/DOCKER.md and its ru/zh/hi translations gain a "Host Docker daemon settings" section, linked from the READMEs, and `Dockerfile.dind` pins `DIND_LIVE_RESTORE=1` for the nested daemon.
