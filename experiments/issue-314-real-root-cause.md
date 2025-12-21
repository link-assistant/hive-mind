# Issue #314: Real Root Cause Analysis

## Problem Statement

User runs:

```bash
solve https://github.com/netkeep80/jsonRVM/issues/1 --auto-continue --fork --verbose --model opus --think max
```

The command fails to access the fork and checkout the correct branch.

## What Previous Fixes Did

### PR #315 (Merged)

- Added fork detection for auto-continue mode
- Extracted `forkOwner` from PR metadata
- Passed `forkOwner` to `setupRepository()`

### PR #316 (Current - Still Broken)

- Swapped priority in `setupRepository()`:
  - Check `argv.fork` FIRST
  - Check `forkOwner` SECOND
- This ensures when `--fork` is specified, it uses current user's fork

## THE REAL ROOT CAUSE

The problem is NOT about fork priority. The problem is about **branch location**!

### Scenario:

1. User A creates PR #123 from their fork: `userA/jsonRVM`, branch: `issue-1-abc123`
2. User B runs: `solve <issue-url> --auto-continue --fork`
3. System correctly detects:
   - `forkOwner = "userA"`
   - `prBranch = "issue-1-abc123"`
   - `argv.fork = true`
4. Due to priority fix, system uses current user's fork: `userB/jsonRVM`
5. System clones `userB/jsonRVM`
6. System tries to checkout `issue-1-abc123` branch
7. **❌ FAILS: Branch doesn't exist in userB's fork!**

The branch `issue-1-abc123` exists in `userA/jsonRVM`, not in `userB/jsonRVM`!

## Why Current Code Fails

In `solve.repository.lib.mjs`:

```javascript
// Lines 82-202: argv.fork takes priority
if (argv.fork) {
  // Uses current user's fork
  repoToClone = `${currentUser}/${repo}`;
  forkedRepo = `${currentUser}/${repo}`;
  upstreamRemote = `${owner}/${repo}`;
}
// Lines 203-226: forkOwner is ignored when argv.fork is true
else if (forkOwner) {
  // This code never runs when --fork is specified!
  repoToClone = `${forkOwner}/${repo}`;
}
```

Later in `solve.mjs`, when checking out the branch:

```javascript
// This fails because branch is in forkOwner's repo, not current user's!
await $`git checkout ${prBranch}`;
```

## THE CORRECT FIX

When both `argv.fork` AND `forkOwner` are present:

1. **Clone current user's fork** (or create it if missing)
2. **Add forkOwner's fork as a remote** (e.g., `pr-fork`)
3. **Fetch from that remote**
4. **Checkout the branch from that remote** tracking it locally
5. **Push to current user's fork** to continue work

### Implementation Steps:

1. Modify `setupRepository()` to return `forkOwner` even when `argv.fork` is true
2. After cloning, add a check:
   ```javascript
   if (argv.fork && forkOwner && forkOwner !== currentUser) {
     // Add PR fork as remote
     await $`git remote add pr-fork https://github.com/${forkOwner}/${repo}.git`;
     // Fetch from PR fork
     await $`git fetch pr-fork`;
     // Branch will be fetched from pr-fork, not origin
   }
   ```
3. Modify branch checkout logic to handle this case:
   ```javascript
   if (forkOwner && forkOwner !== currentUser) {
     // Branch is in pr-fork, not origin
     await $`git checkout -b ${prBranch} pr-fork/${prBranch}`;
   } else {
     // Normal checkout
     await $`git checkout ${prBranch}`;
   }
   ```

## Expected Behavior After Fix

✅ User B can continue work on User A's PR using their own fork
✅ Branch is fetched from User A's fork and tracked locally
✅ Work is pushed to User B's fork
✅ No access errors
✅ Clean collaboration workflow

## Test Scenarios

1. **Scenario 1**: `--fork` only → Use current user's fork (already works)
2. **Scenario 2**: Auto-continue without `--fork` → Use PR fork if accessible (already works)
3. **Scenario 3**: Both `--fork` and auto-continue, PR from someone else's fork → **BROKEN - needs this fix**
4. **Scenario 4**: Both `--fork` and auto-continue, PR from current user's fork → Already works
