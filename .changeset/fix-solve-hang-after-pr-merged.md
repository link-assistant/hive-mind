---
'@link-assistant/hive-mind': patch
---

fix: prevent solve command from hanging after PR is merged (Issue #1346)

Previously, after the solve command detected a merged PR and printed "PR MERGED! Stopping auto-restart-until-mergeable mode", the process would hang indefinitely instead of exiting.

Root cause: The `finally` block in `src/solve.mjs` only printed the log file path but never called `process.exit(0)`. The `@sentry/profiling-node` integration registers native V8 profiler handles on the Node.js event loop that do not automatically unref themselves, preventing natural process exit.

The fix routes the successful completion path through the existing `safeExit(0)` function, which flushes Sentry (2-second timeout) and calls `process.exit(0)`, consistent with how error exits are already handled.
