# Case Study: Issue #1572 — `error: failed to push some refs`

## Summary

Two bugs were identified from a failed solve run on `Jhon-Crow/godot-topdown-MVP#1742`:

1. **Push failure during `.gitkeep` cleanup** — the revert commit could not be pushed because the local branch was behind the remote
2. **Log completeness gaps** — some push commands lack `2>&1` redirection, making error details unavailable to the code for proper handling; also multi-line log messages lose timestamps on continuation lines

## Timeline of Events

| Time (UTC) | Event | Session |
|---|---|---|
| 18:07:06 | Solve process starts for issue #1742 | — |
| 18:07:32 | `.gitkeep` committed (`ff077c8b`) and pushed to `issue-1742-d13525cf93f4` | Session 1 (`27647682`) |
| 18:07:39 | PR #1791 created | Session 1 |
| 18:07:55 | Claude Session 1 starts (model: claude-sonnet-4-6) | Session 1 |
| 18:12:59 | AI pushes commits (ff077c8b..b1b75c11) — **success** | Session 1 |
| 18:13:41 | Session 1 completes, cost $1.28, 94K tokens | Session 1 |
| 18:13:51 | Auto-restart-until-mergeable mode begins monitoring PR #1791 | �� |
| 18:25:18 | Owner (Jhon-Crow) posts feedback comment on PR | — |
| 18:26:01 | "AI Work Session Started" comment posted, PR converted to draft | — |
| 18:29:50 | **RESTART TRIGGERED** — new comment detected from Jhon-Crow | — |
| 18:29:54 | Claude Session 2 starts — **same working directory, NO `git pull`** | Session 2 (`990c6d46`) |
| 18:37:19 | AI tries `git push` in Session 2 — **FAILS with "fetch first"** | Session 2 |
| 18:38:15 | Session 2 ends with exit code 1 | Session 2 |
| 18:38:22 | `.gitkeep` revert committed locally (1d008e66) | Cleanup |
| 18:38:22 | `.gitkeep` revert push — **FAILS with "non-fast-forward"** | Cleanup |
| 18:38:22 | Process ends | — |

## Root Cause Analysis

### Issue 1: Push failure during `.gitkeep` cleanup

**Root cause:** The `auto-restart-until-mergeable` mode in `solve.auto-merge.lib.mjs` does NOT perform `git pull` or `git fetch` before launching a restarted AI session. When a restart is triggered (line 954), it calls `executeToolIteration()` (line 982) which directly launches a new Claude session in the same working directory.

**Chain of events:**

1. Session 1 pushed commits to `b1b75c11` at 18:12:59
2. Between sessions, the auto-restart loop only checks PR state via GitHub API — no local git operations
3. Session 2 starts at 18:29:54 in the same `tempDir` with a stale local state
4. The restart prompt tells the AI to "Ensure to get latest version of default branch" but this relies on the AI executing `git pull` — which is unreliable and a design flaw
5. Session 2 makes local commits but can't push because remote has diverged
6. After Session 2 fails, the cleanup tries to push the `.gitkeep` revert — also fails because local is still behind remote

**Code locations:**
- `src/solve.auto-merge.lib.mjs:954-993` — restart trigger handler, no `git pull/fetch`
- `src/solve.restart-shared.lib.mjs:174-290` — `executeToolIteration()`, no `git pull/fetch`
- `src/solve.results.lib.mjs:324` — cleanup push that fails

**Fix:** Add `git pull --rebase origin <branchName>` before launching the restarted AI session in the auto-merge restart flow. Also add it to the cleanup function before pushing the revert, as a defense-in-depth measure.

### Issue 2: Log completeness — missing `2>&1` on push commands

**Root cause:** Several `git push` commands in the codebase lack `2>&1` redirection. While the stdio interceptor (`setupStdioLogInterceptor()` in `src/lib.mjs:186-228`) captures all terminal output including stderr in the log file, the absence of `2>&1` means `pushResult.stderr` is empty/undefined in the JavaScript code. This prevents proper error handling and logging of push failure reasons.

**Affected locations (missing `2>&1`):**
- `src/solve.mjs:576` — initial push
- `src/solve.mjs:1346` — uncommitted changes push  
- `src/claude.lib.mjs:1452` — Claude post-push
- `src/codex.lib.mjs:495` — Codex post-push
- `src/opencode.lib.mjs:549` — OpenCode post-push
- `src/agent.lib.mjs:1085` — Agent post-push

**Already correct (have `2>&1`):**
- `src/solve.auto-pr.lib.mjs:384` — initial PR push
- `src/solve.results.lib.mjs:304,324,370,406` — cleanup pushes

**Fix:** Add `2>&1` to all `git push` commands that lack it, ensuring stderr is captured in the command result for proper error handling.

### Issue 2b: Log formatting — multi-line messages lose timestamps

**Root cause:** The `log()` function in `src/lib.mjs:77-121` prepends a timestamp only at the beginning of the message. When messages contain embedded `\n` (e.g., `\n📁 Keeping directory...`), the continuation lines appear in the log file without timestamps, breaking log parsing.

**Example:**
```
[2026-04-10T18:38:22.993Z] [INFO] 
📁 Keeping directory (--no-auto-cleanup): /tmp/gh-issue-solver-1775844437743
```

**Fix:** The `log()` function should handle multi-line messages by prepending timestamps to each line, or callers should avoid embedding `\n` in messages.

## Proposed Solutions

### Solution 1: Add `git pull` before restart sessions

In `src/solve.auto-merge.lib.mjs`, before calling `executeToolIteration()` after a restart trigger, add:

```javascript
// Sync local branch with remote before restart
await $({ cwd: tempDir })`git pull --rebase origin ${branchName} 2>&1`;
```

### Solution 2: Add `git pull` in cleanup before push

In `src/solve.results.lib.mjs`, before each `git push` in the cleanup function, add a `git pull --rebase` as defense-in-depth.

### Solution 3: Add `2>&1` to all `git push` commands

Ensure all `git push` template literals include `2>&1` for consistent stderr capture.

### Solution 4: Fix multi-line log formatting

Update `log()` in `src/lib.mjs` to split messages on `\n` and prefix each line with the timestamp.

## Related Resources

- Full process log: `docs/case-studies/issue-1572/full-process-log.txt` (31,768 lines)
- Solution draft log: `docs/case-studies/issue-1572/solution-draft-log-public.txt` (31,643 lines)
- Public gist: https://gist.github.com/konard/6a971df0d762ee96625179ede3216688
- Private gist: https://gist.github.com/konard/a1a4193a4cd449bc1816981b73e98dcf
