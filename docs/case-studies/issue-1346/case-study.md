# Case Study: Issue #1346 — Solve Command Stuck After "PR MERGED! Stopping auto-restart-until-mergeable mode"

## Issue Reference

- **GitHub Issue:** https://github.com/link-assistant/hive-mind/issues/1346
- **Reported by:** konard
- **Log file:** https://gist.githubusercontent.com/konard/901f6c305f9d8ca8898358f63e67a9ee/raw/000292f7f671699c8318d5eff9dbf317efe8b45a/b68fb132-ec92-4205-af47-e6aa84c7839a.log
- **Log file (local copy):** `./b68fb132-ec92-4205-af47-e6aa84c7839a.log`

---

## 1. Timeline / Sequence of Events

All timestamps from the log file (`b68fb132-ec92-4205-af47-e6aa84c7839a.log`):

| Time (UTC)               | Event                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-02-22T00:39:16Z     | `solve` started: `solve <PR-URL> --model opus --attach-logs --verbose --auto-resume-on-limit-reset --auto-restart-until-mergeable --tokens-budget-stats` |
| 00:39:43Z                | Cloned repo, checked out PR branch `issue-6832-85dece6cbf8d` (PR #6833)                                                                                  |
| 00:39:54Z                | Claude (Opus) execution started                                                                                                                          |
| 01:23:16Z                | Claude execution completed. Result delivered.                                                                                                            |
| 01:23:22Z                | `📌 Result event received, starting 30s stream close timeout (Issue #1280)`                                                                              |
| 01:23:30Z                | `✅ Claude command completed`                                                                                                                            |
| 01:23:30Z                | Auto-restart session log uploaded to PR                                                                                                                  |
| **01:23:31Z**            | **`🎉 PR MERGED! Stopping watch mode`** — watch loop broke out (from `solve.watch.lib.mjs`)                                                              |
| 01:23:31Z                | Session data updated from watch mode                                                                                                                     |
| 01:23:31Z                | `📤 Pushing committed changes to GitHub...` — **push failed** (fetch first)                                                                              |
| 01:23:31Z                | `ℹ️ Logs already uploaded by verifyResults, skipping duplicate upload`                                                                                   |
| **01:23:31Z**            | **`🔄 AUTO-RESTART-UNTIL-MERGEABLE MODE ACTIVE`** — started (from `solve.mjs` after watch mode)                                                          |
| **01:23:32Z**            | **`🎉 PR MERGED! Stopping auto-restart-until-mergeable mode`** — second loop also saw merged, returned                                                   |
| 01:23:32Z                | `🏁 Ending work session`                                                                                                                                 |
| 01:23:32Z                | `ℹ️ Skipping: End comment (logs already attached with session end message)`                                                                              |
| 01:23:32Z                | `✅ PR status: Already ready for review`                                                                                                                 |
| **01:23:36Z**            | **`📁 Complete log file: /home/hive/b68fb132-ec92-4205-af47-e6aa84c7839a.log`** — `finally` block executed, main async code finished                     |
| **01:23:36Z**            | **Process appears to hang** — all user-visible work is done but process does NOT exit                                                                    |
| **2026-02-22T23:12:45Z** | **`❌ Interrupted (CTRL+C)`** — user killed the process manually, ~22 hours later                                                                        |

---

## 2. Root Cause Analysis

### Primary Root Cause: Missing `process.exit(0)` After Successful Completion

The main entry point `src/solve.mjs` ends with a `try/catch/finally` block. After all async operations complete (including `endWorkSession` and log file display in `finally`), **the script does not call `process.exit(0)`**.

```javascript
// src/solve.mjs — original finally block (broken)
} finally {
  await cleanupTempDirectory(tempDir, argv, limitReached);
  if (getLogFile()) {
    const path = await use('path');
    const absoluteLogPath = path.resolve(getLogFile());
    await log(`\n📁 Complete log file: ${absoluteLogPath}`);
  }
  // ❌ NO process.exit(0) HERE
}
```

In Node.js, a script exits when all work is done AND the event loop becomes empty. If anything keeps the event loop active (open handles, pending timers, active network connections), the process blocks indefinitely.

### Why the Process Doesn't Exit Naturally

After the `finally` block completes, Node.js checks if there are any active handles on the event loop. Possible sources of lingering handles include:

1. **`command-stream` child processes**: The `$` function from `command-stream` spawns child processes. Although the claude CLI process exits before the `finally` block runs, internal libuv handles from `command-stream`'s process management (event listeners, pipe handles) may remain active.

2. **Network connection pools**: HTTP/HTTPS connections made by `use-m` to download packages from `unpkg.com`/`esm.sh` use Node.js's built-in fetch (undici), which maintains connection pools. These open TCP connections are active handles.

3. **`@sentry/profiling-node` native addon (when `--sentry` is enabled)**: When Sentry is enabled, the `@sentry/profiling-node` package loads a native C++ addon (`sentry_cpu_profiler-linux-x64-glibc-137.node`) that registers libuv handles. **However, Sentry is disabled by default** and was NOT enabled in the reproduction cases (no `--sentry` flag), so this is NOT the root cause for the observed hangs.

### Important Clarification: Sentry Is Disabled by Default

The reproduction commands did NOT use `--sentry`:
```
solve https://... --attach-logs --verbose --no-tool-check --auto-resume-on-limit-reset --auto-restart-until-mergeable
```

`src/instrument.mjs` disables Sentry by default (line 35):
```javascript
if (!process.argv.includes('--sentry') && process.env.HIVE_MIND_SENTRY !== 'true') {
  return true; // disable
}
```

So `@sentry/profiling-node` was **not loaded** in these reproductions. The hang is caused by other active handles.

### When Sentry IS Enabled: `Sentry.close()` Required

When Sentry IS enabled (`--sentry` flag), the `@sentry/profiling-node` native addon is loaded and keeps the event loop alive. The correct fix is to call `Sentry.close()` (via `closeSentry()` from `sentry.lib.mjs`) before process exit. This properly flushes Sentry's transport queue and tears down the profiling integration.

**Important note on `profileLifecycle: 'trace'`**: The profiler is configured with `profileLifecycle: 'trace'`, meaning the native CPU profiler **only runs while there is at least one active Sentry span**. When the `finally` block runs, there are no active spans — so the profiling timer is already stopped. However, calling `closeSentry()` is still necessary to flush any queued events and properly disable the SDK.

### The `sentry.close()` Hang Risk

`Sentry.close(timeout)` passes the `timeout` value to internal flush/transport logic, but the outer `Promise` returned by `close()` has **no hard deadline**. If the Sentry transport stalls (e.g., network issues), `await sentry.close(2000)` can itself hang indefinitely. The fix wraps it in `Promise.race` with a hard 3-second deadline.

### Supporting Evidence

1. The log shows `📁 Complete log file: ...` at **01:23:36Z** — `finally` block completed.
2. The process was still alive at **23:12:45Z** (~22 hours later), killed with Ctrl+C.
3. **Second reproduction (v1.27.0, 58 hours)**: Same pattern — see Section 6.
4. The `exit-handler.lib.mjs` `safeExit()` function calls `sentry.close(2000)` then `process.exit()` — but this was only called for error exits, not normal completion.

### Additional Contributing Factor: Sequential Ordering of Watch + Auto-Restart Modes

The log shows both modes ran sequentially:

1. `watchForFeedback` (in `solve.watch.lib.mjs`) ran first, detected PR merged, and returned.
2. Then `startAutoRestartUntilMergeable` (in `solve.auto-merge.lib.mjs`) started and also detected PR merged immediately.

This is correct behavior — the two modes are intentionally sequential. The stuck process is unrelated to this double-detection; it simply occurs because neither mode (nor the main function) calls `process.exit(0)` on success.

---

## 3. Code Locations

| File                       | Location                          | Issue                                                            |
| -------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| `src/solve.mjs`            | Line ~1487-1510 (`finally` block) | Missing `process.exit(0)` after successful completion            |
| `src/instrument.mjs`       | Lines 22, 35                      | Sentry disabled by default; profiling only loads with `--sentry` |
| `src/exit-handler.lib.mjs` | `safeExit()` function             | Used for error paths; now also has hard timeout on `sentry.close()` |
| `src/sentry.lib.mjs`       | `closeSentry()` export            | Proper API for Sentry shutdown; checks `isSentryEnabled()` first |

---

## 4. Dangling Promises and Unfreed Resources

Reviewer question from PR comment: "Do we have dangling promises or unfreed resources? Can we ensure we always free them all?"

**Analysis result**: The hang is NOT caused by dangling Promises. All async work completes normally — the `finally` block only runs after the `try` block resolves. The hang is caused by **active Node.js event loop handles** from native/library code that are not cleaned up.

Specific findings:

| Source | Type | Properly cleaned up? |
|--------|------|---------------------|
| `command-stream` child processes | ChildProcess handles | Only when child exits (which it does before finally) |
| `use-m` HTTP fetch connections | Undici connection pools | Not explicitly destroyed (lingering TCP handles) |
| `claude.lib.mjs` setInterval (countdown) | Timer | Yes — `clearInterval()` called |
| `solve.auto-merge.lib.mjs` setTimeout (polling) | Awaited timer | Yes — awaited, not dangling |
| `@sentry/profiling-node` native addon | libuv native handles | Released via `Sentry.close()` when Sentry is enabled |

The pragmatic solution is `process.exit(0)` as a final safety net after cleanup, since exhaustively tracking and unreffing every handle from every library is not feasible in a complex application.

---

## 5. ESLint Rules for process.exit

Reviewer question: "Do we have ESLint rules in npm for that, or should we write our own rules?"

**Available npm packages**:
- `eslint-plugin-n` (or `eslint-plugin-node`) provides `n/no-process-exit` rule
- `eslint-plugin-unicorn` provides `unicorn/no-process-exit` rule

**Assessment for this codebase**: Adding `no-process-exit` as an error would conflict with `safeExit()` (which calls `process.exit()`) and the `finally` block fix. A blanket rule against `process.exit()` is impractical since the application must be able to exit.

A more useful custom rule could detect `process.exit()` calls outside of `safeExit()` / designated exit functions, but this is complex to implement correctly. The practical safeguard is code review.

**Conclusion**: Code review is the appropriate mechanism here. The existing `eslint-rules/` directory contains one custom rule (`require-gh-paginate.mjs`). A `no-bare-process-exit.mjs` rule could be added to warn when `process.exit()` is called outside of `exit-handler.lib.mjs`, but this is not required for the core fix.

---

## 6. Proposed Solutions

### Solution 1 (Recommended and Implemented): Explicit Sentry Close + `process.exit(0)` in `finally`

```javascript
} finally {
  await cleanupTempDirectory(tempDir, argv, limitReached);

  // Show final log file reference so users always know where to find the complete log
  if (getLogFile()) {
    const finalLogPath = path.resolve(getLogFile());
    await log(`\n📁 Complete log file: ${finalLogPath}`);
  }

  // Issue #1346: Close Sentry (if enabled) then exit to prevent hanging.
  // When Sentry is enabled, closeSentry() flushes pending events and releases
  // native profiling handles. The process.exit(0) call is a required safety net
  // for active handles from other libraries (network connections, etc.).
  await closeSentry();
  process.exit(0);
}
```

This restores the original log path display while adding proper Sentry shutdown and forced exit.

### Solution 2: Add Hard Timeout to `sentry.close()` in `exit-handler.lib.mjs`

```javascript
// Wrap sentry.close() in Promise.race to prevent it from hanging indefinitely
await Promise.race([
  sentry.close(2000),
  new Promise(resolve => setTimeout(resolve, 3000)), // hard 3s deadline
]);
```

This prevents `await sentry.close(2000)` from hanging if Sentry's transport stalls.

### Solution 3 (Not Implemented): Custom ESLint Rule

A custom rule to warn when `process.exit()` is called outside designated exit functions. Deferred due to complexity and low practical value.

---

## 7. Fix Applied

The fix was implemented across two files:

### `src/solve.mjs` — `finally` block

```javascript
// Before (BROKEN — hangs indefinitely):
} finally {
  await cleanupTempDirectory(tempDir, argv, limitReached);
  if (getLogFile()) {
    const path = await use('path');
    const absoluteLogPath = path.resolve(getLogFile());
    await log(`\n📁 Complete log file: ${absoluteLogPath}`);
  }
  // ← No process.exit() — active handles keep process alive!
}

// After (FIXED — proper Sentry close + forced exit):
} finally {
  await cleanupTempDirectory(tempDir, argv, limitReached);
  if (getLogFile()) {
    const finalLogPath = path.resolve(getLogFile());
    await log(`\n📁 Complete log file: ${finalLogPath}`);
  }
  await closeSentry();  // flush Sentry events and release profiling handles (no-op when disabled)
  process.exit(0);      // safety net: prevent hang from any remaining active handles
}
```

Key improvements over earlier draft:
- **Restores explicit log path display** (`📁 Complete log file: ...`) matching the original behavior
- **Uses `closeSentry()` from `sentry.lib.mjs`** (checks `isSentryEnabled()` first; no-op when disabled)
- **Replaces `safeExit()` routing** with direct `closeSentry()` + `process.exit(0)` for clarity

### `src/exit-handler.lib.mjs` — `safeExit()` and signal handlers

```javascript
// Before:
await sentry.close(2000);

// After (hard timeout prevents sentry.close() from hanging):
await Promise.race([
  sentry.close(2000),
  new Promise(resolve => setTimeout(resolve, 3000)), // hard 3s deadline
]);
```

Applied in `safeExit()` and all signal handlers (SIGINT, SIGTERM, uncaughtException, unhandledRejection).

---

## 8. Second Reproduction (v1.27.0 — Confirms Root Cause)

A second hang was reported on 2026-03-11 with **solve v1.27.0** (before this fix was merged into main):

- **Log:** https://gist.githubusercontent.com/konard/b4a6fca1bea1ab18322ba104a13530d2/raw/0009a5f0404faedd75c3cbd20aafc372f1bd2031/d1c62020-ec50-4f58-9453-d589b81456c7.log
- **Duration:** ~58 hours (2026-03-09T00:14:47Z to 2026-03-11T10:25:04Z)
- **Terminal output confirming the hang point:**
  ```
  ✅ PR IS MERGEABLE!
     PR is ready to be merged manually
     Exiting auto-restart-until-mergeable mode
  📁 Keeping directory (--no-auto-cleanup): /tmp/gh-issue-solver-1773010716484
  📁 Complete log file: /home/hive/d1c62020-ec50-4f58-9453-d589b81456c7.log
  ← HANGS HERE (no exit, touch commands from hive-telegram-bot leak in)
  ^C
  ```

The timestamps for `📁 Keeping directory` and `📁 Complete log file` in the log file appear on lines following their `[TIMESTAMP] [INFO]` prefix — the `\n` prefix in `await log('\n📁 ...')` causes the timestamp to appear on the preceding line. The messages ARE logged with timestamps; they visually appear timestamp-free only in the log file format.

This second log confirms the identical root cause: `finally` block in v1.27.0's `solve.mjs` ended with `await log(...)` but no `process.exit(0)`, causing the same indefinite hang.

---

## 9. Related Issues / References

- Sentry GitHub issue on profiling blocking process exit: https://github.com/getsentry/sentry-javascript/issues (profiling-node keeps process alive)
- Node.js documentation on event loop and `process.exit()`: https://nodejs.org/api/process.html#processexitcode
- Issue #1280 (stream close timeout) — referenced in log at line 53895
- Issue #1290 (auto-restart log upload tracking) — referenced in code comments
- Issue #1124 (playwright-mcp folder cleanup) — referenced in code comments
- `@sentry/profiling-node` source: `build/cjs/index.js` — timers ARE `.unref()`'d (lines 815, 1043), but native `CpuProfilerBindings.startProfiling()` keeps libuv handles alive
- `Sentry.close()` implementation: `@sentry/core/build/cjs/client.js` — does NOT call `stopProfiling()`; `nodeProfilingIntegration` has no `teardown` lifecycle hook
