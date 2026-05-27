---
"@link-assistant/hive-mind": minor
---

Fix all errors on graceful shutdown and add an experimental working-session guard.

`hive` now fully waits for every in-flight `/solve` to finish before exiting on CTRL+C / `--stop`: signal handling is delegated to a single owner (resolving a double SIGINT-handler race that called `process.exit(130)` and cut the wait short), each solve worker is spawned in its own detached process group so the terminal's SIGINT no longer aborts solve/codex mid-task, and the wait has no time cap. Worker stderr is no longer mislabeled as `ERROR` — the child exit code remains the authoritative failure signal.

Building on that, a new experimental `--do-not-shutdown-in-the-middle-of-working-session` option is added to `solve` and enabled by default for `hive`. With it, an interrupt (CTRL+C / SIGTERM) no longer aborts the AI tool mid-run: if an AI working session is in progress, solve finishes it, auto-commits any uncommitted changes, then shuts down gracefully (exit 130/143); if solve is only idle-waiting (e.g. for CI/CD) it stops immediately, and a second interrupt force-stops. `hive` now forwards a controlled SIGTERM to each in-flight `/solve` worker on the first CTRL+C (instead of only waiting) and passes the flag to every worker (opt out with `--no-do-not-shutdown-in-the-middle-of-working-session`). Graceful shutdown is treated as a normal stop, so it no longer posts a spurious "solution draft failed" comment. Standalone `solve` keeps the flag off by default, so its behavior is unchanged except that an interrupt now always auto-commits uncommitted changes before exiting.
