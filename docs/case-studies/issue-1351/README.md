# Case Study: Issue #1351 - On CTRL+C We Must Do Auto-Commit of Uncommitted Changes and Upload Log if `--attach-logs` is Enabled

## Summary

When the user presses CTRL+C to interrupt a running solve session, two important actions that normally occur at the end of a successful session are silently skipped:

1. **Auto-commit of uncommitted changes** — any work-in-progress changes Claude made are lost or left in an uncommitted state with no preservation attempt.
2. **Log upload to GitHub** — when `--attach-logs` is enabled, the log file is not uploaded to the PR/issue on interrupt.

Additionally, the terminal output message after CTRL+C still shows "Claude command completed" instead of a more accurate "Claude command interrupted" message (as noted in the issue: `Claude command completed -> Claude command interrupted`).

## Reproduction from Issue

The issue reporter's log shows the exact sequence:

```
^C
? Keeping directory (--no-auto-cleanup): /tmp/gh-issue-solver-1772038974192
?? Updated exit code from command result: 130

?
 Claude command completed     <-- This should say "Claude command interrupted"

? Total messages: 0, Tool uses: 0
? Interrupted (CTRL+C)
? Full log file: /home/hive/022ac9f3-c904-494c-93c0-fb240622360a.log
hive@9a7f249e6a7f:~$ gh-upload-log /home/hive/022ac9f3-...log   <-- User had to upload manually
...
hive@9a7f249e6a7f:~$ (cd /tmp/gh-issue-solver-1772038974192 && git status)
Changes not staged for commit:                                    <-- Changes left uncommitted
  modified:   .github/workflows/rust-benchmark.yml
  modified:   rust/Cargo.lock
  ...
```

The user had to **manually** run `gh-upload-log` and check git status. Both of these should be done automatically by hive-mind on CTRL+C.

## Root Cause Analysis

### Architecture Overview

The signal handling in hive-mind is centralized in `src/exit-handler.lib.mjs`. The SIGINT (CTRL+C) handler is:

```javascript
// src/exit-handler.lib.mjs (lines 109-128)
process.on('SIGINT', async () => {
  if (cleanupFunction) {
    try {
      await cleanupFunction();   // <-- Only cleanup (temp dir deletion), nothing else
    } catch {
      // Ignore cleanup errors on signal
    }
  }
  await showExitMessage('Interrupted (CTRL+C)', 130);
  // ... Sentry flush ...
  process.exit(130);
});
```

The `cleanupFunction` is wired up in `src/solve.mjs` as:

```javascript
// src/solve.mjs (lines 163-172)
let cleanupContext = { tempDir: null, argv: null, limitReached: false };
const cleanupWrapper = async () => {
  if (cleanupContext.tempDir && cleanupContext.argv) {
    await cleanupTempDirectory(cleanupContext.tempDir, cleanupContext.argv, cleanupContext.limitReached);
  }
};
initializeExitHandler(getAbsoluteLogPath, log, cleanupWrapper);
installGlobalExitHandlers();
```

So on CTRL+C, only `cleanupTempDirectory()` is called. There is **no** auto-commit of changes, **no** log upload, and **no** PR comment.

### Root Cause 1: SIGINT Handler Does Not Auto-Commit Uncommitted Changes

The auto-commit logic only runs in the **normal exit flow** in `src/solve.mjs` at line 1183–1186:

```javascript
// src/solve.mjs (line 1183-1186) - NORMAL EXIT FLOW ONLY
const shouldAutoCommit = argv['auto-commit-uncommitted-changes'] || limitReached;
const autoRestartEnabled = argv['autoRestartOnUncommittedChanges'] !== false;
const shouldRestart = await checkForUncommittedChanges(tempDir, owner, repo, branchName, $, log, shouldAutoCommit, autoRestartEnabled);
```

The actual commit+push happens in `src/claude.lib.mjs` at line 1397 inside `checkForUncommittedChanges()`:

```javascript
// src/claude.lib.mjs (line 1397-1455)
export const checkForUncommittedChanges = async (tempDir, owner, repo, branchName, $, log, autoCommit = false, ...) => {
  // git status --porcelain
  // if autoCommit: git add -A + git commit -m "Auto-commit..." + git push
  // ...
};
```

The SIGINT handler calls `cleanupWrapper()` which calls `cleanupTempDirectory()`, which **only deletes** the temp directory. It never calls `checkForUncommittedChanges()` with `autoCommit=true`.

**The issue**: The `cleanupContext` at SIGINT time may have `tempDir` populated (if it was set earlier), but no code path triggers the auto-commit before deletion occurs.

