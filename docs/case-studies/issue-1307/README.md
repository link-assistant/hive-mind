# Case Study: Issue #1307 - Merge Queue Didn't Wait for GitHub Actions

## Issue Summary

The `/merge` command in the Hive-Mind Telegram bot merged PR #1237 without waiting for the previous CI run (triggered by PR #1306) to complete. This resulted in:

1. A failed CI run on main (run 22040174585 failed due to `check-file-line-limits`)
2. Cancelled jobs in the previous CI run (run 22039917719 - Docker arm64 build, Docker Publish Merge, Helm Release)

## Timeline Reconstruction

### Context

| Time (UTC) | Event                      | Details                                                               |
| ---------- | -------------------------- | --------------------------------------------------------------------- |
| 17:25:21   | PR #1306 merged            | "Fix --auto-restart-until-mergable false positive on empty CI checks" |
| 17:25:25   | CI Run 22039917719 started | Triggered by PR #1306 merge (push event to main)                      |

### Previous CI Run (22039917719) - PR #1306

| Time (UTC)   | Job                              | Status        | Duration |
| ------------ | -------------------------------- | ------------- | -------- |
| 17:25:37     | detect-changes                   | success       | 12s      |
| 17:25:48     | check-file-line-limits           | success       | 23s      |
| 17:25:51     | test-compilation                 | success       | 26s      |
| 17:25:51     | validate-docs                    | success       | 26s      |
| 17:26:19     | lint                             | success       | 54s      |
| 17:26:46     | memory-check-linux               | success       | 1m21s    |
| 17:28:32     | test-execution                   | success       | 3m7s     |
| 17:30:36     | test-suites                      | success       | 5m11s    |
| 17:31:31     | Release                          | success       | 6m6s     |
| 17:33:14     | Docker Publish (linux/amd64)     | success       | 7m49s    |
| **17:43:01** | **Docker Publish (linux/arm64)** | **CANCELLED** | -        |
| **17:43:01** | **Docker Publish (Merge)**       | **CANCELLED** | -        |
| **17:43:01** | **Helm Release**                 | **CANCELLED** | -        |

### Merge Queue Event

