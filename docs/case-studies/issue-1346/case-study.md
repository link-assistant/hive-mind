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
// src/solve.mjs — last lines
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

### Secondary Root Cause: Sentry Profiling Integration Keeps Event Loop Alive

`src/instrument.mjs` initializes `@sentry/profiling-node`:

```javascript
const profilingModule = await import('@sentry/profiling-node');
nodeProfilingIntegration = profilingModule.nodeProfilingIntegration;

Sentry.init({
  integrations: [nodeProfilingIntegration()],
  profileLifecycle: 'trace',
  profileSessionSampleRate: ...,
  ...
});
```

The `@sentry/profiling-node` package uses native addons (typically V8 CPU profiler or Parca/StackProf) that register handles on the Node.js event loop. These handles do **not** automatically unref themselves, preventing the event loop from naturally draining.

The comment in `instrument.mjs` (line 22) even acknowledges this problem:

```javascript
// This prevents Sentry's profiling integration from blocking process exit
```

But the actual fix (calling `Sentry.close()` at successful exit) is only implemented in `safeExit()` within `exit-handler.lib.mjs`. The `safeExit()` function is NOT called on normal (success) completion — it is only used for error exits.

### Supporting Evidence

1. The log shows `📁 Complete log file: ...` at **01:23:36Z** (all user code finished).
2. The process was still alive at **23:12:45Z** (~22 hours later), killed with Ctrl+C.
3. The `safeExit()` function calls `Sentry.close(2000)` before `process.exit()`:
   ```javascript
   export const safeExit = async (code = 0, reason = 'Process completed') => {
     await showExitMessage(reason, code);
     try {
       const sentry = await getSentry();
       if (sentry && sentry.close) {
         await sentry.close(2000);
       }
     } catch {}
     process.exit(code);
   };
   ```
4. The normal success path does NOT go through `safeExit()`.

### Additional Contributing Factor: Sequential Ordering of Watch + Auto-Restart Modes

The log shows both modes ran sequentially:

1. `watchForFeedback` (in `solve.watch.lib.mjs`) ran first, detected PR merged, and returned.
2. Then `startAutoRestartUntilMergeable` (in `solve.auto-merge.lib.mjs`) started and also detected PR merged immediately.

This is correct behavior — the two modes are intentionally sequential. The stuck process is unrelated to this double-detection; it simply occurs because neither mode (nor the main function) calls `process.exit(0)` on success.

---

## 3. Code Locations

| File                       | Location                          | Issue                                                            |
| -------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| `src/solve.mjs`            | Line ~1480-1491 (`finally` block) | Missing `process.exit(0)` after successful completion            |
| `src/instrument.mjs`       | Lines 51-73                       | Sentry profiling integration keeps event loop alive              |
| `src/exit-handler.lib.mjs` | `safeExit()` function             | Correctly closes Sentry and exits, but only used for error paths |

---

## 4. Proposed Solutions

### Solution 1 (Recommended): Add `process.exit(0)` at end of `solve.mjs` `finally` block

```javascript
} finally {
  await cleanupTempDirectory(tempDir, argv, limitReached);
  if (getLogFile()) {
    const path = await use('path');
    const absoluteLogPath = path.resolve(getLogFile());
    await log(`\n📁 Complete log file: ${absoluteLogPath}`);
  }
  // Close Sentry to flush pending events and allow process to exit cleanly
  try {
    const Sentry = await import('@sentry/node');
    await Sentry.close(2000);
  } catch {}
  process.exit(0);
}
```

Or better, reuse `safeExit`:

```javascript
} finally {
  await cleanupTempDirectory(tempDir, argv, limitReached);
  if (getLogFile()) {
    const path = await use('path');
    const absoluteLogPath = path.resolve(getLogFile());
    await log(`\n📁 Complete log file: ${absoluteLogPath}`);
  }
  await safeExit(0, 'Process completed successfully');
}
```

**Note:** `safeExit` calls `process.exit()` internally, so it exits from the `finally` block.

### Solution 2: Unref Sentry Profiling Handles

This is harder since `@sentry/profiling-node` doesn't expose a way to unref its handles publicly. Closing Sentry via `Sentry.close()` is the correct API.

### Solution 3: Add a timeout fallback

```javascript
// Force exit after 30 seconds if process hasn't exited naturally
const forceExitTimer = setTimeout(() => {
  process.exit(0);
}, 30000);
forceExitTimer.unref(); // Don't let this timer keep the event loop alive
```

This is a safety net, not a proper fix.

---

## 5. Recommended Fix

The cleanest fix is **Solution 1**: add `process.exit(0)` (or route through `safeExit(0, ...)`) at the end of the `finally` block in `src/solve.mjs`. This ensures:

1. All async cleanup is complete before exit.
2. Sentry is flushed/closed (2 second timeout).
3. The process always terminates promptly, regardless of what Sentry or other libraries have registered on the event loop.

This fix is minimal, safe, and consistent with how error exits are already handled via `safeExit()`.

---

## 6. Related Issues / References

- Sentry GitHub issue on profiling blocking process exit: https://github.com/getsentry/sentry-javascript/issues (profiling-node keeps process alive)
- Node.js documentation on event loop and `process.exit()`: https://nodejs.org/api/process.html#processexitcode
- Issue #1280 (stream close timeout) — referenced in log at line 53895
- Issue #1290 (auto-restart log upload tracking) — referenced in code comments
- Issue #1124 (playwright-mcp folder cleanup) — referenced in code comments