### Root Cause 2: SIGINT Handler Does Not Upload Logs

The log upload (`attachLogToGitHub`) only runs at several places in the normal exit flow inside `src/solve.mjs` and `src/solve.results.lib.mjs`. These are all unreachable from the SIGINT path.

The SIGINT handler only does:
1. `cleanupFunction()` → temp dir deletion
2. `showExitMessage()` → shows log path on console
3. Sentry flush
4. `process.exit(130)`

No call to `attachLogToGitHub` or `uploadLogWithGhUploadLog` is present in the interrupt path.

### Root Cause 3: Misleading "Claude command completed" Message

In `src/claude.lib.mjs` at line 1291:

```javascript
await log('\n\n✅ Claude command completed');
```

When Claude exits due to SIGINT (exit code 130), this message is still printed because:
- The SIGINT signal arrives at the parent process (hive-mind/solve.mjs)
- But the `claude` subprocess may have already written "Claude command completed" to the log stream **before** the SIGINT propagates to terminate the subprocess
- OR the SIGINT was sent to the Claude subprocess directly (if user hits CTRL+C in terminal), causing it to emit a result-type exit chunk that the monitoring code treats as a completed session

Looking at the issue log: `Updated exit code from command result: 130` (from `src/claude.lib.mjs` line ~1159-1160 where it reads the actual exit code). The code detects exit code 130 but still logs "Claude command completed" before checking if it was interrupted.

## Detailed Flow Analysis

### Normal Flow (No CTRL+C)

```
solve.mjs
  └─ claude.lib.mjs executeClaude()
       └─ Claude subprocess runs
       └─ [on completion] log "✅ Claude command completed"
       └─ return { success: true/false }
  └─ checkForUncommittedChanges(tempDir, ..., shouldAutoCommit)
       └─ [if autoCommit] git add -A && git commit && git push
  └─ verifyResults()
       └─ attachLogToGitHub() [if shouldAttachLogs]
  └─ process.exit(0)
```

### CTRL+C Flow (Current - Broken)

```
User presses CTRL+C
  └─ SIGINT sent to terminal process group
  └─ [possibly] Claude subprocess receives SIGINT, exits with code 130
  └─ solve.mjs SIGINT handler fires (exit-handler.lib.mjs)
       └─ cleanupWrapper() → cleanupTempDirectory() → rm -rf tempDir
            !! PROBLEM: Uncommitted changes are DELETED with the directory !!
       └─ showExitMessage() → "Interrupted (CTRL+C)" + log file path
       └─ process.exit(130)
  !! No auto-commit  !!
  !! No log upload   !!
  !! Misleading message already logged !!
```

### CTRL+C Flow (Desired - Fixed)

```
User presses CTRL+C
  └─ SIGINT sent to terminal process group
  └─ solve.mjs SIGINT handler fires
       └─ [NEW] Check for uncommitted changes in tempDir
       └─ [NEW] If changes found: git add -A && git commit -m "Auto-commit on CTRL+C..." && git push
       └─ [NEW] If --attach-logs: attachLogToGitHub() or uploadLogWithGhUploadLog()
       └─ [NEW] Post PR/issue comment about interruption with log link
       └─ cleanupWrapper() → cleanupTempDirectory()
       └─ showExitMessage() → "Interrupted (CTRL+C)" + log file path
       └─ process.exit(130)
```

## Key Code Locations

| File | Line(s) | Relevance |
|------|---------|-----------|
| `src/exit-handler.lib.mjs` | 109-128 | SIGINT handler — where fix must be added |
| `src/exit-handler.lib.mjs` | 32-38 | `initializeExitHandler()` — where context is passed in |
| `src/solve.mjs` | 163-172 | `cleanupWrapper` setup and `initializeExitHandler()` call |
| `src/solve.mjs` | 1183-1186 | Normal-flow auto-commit trigger |
| `src/claude.lib.mjs` | 1397-1455 | `checkForUncommittedChanges()` with auto-commit logic |
| `src/github.lib.mjs` | (search: `attachLogToGitHub`) | Log attachment function |
| `src/log-upload.lib.mjs` | Full file | `uploadLogWithGhUploadLog()` — wraps gh-upload-log CLI |
| `src/solve.results.lib.mjs` | 464+ | `verifyResults()` — where log upload happens in normal flow |
| `src/solve.mjs` | 142 | `shouldAttachLogs` derivation from `argv.attachLogs` |

## Evidence from Issue Reporter's Terminal

From the issue body:

