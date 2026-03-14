---
'@link-assistant/hive-mind': patch
---

fix: restore process.exit(0) to prevent indefinite process hang after session ends (Issue #1431)

Regression of Issue #1335/#1346 fix: commit 187adb82 removed safeExit(0) from the finally block in solve.mjs. Active handles from command-stream, undici connection pools, stdin, and log file streams kept the event loop alive indefinitely (~7h observed). Restore safeExit(0) at the end of the finally block.
