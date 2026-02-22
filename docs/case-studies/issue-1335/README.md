# Case Study: Issue #1335 — Auto-restart cycle stuck and lead to 20+ hours of solve process hang

## Summary

Two distinct bugs caused `solve` processes to run for 20–32 hours after their work was logically complete:

1. **Bug A — No `no_checks` timeout:** A solve process running with `--auto-restart-until-mergeable` got stuck in an infinite loop because the target repository had **no CI/CD checks configured**. The `watchUntilMergeable` loop in `solve.auto-merge.lib.mjs` treats `no_checks` identically to a transient race-condition state and waits 60 seconds before re-checking — forever.

2. **Bug B — No `process.exit()` after session ends:** A separate solve process successfully completed all work (PR became mergeable at 2026-02-18T05:33:54Z) but the Node.js process did not exit. It continued running for **~28 hours** until manually killed with Ctrl+C. Root cause: `solve.mjs` never calls `process.exit()` after normal completion, and Sentry's profiling integration (`@sentry/profiling-node`) keeps the event loop alive indefinitely.

## Timeline of Events

| Time (UTC)             | Event                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| 2026-02-17 23:13:11    | solve started: `solve https://github.com/MILANA808/milana_site/pull/18 --auto-restart-until-mergeable` |
| 23:13 – 23:28          | Claude AI session ran (PR #18 on MILANA808/milana_site — a simple HTML site with no CI)                |
| 23:28:25               | Claude session ended, `watchUntilMergeable` loop started                                               |
| 23:28:28               | **First `no_checks` hit**: "CI/CD checks have not started yet"                                         |
| 23:28 – 09:27 next day | Loop ran **1,920 iterations**, one per minute, never exiting                                           |
| 2026-02-19 09:27:18    | Process manually killed with Ctrl+C                                                                    |

Total hang duration: **~10 hours** (the log captured only a portion; based on check count, the real total was ~32 hours of polling if not interrupted).

## Root Cause Analysis

### Primary Root Cause (Bug A): No distinction between transient and permanent `no_checks` state

**File:** `src/solve.auto-merge.lib.mjs`, function `watchUntilMergeable`

The `getMergeBlockers()` function calls `getDetailedCIStatus()`, which returns `{ status: 'no_checks' }` when a repository's PR has **zero** check runs or commit statuses. This is a valid permanent condition for repos without any CI pipelines.

The code maps `no_checks` to a `ci_pending` blocker:

```js
if (ciStatus.status === 'no_checks') {
  blockers.push({
    type: 'ci_pending',
    message: 'CI/CD checks have not started yet (waiting for checks to appear)',
    details: [],
  });
}
```

Later in `watchUntilMergeable`, a `ci_pending` blocker is handled by:

- NOT setting `shouldRestart = true`
- Logging "Waiting for CI..."
- Sleeping 60 seconds
- Looping again

There is **no break condition** for the `ci_pending` / `no_checks` state. The loop is `while (true)`.

The code was designed to handle a **transient** race condition (the brief window between a git push and GitHub starting CI runners), but a repo with **no CI at all** also returns `no_checks` — permanently. The code made no distinction.

### Contributing Factor (Bug A): The target repository genuinely had no CI

`MILANA808/milana_site` is a simple HTML portfolio site with no `.github/workflows/` directory. It will never have CI checks. Any PR to this repository will always return `no_checks`.

### Contributing Factor (Agent tool): Same issue applies to `watchForFeedback` in `solve.watch.lib.mjs`

The `watchForFeedback` function (used for `--watch` mode and temporary auto-restart) also has an unbounded loop, but its primary exit conditions (PR merged, max iterations reached, all changes committed) work differently. However, the `--watch` mode version also has no exit condition for the case where CI never appears.

## Evidence from Log

```
[2026-02-17T23:28:25.476Z] [INFO] 🔄 AUTO-RESTART-UNTIL-MERGEABLE MODE ACTIVE
[2026-02-17T23:28:26.360Z] [INFO] 🔍 Check #1:      11:28:25 PM
[2026-02-17T23:28:28.927Z] [INFO]   ⏳ Waiting for CI: CI/CD checks have not started yet
[2026-02-17T23:28:28.928Z] [INFO]   ⏱️ Next check in: 60 seconds...
...
[2026-02-19T09:27:12.070Z] [INFO] 🔍 Check #1920:   9:27:08 AM
[2026-02-19T09:27:12.069Z] [INFO]   ⏳ Waiting for CI: CI/CD checks have not started yet
[2026-02-19T09:27:18.744Z] [ERROR] ❌ Interrupted (CTRL+C)
```

**1,920 checks** × 60 seconds = **32 hours** of pointless polling before manual interruption.

## Comparison: `--tool claude` vs `--tool agent`

The issue title asks to ensure logic is in sync for both `--tool claude` and `--tool agent`. Both tools use the same `watchUntilMergeable` function (from `solve.auto-merge.lib.mjs`) and the same `watchForFeedback` function (from `solve.watch.lib.mjs`). The `executeToolIteration` function in `solve.restart-shared.lib.mjs` dispatches to the correct tool implementation. The stuck CI loop bug affects **both tools identically**.

## Solution for Bug A: Workflow Existence Check

After receiving reviewer feedback that a timeout is the wrong approach, the fix was revised to address the root cause directly:

**Check if the repository has any CI workflows configured.** When `no_checks` state is detected, call `hasRepoWorkflows(owner, repo)` via `gh api repos/{owner}/{repo}/actions/workflows --jq '.total_count'`. If the count is zero, the `no_checks` state is **permanent** — there is no CI to wait for. If the count is > 0, the `no_checks` state is a **transient race condition** and we keep waiting.

**Implementation (`src/solve.auto-merge.lib.mjs`):**

- Add `hasRepoWorkflows()` function to `github-merge.lib.mjs`
- In `watchUntilMergeable`, cache the result of `hasRepoWorkflows()` (checked once per `no_checks` detection)
- If no workflows: log "No CI workflows configured", post a PR comment, exit as "mergeable (no CI)"
- If workflows exist: keep waiting (this is a race condition)

This is semantically correct: if no CI is configured, there is nothing to wait for.

## Bug B: Process Not Exiting After Session Ends

### Timeline

| Time (UTC)           | Event                                                                                |
| -------------------- | ------------------------------------------------------------------------------------ |
| 2026-02-18T05:33:53Z | `watchUntilMergeable` detected PR IS MERGEABLE                                       |
| 2026-02-18T05:33:53Z | Loop exited, `watchUntilMergeable` returned `{ success: true, reason: 'mergeable' }` |
| 2026-02-18T05:33:54Z | `endWorkSession` completed, PR marked "Already ready for review"                     |
| 2026-02-18T05:33:54Z | `finally` block: temp dir kept (`--no-auto-cleanup`), log path printed               |
| 2026-02-18T05:33:54Z | **Process should have exited here but did not**                                      |
| 2026-02-19T09:55:49Z | Manually killed with Ctrl+C (~28 hours later)                                        |

### Root Cause

**File:** `src/solve.mjs`, `finally` block (previously line 1491)

The `finally` block in `solve.mjs` does NOT call `process.exit()` after successful completion:

```js
} finally {
  await cleanupTempDirectory(tempDir, argv, limitReached);
  if (getLogFile()) {
    await log(`\n📁 Complete log file: ${absoluteLogPath}`);
  }
  // ← No process.exit() here!
}
```

In Node.js, when the main entry-point script finishes executing, the process only exits if the **event loop is empty** — i.e., there are no pending timers, network connections, or other async handles. Sentry's profiling integration (`@sentry/profiling-node`) registers a background sampling interval that keeps the event loop alive indefinitely.

All the error-path `safeExit(1, ...)` calls worked fine because they explicitly call `process.exit(1)`. But the normal success path had no such call.

### Fix

Added a call to `safeExit(0, 'Process completed')` at the end of the `finally` block (Issue #1335):

```js
} finally {
  await cleanupTempDirectory(tempDir, argv, limitReached);
  if (getLogFile()) {
    await log(`\n📁 Complete log file: ${absoluteLogPath}`);
  }
  // Issue #1335: Force process exit to prevent indefinite hang.
  await safeExit(0, 'Process completed');
}
```

`safeExit` flushes Sentry events (up to 2 seconds) then calls `process.exit(0)`, guaranteeing the process terminates even if async handles are still open.

### Evidence from Log

```
[2026-02-18T05:33:53.504Z] [INFO] ✅ PR IS MERGEABLE!
[2026-02-18T05:33:53.505Z] [INFO]    PR is ready to be merged manually
[2026-02-18T05:33:53.505Z] [INFO]    Exiting auto-restart-until-mergeable mode
[2026-02-18T05:33:54.399Z] [INFO]
[2026-02-18T05:33:54.399Z] [INFO] 📊 Updated session data from auto-restart-until-mergeable mode:
[2026-02-18T05:33:54.400Z] [INFO]    Session ID: 270d9483-fa03-4b2f-88ee-43b3abb3983e
[2026-02-18T05:33:54.400Z] [INFO]    Anthropic cost: $1.501226
[2026-02-18T05:33:54.400Z] [INFO]
🏁 Ending work session:      2026-02-18T05:33:54.400Z
[2026-02-18T05:33:54.401Z] [INFO]   ℹ️ Skipping:               End comment (logs already attached)
[2026-02-18T05:33:54.723Z] [INFO]   ✅ PR status:              Already ready for review
[2026-02-18T05:33:54.724Z] [INFO]
📁 Keeping directory (--no-auto-cleanup): /tmp/gh-issue-solver-1771385851893
[2026-02-18T05:33:54.725Z] [INFO]
📁 Complete log file: /home/hive/fa80c06c-d8a2-41bc-9dfd-e7fc95f1ae52.log
                          ← process hung here for ~28 hours ←
[2026-02-19T09:55:49.194Z] [INFO]
[2026-02-19T09:55:49.197Z] [ERROR] ❌ Interrupted (CTRL+C)
```

### Log Reference (Bug B)

- Gist URL: https://gist.githubusercontent.com/konard/64853b4e68d51fdd8bb5239afdc0249b/raw/257528bd56cf97dbc2738923e20df2dc0617a2ab/fa80c06c-d8a2-41bc-9dfd-e7fc95f1ae52.log

---

## Related Issues

- Issue #1314: Billing limit CI handling (cancelled checks)
- Issue #1269: Callback timeout to prevent infinite blocking in `waitForCI`
- Issue #1124: Playwright MCP artifacts triggering auto-restart
- Issue #1190: Auto-restart-until-mergeable implementation

## Files Involved

- `src/solve.auto-merge.lib.mjs` — `watchUntilMergeable`, `getMergeBlockers` (Bug A fix: workflow existence check)
- `src/github-merge.lib.mjs` — new `hasRepoWorkflows()` function added for Bug A fix
- `src/solve.mjs` — `finally` block (Bug B fix: `safeExit` + active handles debug logging)
- `src/exit-handler.lib.mjs` — `safeExit` function used for forced exit
- `src/solve.watch.lib.mjs` — `watchForFeedback`
- `src/github-merge.lib.mjs` — `getDetailedCIStatus`, `waitForCI`
- `src/solve.restart-shared.lib.mjs` — shared tool dispatch

## Log References

- Bug A full log: `./full-log.txt` (18,374 lines)
- Bug A gist: https://gist.githubusercontent.com/konard/26d45c8e8aece11df677043e4c41229e/raw/8b818ebde8874f26774210ea3355f3c9527522dc/2478274b-499c-49bd-90d4-8d5d55a84b12.log
- Bug B gist: https://gist.githubusercontent.com/konard/64853b4e68d51fdd8bb5239afdc0249b/raw/257528bd56cf97dbc2738923e20df2dc0617a2ab/fa80c06c-d8a2-41bc-9dfd-e7fc95f1ae52.log
