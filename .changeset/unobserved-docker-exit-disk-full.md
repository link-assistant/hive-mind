---
'@link-assistant/hive-mind': patch
---

Report a docker session that start-command finalized as exit 0 without a docker finish time (`endTimeSource: observed-at` — its watcher lost a still-running container, e.g. `docker logs -f` hitting ENOSPC on a full disk, and removed it) as killed instead of "✅ finished successfully", so the kill diagnosis and `--on-session-kill=resume` recovery run. The monitor now samples host free disk on every tick, recognizes ENOSPC in the log, names the cause in the headline ("Work session killed (disk full)"), keeps a session tracked when a status query fails, and no longer advertises a removed container as kept (#2303).
