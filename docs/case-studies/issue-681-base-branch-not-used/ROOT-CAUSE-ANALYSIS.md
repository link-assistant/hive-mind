# Root Cause Analysis: Base Branch Not Used

## Executive Summary

The `--base-branch` option was completely ignored during issue branch creation due to incorrect git command usage in `src/solve.branch.lib.mjs`. The function logged the correct base branch but failed to use it in the actual `git checkout -b` command.

## Technical Details

### Location of the Bug

**File**: `src/solve.branch.lib.mjs`
**Function**: `createOrCheckoutBranch`
**Lines**: 103-134

### The Problematic Code

```javascript
export async function createOrCheckoutBranch({
  isContinueMode,
  prBranch,
  issueNumber,
  tempDir,
  defaultBranch, // Repository's default branch ("main")
  argv, // Contains argv.baseBranch ("feat/perf.t")
  log,
  formatAligned,
  $,
  crypto,
}) {
  let branchName;
  let checkoutResult;

  if (isContinueMode && prBranch) {
    // Continue mode: checkout existing PR branch
    branchName = prBranch;
    const repository = await import('./solve.repository.lib.mjs');
    const { checkoutPrBranch } = repository;
    checkoutResult = await checkoutPrBranch(tempDir, branchName, null, null);
  } else {
    // Traditional mode: create new branch for issue
    const randomHex = crypto.randomBytes(6).toString('hex');
    branchName = `issue-${issueNumber}-${randomHex}`;

    // Line 129: Logs message showing defaultBranch
    await log(`\n${formatAligned('🌿', 'Creating branch:', `${branchName} from ${defaultBranch}`)}`);

    // Line 133: BUG - Creates branch from current HEAD, ignoring both defaultBranch and argv.baseBranch
    checkoutResult = await $({ cwd: tempDir })`git checkout -b ${branchName}`;
  }
  // ... verification code follows
}
```

### What Went Wrong

1. **The log message is misleading**:
   - Shows: "Creating branch: issue-5-f81abcbe3f46 from main"
   - The log uses `defaultBranch` variable
   - This makes it look like the code is working correctly

2. **The git command is incomplete**:
   - Used: `git checkout -b ${branchName}`
   - Should be: `git checkout -b ${branchName} ${baseBranch}`
   - Without the second parameter, git creates the branch from current HEAD

3. **The function doesn't use argv.baseBranch**:
   - The function receives `argv` as a parameter
   - `argv.baseBranch` contains the user's specified base branch
   - The code never accesses or uses this value

