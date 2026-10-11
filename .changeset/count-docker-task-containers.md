---
'@link-assistant/hive-mind': patch
---

Fix `/limits` and dispatch throttling ignoring running docker-isolated tasks (issue #2917). The queue now counts running task containers on the docker daemon. They are attributed by the new `hive-mind.tool`/`hive-mind.url` docker labels (passed when the installed `$` is start-command 0.37.0+), by the `HIVE_MIND_TOOL`/`HIVE_MIND_TASK_URL` container env, or by the container's `solve … --tool` command for older containers, and reconciled with tracked sessions and `pgrep` without double counting. Containers no session accounts for are shown as `N untracked` (e.g. `codex (pending: 0, processing: 4, 2 untracked)`) and block one-at-a-time dispatch for their tool. The session monitor follows a dead container into its running `$ --resume` descendant instead of reporting the task finished. It keeps a footer-less docker `executed` status with a live container running. Every tick, it adopts running task containers it had stopped tracking, using their last record in `sessions-events.jsonl`, so their real completion is reported to the original chat.

Also refreshes the pins the dependency freshness gate flagged while this PR was open: Box 2.10.3 → 2.10.4 (live restore for the nested Docker daemon by default), command-stream 2.1.0 → 2.3.0 and lino-objects-codec 0.9.1 → 0.9.2.
