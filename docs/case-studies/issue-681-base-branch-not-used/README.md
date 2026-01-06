# Case Study: Issue #681 - Base Branch Not Used When Creating Issue Branch

## Overview

This case study documents a critical bug where the `--base-branch` option was ignored during branch creation, causing the tool to always create branches from the repository's default branch (main) instead of the user-specified base branch.

## Issue Details

- **Issue URL**: https://github.com/deep-assistant/hive-mind/issues/681
- **Affected PR**: https://github.com/uselessgoddess/bar/pull/6
- **Reporter**: konard
- **Date Reported**: 2025-11-05
- **Severity**: High - Causes incorrect base for feature branches

## Problem Statement

When using the solve command with the `--base-branch` option:

```bash
solve https://github.com/uselessgoddess/bar/issues/5 --base-branch feat/perf.t
```

The tool was expected to:

1. Create a new issue branch FROM the specified base branch (`feat/perf.t`)
2. Create a pull request targeting the specified base branch

What actually happened:

1. The tool created the issue branch FROM the repository's default branch (`main`) instead
2. The pull request correctly targeted the specified base branch (`feat/perf.t`)

This resulted in the PR including commits from `main` that weren't in `feat/perf.t`, polluting the PR with unrelated changes.

## Evidence from Logs

From `first-session-log.txt`, line 73:

```
🌿 Creating branch:          issue-5-f81abcbe3f46 from main
```

But the command was executed with (line 10):

```
--base-branch feat/perf.t
```

The PR was correctly created with the base branch (line 164):

```
gh pr create --draft ... --base feat/perf.t --head konard:issue-5-f81abcbe3f46
```

## Root Cause Analysis

### File Structure

The bug exists in the following files:

- `src/solve.branch.lib.mjs` - Contains the branch creation logic
- `src/solve.mjs` - Calls the branch creation function
- `src/solve.config.lib.mjs` - Defines the CLI option

### The Bug

In `src/solve.branch.lib.mjs:103-134`, the `createOrCheckoutBranch` function:

```javascript
export async function createOrCheckoutBranch({
  isContinueMode,
  prBranch,
  issueNumber,
  tempDir,
  defaultBranch, // <-- This is the repository's default branch (main)
  argv, // <-- Contains argv.baseBranch with the user's choice
  log,
  formatAligned,
  $,
  crypto,
}) {
  // ...
  if (isContinueMode && prBranch) {
    // ... checkout existing branch
  } else {
    // Traditional mode: create new branch for issue
    const randomHex = crypto.randomBytes(6).toString('hex');
    branchName = `issue-${issueNumber}-${randomHex}`;
    await log(`\n${formatAligned('🌿', 'Creating branch:', `${branchName} from ${defaultBranch}`)}`);

    // BUG: This creates the branch from current HEAD, not from the base branch
    checkoutResult = await $({ cwd: tempDir })`git checkout -b ${branchName}`;
  }
  // ...
}
```

**The Problem**:

1. The function receives `defaultBranch` parameter (repository's default branch = "main")
2. The function receives `argv` which contains `argv.baseBranch` (user's choice = "feat/perf.t")
3. The log message uses `defaultBranch` for display
4. **The actual git command `git checkout -b ${branchName}` doesn't specify a base branch at all**
5. This causes git to create the new branch from the current HEAD, which is the repository's default branch

### Why the PR Creation Worked Correctly

In `src/solve.auto-pr.lib.mjs:655` and `src/solve.auto-pr.lib.mjs:719-723`:

```javascript
const targetBranch = argv.baseBranch || defaultBranch;
// ...
if (argv.baseBranch) {
  await log(formatAligned('🎯', 'Target branch:', `${targetBranch} (custom)`));
}
```

The PR creation code correctly prioritizes `argv.baseBranch` over `defaultBranch`, so the PR was created with the correct target branch.

### Call Chain

1. `src/solve.mjs:494` - Gets repository's default branch:

   ```javascript
   const defaultBranch = await verifyDefaultBranchAndStatus({ ... });
   ```

2. `src/solve.mjs:501` - Calls branch creation with `defaultBranch`:

   ```javascript
   const branchName = await createOrCheckoutBranch({
     // ...
     defaultBranch, // This is "main"
     argv, // Contains baseBranch: "feat/perf.t"
     // ...
   });
   ```

3. `src/solve.branch.lib.mjs:129-133` - Creates branch incorrectly:
   ```javascript
   await log(`\n${formatAligned('🌿', 'Creating branch:', `${branchName} from ${defaultBranch}`)}`);
   checkoutResult = await $({ cwd: tempDir })`git checkout -b ${branchName}`;
   ```

## Impact

### Severity: High

This bug causes:

1. **Incorrect branch history**: The issue branch contains all commits from main, not just from the intended base branch
2. **Polluted pull requests**: PRs include unrelated commits that exist in main but not in the base branch
3. **Misleading logs**: The log says "Creating branch: X from main" when the user specified a different base branch
4. **Confusion for users**: The behavior doesn't match the documentation or expectations
5. **Broken workflows**: Teams using feature branches as bases for incremental work get incorrect results

### Affected Use Cases

1. **Feature branch workflows**: When working on features that branch from other feature branches
2. **Hotfix workflows**: When creating hotfixes from release branches instead of main
3. **Staged rollout**: When building features incrementally on top of each other
4. **Multi-version support**: When maintaining different versions in different branches

## Additional Files

- [first-session-log.txt](./first-session-log.txt) - Complete log of the first solve session
- [second-session-log.txt](./second-session-log.txt) - Complete log of the auto-restart session
- [ROOT-CAUSE-ANALYSIS.md](./ROOT-CAUSE-ANALYSIS.md) - Detailed technical analysis
- [PROPOSED-SOLUTIONS.md](./PROPOSED-SOLUTIONS.md) - Proposed fixes and preventive measures
