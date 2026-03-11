---
'@link-assistant/hive-mind': patch
---

fix: prevent solve command from hanging after PR is merged (Issue #1346)

Previously, after the solve command detected a merged PR and printed "PR MERGED! Stopping auto-restart-until-mergeable mode", the process would hang indefinitely instead of exiting.

Root cause: The `finally` block in `src/solve.mjs` completed all async work but never called `process.exit(0)`. Active handles on the Node.js event loop (from libraries like `command-stream` and network connections) prevent natural process exit. When Sentry is enabled (`--sentry`), `@sentry/profiling-node` native handles also contribute.

The fix:

1. Restores explicit `📁 Complete log file:` display in the `finally` block (matching original behavior)
2. Calls `closeSentry()` from `sentry.lib.mjs` to properly flush Sentry events and release profiling handles when Sentry is enabled (no-op when disabled)
3. Calls `process.exit(0)` as a required safety net to prevent hanging from any remaining active handles
4. Adds a hard `Promise.race` timeout (3s) around `sentry.close()` in `exit-handler.lib.mjs` to prevent it from hanging if Sentry's transport stalls
