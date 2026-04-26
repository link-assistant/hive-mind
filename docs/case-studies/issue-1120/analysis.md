# Case Study: Issue #1120 - BRANCH CHECKOUT FAILED with null/null Error

## Executive Summary

This issue documents a bug in `solve.mjs` where error messages incorrectly display `https://github.com/null/null` instead of the actual repository URL when a branch checkout fails. The root cause is that the `owner`, `repo`, and `prNumber` parameters are passed as `null` to the error handling function.

## Timeline of Events

| Timestamp            | Event                                                                |
| -------------------- | -------------------------------------------------------------------- |
| 2026-01-13T09:41:16Z | Renovate bot creates PR #8 in `ProverCoderAI/effect-template`        |
| 2026-01-13T09:52:04Z | User @skulidropek comments asking to fix linter issues               |
| 2026-01-13T09:52:23Z | solve.mjs v1.2.7 starts processing PR #8                             |
| 2026-01-13T09:52:30Z | Continue mode activated for PR #8                                    |
| 2026-01-13T09:52:35Z | PR branch identified: `renovate/eslint-plugin-vitest-replacement`    |
| 2026-01-13T09:52:37Z | Fork mode enabled, clone from `konard/ProverCoderAI-effect-template` |
| 2026-01-13T09:52:39Z | Repository cloned successfully                                       |
| 2026-01-13T09:52:41Z | **FAILURE**: Branch checkout fails with `null/null` error            |

## Root Cause Analysis

### Problem 1: Branch Does Not Exist in User's Fork

The PR branch `renovate/eslint-plugin-vitest-replacement` was created by Renovate bot directly in the upstream repository `ProverCoderAI/effect-template`. When fork mode is enabled:

1. solve.mjs clones the user's fork (`konard/ProverCoderAI-effect-template`)
2. It tries to checkout `origin/renovate/eslint-plugin-vitest-replacement`
3. This branch doesn't exist in the fork (only in upstream)
4. Git fails: `fatal: 'origin/renovate/eslint-plugin-vitest-replacement' is not a commit`

**Key insight**: This is a NOT a fork PR (`isCrossRepository: false`). The PR is from the same repository, created by a bot. The user's fork was cloned but the PR branch exists in upstream, not in the fork.

### Problem 2: Null Values in Error Messages

In `src/solve.branch.lib.mjs:136-148`, the error handler is called with null values:

```javascript
await handleBranchCheckoutError({
  branchName,
  prNumber: null, // Will be set later
  errorOutput,
  issueUrl: argv['issue-url'] || argv._[0],
  owner: null, // Will be set later
  repo: null, // Will be set later
  ...
});
```

The comment says "Will be set later" but these values are never actually set. The `owner` and `repo` are available in the calling context (`solve.mjs` lines 190, 524-527) but are not passed to `createOrCheckoutBranch`.

### Problem 3: Incorrect Remote Used for Checkout

When working with a PR from the upstream repository while using fork mode:

- The branch exists in `upstream` (ProverCoderAI/effect-template)
- The code tries to fetch from `origin` (konard/ProverCoderAI-effect-template)
- `checkoutPrBranch` function in `solve.repository.lib.mjs:1183-1214` fetches from wrong remote

## Data Files

| File              | Description                         |
| ----------------- | ----------------------------------- |
| `failure-log.txt` | Complete failure log from solve.mjs |
| `pr-details.json` | GitHub API response for PR #8       |
| `analysis.md`     | This analysis document              |

## Impact

1. **User Experience**: Error messages are confusing and unhelpful due to `null/null`
2. **Debugging**: Developers cannot easily identify which repository/PR failed
3. **Resolution**: Users cannot follow the suggested fix commands (they contain `null`)

## Proposed Solutions

### Solution 1: Pass Owner/Repo to Error Handler (Quick Fix)

Modify `createOrCheckoutBranch` to accept and pass `owner`, `repo`, and `prNumber`:

```javascript
// In solve.mjs:545
const branchName = await createOrCheckoutBranch({
  isContinueMode,
  prBranch,
  issueNumber,
  tempDir,
  defaultBranch,
  argv,
  log,
  formatAligned,
  $,
  crypto,
  owner, // ADD
  repo, // ADD
  prNumber, // ADD
});
```

### Solution 2: Fetch from Upstream When Branch Missing in Origin

In `checkoutPrBranch`, check if branch exists in origin first, if not try upstream:

```javascript
if (branchExistsInOrigin) {
  checkoutResult = await $({ cwd: tempDir })`git checkout -b ${branchName} origin/${branchName}`;
} else if (branchExistsInUpstream) {
  checkoutResult = await $({ cwd: tempDir })`git checkout -b ${branchName} upstream/${branchName}`;
}
```

### Solution 3: Detect Non-Fork PRs and Skip Fork Mode

When PR's `headRepositoryOwner.login === owner` (same repo PR), don't use fork mode:

```javascript
if (prData.headRepositoryOwner.login === owner) {
  // PR is from same repository, not a fork
  // Don't enable fork mode even if --fork is set
}
```

## Recommended Implementation Priority

1. **High Priority**: Fix null values in error messages (Solution 1) - Immediate UX improvement
2. **Medium Priority**: Fetch from upstream as fallback (Solution 2) - Functional fix
3. **Low Priority**: Detect non-fork PRs (Solution 3) - Prevention of similar issues

## Related Issues

- Similar pattern may exist in other error handlers
- `handleBranchCreationError` and `handleBranchVerificationError` also receive null values

## References

- Original issue: https://github.com/link-assistant/hive-mind/issues/1120
- PR comment with log: https://github.com/ProverCoderAI/effect-template/pull/8#issuecomment-3743313834
- Source file: `src/solve.branch.lib.mjs:166`
- Stack trace origin: `src/solve.mjs:545`
