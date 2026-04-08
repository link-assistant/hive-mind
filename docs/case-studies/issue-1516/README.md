# Case Study: Issue #1516 — Premature Finish Signaling Before Execution Completes

## Summary

The system reported task completion ("solution log uploaded", "✅ Ready to merge") while execution was still ongoing. A new commit appeared on the PR **after** the system had already signaled completion, confusing the user.

**Affected PR:** [link-foundation/meta-theory#33](https://github.com/link-foundation/meta-theory/pull/33)
**Session ID:** `64801be7-10d4-447c-8bd9-8266b2e17725`
**Date:** 2026-04-01

## Timeline Reconstruction

All timestamps in UTC.

| Time             | Event                                                                                       | Source                   |
| ---------------- | ------------------------------------------------------------------------------------------- | ------------------------ |
| 09:27:40         | solve.mjs starts (v1.42.0)                                                                  | solve.mjs                |
| 09:27:56         | `.gitkeep` initial commit (`bc0ef41`) pushed                                                | solve.mjs                |
| 09:28:05         | PR #33 created as draft                                                                     | solve.mjs                |
| 09:28:17         | Claude CLI execution begins                                                                 | claude.lib.mjs           |
| 09:30:50         | Claude commits "Remove downloaded.md files" (`c007d8d`)                                     | Claude CLI               |
| 09:33:17         | Claude commits "Add case study" (`c6054e0`) and pushes                                      | Claude CLI               |
| 09:33:41         | Claude runs `gh pr ready 33` — PR marked as ready for review                                | Claude CLI               |
| **09:34:38.319** | **Stream timeout fires — SIGTERM sent to Claude CLI process**                               | claude.lib.mjs           |
| 09:34:38.320     | Force-kill timeout triggered — process declared exited                                      | claude.lib.mjs           |
| 09:34:38.532     | `.gitkeep` revert committed (`17b8611`)                                                     | solve.results.lib.mjs    |
| **09:34:39.456** | **`.gitkeep` revert pushed to GitHub** (new commit on PR)                                   | solve.results.lib.mjs    |
| 09:34:39.470     | Session Summary displayed                                                                   | solve.mjs                |
| 09:34:40         | `verifyResults()` starts — finds PR #33 already ready                                       | solve.results.lib.mjs    |
| **09:34:47.346** | **Solution draft log uploaded to PR as Gist**                                               | solve.results.lib.mjs    |
| 09:34:48.400     | "🎉 SUCCESS: A solution draft has been prepared" printed                                    | solve.results.lib.mjs    |
| **09:34:52.201** | **"✅ Ready to merge" comment posted on PR**                                                | solve.auto-merge.lib.mjs |
| 09:34:54.891     | **Leaked ChildProcess detected** (pid=1075674, file=/bin/sh)                                | exit-handler.lib.mjs     |
| 09:34:54.897     | "✅ Process completed" — solve.mjs exits                                                    | exit-handler.lib.mjs     |
| **09:35:04**     | **NEW COMMIT `62e01ec` appears on PR** — "Add screenshot comparison findings to case study" | Leaked /bin/sh process   |

## Root Causes

### Root Cause 1: Leaked Child Processes Continue Executing After Force-Kill

When the stream timeout fires (`resultStreamCloseMs`), SIGTERM is sent to the Claude CLI process via `execCommand.kill('SIGTERM')` (claude.lib.mjs line 863). However, Claude CLI spawns child `/bin/sh` processes for its Bash tool calls. These child processes **do not receive the signal** because:

1. The signal is sent only to the parent process (Claude CLI), not to the entire process group
2. Node.js `child_process.spawn()` does not use `setsid` by default, so child processes share the process group, but `kill()` on the ChildProcess object only sends to the spawned PID
3. The `drainHandles()` function in exit-handler.lib.mjs only calls `.unref()` on surviving ChildProcess handles — it does not kill them

**Evidence:** The leaked ChildProcess (pid=1075674, file=/bin/sh) continued running after solve.mjs exited and created commit `62e01ec` at 09:35:04 — **10 seconds after the parent process declared completion.**

**Location:** `src/claude.lib.mjs` lines 857-881 (`forceExitOnTimeout`)

### Root Cause 2: `.gitkeep` Revert Push Creates New Commit Before Completion Signals

In `solve.mjs`, the execution sequence after Claude CLI exits is:

```
1. cleanupClaudeFile()     — line 1179  ← commits and PUSHES .gitkeep revert
2. showSessionSummary()    — line 1182
3. verifyResults()         — line 1220  ← uploads solution log, prints "SUCCESS"
4. startAutoRestartUntilMergeable() — line 1413  ← posts "Ready to merge" comment
```

The `.gitkeep` revert push (step 1) creates a new commit on the PR **before** the solution log upload and "Ready to merge" comment (steps 3-4). From the user's perspective on GitHub, the sequence appears as:

1. Solution log comment: "session is ended, feel free to review"
2. "✅ Ready to merge" comment
3. **New commit appears** (`.gitkeep` revert) — confusing!

The `.gitkeep` revert commit `17b8611` was pushed at 09:34:39, but the solution log was uploaded at 09:34:47. While the push happened before the log upload in wall clock time, GitHub's UI may show them in a different visual order, and the user sees the commit notification after the "done" signals.

**Location:** `src/solve.mjs` line 1179 vs line 1220

## Leaked Process Evidence

Normal process at exit:

```
Active Node.js handles at exit (3 handles, 1 requests):
  Handle: WriteStream (fd=2)
  Handle: WriteStream (fd=1)
  Handle: ReadStream (fd=0)
  Request: FileHandleCloseReq
```

This session at exit (showing leaked resources):

```
Active Node.js handles at exit (6 handles, 1 requests):
  Handle: WriteStream (fd=2)
  Handle: WriteStream (fd=1)
  Handle: ReadStream (fd=0)
  Handle: Socket          ← keep-alive HTTP connection (undici)
  Handle: Socket          ← keep-alive HTTP connection (undici)
  Handle: ChildProcess (pid=1075674, file=/bin/sh)  ← LEAKED
  Request: FileHandleCloseReq
```

The extra Socket handles are from undici's HTTP keep-alive pool (used by Claude CLI's Anthropic API calls). The ChildProcess is a surviving bash process from a Claude CLI tool call.

