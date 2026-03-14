# Case Study: Issue #1341 - /merge should wait for all GitHub Actions to finish

## Summary

The `/merge` command in the Telegram bot was merging PRs too quickly without waiting for GitHub Actions to complete between merges. This caused workflow runs to be cancelled and only one version to be published instead of multiple versions.

## Timeline of Events (2026-02-21)

The following timeline was reconstructed from GitHub API data:

| Time (UTC) | Event                    | Details                                                 |
| ---------- | ------------------------ | ------------------------------------------------------- |
| 18:29:23   | PR #1298 merged          | Merge commit: c9bfcb54                                  |
| 18:29:26   | Workflow started         | "Checks and release" for c9bfcb54 (Run ID: 22262020720) |
| 18:30:33   | PR #1303 merged          | Merge commit: ca79d10e - **70 seconds after PR #1298**  |
| 18:30:35   | New workflow started     | "Checks and release" for ca79d10e (Run ID: 22262039519) |
| 18:30:49   | First workflow cancelled | Run 22262020720 status: **cancelled**                   |

### Key Observation

PR #1303 was merged only **70 seconds** after PR #1298, but the "Checks and release" workflow typically takes **15-30 minutes** to complete. This caused:

1. PR #1298's workflow to be **cancelled** (superseded by the new commit)
2. Only one version to be published (from PR #1303)
3. PR #1298's changes were never released independently

## Root Cause Analysis

### Issue #1307 Implementation Gap

Issue #1307 added `waitForTargetBranchCI()` functionality, but it only waits **before the first merge**:

```javascript
// telegram-merge-queue.lib.mjs lines 237-240
if (MERGE_QUEUE_CONFIG.WAIT_FOR_TARGET_BRANCH_CI) {
  await this.waitForTargetBranchCI();
}
```

### Missing Post-Merge CI Wait

After each merge, the system only waits a short `POST_MERGE_WAIT_MS` delay (default: 60 seconds):

```javascript
// telegram-merge-queue.lib.mjs lines 259-261
if (item.status === MergeItemStatus.MERGED && this.currentIndex < this.items.length - 1) {
  this.log(`Waiting ${MERGE_QUEUE_CONFIG.POST_MERGE_WAIT_MS / 1000}s before next PR...`);
  await this.sleep(MERGE_QUEUE_CONFIG.POST_MERGE_WAIT_MS);
}
```

This 60-second wait is NOT enough for:

- CI workflows to start (GitHub may queue them)
- CI workflows to complete (typically 15-30+ minutes)
- Version releases to be published

### Workflow Cancellation Behavior

When a new commit is pushed to the default branch while a workflow is running:

1. GitHub may cancel the in-progress workflow (depends on workflow configuration)
2. A new workflow starts for the latest commit
3. The cancelled workflow's release step is never executed

## Impact

1. **Lost releases**: Only one version (1.24.6) was published instead of two
2. **Changelog confusion**: Changes from PR #1298 were bundled with PR #1303's release
3. **Traceability loss**: Cannot correlate releases to specific PRs

## Solution Architecture

### Required Changes

1. **Wait for post-merge CI between merges** (not just before first merge)
2. **Stop queue on CI failure** with clear error messages and links
3. **Detect pre-existing failures** before starting the queue

### Implementation Strategy

```
[Before First Merge]
    ↓
waitForTargetBranchCI() ← Already implemented (Issue #1307)
    ↓
[Merge PR #1]
    ↓
waitForPostMergeCI() ← NEW: Wait for workflow to complete
    ↓
If workflow failed → Stop queue, show error with link
    ↓
[Merge PR #2]
    ↓
waitForPostMergeCI() ← NEW: Wait for workflow to complete
    ↓
...
```

### New Functions Required

1. `waitForPostMergeCI(mergeCommitSha)` - Wait for workflow runs on specific commit
2. `checkBranchCIHealth()` - Check if default branch has any failed CI runs
3. Updated `processItem()` - Wait after each successful merge

### Configuration Options

| Option                                         | Default | Description                        |
| ---------------------------------------------- | ------- | ---------------------------------- |
| `HIVE_MIND_MERGE_QUEUE_WAIT_FOR_POST_MERGE_CI` | `true`  | Wait for CI after each merge       |
| `HIVE_MIND_MERGE_QUEUE_STOP_ON_CI_FAILURE`     | `true`  | Stop queue if CI fails             |
| `HIVE_MIND_MERGE_QUEUE_CHECK_BRANCH_HEALTH`    | `true`  | Check for failures before starting |

## Research: Existing Solutions

### GitHub Actions Marketplace

Several community actions exist for waiting on workflows:

1. **[Wait for Workflow Action](https://github.com/marketplace/actions/wait-for-workflow-action)** - Waits for specified workflow to complete
2. **[Wait on Check](https://github.com/marketplace/actions/wait-on-check)** - Polls for check results using Checks API
3. **[int128/wait-for-workflows-action](https://github.com/int128/wait-for-workflows-action)** - Uses GraphQL API

### GitHub REST API

The workflow runs API provides all necessary endpoints:

```bash
# Get workflow runs for a branch
GET /repos/{owner}/{repo}/actions/runs?branch={branch}&status={status}

# Status values: completed, in_progress, queued, requested, waiting, pending
# Conclusion values: success, failure, cancelled, timed_out, skipped, neutral
```

### Current Implementation

The codebase already has the necessary functions in `github-merge.lib.mjs`:

- `getActiveBranchRuns(owner, repo, branch)` - Get in_progress/queued runs
- `waitForBranchCI(owner, repo, branch, options)` - Wait for runs to complete
- `getWorkflowRunsForSha(owner, repo, sha)` - Get runs for specific commit

These can be extended to support post-merge waiting.

## Data Files

- `data/pr-1298.json` - PR #1298 metadata (merged at 18:29:23Z)
- `data/pr-1303.json` - PR #1303 metadata (merged at 18:30:33Z)
- `data/workflow-runs.json` - Recent workflow runs list
- `data/workflow-runs-detail.json` - Detailed workflow run info

## References

- [Issue #1341](https://github.com/link-assistant/hive-mind/issues/1341) - Original issue report
- [Issue #1307](https://github.com/link-assistant/hive-mind/issues/1307) - Previous fix for pre-merge CI waiting
- [GitHub Actions Workflow Runs API](https://docs.github.com/en/rest/actions/workflow-runs) - Official API documentation

## Related Issues

- Issue #1307: Wait for target branch CI before first merge
- Issue #1143: Original /merge command implementation

---

_Case study created: 2026-02-21_
