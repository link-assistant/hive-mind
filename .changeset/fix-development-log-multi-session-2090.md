---
'@link-assistant/hive-mind': patch
---

fix(development-log): collect a development log for every working session (#2090)

A run with `--auto-restart-until-mergeable` (implied by `--auto-merge`) starts a
new tool session with its own session UUID per restart iteration, but only the
first session ever reached the pull request:
`createDevelopmentLogFinalizer` memoized a single collection per process, no
restart path invoked the finalizer again, and several exit paths (usage limit,
tool failure, graceful shutdown, auto-continue) skipped finalization entirely.
The single collected `solve.log` was also truncated at collection time and was
committed twice, as a byte-identical duplicate under `<tool>-<sessionId>.log`.

The finalizer is now memoized per session id, every restart iteration finalizes
its own session at the shared `executeToolIteration` chokepoint, `safeExit`
forces a final collection on every exit path, and each session directory stores
only its own byte range of the process log (`metadata.json` schema version 3,
`artifacts.solveLogRange`) so the union of the sessions is the complete log
without duplication.
