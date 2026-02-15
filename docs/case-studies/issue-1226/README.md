# Case Study: Pull Requests with `--auto-merge` Option Didn't Result in Actual Merge

**Issue:** [#1226](https://github.com/link-assistant/hive-mind/issues/1226)
**Date:** 2026-02-06
**Status:** Root cause identified, fix proposed

## Executive Summary

Two pull requests created by hive-mind with the `--auto-merge` flag did not result in automatic merging. Both PRs had to be merged manually by repository maintainers. The root cause is a **fundamental permissions gap**: the `--auto-merge` feature attempts to run `gh pr merge` against upstream repositories where the hive-mind solver only has **read (pull) access** via fork mode. The `gh pr merge` command requires **write (push) access** to the target repository, which fork contributors do not have.

Additionally, the `--auto-restart-until-mergeable` loop (which `--auto-merge` implies) was **never entered** in either case because the process was interrupted by log uploads and temporary watch mode before reaching the auto-merge code path.

## Affected Pull Requests

| PR                                                                       | Repository         | Created      | Merged       | Merged By            | Auto-Merge Result |
| ------------------------------------------------------------------------ | ------------------ | ------------ | ------------ | -------------------- | ----------------- |
| [ideav/crm#233](https://github.com/ideav/crm/pull/233)                   | ideav/crm          | 10:08:45 UTC | 10:20:28 UTC | `ideav` (manual)     | Never attempted   |
| [netkeep80/isocubic#265](https://github.com/netkeep80/isocubic/pull/265) | netkeep80/isocubic | 09:51:36 UTC | 10:19:08 UTC | `netkeep80` (manual) | Never attempted   |

## Timeline of Events

### PR 265 (netkeep80/isocubic) — Opus model, $11.03 estimated cost

| Time (UTC) | Event                                                                 |
| ---------- | --------------------------------------------------------------------- |
| 09:51:15   | Solve command started with `--auto-merge --attach-logs --verbose`     |
| 09:51:20   | **No write access detected** → fork mode enabled                      |
| 09:51:29   | Branch pushed to fork (`konard/netkeep80-isocubic`)                   |
| 09:51:36   | PR #265 created (draft) from fork to upstream                         |
| 10:07:07   | Main solution commit pushed                                           |
| 10:08:18   | CLAUDE.md revert committed and pushed                                 |
| 10:08:19   | Session completed — no uncommitted changes                            |
| 10:08:19   | `verifyResults()` called — PR found, "Auto-merge mode enabled" logged |
| 10:08:20   | **Log upload to gist started** ← log file ends here                   |
| ~10:08:26  | Log uploaded to PR as comment                                         |
| ~10:08:30  | CI checks start running (all pass by 10:12:45)                        |
| 10:19:08   | **PR merged manually by `netkeep80`**                                 |

**Key observation:** The log file (uploaded to gist) captures everything up to the gist upload itself. After that, the process continued to `startAutoRestartUntilMergeable()`, but we don't have logs for that phase. However, even if it reached the merge step, `gh pr merge` would have **failed with a permissions error** since the user only has read access.

### PR 233 (ideav/crm) — Sonnet model, $1.60 + $0.57 estimated cost

| Time (UTC) | Event                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| 10:08:30   | Solve command started with `--auto-merge` (detected from auto-restart log)                                    |
| 10:08:31   | **No write access detected** → fork mode enabled                                                              |
| 10:08:45   | PR #233 created from fork to upstream                                                                         |
| 10:12:20   | Main fix committed                                                                                            |
| 10:13:51   | CLAUDE.md revert committed                                                                                    |
| 10:13:55   | Session completed with **uncommitted changes** (`experiments/test-metadata-api.html`, `issue-screenshot.png`) |
| 10:14:00   | `verifyResults()` called — "Auto-merge mode enabled" logged                                                   |
| 10:14:00   | **Temporary watch mode entered** (to handle uncommitted changes)                                              |
| 10:14:06   | Auto-restart 1/3 triggered for uncommitted changes                                                            |
| 10:14:09   | New Claude session started to commit remaining files                                                          |
| ~10:15:18  | Claude session completed — "Auto-restart Complete" comment posted                                             |
| 10:15:31   | **Log upload to gist started** ← log file ends here                                                           |
| 10:20:28   | **PR merged manually by `ideav`**                                                                             |

**Key observation:** The temporary watch mode ran one iteration to commit uncommitted files. After the watch mode completed, the process should have proceeded to `startAutoRestartUntilMergeable()` (line 1368 of solve.mjs). However, even if it did, the merge would have failed due to lack of write access. The log was truncated at the gist upload point.

## Root Cause Analysis

### Root Cause 1: Permission Incompatibility (PRIMARY)

**The `--auto-merge` feature is fundamentally incompatible with fork mode.**

Both repositories show that the solver user (`konard`) only has **read (pull) access**:

```json
// ideav/crm permissions
{"admin": false, "maintain": false, "pull": true, "push": false, "triage": false}

// netkeep80/isocubic permissions
{"admin": false, "maintain": false, "pull": true, "push": false, "triage": false}
```

The `mergePullRequest()` function in `github-merge.lib.mjs:459` executes:

```bash
gh pr merge ${prNumber} --repo ${owner}/${repo}
```

This command requires **write/push access** to the target repository. Fork contributors cannot merge PRs to upstream repositories — only maintainers with write access can. GitHub will return a permissions error.

**Evidence:** Neither log shows any `gh pr merge` command execution or any merge-related error, confirming the merge was never even attempted.

### Root Cause 2: No Fork-Mode Guard in Auto-Merge Code

The entire auto-merge pipeline (`solve.auto-merge.lib.mjs`) has **no check for fork mode**:

- `startAutoRestartUntilMergeable()` does not check `argv.fork` or `forkedRepo`
- `watchUntilMergeable()` does not check permissions before attempting merge
- `attemptAutoMerge()` does not verify write access before calling `mergePullRequest()`
- `checkPRMergeable()` in `github-merge.lib.mjs` only checks GitHub's merge state status, not the user's permissions

The code proceeds as if the user has merge permissions, which will inevitably fail for fork-based PRs.

### Root Cause 3: No Branch Protection Rules

Both repositories have **no branch protection rules** configured:

```
gh api repos/ideav/crm/branches/main/protection → 404 Not Found
gh api repos/netkeep80/isocubic/branches/main/protection → 404 Not Found
```

Without branch protection, GitHub's native auto-merge feature (`enableAutoMerge` GraphQL mutation) cannot be used as an alternative. It returns: `"Protected branch rules not configured for this branch"`.

### Root Cause 4: Repository Auto-Merge Setting Not Enabled

Both repositories show `allow_auto_merge: null` (not enabled), which means even if branch protection existed, the GitHub-native auto-merge feature would not be available.

### Contributing Factor: Log Truncation

The solution draft logs uploaded to gists are **point-in-time snapshots** — they capture the log up to the moment of upload but not the subsequent auto-merge attempts. This made the investigation harder because the actual auto-merge phase (if it was reached) has no preserved logs.

## Impact Assessment

| Impact              | Description                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **User experience** | Users expected `--auto-merge` to merge the PR automatically. Instead, they had to merge manually.                                             |
| **Cost**            | The auto-restart-until-mergeable loop could run indefinitely, consuming API credits, if merge always fails due to permissions.                 |
| **Trust**           | The `--auto-merge` flag gives a false sense of automation when used in fork mode.                                                             |

## Proposed Solutions

### Solution 1: Early Fork-Mode Detection and Warning (Recommended — Quick Fix)

Add a check at the beginning of `startAutoRestartUntilMergeable()` and `attemptAutoMerge()` to detect fork mode and warn the user:

```javascript
// In solve.auto-merge.lib.mjs
export const startAutoRestartUntilMergeable = async params => {
  const { argv } = params;

  // Check if running in fork mode — auto-merge cannot work without write access
  if (argv.fork) {
    await log('');
    await log(formatAligned('⚠️', 'Auto-merge:', 'Cannot auto-merge fork PRs'));
    await log(formatAligned('', 'Reason:', 'Fork contributors do not have write access to merge PRs to upstream', 2));
    await log(formatAligned('', 'Action:', 'PR is ready for manual merge by a repository maintainer', 2));
    await log('');

    // Post a comment to the PR notifying the maintainer
    try {
      const commentBody = `## ✅ Ready to merge\n\nThis pull request is ready to be merged. Auto-merge was requested but cannot be performed because this PR was created from a fork (no write access to the target repository).\n\nPlease merge manually.\n\n---\n*hive-mind with --auto-merge flag (fork mode)*`;
      await $`gh pr comment ${params.prNumber} --repo ${params.owner}/${params.repo} --body ${commentBody}`;
    } catch {
      /* ignore */
    }

    return { success: false, reason: 'fork_no_write_access' };
  }
  // ... rest of existing code
};
```

### Solution 2: Permission Pre-Check Before Merge Attempt

Add a permission check in `mergePullRequest()` or `checkPRMergeable()`:

```javascript
// In github-merge.lib.mjs, add to checkPRMergeable or as separate function
export async function checkMergePermissions(owner, repo, verbose = false) {
  try {
    const { stdout } = await exec(`gh api repos/${owner}/${repo} --jq .permissions`);
    const permissions = JSON.parse(stdout.trim());
    const canMerge = permissions.push === true || permissions.admin === true || permissions.maintain === true;

    if (verbose) {
      console.log(`[VERBOSE] Merge permissions for ${owner}/${repo}: push=${permissions.push}, admin=${permissions.admin}`);
    }

    return { canMerge, permissions };
  } catch (error) {
    return { canMerge: false, permissions: null };
  }
}
```

### Solution 3: GitHub Native Auto-Merge Integration

For repositories where the user DOES have write access AND branch protection is configured AND the repository has `allow_auto_merge` enabled, use GitHub's native auto-merge feature:

```bash
gh pr merge ${prNumber} --repo ${owner}/${repo} --auto --squash
```

This leverages GitHub's server-side merge queue rather than polling from the client side. However, this only works when:

1. Repository setting "Allow auto-merge" is enabled
2. Branch protection rules are configured
3. The authenticated user has write access

### Solution 4: Maintainer Notification System

For fork-mode PRs, instead of attempting to merge, implement a notification system:

1. Post a comment on the PR: "Ready to merge — requesting maintainer review"
2. Apply a label (e.g., "ready-to-merge") to the PR
3. Optionally tag the repository maintainer in the comment

### Solution 5: Validate `--auto-merge` Compatibility at CLI Startup

Add validation in `solve.config.lib.mjs` to warn users early:

```javascript
// During argument validation
if (argv.autoMerge && argv.fork) {
  console.warn('⚠️  Warning: --auto-merge may not work with fork mode.');
  console.warn('   Fork contributors typically lack write access to merge PRs.');
  console.warn('   The PR will be prepared for manual merge by the maintainer.');
}
```

## Additional Research: GitHub CLI `gh pr merge` Behavior

### Documented Requirements (from GitHub docs)

| Requirement                                                  | Source                                                                                                                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Write/push access to target repository                       | [Merging a PR](https://docs.github.com/articles/merging-a-pull-request)                                                                                                                                    |
| `contents: write` + `pull-requests: write` for tokens        | [gh CLI discussions](https://github.com/cli/cli/discussions/6379)                                                                                                                                          |
| Branch protection must be configured for `--auto` flag       | [GitHub Community #129063](https://github.com/orgs/community/discussions/129063)                                                                                                                           |
| Repository must have "Allow auto-merge" enabled for `--auto` | [Managing auto-merge](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository) |

### Known `gh pr merge` Error Messages

| Scenario                                | Error                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| No write access                         | `GraphQL: Resource not accessible by integration`                             |
| No branch protection for `--auto`       | `GraphQL: Pull request Protected branch rules not configured for this branch` |
| Auto-merge not enabled in repo settings | `GraphQL: Pull request is in unstable status`                                 |
| PR has merge conflicts                  | `Pull request is not mergeable`                                               |

## Evidence Files

| File                                                      | Description                             |
| --------------------------------------------------------- | --------------------------------------- |
| `evidence/pr-233-ideav-crm/pr-details.json`               | Full PR 233 details                     |
| `evidence/pr-233-ideav-crm/commits.json`                  | PR 233 commit history                   |
| `evidence/pr-233-ideav-crm/review-comments.json`          | PR 233 review comments                  |
| `evidence/pr-265-netkeep80-isocubic/pr-details.json`      | Full PR 265 details                     |
| `evidence/pr-265-netkeep80-isocubic/commits.json`         | PR 265 commit history                   |
| `evidence/pr-265-netkeep80-isocubic/review-comments.json` | PR 265 review comments                  |
| `logs/pr-233-solution-draft-log.txt`                      | PR 233 main session log (639KB)         |
| `logs/pr-233-auto-restart-log.txt`                        | PR 233 auto-restart session log (857KB) |
| `logs/pr-265-solution-draft-log.txt`                      | PR 265 session log (2.0MB)              |

## Recommendations

1. **Immediate**: Implement Solution 1 (fork-mode guard) to prevent silent failures
2. **Short-term**: Implement Solution 2 (permission pre-check) for all merge paths
3. **Medium-term**: Implement Solution 3 (GitHub native auto-merge) for repos that support it
4. **Long-term**: Implement Solution 4 (maintainer notification) for fork-mode PRs

## Related Issues and References

- [hive-mind #1190](https://github.com/link-assistant/hive-mind/issues/1190) — Original auto-merge feature implementation
- [hive-mind #1219](https://github.com/link-assistant/hive-mind/issues/1219) — Fix for `safeExit(0)` preventing auto-merge
- [hive-mind #1124](https://github.com/link-assistant/hive-mind/issues/1124) — Playwright MCP auto-cleanup
- [GitHub CLI #8792](https://github.com/cli/cli/issues/8792) — `gh pr merge --auto` silently merges without auto-merge support
- [GitHub Community #129063](https://github.com/orgs/community/discussions/129063) — Auto-merge requires branch protection
