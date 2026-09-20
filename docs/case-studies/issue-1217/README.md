# Case Study: BRANCH CHECKOUT FAILED - Fork PR Branch Resolution Bug

**Issue:** [#1217](https://github.com/link-assistant/hive-mind/issues/1217)
**Related PR:** [objectionary/eo2js#154](https://github.com/objectionary/eo2js/pull/154)
**Status:** Analysis Complete
**Date:** 2026-02-05

## Executive Summary

The hive-mind `solve` command fails to checkout a PR branch when:

1. The PR comes from another user's fork (e.g., `skulidropek/eo2js`)
2. The current user has their own fork with a different naming convention (e.g., `konard/objectionary-eo2js`)
3. The `--fork` flag is used in continue mode

The bug occurs because the code incorrectly constructs the `pr-fork` remote URL using a naming convention that may not match the actual fork repository name.

## Timeline of Events

### 2026-02-05T09:18:29Z - Solution Draft Initiated

- solve.mjs v1.15.1 started processing PR https://github.com/objectionary/eo2js/pull/154

### 2026-02-05T09:18:36Z - PR Analysis

- PR #154 detected as fork PR from `skulidropek/eo2js`
- Branch name: `issues/117`
- Fork owner: `skulidropek`

### 2026-02-05T09:18:38Z - Fork Conflict Check

- Verified no fork conflict between `konard/objectionary-eo2js` and `objectionary/eo2js`
- Fork exists: `konard/objectionary-eo2js`
- Fork parent validated: `objectionary/eo2js`

### 2026-02-05T09:18:43Z - PR Fork Remote Setup Fails

- Code attempted to add `pr-fork` remote
- **BUG:** Constructed URL as `skulidropek/objectionary-eo2js` (non-existent)
- **Actual repository:** `skulidropek/eo2js`
- Error: `remote: Repository not found.`

### 2026-02-05T09:18:44Z - Branch Checkout Fails

- Branch `issues/117` not found in any accessible remote
- Git error: `fatal: 'origin/issues/117' is not a commit and a branch 'issues/117' cannot be created from it`

## Root Cause Analysis

### Primary Bug Location

**File:** `src/solve.repository.lib.mjs`
**Function:** `setupPrForkRemote()`
**Lines:** 1183-1196

### The Bug

```javascript
// Line 1183-1187: Incorrectly constructs fork repo name
let prForkRepoName = repo;
if (owner && argv.prefixForkNameWithOwnerName) {
  // When prefix option is enabled, try prefixed name first
  prForkRepoName = `${owner}-${repo}`; // This creates "objectionary-eo2js"
}
```

The problem:

1. `argv.prefixForkNameWithOwnerName` applies to the **current user's** fork naming preference
2. This flag is being incorrectly applied to **another user's** fork (`skulidropek`)
3. Another user's fork name is independent of the current user's naming preferences

### Why This Happens

When `--fork` flag is used and the PR is from another user's fork:

1. The code correctly identifies that `skulidropek` is the PR fork owner
2. It uses `--prefix-fork-name-with-owner-name` (or auto-fork behavior) creating `konard/objectionary-eo2js`
3. When setting up `pr-fork` remote, it **incorrectly assumes** `skulidropek` also used the same naming convention
4. It constructs `skulidropek/objectionary-eo2js` which doesn't exist (actual: `skulidropek/eo2js`)

### Reproduction Steps

1. Have a fork with prefixed name: `{your-user}/{owner}-{repo}` (e.g., `konard/objectionary-eo2js`)
2. Try to continue working on a PR from another fork: `skulidropek/eo2js#154`
3. Use the `--fork` flag

```bash
./solve.mjs "https://github.com/objectionary/eo2js/pull/154" --fork
```

## Impact Assessment

### Severity: Medium

- **Workaround available:** Users can avoid using `--fork` flag for PRs from other forks
- **Limited scope:** Only affects continue mode with `--fork` flag on PRs from other users' forks
- **No data loss:** Fails early with clear error message

### Affected Workflows

1. AI-powered solution drafts continuing work on external PRs
2. Collaborative PR reviews using fork-based workflows
3. Any automation using `solve` to continue PRs from different fork owners

## Proposed Solutions

### Solution 1: Query GitHub API for Actual Fork Name (Recommended)

Instead of guessing the fork name based on current user's preferences, query the GitHub API to get the actual repository name:

```javascript
export const setupPrForkRemote = async (tempDir, argv, prForkOwner, repo, isContinueMode, owner = null) => {
  // ... existing validation code ...

  // NEW: Query GitHub API to find actual fork name
  const forkSearchResult = await $`gh api repos/${owner}/${repo}/forks --paginate --jq '.[] | select(.owner.login == "${prForkOwner}") | .name'`;

  let prForkRepoName = repo; // Default to standard name
  if (forkSearchResult.code === 0 && forkSearchResult.stdout) {
    prForkRepoName = forkSearchResult.stdout.toString().trim() || repo;
  }

  // Verify the fork exists before adding remote
  const forkVerifyResult = await $`gh repo view ${prForkOwner}/${prForkRepoName} --json name 2>/dev/null`;
  if (forkVerifyResult.code !== 0) {
    // Try alternative: search for any fork owned by prForkOwner
    const searchResult = await $`gh api search/repositories --jq '.items[0].name' -f q="fork:true user:${prForkOwner} ${repo}"`;
    if (searchResult.code === 0 && searchResult.stdout) {
      prForkRepoName = searchResult.stdout.toString().trim();
    }
  }

  // ... rest of the function ...
};
```

### Solution 2: Direct PR Reference Checkout

Use GitHub's special PR refs to checkout directly without needing the fork:

```javascript
// Fetch the PR directly using GitHub's special refs
await $({ cwd: tempDir })`git fetch origin pull/${prNumber}/head:${branchName}`;
await $({ cwd: tempDir })`git checkout ${branchName}`;
```

This approach:

- Works regardless of fork naming
- Doesn't require access to the contributor's fork
- Is the standard way to checkout PR branches

### Solution 3: Try Multiple Fork Naming Conventions

```javascript
const possibleForkNames = [
  repo, // Standard: "eo2js"
  `${owner}-${repo}`, // Prefixed: "objectionary-eo2js"
  repo.replace(/-/g, ''), // No dashes variant
];

let actualForkName = null;
for (const candidate of possibleForkNames) {
  const result = await $`gh repo view ${prForkOwner}/${candidate} --json name 2>/dev/null`;
  if (result.code === 0) {
    actualForkName = candidate;
    break;
  }
}
```

## Existing Components/Libraries

### 1. GitHub CLI (`gh`)

- `gh api repos/{owner}/{repo}/forks` - List forks to find actual fork name
- `gh pr checkout {number}` - Direct PR checkout (handles fork branches automatically)
- `gh repo view` - Verify repository existence

### 2. Git Pull Request Refs

GitHub provides special refs for all PRs:

- `refs/pull/{number}/head` - The PR branch
- `refs/pull/{number}/merge` - Merge commit preview

These can be fetched directly without knowing the fork name.

### 3. Similar Issue References

- [GitHub Community: Checkout a branch from a fork](https://github.com/orgs/community/discussions/23445)
- [GitHub Docs: Checking out pull requests locally](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/checking-out-pull-requests-locally)

## Recommendations

### Immediate Fix (Solution 2)

Use Git's PR refs for checkout - simplest, most reliable solution:

```javascript
// In checkoutPrBranch() for PRs from other forks
if (prNumber) {
  await $({ cwd: tempDir })`git fetch origin pull/${prNumber}/head:${branchName}`;
  return await $({ cwd: tempDir })`git checkout ${branchName}`;
}
```

### Long-term Improvement (Solution 1)

Implement proper fork discovery via GitHub API to handle all edge cases.

### Testing

Add test cases for:

1. Standard fork name (`user/repo`)
2. Prefixed fork name (`user/owner-repo`)
3. Custom fork name (renamed after creation)
4. Fork doesn't exist (deleted)

## Files to Modify

1. **`src/solve.repository.lib.mjs`**
   - `setupPrForkRemote()` - Fix fork name construction
   - `checkoutPrBranch()` - Add PR ref checkout as fallback

2. **`src/solve.branch.lib.mjs`**
   - `createOrCheckoutBranch()` - Pass prNumber for PR ref checkout

3. **Tests**
   - Add unit tests for fork name resolution
   - Add integration tests for cross-fork PR checkout

## Appendix

### Full Error Log

See [./failure-log.md](./failure-log.md) for the complete failure log from the original incident.

### Repository Structure

```
objectionary/eo2js (upstream)
├── skulidropek/eo2js (PR author's fork) - ACTUAL
│   └── branch: issues/117 (PR #154)
└── konard/objectionary-eo2js (current user's fork) - DIFFERENT NAMING
```

### Related Issues

- This case study follows the pattern established in issue #967 (fork parent mismatch detection)
- The solution should be consistent with existing fork handling in `validateForkParent()`
