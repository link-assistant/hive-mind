# Case Study: Issue #1008 - Log Attachment Failure When PR is Merged During Session

## Summary

This case study documents a bug where log files are not attached to pull requests when the PR is merged during the AI solving session.

## Timeline of Events

### Issue #88 in ideav/orbits (Failed Case)

| Time (UTC) | Event |
|------------|-------|
| 15:39:04 | Solve.mjs started with `--attach-logs` flag |
| 15:39:31 | PR #89 created (draft) |
| 15:39:43 | Claude execution started |
| 15:46:11 | **PR #89 merged** by repository owner |
| 15:46:34 | Claude execution completed |
| 15:46:37 | `verifyResults()` started searching for PRs |
| 15:46:38 | **FAILURE**: `gh pr list --head issue-88-a46bad708fee` returned empty array |
| 15:46:38 | Process completed WITHOUT attaching logs |

### Issue #123 in andchir/install_scripts (Working Case)

| Time (UTC) | Event |
|------------|-------|
| 15:38:10 | Solve.mjs started with `--attach-logs` flag |
| 15:38:36 | PR #124 created (draft) |
| 15:38:43 | Claude execution started |
| 15:44:09 | Claude execution completed |
| 15:44:12 | `verifyResults()` found PR #124 (still OPEN) |
| 15:44:13 | **SUCCESS**: Log uploaded to PR as comment |
| 15:45:13 | PR #124 merged by repository owner (AFTER log was attached) |

## Root Cause Analysis

The issue is in the `verifyResults()` function in `src/solve.results.lib.mjs` at line 420:

```javascript
const allBranchPrsResult = await $`gh pr list --repo ${owner}/${repo} --head ${branchName} --json number,url,createdAt,headRefName,title,state,updatedAt,isDraft`;
```

The `gh pr list` command by default only returns **OPEN** pull requests. When a PR is merged during the AI session:

1. The AI agent calls `gh pr merge` as part of the solution
2. The PR state changes from `OPEN` to `MERGED`
3. When `verifyResults()` runs after Claude completes, the PR is already merged
4. `gh pr list` without `--state all` doesn't find the PR
5. The log attachment code is skipped

### Verification

```bash
# Without --state all (returns empty for merged PRs)
$ gh pr list --repo ideav/orbits --head issue-88-a46bad708fee
[]

# With --state all (finds merged PR)
$ gh pr list --repo ideav/orbits --head issue-88-a46bad708fee --state all
[{"number":89,"state":"MERGED",...}]
```

## Evidence

### Full Logs

- **Failed case (PR 89)**: [Gist 85795acdc31baa81d511729dae8657ed](https://gist.github.com/konard/85795acdc31baa81d511729dae8657ed)
- **Working case (PR 124)**: [Gist 32a931d9bf7528f0f71bab43b91d5d47](https://gist.github.com/konard/32a931d9bf7528f0f71bab43b91d5d47)

### Key Log Lines (Failed Case)

From gist line 7126:
```
[2025-12-27T15:46:38.179Z] [INFO]   ℹ️  No pull requests found from branch issue-88-a46bad708fee
```

### Key Log Lines (Working Case)

From gist ending:
```
[2025-12-27T15:44:12.850Z] [INFO]   ✅ Found pull request #124: "Исправить ошибку PHP-FPM при неограниченной памяти (-1)"
```

## Proposed Solution

Add `--state all` to the `gh pr list` command in `verifyResults()` to find PRs regardless of their state (OPEN, MERGED, or CLOSED):

```javascript
// Before (only finds OPEN PRs)
const allBranchPrsResult = await $`gh pr list --repo ${owner}/${repo} --head ${branchName} --json ...`;

// After (finds ALL PRs including MERGED and CLOSED)
const allBranchPrsResult = await $`gh pr list --repo ${owner}/${repo} --head ${branchName} --state all --json ...`;
```

## Impact

This bug affects all cases where:
1. The `--attach-logs` flag is enabled
2. The PR is merged during the AI solving session (before `verifyResults()` runs)
3. The AI agent itself calls `gh pr merge` or the repository owner merges quickly

The log files contain valuable debugging information, and failing to attach them can make it harder to understand what the AI agent did.

## Related Issues

- Issue URL: https://github.com/link-assistant/hive-mind/issues/1008
- PR URL: https://github.com/link-assistant/hive-mind/pull/1009

## Files Modified

- `src/solve.results.lib.mjs` - Added `--state all` to PR list command
