---
'@link-assistant/hive-mind': patch
---

fix: properly drain active handles at exit to prevent indefinite process hang (Issue #1431)

Root causes identified and fixed: process.stdin (ReadStream) was never unreferenced; undici's global connection pool (Socket×2) was never closed; surviving command-stream child processes (ChildProcess) were never unreferenced; process.stdout/stderr (WriteStream×2) were not unreferenced on non-TTY descriptors.

Added drainHandles() in exit-handler.lib.mjs that unrefs/closes all four handle types before process.exit(). Added logActiveHandles() export with per-handle detail (fd, path, pid, remoteAddress) that always logs to the log file. Added no-leaked-streams ESLint rule to catch bare createReadStream/createWriteStream calls whose return value is discarded — the stream companion to the existing no-leaked-timers rule.
