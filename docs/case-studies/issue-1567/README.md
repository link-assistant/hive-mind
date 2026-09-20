# Case Study: Issue #1567 — Non-consistent auto-restart logic on comments

## Overview

This case study analyzes six interrelated bugs in the hive-mind auto-restart and auto-restart-until-mergeable logic, observed across multiple pull requests in the `Jhon-Crow/godot-topdown-MVP` repository.

## Affected Pull Requests

| PR                                                                | Comments | Key Issues Observed                                                    |
| ----------------------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| [#1796](https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1796) | 62       | Iteration jumps (1→4), duplicate "Ready to merge", concurrent sessions |
| [#1720](https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1720) | 31       | ~27min gap between session end and "Ready to merge"                    |
| [#1661](https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1661) | 23       | "Ready to merge" posted before "Solution log", ~70min gap              |
| [#1609](https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1609) | 51       | General restart issues                                                 |
| [#1739](https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1739) | 16       | ~1h47m gap between session end and "Ready to merge"                    |

## Requirements from Issue

1. **CI/CD completion window**: Reduce from 5 minutes minimum to 2 minutes minimum, apply to both CI/CD finished and no-CI cases, start checking not earlier than 2 minutes after working session finish
2. **Consistent iteration numbering**: Count only visible iterations (actual restarts), no jumps; numbering relative to single solve command run
3. **No concurrent sessions on same PR/issue**: Guarantee at all levels
4. **Fix long intervals between session finish and next action**: 20-25min, ~1hr, ~2hr gaps observed
5. **"Ready to merge" must not come before "Solution log"**: Race condition in posting order
6. **No duplicate "Ready to merge" comments**: Find and fix root cause

## Root Cause Analysis

### Issue 1: CI/CD completion window too long (5 minutes)

**Root cause**: `MIN_CI_CHECK_INTERVAL_SECONDS = 300` (5 minutes) in `solve.auto-merge.lib.mjs:515`.

This was introduced in Issue #1503 to conserve GitHub API rate limits. However, it creates unnecessarily long wait times. The user requests reducing to 2 minutes minimum. Additionally, this minimum should apply from when the working session finishes (not from an arbitrary point), and should apply uniformly whether CI/CD is configured or not.

**File**: `src/solve.auto-merge.lib.mjs:515`

### Issue 2: Iteration number jumps

**Root cause**: **Two concurrent `watchUntilMergeable` processes running on the same PR** (PR #1796). Each process maintains its own independent `restartCount` counter. When comments from both processes interleave chronologically, iteration numbers appear to jump (e.g., Stream A posts iteration 1, Stream B posts iteration 1, Stream A posts iteration 4 — appears as 1→1→4 in the comment thread).

The iteration numbering logic itself (`restartCount` in `solve.auto-merge.lib.mjs:528`) is correct per-process. The real fix is preventing concurrent sessions (Issue 3).

**Evidence**: PR #1796 timeline shows two distinct streams:

- Stream A: iterations 1-10 (started 18:42:40)
- Stream B: iterations 1-7 (started 19:28:29)

**File**: `src/solve.auto-merge.lib.mjs:528`, but the root cause is concurrency (Issue 3)

### Issue 3: Concurrent sessions on same PR

**Root cause**: No PR-level or issue-level locking mechanism exists. The system has:

- Queue-level concurrency via `telegram-solve-queue.lib.mjs` (tool-specific `dequeue-one-at-a-time`)
- Per-repository merge concurrency check in `telegram-merge-command.lib.mjs`
- But **no per-PR session deduplication**

When a user triggers a solve command while another session is already running on the same PR (e.g., via `/solve` command while `--auto-restart-until-mergeable` is active), two processes run simultaneously.

**Files**: `src/telegram-solve-queue.lib.mjs`, `src/solve.auto-merge.lib.mjs`, `src/session-monitor.lib.mjs`

### Issue 4: Long intervals between session finish and next action

**Root cause**: `MIN_CI_CHECK_INTERVAL_SECONDS = 300` (5 minutes) in `solve.auto-merge.lib.mjs:515` combined with the `DOUBLE_CHECK_DELAY_MS = 10000` (10 seconds) consensus check at line 660.

The ~27min gap in PR #1720 is expected CI pipeline execution time. The ~1h47m gap in PR #1739 is the 5-minute check interval compounded over many iterations while waiting for CI to complete — the system checks every 5 minutes, and if CI takes 20 minutes, the "Ready to merge" can only appear at the next 5-minute boundary after CI completes.

Reducing to 2-minute intervals will significantly reduce these gaps.

### Issue 5: "Ready to merge" before "Solution log"

**Root cause**: In `solve.mjs`, the flow is:

1. Line 1218: `verifyResults()` runs — this posts the "Solution Draft Log" via `attachLogToGitHub()`
2. Line 1410: `startAutoRestartUntilMergeable()` runs — this can post "Ready to merge" on its first check

However, in `verifyResults()` at `solve.results.lib.mjs:716`, the log upload is async and may take time (uploading large log content). Meanwhile, `startAutoRestartUntilMergeable()` starts its first check cycle immediately and can reach the "PR IS MERGEABLE" branch (line 703) and post "Ready to merge" before the log upload completes.

But actually, looking at the code more carefully: `verifyResults` is awaited before `startAutoRestartUntilMergeable`. The actual issue is that the solution log in `verifyResults` may fail silently or the initial solution working session doesn't post a log at all (e.g., when `shouldAttachLogs` is true but `shouldRestart` is also true, the log upload is deferred to after watch mode at line 1370). If the temporary watch mode runs and finishes quickly, the deferred log upload (line 1373) happens _after_ auto-restart-until-mergeable starts at line 1410... No — the code is sequential. Line 1373 is inside `if (temporaryWatchMode)` which completes before line 1410.

Re-examining: The actual race is when the system is in `--auto-restart-until-mergeable` mode (not first run). In `watchUntilMergeable()`, after `executeToolIteration()` succeeds (line 1115), the log is attached (line 1147), and then the loop continues to check blockers. On the NEXT iteration, if `blockers.length === 0`, it posts "Ready to merge" (line 742). But the log upload at line 1147 and the "Ready to merge" at line 742 are in the same process — the issue is that the log upload might still be in-flight when the next iteration starts... No, it's awaited.

The most likely explanation is concurrent sessions (Issue 3 again). Two processes: Process A is uploading the solution log, Process B has already finished checking and posts "Ready to merge" 22 seconds before Process A finishes its log upload.

**File**: `src/solve.mjs:1218-1410`, `src/solve.auto-merge.lib.mjs:739-744`

### Issue 6: Duplicate "Ready to merge" comments

**Root cause**: Same as Issue 3 — two concurrent `watchUntilMergeable` processes, each with its own `readyToMergeCommentPosted = false` flag. Each independently determines the PR is mergeable and posts its own "Ready to merge" comment.

The in-memory flag (`readyToMergeCommentPosted`) at `solve.auto-merge.lib.mjs:535` only prevents duplicates within a single process. It cannot prevent duplicates across concurrent processes.

**Evidence**: PR #1796 shows two "Ready to merge" comments posted 63 seconds apart (22:03:57 and 22:05:00).

**File**: `src/solve.auto-merge.lib.mjs:535, 739-744`

## Solution Plan

### Fix 1: Reduce CI check interval to 2 minutes

- Change `MIN_CI_CHECK_INTERVAL_SECONDS` from 300 to 120 in `solve.auto-merge.lib.mjs:515`

### Fix 2: Prevent concurrent sessions on the same PR/issue

- Add a PR-level session lock using a lock file or in-memory registry
- Before starting `watchUntilMergeable()` or `watchForFeedback()`, check if another session is already active for the same PR
- Implement in `telegram-solve-queue.lib.mjs` to reject/queue commands for PRs that already have active sessions
- Also add a guard at the `solve.auto-merge.lib.mjs` level using `checkForExistingComment()` to detect if another process recently posted

### Fix 3: Ensure "Ready to merge" never comes before "Solution log"

- In `solve.auto-merge.lib.mjs`, before posting "Ready to merge", check if a solution log exists for the current commit SHA
- Alternatively, ensure the initial working session's log is always uploaded before entering auto-restart-until-mergeable mode

### Fix 4: Use `checkForExistingComment()` as cross-process duplicate guard for "Ready to merge"

- Re-enable the `checkForExistingComment()` check for "Ready to merge" as a cross-process guard
- Keep the in-memory flag for intra-process deduplication
- Only suppress if the existing comment was posted for the CURRENT commit SHA

## Data Files

- `ci-logs/pr-1796-issue-comments.json` — 62 comments from PR #1796
- `ci-logs/pr-1720-issue-comments.json` — 31 comments from PR #1720
- `ci-logs/pr-1661-issue-comments.json` — 23 comments from PR #1661
- `ci-logs/pr-1609-issue-comments.json` — 51 comments from PR #1609
- `ci-logs/pr-1739-issue-comments.json` — 16 comments from PR #1739
- `ci-logs/pr-*-details.json` — PR metadata
