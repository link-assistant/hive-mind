# Case Study: Issue #1571 - Comment Ordering Between Limit Reached and Auto Resume

## Issue Summary

When the usage limit is reached with `--auto-resume-on-limit-reset` enabled, the "Solution Draft Log" and "Ready to merge" comments are posted between the "Usage Limit Reached" and "Auto Resume" comments, creating a confusing comment sequence for users.

**Issue URL:** https://github.com/link-assistant/hive-mind/issues/1571
**Related PR:** https://github.com/link-assistant/hive-mind/pull/1568

## Timeline of Events (PR #1568)

### Normal working session (22:39 - 22:51 UTC)

| #   | Time (UTC) | Comment              | Process   |
| --- | ---------- | -------------------- | --------- |
| 1   | 22:39:56   | Solution Draft Log   | Session 1 |
| 2   | 22:40:03   | Auto-restart 1/3     | Session 1 |
| 3   | 22:51:25   | Auto-restart 1/3 Log | Session 1 |
| 4   | 22:51:48   | Ready to merge       | Session 1 |

### User feedback and new session (23:10 - 23:37 UTC)

| #   | Time (UTC) | Comment                 | Process   |
| --- | ---------- | ----------------------- | --------- |
| 5   | 23:10:19   | User feedback           | User      |
| 6   | 23:36:44   | AI Work Session Started | Session 2 |
| 7   | 23:37:01   | Usage Limit Reached     | Session 2 |

### Problematic comment ordering (00:11 UTC)

| #   | Time (UTC) | Comment                      | Process            | Expected?                          |
| --- | ---------- | ---------------------------- | ------------------ | ---------------------------------- |
| 8   | 00:11:09   | Solution Draft Log           | Session 2 (parent) | NO - should not appear here        |
| 9   | 00:11:31   | Ready to merge               | Session 2 (parent) | NO - should not appear here        |
| 10  | 00:11:31   | Auto Resume (on limit reset) | Session 3 (child)  | YES - but should be BEFORE 8 and 9 |

### Resumed session (00:15 - 00:17 UTC)

| #   | Time (UTC) | Comment                  | Process   |
| --- | ---------- | ------------------------ | --------- |
| 11  | 00:15:45   | Verification Complete    | Session 3 |
| 12  | 00:16:06   | Draft log of auto resume | Session 3 |
| 13  | 00:16:14   | Auto-restart 1/3         | Session 3 |
| 14  | 00:16:38   | Auto-restart 1/3 Log     | Session 3 |
| 15  | 00:17:02   | Ready to merge           | Session 3 |

### Expected comment ordering (after fix)

| #   | Comment                      | Process            |
| --- | ---------------------------- | ------------------ |
| 7   | Usage Limit Reached          | Session 2 (parent) |
| 10  | Auto Resume (on limit reset) | Session 3 (child)  |
| 11  | ... work happens ...         | Session 3          |
| 12  | Solution Draft Log           | Session 3          |
| 15  | Ready to merge               | Session 3          |

## Root Cause Analysis

### The Bug

When `--auto-resume-on-limit-reset` is enabled and the usage limit is reached, the execution flow in `solve.mjs` is:

1. **Limit handling** (lines ~894-1078): Posts "Usage Limit Reached" comment with execution log
2. **`showSessionSummary()`** (line 1180): Calls `autoContinueWhenLimitResets()` which:
   - Sleeps until the limit resets (~34 minutes in this case)
   - Spawns a child process (`node solve.mjs ... --resume ...`)
   - **BUG: Returns immediately** after spawn without awaiting child exit
3. **`verifyResults()`** (line 1218): Posts "Solution Draft Log" comment
4. **`startAutoRestartUntilMergeable()`** (line 1411): Posts "Ready to merge" comment

Steps 3-4 execute in the **parent process** after `autoContinueWhenLimitResets()` returns, racing with the child process that posts "Auto Resume". Since steps 3-4 start immediately while the child process needs time to initialize and post its comment, the parent's comments appear first.

### Root Cause in Code

In `src/solve.auto-continue.lib.mjs`, the `autoContinueWhenLimitResets()` function:

```javascript
// Execute the resume command
const child = childProcess.spawn('node', resumeArgs, { ... });

child.on('close', code => {
  process.exit(code);
});
// Function returns here - parent continues executing!
```

The `child.on('close', ...)` registers a callback but doesn't block. The function returns to `showSessionSummary()`, which returns to `solve.mjs`, which continues to `verifyResults()` and `startAutoRestartUntilMergeable()`.

## Solution

### Fix 1: Await child process exit (Primary fix)

In `src/solve.auto-continue.lib.mjs`, wrap the child.on('close') in a Promise and await it:

```javascript
// Issue #1571: Await child process exit to prevent parent from continuing
await new Promise(resolve => {
  child.on('close', code => {
    process.exit(code);
    resolve(); // Won't be reached due to process.exit, but included for completeness
  });
});
```

This ensures `autoContinueWhenLimitResets()` never returns to the caller. The parent process blocks until the child exits, at which point `process.exit()` terminates the parent.

### Fix 2: Defense-in-depth guard (Secondary fix)

In `src/solve.mjs`, add a guard after `showSessionSummary()` to skip post-processing:

```javascript
// Issue #1571: When limit was reached and auto-continue is enabled, skip post-processing
if (limitReached && (argv.autoResumeOnLimitReset || argv.autoRestartOnLimitReset) && global.limitResetTime) {
  await log('Auto-continue was invoked for limit reset - skipping post-processing');
  await safeExit(0, 'Auto-continue child process will handle post-processing');
}
```

This ensures that even if `autoContinueWhenLimitResets()` somehow returns, the parent won't post confusing comments.

## Files Changed

| File                                               | Change                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `src/solve.auto-continue.lib.mjs`                  | Await child process exit in `autoContinueWhenLimitResets()`        |
| `src/solve.mjs`                                    | Defense-in-depth guard to skip post-processing after auto-continue |
| `tests/test-auto-resume-comment-ordering-1571.mjs` | 11 unit tests for the fix                                          |
| `docs/case-studies/issue-1571/`                    | Case study documentation                                           |

## Test Coverage

11 unit tests covering:

- Defense-in-depth guard logic (6 tests: various flag combinations)
- Comment ordering validation (4 tests: correct order, buggy order detection)
- Await behavior verification (1 test: child exit blocking)

## Related Issues and Components

- **Issue #1054**: Original auto-resume-on-limit-reset implementation
- **Issue #1152**: Auto-continue improvements (buffer time, session type)
- **Issue #1567**: Concurrent session deduplication
- **Issue #1584**: Ready-to-merge comment deduplication

## Lessons Learned

1. **Async child process spawn**: Always await child process exit when the parent should not continue after spawning. A `child.on('close', ...)` callback alone does not block the async function.
2. **Defense-in-depth**: When process lifecycle depends on `process.exit()` being called in a callback, add explicit guards in the caller to handle the case where control flow continues unexpectedly.
3. **Comment ordering UX**: Users read PR comments as a timeline. Out-of-order comments (especially "Ready to merge" before work starts) create confusion about the actual state of the PR.
