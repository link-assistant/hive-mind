---
"@link-assistant/hive-mind": minor
---

Prevent silently stuck hive workers (#1811). Adds a per-call timeout to `gh` invocations that go through `wrapDollarWithGhRetry` (default 90s, configurable via `--gh-timeout-seconds` and `GH_TIMEOUT_SECONDS`), and a parent-side inactivity watchdog that warns when a worker emits no stdout/stderr (`--worker-inactivity-warn-seconds`, default 300s) and can optionally SIGTERM/SIGKILL stalled workers (`--worker-inactivity-kill-seconds`, default 0 = disabled). See `docs/case-studies/issue-1811` for the full case study and root-cause analysis.