| Time (UTC)   | Event                                                    |
| ------------ | -------------------------------------------------------- |
| **17:42:51** | PR #1237 merged by merge queue                           |
| 17:42:54     | CI Run 22040174585 started (triggered by PR #1237 merge) |

### Post-Merge CI Run (22040174585) - PR #1237

| Time (UTC)   | Job                        | Status      |
| ------------ | -------------------------- | ----------- |
| 17:43:12     | detect-changes             | success     |
| **17:43:24** | **check-file-line-limits** | **FAILURE** |
| 17:43:26     | validate-docs              | success     |
| 17:43:31     | test-compilation           | success     |
| 17:43:56     | lint                       | success     |

## Visual Timeline

```
Time (UTC)  |  Run 22039917719 (PR #1306)          |  Run 22040174585 (PR #1237)
------------|--------------------------------------|--------------------------------
17:25:21    |  PR #1306 merged                     |
17:25:25    |  CI Run started                      |
   ...      |  Jobs running...                     |
17:30:36    |  test-suites completed               |
17:31:31    |  Release completed                   |
17:33:14    |  Docker amd64 completed              |
            |  Docker arm64 still building...      |
17:42:51    |                                      |  PR #1237 MERGED (queue!)
17:42:54    |                                      |  CI Run started
17:43:01    |  arm64 CANCELLED!                    |
            |  Docker Merge CANCELLED!             |
            |  Helm Release CANCELLED!             |
17:43:24    |                                      |  check-file-line-limits FAILED
```

## Root Cause Analysis

### The Problem

The merge queue implementation in `src/telegram-merge-queue.lib.mjs` checks CI status using `checkPRCIStatus()` from `src/github-merge.lib.mjs`. This function checks CI status **for a specific PR branch**, not for the **default branch (main)**.

When processing the merge queue:

1. The queue fetches PRs with the "ready" label
2. For each PR, it checks if the PR's own CI checks have passed
3. If they have, it merges the PR

**The critical oversight**: The code doesn't check if there are **any ongoing CI runs on the main branch** that should complete before merging.

### Code Path Analysis

In `telegram-merge-queue.lib.mjs:processItem()`:

```javascript
// Step 2: Check CI status
const ciStatus = await checkPRCIStatus(this.owner, this.repo, item.pr.number, this.verbose);
```

This only checks `item.pr.number` (the PR being merged), not the main branch's current CI status.

### Why This Matters

When a PR is merged to main:

1. GitHub Actions workflows are triggered (push event)
2. These workflows may include critical post-merge operations:
   - Release publishing (npm, Docker, Helm)
   - Deployments
   - Notifications

If the next PR is merged before these complete:

- Workflows may be cancelled (GitHub's concurrency groups)
- Release pipelines may fail or produce incomplete releases
- The repository state may become inconsistent

## Impact

In this specific case:

1. **Cancelled Docker arm64 build** - Users expecting multi-arch support didn't get it
2. **Cancelled Helm release** - Kubernetes users didn't get the latest chart
3. **Failed CI on main** - The `check-file-line-limits` check failed because the merged code (from PR #1237) had line limit violations

## Proposed Solutions

### Solution 1: Wait for Main Branch CI Before First Merge

**Description**: Before processing the first PR in the queue, check if there are any active CI runs on the main branch and wait for them to complete.

**Implementation**:

```javascript
async function waitForMainBranchCI(owner, repo, verbose = false) {
  // Get recent runs on main branch
  const { stdout } = await exec(`gh api repos/${owner}/${repo}/actions/runs?branch=main&status=in_progress --jq '.workflow_runs[0]'`);

  if (!stdout.trim()) {
    return { hasActiveRuns: false };
  }

  const run = JSON.parse(stdout);
  // Use gh run watch to wait for completion
  await exec(`gh run watch ${run.id} --repo ${owner}/${repo} --exit-status`);

  return { hasActiveRuns: true, completedRunId: run.id };
}
```

**Pros**:

- Simple to implement
- Uses existing `gh` CLI commands
- No additional dependencies

**Cons**:

- Adds latency to merge queue processing
- `gh run watch` may have issues in some environments (see [cli/cli#8194](https://github.com/cli/cli/issues/8194))

### Solution 2: Check All Active Runs Before Each Merge

**Description**: Before each individual merge, verify no runs are active on main.

**Implementation**:

```javascript
async function checkNoActiveRunsOnMain(owner, repo, verbose = false) {
  const { stdout } = await exec(`gh api repos/${owner}/${repo}/actions/runs --jq '[.workflow_runs[] | select(.head_branch=="main" and .status=="in_progress")] | length'`);

  const activeCount = parseInt(stdout.trim(), 10);
  return activeCount === 0;
}
```

**Pros**:

- More granular control
- Faster for single-PR queues

**Cons**:

- More API calls
- Doesn't actively wait, just checks

### Solution 3: Use GitHub's Native Merge Queue

**Description**: Migrate to [GitHub's native merge queue feature](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue).

**Pros**:

- Built into GitHub, no custom code needed
- Handles concurrent merge requests automatically
- Integrates with branch protection rules

**Cons**:

- Requires GitHub Enterprise or public repos on github.com
- Less customization than custom solution
- Different UX (native GitHub vs Telegram commands)

### Solution 4: Implement Wait-on-Check Pattern

**Description**: Use a polling approach similar to [lewagon/wait-on-check-action](https://github.com/marketplace/actions/wait-on-check).

**Implementation**:

```javascript
async function waitForAllMainBranchRuns(owner, repo, options = {}) {
  const { timeout = 30 * 60 * 1000, pollInterval = 30 * 1000 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const { stdout } = await exec(`gh api repos/${owner}/${repo}/actions/runs?branch=main&per_page=5 --jq '[.workflow_runs[] | select(.status=="in_progress" or .status=="queued")] | length'`);

    const activeCount = parseInt(stdout.trim(), 10);
    if (activeCount === 0) {
      return { success: true };
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return { success: false, error: 'Timeout waiting for main branch CI' };
}
```

**Pros**:

- Reliable polling mechanism
- Configurable timeout and interval
- Follows established pattern

**Cons**:

- Additional API calls
- Adds processing time

## Recommended Solution

**Solution 1 + Solution 4 hybrid**:

1. Before processing the merge queue, call `waitForAllMainBranchRuns()` to ensure no active runs
2. Update the `MergeQueueProcessor.run()` method to add this check before the first merge
3. Make this configurable via environment variable `HIVE_MIND_MERGE_QUEUE_WAIT_FOR_MAIN_CI`

### Configuration Additions

```javascript
// In config.lib.mjs
mergeQueue: {
  // Existing config...
  waitForMainBranchCI: parseBool(process.env.HIVE_MIND_MERGE_QUEUE_WAIT_FOR_MAIN_CI, true),
  mainBranchCITimeout: parseInt(process.env.HIVE_MIND_MERGE_QUEUE_MAIN_CI_TIMEOUT_MS, 10) || 45 * 60 * 1000, // 45 min
  mainBranchCIPollInterval: parseInt(process.env.HIVE_MIND_MERGE_QUEUE_MAIN_CI_POLL_INTERVAL_MS, 10) || 30 * 1000, // 30s
}
```

## Related Issues and Research

### Similar Issues in This Repository

- [Issue #1304](https://github.com/link-assistant/hive-mind/issues/1304): Empty CI checks causing false positive "Ready to merge" (fixed in PR #1306)

### External Research

1. [GitHub Docs: Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
2. [GitHub CLI: gh run watch](https://cli.github.com/manual/gh_run_watch)
3. [Wait on Check Action](https://github.com/marketplace/actions/wait-on-check)
4. [cli/cli#8194: gh run watch timeout issues](https://github.com/cli/cli/issues/8194)
5. [GitHub Community: Run workflow only when previous run completed](https://github.com/orgs/community/discussions/55027)

### Key Insights from Research

1. **GitHub's native merge queue** only checks pre-merge status, not post-merge CI
2. **`gh run watch`** can wait for a specific run, but has known issues in CI environments
3. **The Checks API** (`/repos/{owner}/{repo}/commits/{ref}/check-runs`) is the standard way to check status
4. **Workflow runs API** (`/repos/{owner}/{repo}/actions/runs`) provides branch filtering

## Implementation (Solution Applied)

The fix has been implemented following the **Solution 1 + Solution 4 hybrid** approach:

### Code Changes

| File                               | Changes                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `src/config.lib.mjs`               | Added 3 new configuration options for target branch CI waiting           |
| `src/github-merge.lib.mjs`         | Added `getActiveBranchRuns()`, `waitForBranchCI()`, `getDefaultBranch()` |
| `src/telegram-merge-queue.lib.mjs` | Added `waitForTargetBranchCI()` method and progress message updates      |
| `tests/test-merge-queue.mjs`       | Added 8 tests for Issue #1307 functionality                              |
| `docs/case-studies/issue-1307/`    | Case study documentation and data files                                  |

### New Configuration Options

| Environment Variable                               | Default | Description                                 |
| -------------------------------------------------- | ------- | ------------------------------------------- |
| `HIVE_MIND_MERGE_QUEUE_WAIT_FOR_TARGET_CI`         | `true`  | Enable/disable waiting for target branch CI |
| `HIVE_MIND_MERGE_QUEUE_TARGET_CI_TIMEOUT_MS`       | 2700000 | Timeout for waiting (45 minutes)            |
| `HIVE_MIND_MERGE_QUEUE_TARGET_CI_POLL_INTERVAL_MS` | 30000   | Polling interval (30 seconds)               |

### How It Works

1. Before processing the first PR in the merge queue, `waitForTargetBranchCI()` is called
2. It fetches the repository's default branch (usually `main` or `master`)
3. It queries the GitHub API for any `in_progress` or `queued` workflow runs on that branch
4. If active runs exist, it polls at the configured interval until they complete or timeout
5. Progress is reported to Telegram so users can see the waiting status
6. After all runs complete (or timeout), normal merge queue processing begins

### Data Files

| File                                                | Purpose                    |
| --------------------------------------------------- | -------------------------- |
| `docs/case-studies/issue-1307/README.md`            | This case study document   |
| `docs/case-studies/issue-1307/run-22039917719.json` | Previous CI run details    |
| `docs/case-studies/issue-1307/run-22040174585.json` | Post-merge CI run details  |
| `docs/case-studies/issue-1307/run-22040174585.log`  | Post-merge CI run logs     |
| `docs/case-studies/issue-1307/pr-1237-details.json` | Merged PR details          |
| `docs/case-studies/issue-1307/pr-1306-details.json` | Previous merged PR details |

## Verification

All 51 tests pass, including 8 new tests for Issue #1307:

```
📋 Issue #1307: Target Branch CI Waiting Configuration Tests

✅ MERGE_QUEUE_CONFIG has target branch CI waiting fields
✅ MERGE_QUEUE_CONFIG.WAIT_FOR_TARGET_BRANCH_CI defaults to true
✅ MERGE_QUEUE_CONFIG.TARGET_BRANCH_CI_TIMEOUT_MS has reasonable value
✅ MERGE_QUEUE_CONFIG.TARGET_BRANCH_CI_POLL_INTERVAL_MS has reasonable value
✅ MergeQueueProcessor has waitForTargetBranchCI method
✅ MergeQueueProcessor initializes with waitingForTargetBranchCI state
✅ Issue #1307: Document the race condition problem and solution
✅ Issue #1307: Timeline reconstruction
```

## Conclusion

The root cause was that the merge queue only checked the **PR's CI status**, not whether there were **active CI runs on the target branch (main)**. This critical oversight led to cancelled workflows, incomplete releases, and failed post-merge checks.

The fix implements a waiting mechanism that:

1. Polls for active runs on the target branch before processing the merge queue
2. Uses configurable timeout and polling interval
3. Reports waiting status in Telegram messages
4. Gracefully handles timeouts by proceeding with merge (with a warning logged)