## Proposed Solutions

### Fix 1: Kill Entire Process Group on Stream Timeout

Instead of `execCommand.kill('SIGTERM')` which only signals the parent PID, send the signal to the **negative PID** (process group). This ensures all child processes (bash tool calls) are also terminated.

```javascript
// Before (only kills parent):
execCommand.kill('SIGTERM');

// After (kills entire process group):
try {
  process.kill(-execCommand.pid, 'SIGTERM');
} catch {
  execCommand.kill('SIGTERM'); // fallback
}
```

Also add SIGKILL to the process group in the 5-second follow-up:

```javascript
try {
  process.kill(-execCommand.pid, 'SIGKILL');
} catch {
  execCommand.kill('SIGKILL');
}
```

### Fix 2: Move `.gitkeep` Cleanup After Completion Signals

Reorder the operations in `solve.mjs` so that `.gitkeep` revert happens **after** `verifyResults()` and `startAutoRestartUntilMergeable()`:

```javascript
// Before:
await cleanupClaudeFile(tempDir, branchName, claudeCommitHash, argv); // line 1179
// ... verifyResults, auto-merge, etc ...

// After:
// ... verifyResults, auto-merge, etc ...
await cleanupClaudeFile(tempDir, branchName, claudeCommitHash, argv); // moved to end
```

### Fix 3: Report Surviving Child Processes as Errors (Not Kill Silently)

Instead of silently killing surviving child processes in `drainHandles()` (which hides root causes), report them as errors so each occurrence is investigated:

```javascript
for (const handle of process._getActiveHandles()) {
  if (handle?.constructor?.name === 'ChildProcess') {
    // Report as error — do NOT kill silently
    console.error(`ERROR: Surviving ChildProcess detected (pid=${handle.pid})`);
    handle.unref(); // Let Node exit, but leave OS process for diagnosis
  }
}
```

This ensures that any leaked processes are visible and the root cause is investigated each time, rather than masking bugs by silently terminating them.

## Files Involved

| File                        | Relevance                                                          |
| --------------------------- | ------------------------------------------------------------------ |
| `src/claude.lib.mjs`        | Stream timeout and force-kill logic (lines 857-881)                |
| `src/solve.mjs`             | Execution ordering after Claude exits (lines 1179-1413)            |
| `src/solve.results.lib.mjs` | `.gitkeep` revert and push logic (lines 238-372)                   |
| `src/exit-handler.lib.mjs`  | Handle draining that errors on surviving processes (lines 124-148) |

## Related Issues

- Issue #1280: Stream close timeout
- Issue #1346: SIGTERM → SIGKILL follow-up timing
- Issue #1431: Active handle draining
- Issue #1472: Activity timeout
- Issue #1510: Separate SIGTERM/SIGKILL phases
