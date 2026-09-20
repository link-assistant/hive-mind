# Issue #314 Investigation

## Problem Statement

Command that fails:

```bash
solve https://github.com/netkeep80/jsonRVM/issues/1 --auto-continue --attach-logs --verbose --model opus --fork --think max
```

## Key Feedback

From PR comment:

> You didn't understand the issue, it was the fork of the user that was provided for the tool to solve.
> So gh tool was setup with konard account, and fork was created in konard's user, so it is our own fork, not someone else's.

This means:

- The gh CLI is authenticated as konard
- There's a fork: konard/jsonRVM (forked from netkeep80/jsonRVM)
- konard previously created a PR from this fork
- Now konard is running `solve` with `--auto-continue` and `--fork` flags

## Current Code Logic

### When `--fork` and `--auto-continue` are used together:

1. `determineForkStrategy()` (lines 188-202):
   - Because `--fork` flag is set, it sets:
     - `repoToClone = konard/jsonRVM`
     - `forkedRepo = konard/jsonRVM`
     - `upstreamRemote = netkeep80/jsonRVM`
   - Returns `prForkOwner = konard` (from existing PR)

2. `cloneRepository()`:
   - Clones konard/jsonRVM as origin

3. `setupPrForkRemote()` (lines 405-465):
   - Checks if `prForkOwner === currentUser` (konard === konard)
   - Returns `null` (no pr-fork remote needed)
   - Logic: "If PR is from current user's fork, no need for pr-fork remote"

4. `checkoutPrBranch()` (lines 467-499):
   - Uses `remoteName = 'origin'` (since prForkRemote is null)
   - Tries to checkout branch from origin

## Potential Issues

### Issue #1: Branch Not Fetched

When `gh repo clone konard/jsonRVM` is executed, it might only fetch the default branch. When trying to checkout a PR branch, the branch might not exist locally or in the fetched remote branches.

The code tries to handle this at line 477:

```javascript
const fetchResult = await $({ cwd: tempDir })`git fetch origin`;
```

But this might fail if:

- The branch was never pushed to konard/jsonRVM
- The branch only exists in a different remote

### Issue #2: Wrong Remote Configuration

After cloning, the `origin` remote points to konard/jsonRVM. But what if:

- The PR branch was created in a different fork?
- The branch name exists but points to a different fork's branch?

## Questions to Answer

1. What is the URL of the PR being auto-continued?
2. Where is the PR branch located (which fork, which owner)?
3. What is the actual error message when checkout fails?
4. Does `git fetch origin` successfully fetch the PR branch?

## Next Steps

- Wait for maintainer's clarification
- Reproduce the issue if possible
- Add more detailed logging to understand the failure point
