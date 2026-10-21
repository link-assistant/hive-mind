---
'@link-assistant/hive-mind': patch
---

An OOM event is reported on GitHub only when it happens, never after the work is finished (#2809):

- A container OOM event that the running session survives is reported once, about one poll after it is seen (so solve's own report comes first), with the log so far when `--attach-logs` is set. A late observation (older than 15 minutes) is not reported.
- A session that finishes well after a survived OOM event posts no OOM comment on GitHub; Telegram still mentions it.
- No kill or OOM comment and no recovery once the pull request is merged, closed, or its latest session posted "Ready to merge".
- Telegram shows how many OOM kills there were when there was more than one, for example "(9 OOM kills)".