1. Exit code 130 was detected: `Updated exit code from command result: 130`
2. Still showed "Claude command completed" (should say "interrupted")
3. User had to manually run `gh-upload-log` to upload logs
4. User had to manually check `git status` to see uncommitted changes existed
5. 6 files were modified by Claude but left uncommitted

## Impact

- **Data loss risk**: Uncommitted changes are deleted when the temp directory is cleaned up on CTRL+C (when `--auto-cleanup` is true, which is the default for private repos)
- **Manual effort**: Users who interrupt a session and want to preserve logs/changes must manually run `gh-upload-log` and `git commit`
- **Confusing UX**: "Claude command completed" message is misleading when the session was actually interrupted
- **Inconsistency**: The `--attach-logs` flag is advertised as ensuring logs are uploaded, but this is silently not done on interruption

## Proposed Solutions

### Solution A: Enhance the `cleanupFunction` Contract (Recommended)

Instead of `cleanupFunction` only handling temp directory deletion, expand it to an "interrupt handler" that performs all the necessary actions before cleanup.

**Changes required:**

1. **`src/exit-handler.lib.mjs`**: Add a separate `interruptFunction` slot that runs before `cleanupFunction` on SIGINT (and optionally SIGTERM):

```javascript
let interruptFunction = null;

export const initializeExitHandler = (getLogPath, log, cleanup = null, interrupt = null) => {
  getLogPathFunction = getLogPath;
  logFunction = log;
  cleanupFunction = cleanup;
  interruptFunction = interrupt;  // NEW
};

// In SIGINT handler:
process.on('SIGINT', async () => {
  if (interruptFunction) {
    try {
      await interruptFunction();  // auto-commit + log upload
    } catch {
      // Ignore interrupt handler errors
    }
  }
  if (cleanupFunction) {
    try {
      await cleanupFunction();   // temp dir deletion
    } catch { }
  }
  await showExitMessage('Interrupted (CTRL+C)', 130);
  process.exit(130);
});
```

2. **`src/solve.mjs`**: Create an `interruptWrapper` that auto-commits and uploads logs:

```javascript
const interruptWrapper = async () => {
  const ctx = cleanupContext;
  if (!ctx.tempDir || !ctx.argv) return;

  // Auto-commit uncommitted changes (always on CTRL+C to preserve work)
  const hasChanges = await checkForUncommittedChanges(
    ctx.tempDir, owner, repo, branchName, $, log,
    true,   // always autoCommit on CTRL+C
    false   // no autoRestart
  );

  // Upload logs if --attach-logs is enabled
  if (shouldAttachLogs && global.createdPR?.number) {
    await attachLogToGitHub({
      logFile: getLogFile(),
      targetType: 'pr',
      targetNumber: global.createdPR.number,
      owner, repo, $, log, sanitizeLogContent,
      verbose: ctx.argv.verbose || false,
      errorMessage: 'Session interrupted by user (CTRL+C)',
    });
  }
};

initializeExitHandler(getAbsoluteLogPath, log, cleanupWrapper, interruptWrapper);
```

### Solution B: Consolidate Context in `cleanupFunction`

Instead of adding a new hook, pass full context into `cleanupWrapper` and let it handle everything on interrupt:

**Pros**: Simpler — one function does all cleanup.
**Cons**: `cleanupFunction` interface mixes concerns (temp dir deletion vs. data preservation).

### Solution C: Use `process.on('beforeExit')` / `process.on('exit')`

Use Node.js lifecycle hooks to perform synchronous cleanup. However, these are limited — async operations cannot be awaited in `'exit'` event. Not viable for network operations (git push, GitHub API).

### Solution D: Wrap Child Process Handling

Instead of handling SIGINT at the parent level, detect exit code 130 in the claude subprocess result and trigger the auto-commit/log-upload flow there.

**How**: In `src/claude.lib.mjs`, after the subprocess exits, check if exitCode === 130 and run the same post-processing that normally happens on success.

**Pros**: Keeps exit-handler.lib.mjs simple.
**Cons**: Requires propagating full context (tempDir, branchName, argv, shouldAttachLogs, etc.) into claude.lib.mjs, and duplicating logic for each AI tool (opencode, codex, agent).

### Solution E: Dedicated SIGINT-aware Helper Module

Create `src/solve.interrupt-handler.lib.mjs` with a shared `handleInterrupt()` function that is called from:
- SIGINT handler in exit-handler.lib.mjs
- Future SIGTERM handler enhancements

This promotes separation of concerns while centralizing interrupt logic.

## Fix for Misleading "Claude command completed" Message

In `src/claude.lib.mjs`, where the success message is printed, detect exit code 130:

