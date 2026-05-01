# Case Study: Issue #1425 - /merge should only check last CI/CD of default branch

## Summary

The `/merge` command incorrectly reported "CI failed" and blocked the merge queue when in reality the latest CI run was still **in progress** on a newer commit. The `checkBranchCIHealth` function only queried _completed_ runs, causing it to misidentify the most recent _completed_ (but outdated) failing run as the "latest" CI status — when a newer, passing-or-running CI run already existed.

## Screenshots / Evidence

- [`data/issue-1425-merge-response.png`](data/issue-1425-merge-response.png) — The `/merge` command response showing the false failure
- [`data/issue-1425-ci-state.png`](data/issue-1425-ci-state.png) — GitHub commits page showing the actual CI state

## Timeline of Events (2026-03-13)

The following timeline was reconstructed from GitHub API data and the screenshots:

| Time (UTC) | Event                                        | Commit    | CI Status                               |
| ---------- | -------------------------------------------- | --------- | --------------------------------------- |
| ~07:35:02  | PR #1420 merged                              | `14fdb8b` | ✅ success (completed)                  |
| ~07:43:09  | PR #1414 merged                              | `bf59d39` | ❌ failure (completed)                  |
| ~07:48:54  | PR #1384 merged                              | `31a4668` | 🔄 **in_progress**                      |
| ~07:49:XX  | User ran `/merge`                            | —         | —                                       |
| ~07:49:XX  | `checkBranchCIHealth` queried completed runs | —         | Returns `bf59d39` (failure) as "latest" |
| ~07:49:XX  | Merge queue blocked                          | —         | False positive: "CI failed on main"     |
| ~07:54:13  | Version `1.31.0` bump committed              | `2db358a` | (auto-release by CI of `31a4668`)       |

### Key Observation

When the user ran `/merge` at ~07:49 UTC:

