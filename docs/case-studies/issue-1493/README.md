# Case Study: Resource Leaks — Child Processes, Temp Files, and Diagnostics

**Issue**: [#1493](https://github.com/link-assistant/hive-mind/issues/1493)
**Date**: 2026-03-29
**Category**: Bug fix, reliability improvement

## Incident Summary

At process exit, the `logActiveHandles()` diagnostic function reported **15 active Node.js handles** and **1 active request**:

```
Active Node.js handles at exit (15 handles, 1 requests):
   Handle: WriteStream (fd=2)           — stderr
   Handle: WriteStream (fd=1)           — stdout
   Handle: ReadStream (fd=0)            — stdin
   Handle: Socket                       — ×8 (2 per child process)
   Handle: ChildProcess (pid=57180, file=/bin/sh)
   Handle: ChildProcess (pid=60552, file=/bin/sh)
   Handle: ChildProcess (pid=73553, file=/bin/sh)
   Handle: ChildProcess (pid=79694, file=/bin/sh)
   Request: FileHandleCloseReq
```

### Handle Breakdown

| Handle Type        | Count | Source                                  | Impact                                    |
| ------------------ | ----- | --------------------------------------- | ----------------------------------------- |
| ChildProcess       | 4     | command-stream `$` template tag         | **Orphaned processes** after parent exits |
| Socket             | 8     | stdio pipes (2 per child: stdin+stdout) | Keeps event loop alive                    |
| WriteStream        | 2     | process.stdout + process.stderr         | Normal (unref'd by drainHandles)          |
| ReadStream         | 1     | process.stdin                           | Normal (unref'd by drainHandles)          |
| FileHandleCloseReq | 1     | fs.promises file handle pending close   | Transient, completes naturally            |

## Root Cause Analysis

### Root Cause 1: Child Processes Only Unref'd, Not Killed

**File**: `src/exit-handler.lib.mjs`, `drainHandles()` function

The `drainHandles()` function (introduced in Issue #1431) found surviving ChildProcess handles and called `.unref()` on them. This allows Node.js to exit without waiting for the children, but the child processes themselves continue running as **orphaned processes** on the host system.

```javascript
// BEFORE (Issue #1431 approach — insufficient)
for (const handle of process._getActiveHandles()) {
  if (handle?.constructor?.name === 'ChildProcess' && typeof handle.unref === 'function') {
    handle.unref(); // Node can exit, but /bin/sh children are still alive
  }
}
```

**Why 4 ChildProcess handles?** The `command-stream` library (loaded via `use('command-stream')`) spawns `/bin/sh` subprocesses for each `$\`...\`` template tag execution. When the main process completes its work, any command-stream processes that haven't fully exited yet remain as active handles. The log shows this was a long-running session (~40 minutes) with multiple tool iterations, each spawning shell processes.

### Root Cause 2: Temp File Leaks on Exception Paths

**Files**: `github.lib.mjs`, `github-error-reporter.lib.mjs`, `solve.auto-pr.lib.mjs`, `solve.results.lib.mjs`

Multiple functions follow a "write temp file → run command → delete temp file" pattern:

```javascript
// BEFORE — temp file leaks if $`gh ...` throws
const tempFile = `/tmp/log-upload-comment-${targetType}-${Date.now()}.md`;
await fs.writeFile(tempFile, content);
result = await $`gh pr comment ... --body-file "${tempFile}"`;
await fs.unlink(tempFile).catch(() => {}); // NEVER REACHED if line above throws
```

If the `gh` command throws (network error, auth failure, etc.), the `unlink` call is skipped and the temp file remains on disk indefinitely.

### Root Cause 3: Insufficient Diagnostic Detail

The `logActiveHandles()` function logged handle types but lacked:

- Categorized summary (e.g., `ChildProcess×4, Socket×8`)
- Process state information (`exitCode`, `killed`, `destroyed`)
- These details are crucial for distinguishing already-exited-but-unreferenced processes from truly alive ones

## Fixes Applied

### Fix 1: Kill Child Processes Before Unref

```javascript
// AFTER — kill first, then unref
for (const child of childHandles) {
  if (child.exitCode === null && !child.killed) {
    child.kill('SIGTERM');
    // SIGKILL fallback after 2s
    const killTimer = setTimeout(() => {
      try {
        if (child.exitCode === null) child.kill('SIGKILL');
      } catch {
        /* already exited */
      }
    }, 2000);
    killTimer.unref();
  }
  child.unref();
}
```

### Fix 2: try/finally for Temp Files

```javascript
// AFTER — temp file always cleaned up
const tempFile = `/tmp/log-upload-comment-${targetType}-${Date.now()}.md`;
await fs.writeFile(tempFile, content);
try {
  result = await $`gh pr comment ... --body-file "${tempFile}"`;
} finally {
  await fs.unlink(tempFile).catch(() => {});
}
```

### Fix 3: Enhanced Diagnostics

- Added categorized handle summary: `[ChildProcess×4, Socket×8, WriteStream×2, ReadStream×1]`
- Added `exitCode`, `killed`, and `destroyed` state to each handle's detail line

### Fix 4: New ESLint Rule — `no-leaked-child-processes`

New custom linting rule (`eslint-rules/no-leaked-child-processes.mjs`) flags bare `spawn()`, `fork()`, and `execFile()` calls whose return value is not captured. Follows the same pattern as:

- `no-leaked-timers` (Issue #1346)
- `no-leaked-streams` (Issue #1431)

## Files Changed

| File                                            | Change                                                  |
| ----------------------------------------------- | ------------------------------------------------------- |
| `src/exit-handler.lib.mjs`                      | Kill child processes before unref; enhanced diagnostics |
| `src/github.lib.mjs`                            | try/finally for 3 temp file patterns                    |
| `src/github-error-reporter.lib.mjs`             | try/finally for 2 temp file patterns                    |
| `src/solve.auto-pr.lib.mjs`                     | try/finally for PR creation temp files                  |
| `src/solve.results.lib.mjs`                     | try/finally for 2 PR body update temp files             |
| `eslint-rules/no-leaked-child-processes.mjs`    | New ESLint rule                                         |
| `eslint.config.mjs`                             | Register new rule                                       |
| `tests/test-no-leaked-child-processes-rule.mjs` | Unit tests for new rule                                 |
| `tests/test-resource-leak-fixes-1493.mjs`       | Unit tests for exit handler fixes                       |

## Resource Leak Prevention — Complete Coverage

After this fix, hive-mind has a complete set of resource leak prevention rules:

| Resource                              | ESLint Rule                 | Issue |
| ------------------------------------- | --------------------------- | ----- |
| Timers (setTimeout/setInterval)       | `no-leaked-timers`          | #1346 |
| Streams (ReadStream/WriteStream)      | `no-leaked-streams`         | #1431 |
| Child Processes (spawn/fork/execFile) | `no-leaked-child-processes` | #1493 |

All three enforce the same principle: **if you create a resource that keeps the event loop alive, you must hold a reference to it so you can clean it up.**

## References

- [Node.js Child Process docs](https://nodejs.org/api/child_process.html)
- [Node.js process.\_getActiveHandles()](https://nodejs.org/api/process.html) — private but widely used for diagnostics
- Issue #1431 — Original drainHandles() implementation
- Issue #1346 — Timer leak fix and no-leaked-timers rule
