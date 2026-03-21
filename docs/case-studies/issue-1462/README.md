# Case Study: Issue #1462 - PR Creation Fail, Error Messaging Unclear

## Problem Statement

When hive-mind attempted to solve an issue on `netkeep80/BinDiffSynchronizer#190`, the `gh pr create` command appeared to succeed (returned a URL), but the subsequent PR verification found that the PR did not actually exist on GitHub. This triggered **three separate error messages** with overlapping information, and the log file was **not uploaded to the issue** despite `--attach-logs` being enabled.

## Timeline of Events

| Timestamp           | Event                                                               |
| ------------------- | ------------------------------------------------------------------- |
| 2026-03-21 22:34:09 | solve.mjs v1.35.1 started for `netkeep80/BinDiffSynchronizer#190`   |
| 2026-03-21 22:34:15 | Fork mode enabled (no write access to target repo)                  |
| 2026-03-21 22:34:19 | Fork `konard/netkeep80-BinDiffSynchronizer` confirmed               |
| 2026-03-21 22:34:25 | Branch `issue-190-82d805435bf7` created, .gitkeep committed         |
| 2026-03-21 22:34:26 | Branch pushed to fork successfully                                  |
| 2026-03-21 22:34:28 | GitHub compare API confirmed 1 commit ahead                         |
| 2026-03-21 22:34:30 | `gh pr create --draft` executed (cross-repo fork PR)                |
| 2026-03-21 22:34:31 | `gh pr create` returned (no stderr captured in logs)                |
| 2026-03-21 22:34:32 | **PR verification FAILED**: PR does not exist on GitHub             |
| 2026-03-21 22:34:32 | **ERROR 1**: "FATAL ERROR: PR creation failed" (verification)       |
| 2026-03-21 22:34:32 | **ERROR 2**: "PR CREATION FAILED" (catch in prCreateError handler)  |
| 2026-03-21 22:34:32 | **ERROR 3**: "FATAL ERROR: PR creation failed" (outer catch)        |
| 2026-03-21 22:34:32 | `handleErrorWithIssueCreation` called but skipped (non-interactive) |
| 2026-03-21 22:34:32 | Log NOT uploaded to issue (no `global.createdPR` available)         |
| 2026-03-21 22:34:32 | "Could not determine GitHub user" warning                           |

## Root Cause Analysis

### Root Cause 1: Missing `gh pr create` stderr/stdout capture in verification failure path

The `gh pr create` command at line 1161 of `solve.auto-pr.lib.mjs` returned output that was parsed as a URL. However, the actual error or stderr from `gh pr create` was **not logged** when the subsequent verification failed. The log shows:

```
Command: cd "/tmp/gh-issue-solver-1774132458229" && gh pr create --draft --title "..." --body-file "..." --base main --head konard:issue-190-82d805435bf7 --repo netkeep80/BinDiffSynchronizer
```

But there is no log of what `gh pr create` actually returned (stdout/stderr). The verification step found the PR didn't exist, but we don't know WHY `gh pr create` silently failed.

**Likely scenario**: GitHub accepted the `gh pr create` command and returned a URL, but the PR was rejected server-side (possibly due to fork PR restrictions, repository settings, or a transient GitHub API issue). The `gh pr create` CLI tool may have returned exit code 0 but the PR was not persisted.

### Root Cause 2: Triple error message cascade

The error propagation chain creates 3 error messages:

1. **Line 1218**: Verification failure throws `Error('PR creation failed - PR does not exist on GitHub')` after logging a "FATAL ERROR" block
2. **Line 1370**: The `prCreateError` catch handler catches this, logs "PR CREATION FAILED" block, and re-throws `Error('PR creation failed')`
3. **Line 1448**: The outer `prError` catch handler catches this, logs another "FATAL ERROR" block, and re-throws `Error('PR creation failed: PR creation failed')`

Each handler adds its own multi-line error block with troubleshooting steps, resulting in ~60 lines of error output that obscure the actual problem.

### Root Cause 3: Log not uploaded to issue when PR creation fails

In `solve.error-handlers.lib.mjs`, `handleFailure()` (line 43) only uploads logs when:

```javascript
if (shouldAttachLogs && getLogFile() && global.createdPR && global.createdPR.number)
```

When PR creation fails, `global.createdPR` is never set, so the condition is false. The issue number IS known (stored in `issueNumber` variable in solve.mjs) but is not stored in `global` and not passed to the error handler for fallback log upload.

### Root Cause 4: "Could not determine GitHub user" in error reporter

The `github-issue-creator.lib.mjs` uses `gh api user --jq .login` to get the current user. The user's token (`gho_****` - OAuth token) may have limited API scopes. Even though `gh auth status` shows the user as `konard`, the API call to `/user` endpoint can fail with certain token types. Additionally, the process was non-interactive (`!process.stdin.isTTY`), so issue creation would have been skipped anyway, but the "Could not determine GitHub user" warning added confusion.

## Impact

1. User sees 3 error blocks (~60 lines) instead of one clear message
2. Log is NOT uploaded to the issue despite `--attach-logs` being enabled
3. No comment is posted to the issue about the failure
4. The actual root cause (why `gh pr create` silently failed) is not captured in logs

## Solutions Implemented

### Fix 1: Consolidate triple error into single clear message

- In the PR verification failure path (line 1215-1232), throw the error without the verbose "FATAL ERROR" block since the outer catch already provides context
- In the `prCreateError` catch handler (line 1370), add the `gh pr create` stderr to the error context
- In the outer `prError` catch handler (line 1448), provide a single consolidated error message

### Fix 2: Upload logs to issue as fallback when PR is not available

- Store `issueNumber` in `global.issueNumber` in solve.mjs so error handlers can access it
- In `handleFailure()`, when `global.createdPR` is not available but `global.issueNumber` is, upload logs to the issue instead
- This ensures `--attach-logs` works even when PR creation fails

### Fix 3: Log `gh pr create` stdout and stderr for debugging

- Capture and log the full output of `gh pr create` in verbose mode
- When verification fails, include the `gh pr create` output in the error message

### Fix 4: Improve "Could not determine GitHub user" handling

- In non-interactive mode, skip the `gh api user` call entirely since issue creation will be skipped
- Use `gh auth status` as fallback for user detection

## Files Changed

- `src/solve.auto-pr.lib.mjs` - Consolidated error messages, added gh pr create output logging
- `src/solve.error-handlers.lib.mjs` - Added fallback log upload to issue when PR unavailable
- `src/solve.mjs` - Store issueNumber in global for error handler access

## References

- Original log: [full-log.txt](./full-log.txt)
- Gist with original log: https://gist.github.com/konard/21160a90d4e9903404b040bf96297bce
- Failed repository: `netkeep80/BinDiffSynchronizer#190`
