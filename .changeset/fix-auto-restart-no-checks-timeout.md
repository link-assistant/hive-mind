---
'@link-assistant/hive-mind': patch
---

fix: fix root causes of 20-32h process hang after session ends (Issue #1335)

Two separate bugs caused `solve` processes to run for 20–32 hours after work was complete:

**Bug A — Infinite loop for repos without CI:** When `--auto-restart-until-mergeable` is used
on a repository with no CI/CD workflows, the `watchUntilMergeable` loop was permanently stuck
on "CI/CD checks have not started yet" with no exit condition. The root cause was that the code
treated `no_checks` identically for both transient race conditions (CI hasn't started yet after
a push) and permanent states (repo has no CI at all). Fixed by checking whether the repository
actually has GitHub Actions workflows configured (`hasRepoWorkflows()`). If none exist, the
`no_checks` state is permanent and the monitor exits immediately, treating the PR as CI-passing.
If workflows exist, the state is a transient race condition and the loop keeps waiting.

**Bug B — No process exit after session ends:** After a successful run (PR became mergeable,
work session ended), `solve.mjs` never called `process.exit()`. Sentry's profiling integration
(`@sentry/profiling-node`) kept the Node.js event loop alive indefinitely. Fixed by calling
`safeExit(0)` at the end of the `finally` block in `solve.mjs`, which flushes Sentry events
(up to 2 seconds) and then calls `process.exit(0)`.

Also adds `--verbose` debug logging of active Node.js handles at exit to aid diagnosis of
future occurrences.
