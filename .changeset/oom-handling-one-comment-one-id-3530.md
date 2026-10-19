---
'@link-assistant/hive-mind': patch
---

Kill and OOM recovery report less, wait for resources, never run a task twice, and use one id per task (#3530, #3532, #3533):

- A killed session gets one GitHub comment. It gives the reason and, with `--attach-logs`, the log, plus an "auto recovery is pending" note. The note is removed once the recovery starts, or replaced with the reason it did not start. Recovery progress (waiting, launching, attempt `n/m`) is shown only in Telegram, so no GitHub comment is auto-updated any more.
- A recovery starts like every other session, with one start comment that says it is a resume or restart and which attempt it is.
- After a mass kill, a recovery waits until the task queue's resource limits pass several checks in a row (`HIVE_MIND_RECOVERY_RESOURCE_POLL_SECONDS`, `HIVE_MIND_RECOVERY_RESOURCE_STABLE_CHECKS`, `HIVE_MIND_RECOVERY_RESOURCE_MAX_WAIT_MINUTES`). `/stop` cancels the wait.
- A healthy in-place resume is no longer declared dead: liveness is probed by container name, not by execution UUID. No recovery or queued `/solve` starts while a container or another session of the same task is still running (#3532).
- A host reboot or hard reset is named as the cause, once for all tasks it ended, with the real end time. A survived earlier OOM kill is listed separately instead of being blamed (#3533).
- One UUID per task: start-command's session, execution, log file and container share it, and the first fresh Claude Code session uses it via `--session-id`. Telegram shows only the latest id.
- `/log` on any id of a recovered task uploads every attempt's log, oldest first, in one sanitized file.