4. **The function uses the wrong variable**:
   - The log uses `defaultBranch` (repository's default branch)
   - Even if fixed, using `defaultBranch` would still be wrong
   - Should use `argv.baseBranch || defaultBranch` to respect user's choice

### Git Command Behavior

When you run `git checkout -b <new-branch>` without specifying a start point:

```bash
# What the code does now:
git checkout -b issue-5-f81abcbe3f46
# This creates the branch from current HEAD (which is 'main')

# What it should do:
git checkout -b issue-5-f81abcbe3f46 feat/perf.t
# This creates the branch from the specified base branch
```

### Why PR Creation Worked

The PR creation code in `src/solve.auto-pr.lib.mjs` is implemented correctly:

```javascript
// Line 655: Correctly uses argv.baseBranch
const targetBranch = argv.baseBranch || defaultBranch;

// Line 656: Fetches the correct branch
await log(formatAligned('🔄', 'Fetching:', `Latest ${targetBranch} branch...`));
const fetchBaseResult = await $({ cwd: tempDir, silent: true })`git fetch origin ${targetBranch}:refs/remotes/origin/${targetBranch} 2>&1`;

// Line 778-780: Creates PR with correct base
command = `cd "${tempDir}" && gh pr create --draft --title "$(cat '${prTitleFile}')" --body-file "${prBodyFile}" --base ${targetBranch} --head ${forkUser}:${branchName} --repo ${owner}/${repo}`;
```

This is why the PR had the correct target branch, but the branch itself had the wrong history.

## Data Flow Analysis

### Step 1: CLI Argument Parsing

**File**: `src/solve.config.lib.mjs:178-182`

```javascript
.option('base-branch', {
  type: 'string',
  description: 'Target branch for the pull request (defaults to repository default branch)',
  alias: 'b'
})
```

Result: `argv['base-branch']` = "feat/perf.t" (stored as `argv.baseBranch` by yargs)

### Step 2: Repository Checkout

**File**: `src/solve.mjs` (around line 494)

```javascript
const defaultBranch = await verifyDefaultBranchAndStatus({
  tempDir,
  log,
  formatAligned,
  $,
});
```

Result: `defaultBranch` = "main" (from repository settings)

### Step 3: Branch Creation

**File**: `src/solve.mjs:501-512`

```javascript
const branchName = await createOrCheckoutBranch({
  isContinueMode,
  prBranch,
  issueNumber,
  tempDir,
  defaultBranch, // "main"
  argv, // { baseBranch: "feat/perf.t", ... }
  log,
  formatAligned,
  $,
  crypto,
});
```

Problem: Passes both `defaultBranch` and `argv`, but the function only uses `defaultBranch` for logging and ignores both for the actual branch creation.

### Step 4: PR Creation

**File**: `src/solve.auto-pr.lib.mjs:655`

```javascript
const targetBranch = argv.baseBranch || defaultBranch;
// ... later ...
--base ${targetBranch}
```

Result: PR correctly targets "feat/perf.t"

## Why This Bug Existed

### 1. Misleading Variable Names

The function parameter `defaultBranch` suggests it's the correct branch to use, but:

- It actually means "repository's default branch"
- It should have been named `repositoryDefaultBranch` for clarity
- The actual "default value for base branch" should be computed as `argv.baseBranch || repositoryDefaultBranch`

### 2. Log Message vs Implementation Mismatch

The log message says "from X" but the git command doesn't actually use X:

```javascript
await log(`Creating branch: ${branchName} from ${defaultBranch}`);
checkoutResult = await $({ cwd: tempDir })`git checkout -b ${branchName}`;
// Logs say "from main" but command creates from current HEAD
```

### 3. Incomplete Testing

The bug suggests that:

- There were no automated tests for the `--base-branch` option
- Manual testing only verified the PR target, not the branch history
- The misleading log message made it appear to work correctly

### 4. Missing Integration Point

The function receives `argv` but doesn't use `argv.baseBranch`. This suggests:

- The feature was added to CLI config (`solve.config.lib.mjs`)
- The feature was added to PR creation (`solve.auto-pr.lib.mjs`)
- But nobody updated the branch creation logic (`solve.branch.lib.mjs`)

## Timeline of Events

1. **Initial Implementation**: `--base-branch` option added to CLI
2. **PR Creation Fixed**: PR creation logic updated to respect `--base-branch`
3. **Branch Creation Overlooked**: Nobody updated the branch creation to use the option
4. **Bug Introduced**: All users with `--base-branch` got wrong branch history
5. **Bug Discovered**: User noticed PR contained commits from main not in base branch
6. **Issue Reported**: GitHub issue #681 created

## Comparison: What Should Happen vs What Did Happen

### Expected Behavior

```
Repository state:
  main: A --- B --- C --- D
  feat/perf.t:    B --- E --- F

Command: solve issue #5 --base-branch feat/perf.t

Expected result:
  main: A --- B --- C --- D
  feat/perf.t:    B --- E --- F
  issue-5-xxx:             F --- G (new commit)
                                 ^
                                 Created from F

PR shows: Only commit G (clean diff)
```

### Actual Behavior

```
Repository state:
  main: A --- B --- C --- D
  feat/perf.t:    B --- E --- F

Command: solve issue #5 --base-branch feat/perf.t

Actual result:
  main: A --- B --- C --- D
  feat/perf.t:    B --- E --- F
  issue-5-xxx:  D --- G (new commit)
                ^
                Created from D (main)

PR shows: Commits C, D, and G (polluted with commits from main)
```

## Conclusion

The bug was caused by:

1. Incomplete implementation of the `--base-branch` feature
2. Misleading log messages that suggested it was working
3. Missing git command parameter
4. Lack of automated tests for this feature
5. Variable naming that didn't clearly distinguish between "repository default" and "user's chosen base"

The fix is straightforward but the impact is high because it affects all users who rely on feature branches.
