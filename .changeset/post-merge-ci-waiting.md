---
'@link-assistant/hive-mind': minor
---

feat: wait for post-merge CI to complete before merging next PR (Issue #1341)

This change ensures that the /merge command waits for GitHub Actions to complete after each merge before processing the next PR in the queue.

**Problem:**

- Merge queue was merging PRs too quickly (70 seconds apart)
- Workflow runs were being cancelled (superseded by new commits)
- Only one version published instead of multiple

**Solution:**

1. Check branch CI health before starting the queue
2. Wait for post-merge CI after each successful merge
3. Stop queue on CI failure (configurable)

**New configuration options:**

- `HIVE_MIND_MERGE_QUEUE_WAIT_FOR_POST_MERGE_CI` (default: true)
- `HIVE_MIND_MERGE_QUEUE_STOP_ON_CI_FAILURE` (default: true)
- `HIVE_MIND_MERGE_QUEUE_CHECK_BRANCH_HEALTH` (default: true)
- `HIVE_MIND_MERGE_QUEUE_POST_MERGE_CI_TIMEOUT_MS` (default: 60 minutes)
- `HIVE_MIND_MERGE_QUEUE_POST_MERGE_CI_POLL_INTERVAL_MS` (default: 30 seconds)

**New API functions:**

- `waitForCommitCI()` - Wait for workflow runs on a commit
- `checkBranchCIHealth()` - Check for failed CI on a branch
- `getMergeCommitSha()` - Get merge commit SHA for a PR
