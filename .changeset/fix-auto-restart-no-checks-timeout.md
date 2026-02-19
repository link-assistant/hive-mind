---
'@link-assistant/hive-mind': patch
---

fix: prevent process hang after session ends and add no-checks timeout (Issue #1335)

Two separate bugs caused `solve` processes to run for 20–32 hours after work was complete:

**Bug A — No `no_checks` timeout:** When `--auto-restart-until-mergeable` is used on a
repository with no CI/CD workflows, the `watchUntilMergeable` loop was permanently stuck
on "CI/CD checks have not started yet" with no exit condition. Fixed by adding a configurable
timeout (`HIVE_MIND_AUTO_RESTART_NO_CHECKS_TIMEOUT_MS`, default 30 minutes) after which the
monitor exits, treating the PR as mergeable from a CI perspective.
An optional hard cap on total loop runtime (`HIVE_MIND_AUTO_RESTART_MAX_RUNTIME_MS`) is also added.

**Bug B — No process exit after session ends:** After a successful run (PR became mergeable,
work session ended), `solve.mjs` never called `process.exit()`. Sentry's profiling integration
kept the Node.js event loop alive indefinitely. Fixed by calling `safeExit(0)` at the end of
the `finally` block in `solve.mjs`.
