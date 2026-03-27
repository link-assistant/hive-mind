# Case Study: Cross-Fork PR Branch Checkout Failure (Issue #1464)

## Summary

When `solve.mjs` is invoked in continue mode on a PR that originates from **another user's fork** (not the current user's fork), the branch checkout fails because the `pr-fork` remote information is not forwarded to the branch checkout function.

## Timeline / Sequence of Events

1. User runs: `solve https://github.com/ProverCoderAI/docker-git/pull/133 --model opus --fork`
2. `solve.mjs` detects this is a PR from `skulidropek/docker-git` (another user's fork of `ProverCoderAI/docker-git`)
3. `setupRepositoryAndClone()` correctly:
   - Clones the current user's fork (`konard/ProverCoderAI-docker-git`)
   - Sets up `upstream` remote pointing to `ProverCoderAI/docker-git`
   - Detects the PR is from another user's fork (`skulidropek`)
   - Adds `pr-fork` remote pointing to `skulidropek/docker-git`
   - Fetches branches from `pr-fork`
   - Returns `{ prForkRemote: 'pr-fork', prForkOwner: 'skulidropek' }`
4. **BUG**: `solve.mjs` destructures only `{ forkedRepo }` from the return value, discarding `prForkRemote` and `prForkOwner`
5. `createOrCheckoutBranch()` is called without fork remote info
6. `checkoutPrBranch()` receives `null, null` for `prForkRemote` and `prForkOwner`
7. `checkoutPrBranch()` defaults to `remoteName = 'origin'` (line 1371 of `solve.repository.lib.mjs`)
8. `git checkout -b issue-132 origin/issue-132` fails because the branch only exists in `pr-fork/issue-132`
9. Fallback to `upstream/issue-132` also fails (branch doesn't exist in upstream either)
10. Fallback to `refs/pull/133/head` fails because this is fetched from `origin` (our fork), not upstream
11. Process exits with error: `Branch operation failed`

## Root Cause

**Data flow disconnection**: The `setupRepositoryAndClone` function correctly detects and configures the `pr-fork` remote, but the caller in `solve.mjs` (line 510) did not destructure or forward `prForkRemote` and `prForkOwner` to `createOrCheckoutBranch`.

The `checkoutPrBranch` function already has full support for using a custom remote via its `prForkRemote` parameter — the plumbing was in place, but the wiring was missing.

### Affected Files

| File                                  | Issue                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `src/solve.mjs` (line 510)            | Only destructures `{ forkedRepo }`, ignoring `prForkRemote` and `prForkOwner` |
| `src/solve.mjs` (line 538-552)        | Does not pass `prForkRemote`/`prForkOwner` to `createOrCheckoutBranch`        |
| `src/solve.branch.lib.mjs` (line 103) | Does not accept `prForkRemote`/`prForkOwner` parameters                       |
| `src/solve.branch.lib.mjs` (line 114) | Passes `null, null` to `checkoutPrBranch`                                     |

## Fix

1. Destructure `prForkRemote` and `prForkOwner` from `setupRepositoryAndClone()` return value
2. Pass them to `createOrCheckoutBranch()`
3. Accept them in `createOrCheckoutBranch()` function signature
4. Forward them to `checkoutPrBranch()` instead of hardcoded `null`

## Data Sources

- **Failure log**: [Gist](https://gist.githubusercontent.com/konard/a275a6ff7ab0b05f042b41c639aa0f66/raw/846bc483e1f9abbe25f71dbb685574b719631f39/solve-2026-03-21T17-45-29-130Z.log) (also saved as `solve-failure-log.log` in this directory)
- **Triggering PR**: https://github.com/ProverCoderAI/docker-git/pull/133
- **Triggering issue**: https://github.com/ProverCoderAI/docker-git/issues/132

## Reproducing the Issue

The issue occurs when ALL of these conditions are met:

1. `solve.mjs` is run in **continue mode** (PR URL provided)
2. The `--fork` flag is used (or auto-fork is triggered due to lack of write access)
3. The PR branch exists in **another user's fork** (not the upstream repo, not the current user's fork)

### Example

```bash
# User "konard" runs solve on a PR from "skulidropek"'s fork
solve https://github.com/ProverCoderAI/docker-git/pull/133 --fork
```

## Prevention

This bug class (return value fields being silently dropped during destructuring) can be prevented by:

1. TypeScript or JSDoc type annotations on return values
2. Integration tests that exercise the cross-fork PR workflow end-to-end