- **Latest commit** on `main` was `31a4668` (PR #1384 merge) with CI run **in_progress**
- **Previous commit** `bf59d39` (PR #1414 merge) had CI run with **failure** conclusion
- The `checkBranchCIHealth` function queried only `status=completed` runs
- The API returned runs sorted by `created_at` descending — so the _most recently completed_ run was `bf59d39` (failure)
- `31a4668`'s run was in_progress and therefore **NOT in the completed results**
- The function treated `bf59d39`'s failure as the "latest" status and blocked the queue

The result in the Telegram message was:

> ❌ **Merge Queue Failed**
> Error: Cannot start merge queue: 1 CI run(s) failed on main: Checks and release. Please fix the CI failures first.

But the CI was actually running successfully on the latest commit.

## Root Cause Analysis

### The Buggy `checkBranchCIHealth` Function

Located in `src/github-merge-ci.lib.mjs` (lines 153–201):

```javascript
export async function checkBranchCIHealth(owner, repo, branch = 'main', options = {}, verbose = false) {
  const { lookbackCount = 5 } = options;

  try {
    // BUG: queries only status=completed runs!
    const { stdout } = await exec(`gh api "repos/${owner}/${repo}/actions/runs?branch=${branch}&status=completed&per_page=${lookbackCount}" ...`);
    const runs = JSON.parse(stdout.trim() || '[]');

    if (runs.length === 0) {
      return { healthy: true, failedRuns: [], error: null };
    }

    // Gets the SHA of the most recently *completed* run
    const latestSha = runs[0].head_sha;
    const latestRuns = runs.filter(r => r.head_sha === latestSha);
    const failedRuns = latestRuns.filter(r => r.conclusion === 'failure' || r.conclusion === 'timed_out');
    ...
  }
}
```

**The bug**: By filtering for `status=completed`, the function ignores any in-progress runs. The "latest SHA" it finds is the SHA of the most recently _completed_ run — not necessarily the most recent commit on the branch.

### Correct Behavior

The function should:

1. First, get the **actual latest commit SHA** on the default branch (from git HEAD or the API)
2. Then check the CI runs specifically for that SHA
3. If those runs are **in_progress**, wait for them to complete (or report "pending" instead of "failure")
4. Only report failure if the **latest commit's** runs have actually failed

### The Confusion Between "Latest Completed Run" and "Latest Commit's Run"

When multiple PRs are merged in quick succession:

```
Commit timeline (newest first):
  31a4668  [PR #1384 merge]  → CI: in_progress  ← NEWEST COMMIT
  bf59d39  [PR #1414 merge]  → CI: failure       ← MOST RECENT *COMPLETED* RUN
  14fdb8b  [PR #1420 merge]  → CI: success
```

`checkBranchCIHealth` queries `?branch=main&status=completed` and gets `bf59d39` as the "latest" because `31a4668`'s run hasn't completed yet. This is the fundamental confusion.

## Impact

1. **False positive failure**: The merge queue is blocked even though the branch is not actually broken
2. **Developer frustration**: User sees a failure message without any real failure to fix
3. **Queue never processes**: All PRs in the queue (PR #843, PR #1424 in the screenshot) are left unmerged
4. **Incorrect guidance**: Message says "Please fix the CI failures first" when there's nothing to fix

## Proposed Solutions

### Solution 1: Query the Latest Commit SHA First (Recommended)

**Approach**: Get the current HEAD commit SHA of the default branch, then check CI runs _specifically for that SHA_ (regardless of their status).

```javascript
export async function checkBranchCIHealth(owner, repo, branch = 'main', options = {}, verbose = false) {
  // Step 1: Get the actual latest commit on the branch
  const { stdout: headShaOut } = await exec(`gh api repos/${owner}/${repo}/git/ref/heads/${branch} --jq '.object.sha'`);
  const headSha = headShaOut.trim();

  // Step 2: Get all CI runs for that specific SHA (any status)
  const { stdout } = await exec(`gh api "repos/${owner}/${repo}/actions/runs?head_sha=${headSha}&per_page=20" --jq '[.workflow_runs[] | {id, name, status, conclusion, head_sha}]'`);
  const runs = JSON.parse(stdout.trim() || '[]');

  if (runs.length === 0) {
    // No runs yet for the latest commit — assume healthy (CI hasn't started or isn't configured)
    return { healthy: true, failedRuns: [], error: null };
  }

  // Step 3: Check if any runs are still in progress
  const inProgressRuns = runs.filter(r => r.status === 'in_progress' || r.status === 'queued' || r.status === 'waiting');
  if (inProgressRuns.length > 0) {
    // CI is running — not failed, just not done yet. Report as healthy (or "pending")
    // The merge queue should wait, not fail
    return { healthy: true, pending: true, pendingRuns: inProgressRuns, failedRuns: [], error: null };
  }

  // Step 4: All runs completed — check for failures
  const failedRuns = runs.filter(r => r.conclusion === 'failure' || r.conclusion === 'timed_out');
  ...
}
```

**Pros**: Correctly identifies the actual latest commit's CI state. Simple and direct.
**Cons**: Adds an extra API call for the HEAD SHA lookup.

### Solution 2: Filter Runs by "Is This the Latest Commit?"

**Approach**: Fetch both completed AND in-progress runs, then determine which SHA is actually the latest commit.

```javascript
// Get ALL runs (no status filter) to find the true latest
const { stdout } = await exec(`gh api "repos/${owner}/${repo}/actions/runs?branch=${branch}&per_page=10" ...`);
const allRuns = JSON.parse(stdout.trim() || '[]');

// Sort by created_at to find the most recent SHA
const latestSha = allRuns[0]?.head_sha;  // Newest run's SHA (may be in_progress)
const latestRuns = allRuns.filter(r => r.head_sha === latestSha);
const inProgressRuns = latestRuns.filter(r => r.status !== 'completed');
if (inProgressRuns.length > 0) {
  // Latest commit's CI is still running - not a failure
  return { healthy: true, pending: true, ... };
}
```

**Pros**: No extra API call needed.
**Cons**: If the very latest run happens to be for an older commit (race condition), it could still be wrong. Less explicit than Solution 1.

### Solution 3: Wait for In-Progress Runs Before Checking

**Approach**: If in-progress runs are detected on the latest commit, wait for them to complete before reporting health status. This combines with `waitForTargetBranchCI()` logic.

**Pros**: Fully correct behavior — never reports failure on an incomplete run.
**Cons**: Could significantly delay the merge queue start. May not be desirable if the user just wants a quick health check.

## Existing Components and Libraries

### GitHub Actions Runs API

The key GitHub API endpoint is:

```
GET /repos/{owner}/{repo}/actions/runs
```

Query parameters:

- `branch`: Filter by branch name
- `head_sha`: Filter by commit SHA (most precise)
- `status`: Filter by status (`completed`, `in_progress`, `queued`, etc.) — **avoid this when you need the true latest state**
- `per_page`: Number of results

Reference: https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-repository

### Existing `getWorkflowRunsForSha` Function

The codebase already has a function that correctly queries by SHA (without status filter):

```javascript
// src/github-merge.lib.mjs:1217
export async function getWorkflowRunsForSha(owner, repo, sha, verbose = false) {
  const { stdout } = await exec(`gh api "repos/${owner}/${repo}/actions/runs?head_sha=${sha}&per_page=20" ...`);
  ...
}
```

This function is already used in `waitForCommitCI` (post-merge CI monitoring). **The fix should use a similar approach** — first resolve the HEAD SHA, then use `getWorkflowRunsForSha` to query its CI status.

### Existing `waitForBranchCI` Function

The `waitForBranchCI` function (already used for `WAIT_FOR_TARGET_BRANCH_CI`) correctly waits for in-progress runs. However, `checkBranchCIHealth` is supposed to be a **pre-flight check** (fast, not waiting), not a wait loop. The two use cases are different.

## Recommended Implementation

The fix should modify `checkBranchCIHealth` in `src/github-merge-ci.lib.mjs` to:

1. **Resolve the actual HEAD SHA** of the default branch first
2. **Query CI runs by HEAD SHA** (not by `status=completed`)
3. **Return `pending` when runs are in progress** instead of treating older failed runs as current
4. **Distinguish 3 states**: `healthy` (latest CI passed), `pending` (latest CI running), `failed` (latest CI failed)

The caller in `telegram-merge-queue.lib.mjs`'s `checkBranchCIHealthBeforeStart()` should then:

- On `pending`: Transition to waiting for branch CI (similar to `waitForTargetBranchCI`) rather than failing immediately
- On `failed`: Block the queue as before

## Related Issues and Prior Art

- **Issue #1341**: Added post-merge CI waiting — introduced `checkBranchCIHealth` as a pre-flight check
- **Issue #1307**: Added `waitForTargetBranchCI` — waits for in-progress CI before merging
- **Issue #1363**: Fixed false-positive "no CI" detection by checking for existing workflows

The pattern of "get HEAD SHA first, then check runs for that SHA" is already used in `waitForCommitCI` for post-merge CI monitoring. This issue applies the same principle to the pre-flight branch health check.

## Data Files

- [`data/ci-runs.json`](data/ci-runs.json) — Recent CI runs on `main` branch at time of analysis
- [`data/commits.json`](data/commits.json) — Recent commits on `main` branch at time of analysis
- [`data/issue-1425-merge-response.png`](data/issue-1425-merge-response.png) — Screenshot: `/merge` false failure
- [`data/issue-1425-ci-state.png`](data/issue-1425-ci-state.png) — Screenshot: GitHub commits page showing actual CI state
