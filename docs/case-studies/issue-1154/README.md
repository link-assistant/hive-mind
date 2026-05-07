# Case Study: Duplicate `Solution Draft Log` GitHub Comments

**Issue:** [#1154](https://github.com/link-assistant/hive-mind/issues/1154)
**Date:** 2026-01-22
**Status:** Root Cause Identified

## Summary

The hive-mind `solve` tool was posting duplicate "Solution Draft Log" comments to GitHub Pull Requests. This happened when there were uncommitted changes at the end of a Claude session, triggering both the normal result verification and the auto-restart cleanup to each upload logs.

## Evidence

### Duplicate Comments

The issue was reported with two specific example comments on [PR #2](https://github.com/VisageDvachevsky/veil-windows-client/pull/2):

| Comment                                                                                               | Timestamp            | Gist ID                            | Log File                                          |
| ----------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------- | ------------------------------------------------- |
| [#3780602191](https://github.com/VisageDvachevsky/veil-windows-client/pull/2#issuecomment-3780602191) | 2026-01-21T18:50:03Z | `0a033b8a44a76ab1bca74c04cbc970db` | `solution-draft-log-pr-1769021399314.txt` (289KB) |
| [#3780603077](https://github.com/VisageDvachevsky/veil-windows-client/pull/2#issuecomment-3780603077) | 2026-01-21T18:50:11Z | `bfb8a3e30cafb30abaa832780acc7a3d` | `solution-draft-log-pr-1769021406768.txt` (294KB) |

Both comments were posted just **8 seconds apart** and contained the same cost information:

- Public pricing estimate: $1.483809 USD
- Calculated by Anthropic: $0.777115 USD

## Timeline Reconstruction

Based on analysis of the solution draft logs:

```
[2026-01-21T18:45:58.884Z] Session starts (solve v1.9.0)
[2026-01-21T18:46:15.068Z] Work session starts on PR #2
[2026-01-21T18:49:56.111Z] Claude command completed
[2026-01-21T18:49:56.789Z] Found uncommitted changes (build-test/)
[2026-01-21T18:49:56.792Z] AUTO-RESTART triggered
[2026-01-21T18:49:57.877Z] verifyResults() called
[2026-01-21T18:50:00.070Z] FIRST UPLOAD: "Uploading solution draft log to Pull Request..."
[2026-01-21T18:50:03.078Z] First gist created: 0a033b8a44a76ab1bca74c04cbc970db
[2026-01-21T18:50:04.208Z] First comment posted
[2026-01-21T18:50:04.768Z] PR MERGED detected, watch mode stops
[2026-01-21T18:50:05.276Z] SECOND UPLOAD: "Uploading working session logs to Pull Request..."
[2026-01-21T18:50:11Z] Second gist created: bfb8a3e30cafb30abaa832780acc7a3d
[2026-01-21T18:50:11Z] Second comment posted (duplicate!)
```

## Root Cause Analysis

### The Bug Location

The bug is in `src/solve.mjs` where log uploads happen in two different places during the same execution:

1. **First Upload (line ~1162):** `verifyResults()` is called which internally calls `attachLogToGitHub()` when `shouldAttachLogs` is true
   - This happens after Claude finishes but BEFORE checking if watch mode is needed

2. **Second Upload (lines 1249-1276):** After temporary watch mode completes, another `attachLogToGitHub()` call happens
   - This was intended for watch mode iterations, but it duplicates when the session ends quickly

### Code Flow

```javascript
// src/solve.mjs

// Step 1: verifyResults() uploads log (line 1162)
await verifyResults(owner, repo, branchName, issueNumber, prNumber, prUrl,
                    referenceTime, argv, shouldAttachLogs, shouldRestart, ...);

// Step 2: If uncommitted changes, enter temporary watch mode
if (temporaryWatchMode) {
    // ...watch mode runs...

    // Step 3: After watch mode, upload log AGAIN (lines 1249-1276)
    if (shouldAttachLogs && prNumber) {
        await log('📎 Uploading working session logs to Pull Request...');
        await attachLogToGitHub({ ... });  // DUPLICATE!
    }
}
```

### Why This Happened

The duplicate upload occurs when:

1. Claude session completes with uncommitted changes
2. `shouldRestart` is true (triggering temporary watch mode)
3. `shouldAttachLogs` is true (--attach-logs flag enabled)
4. The PR gets merged very quickly (within seconds)

In this scenario:

- `verifyResults()` uploads the log as part of normal completion
- Then temporary watch mode starts
- Watch mode detects the PR is already merged and exits immediately
- Post-watch-mode cleanup uploads the log again

## Proposed Solutions

### Solution 1: Track Log Upload State (Recommended)

Add a flag to track whether logs have already been uploaded to prevent duplicates:

```javascript
// Before verifyResults
let logsAlreadyUploaded = false;

// In verifyResults, set flag after upload
if (logUploadSuccess) {
    logsAlreadyUploaded = true;
}

// After watch mode, check flag before uploading
if (shouldAttachLogs && prNumber && !logsAlreadyUploaded) {
    await attachLogToGitHub({ ... });
}
```

### Solution 2: Use GitHub Comment Deduplication

Before posting a new comment, check if a "Solution Draft Log" comment already exists for this session/cost:

```javascript
// Check for existing log comment before posting
const existingComments = await getExistingLogComments(owner, repo, prNumber);
const isDuplicate = existingComments.some(c =>
    c.body.includes('Solution Draft Log') &&
    c.body.includes(sessionId)
);
if (!isDuplicate) {
    await attachLogToGitHub({ ... });
}
```

### Solution 3: Skip Post-Watch-Mode Upload When PR is Merged

The post-watch-mode log upload is unnecessary when the PR is already merged:

```javascript
// After watch mode
if (temporaryWatchMode) {
    // Check if PR was merged during watch
    const prMerged = await checkPRMerged(owner, repo, prNumber);

    // Only upload if PR is still open and logs weren't uploaded yet
    if (shouldAttachLogs && prNumber && !prMerged && !logsAlreadyUploaded) {
        await attachLogToGitHub({ ... });
    }
}
```

## Affected Versions

- `solve` version 1.9.0 and likely earlier versions with auto-restart feature
- The issue appears when:
  - `--attach-logs` flag is used
  - Claude session ends with uncommitted changes
  - PR is merged quickly (within seconds of session end)

## Related Files

- `src/solve.mjs` - Main solve script with duplicate upload calls
- `src/solve.results.lib.mjs` - Contains `verifyResults()` function
- `src/github.lib.mjs` - Contains `attachLogToGitHub()` function
- `src/solve.watch.lib.mjs` - Watch mode implementation

## Files in This Case Study

- `README.md` - This analysis document
- `pr2-comments-raw.json` - All comments from the affected PR
- `pr2-details.json` - PR metadata
- `duplicate-comment-1.json` - First duplicate comment details
- `duplicate-comment-2.json` - Second duplicate comment details
- `gist-1-log.txt` - First solution draft log (289KB)
- `gist-2-log.txt` - Second solution draft log (294KB)
