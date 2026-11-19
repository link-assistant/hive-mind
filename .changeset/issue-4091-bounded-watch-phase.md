---
'@link-assistant/hive-mind': patch
---

Fix `solve` sessions that stayed stuck for hours after their final log (#4091).

- Workflow runs on the HEAD commit that have not started are now bounded instead of blocking until the 24 h watch timeout. This covers runs held in a `concurrency` queue (`pending` with 0 jobs) and runs waiting for an approval (`waiting` / `action_required`). After `HIVE_MIND_STUCK_PENDING_RUN_MINUTES` one notice is posted on the PR. After `HIVE_MIND_STUCK_PENDING_RUN_STOP_MINUTES` monitoring stops with an explicit reason. These runs are never cancelled or re-run.
- `/solve` now prints `[HIVE-MIND SOLVE]` phase markers. Telegram shows the log upload and watch phases (blocker, elapsed time, deadline) instead of `⏳ Executing...`.
- Waits after the final log have a 30 s heartbeat and a deadline. Log sanitize and upload report their progress. A hung GitHub probe is skipped, and repeated hangs stop monitoring.
- While monitoring continues, the log comment no longer says the working session has ended. A `Monitoring Ended` comment reports the final decision.
- On `/stop`, the watch loop stops before the log upload and only the log tail since the last upload is attached. The notice now says "stopped by operator" and gives the last phase instead of `SIGKILL; cause unknown`.
- Watch-loop lines have ISO-8601 UTC timestamps, and the issue JSON is no longer printed on every check.