```javascript
// Before fix:
await log('\n\n✅ Claude command completed');

// After fix:
if (exitCode === 130) {
  await log('\n\n⚠️ Claude command interrupted (CTRL+C)');
} else if (errorDuringExecution) {
  await log('\n\n⚠️ Claude command finished with errors');
} else {
  await log('\n\n✅ Claude command completed');
}
```

The same fix should be applied to `src/opencode.lib.mjs`, `src/codex.lib.mjs`, and `src/agent.lib.mjs`.

## Recommended Approach

Use **Solution A** (enhanced `initializeExitHandler` with `interruptFunction`) combined with the exit code message fix:

1. **Minimal API change** to `exit-handler.lib.mjs`: Add optional 4th `interrupt` parameter.
2. **New `interruptWrapper`** in `solve.mjs` that:
   - Always auto-commits uncommitted changes (regardless of `--auto-commit-uncommitted-changes` flag)
   - Uploads logs to GitHub if `--attach-logs` is set and a PR exists
   - Posts a brief "Session interrupted by user" comment to the PR if desired
3. **Message fix**: Detect exit code 130 in each tool's completion logging code.

## Key Design Considerations

- **Always auto-commit on CTRL+C**: The `--auto-commit-uncommitted-changes` flag defaults to `false`, but on interruption, preserving work should override this default. This matches the behavior described in the issue: "we must do auto-commit of uncommitted changes by default."
- **`--attach-logs` must be respected**: The upload should only happen when explicitly requested (`--attach-logs`). It was surprising to the reporter that it did not happen given the flag was set.
- **Idempotency**: The interrupt handler might fire multiple times if CTRL+C is pressed again during cleanup. Guard with a `interruptHandlerRan` flag.
- **Timeout**: Git operations and GitHub API calls in the interrupt handler should have timeouts to prevent hanging.
- **Context availability**: At SIGINT time, `cleanupContext` (tempDir, argv) must already be populated. This requires `cleanupContext` to be updated early in `solve.mjs`, not just before the final cleanup.

## Related Issues and Prior Art

- **Issue #1183**: Auto-commit of uncommitted changes when limit is reached — similar logic, already implemented for the limit-reset case.
- **Issue #1290**: Log upload after auto-restart — shows the pattern for detecting whether logs were already uploaded.
- **Issue #1154**: Track if logs were already uploaded to prevent duplicates — anti-duplicate pattern to use in interrupt handler.
- **`docs/issue-94-claude-command-kills-solution.md`**: Prior discussion of Claude command interruption behavior.

## External Libraries and References

- **Node.js `process.on('SIGINT')`**: Standard approach for CTRL+C handling. Works with async handlers in Node 18+. [Node.js docs](https://nodejs.org/api/process.html#signal-events)
- **`gh-upload-log`**: The CLI tool already used for log uploads in normal flow (`src/log-upload.lib.mjs`). Can be reused in the interrupt handler.
- **`graceful-shutdown` pattern**: Industry practice of running cleanup tasks in reverse-registration order before exiting. Libraries like [`death`](https://github.com/jprichardson/node-death) and [`node-cleanup`](https://www.npmjs.com/package/node-cleanup) provide helpers, though hive-mind's in-house `exit-handler.lib.mjs` is already doing this.
- **`got-exit` / `signal-exit`**: npm packages that provide reliable SIGINT handling and call registered callbacks before exit. [`signal-exit`](https://www.npmjs.com/package/signal-exit) is widely used (e.g., in npm itself, tape, etc.) and handles edge cases like multiple-SIGINT presses.

## Files to Modify

| File | Change |
|------|--------|
| `src/exit-handler.lib.mjs` | Add `interruptFunction` parameter; call before `cleanupFunction` on SIGINT/SIGTERM |
| `src/solve.mjs` | Create `interruptWrapper` with auto-commit + log upload; pass to `initializeExitHandler` |
| `src/claude.lib.mjs` | Fix "Claude command completed" → "Claude command interrupted" when exitCode=130 |
| `src/opencode.lib.mjs` | Same message fix |
| `src/codex.lib.mjs` | Same message fix |
| `src/agent.lib.mjs` | Same message fix |

## Conclusion

The issue is caused by the SIGINT handler performing only directory cleanup, skipping the data-preservation steps (auto-commit, log upload) that exist in the normal exit flow. The fix requires:

1. Extending the exit handler API to support an interrupt-specific callback.
2. Wiring up auto-commit and log upload in that callback from solve.mjs.
3. Fixing the misleading "completed" vs "interrupted" terminal message in each AI tool library.
