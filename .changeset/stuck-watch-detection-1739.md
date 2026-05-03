---
"@link-assistant/hive-mind": patch
---

Detect orphaned `run_in_background` Bash watchers and warn the model away from unbounded `until ... do sleep N; done` polling loops (Issue #1739)

Adds a per-session `BackgroundTaskTracker` that follows Claude Code's `system.task_started` / `system.task_completed` JSONL events. When the `result` event arrives the harness now logs how many background tasks survived end-of-turn (a clean session reports `🔎 Background tasks: clean (0 alive at result event)`), and emits `🛑 STUCK-WATCH DETECTED` if a passive final assistant message ("I'll wait for…", "Once it completes…") coincides with a still-running background task — the exact shape that produced the 2 h 54 min stuck session captured in `docs/case-studies/issue-1739/`. The Claude system prompt is also updated to forbid hand-rolled `until/while ... do sleep N; done` watchers and steer the model toward `gh run watch <run-id> --exit-status` and `timeout T ...` as finite-timeout alternatives.
