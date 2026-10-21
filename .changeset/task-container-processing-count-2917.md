---
'@link-assistant/hive-mind': patch
---

`/limits` and the solve queue count the docker task containers that are really running (#2917):

- Every `--isolation docker` task container gets `hive-mind.*` labels (tool, URL, command, session, bot instance) through start-command's `--label`, which start-command re-applies on `$ --resume`.
- Under docker isolation the processing count comes from `docker ps`: labelled containers, unlabelled task containers matched to a `$ --list` solve/hive record, and containers of tracked sessions. `pgrep` in the bot container (always 0 there) is ignored.
- Dispatch, the one-at-a-time limits and the kill-recovery resource gate use the larger of the queue's own count and the observed count, so a task the bot no longer tracks still blocks a second start of its tool.
- `/limits` shows untracked tasks, for example `codex (pending: 0, processing: 4, 2 untracked)`.
- The bot adopts running task containers it does not track (after a 2-minute grace period), so their completion is monitored and recorded. `HIVE_MIND_INSTANCE_ID` keeps bots that share one Docker daemon apart.
