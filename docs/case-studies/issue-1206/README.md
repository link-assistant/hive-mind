# Case Study: Issue #1206 — Solve attempts to fork when user owns the repository (HTTP 403)

## Summary

When using `--fork` (or `--auto-fork` on a public repository the user owns but somehow lacks cached permissions), the `solve` command attempts to create a GitHub fork even when the authenticated user is the repository owner. GitHub does not allow users to fork their own repositories and returns `HTTP 403: Resource not accessible by personal access token`, causing `solve` to fail.

## Timeline / Sequence of Events

1. **User runs solve on their own repository**: `solve https://github.com/unidel2035/btc/issues/965` with `--fork` flag
2. **solve enters fork mode**: The `setupRepository` function in `solve.repository.lib.mjs` detects `argv.fork = true`
3. **Current user is retrieved**: `gh api user --jq .login` returns `unidel2035`
4. **Fork conflict check passes**: No existing fork conflicts detected
5. **Fork existence check fails**: No fork exists at `unidel2035/btc` (because it's the original repo, not a fork)
6. **Fork creation attempted**: `gh repo fork unidel2035/btc --clone=false` is executed
7. **GitHub returns HTTP 403**: GitHub does not allow forking your own repository
8. **solve crashes**: `failed to fork: HTTP 403: Resource not accessible by personal access token`

## Root Cause Analysis

### Root Cause: Missing owner detection before fork creation

The `setupRepository` function in `src/solve.repository.lib.mjs` (line ~408) enters fork creation logic when `argv.fork` is true, but never checks whether the authenticated GitHub user (`currentUser`) is the same as the repository owner (`owner`).

**Code location (before fix):** `src/solve.repository.lib.mjs:418`

```javascript
const currentUser = userResult.stdout.toString().trim();

// Check for fork conflicts (Issue #344) — BUT NO OWNER CHECK!
await log(`${formatAligned('🔍', 'Detecting fork conflicts...', '')}`);
```

The flow proceeds directly to fork conflict detection, fork existence checks, and eventually fork creation — all unnecessary when `currentUser === owner`.

### Why `--auto-fork` was not affected

The `--auto-fork` logic in `src/solve.mjs` (lines 246-314) already handles this case correctly:

1. It checks `permissions.push/admin/maintain` via `gh api repos/${owner}/${repo} --jq .permissions`
2. If the user has write access (which owners always do), fork mode is NOT enabled
3. Only when the user lacks write access does it set `argv.fork = true`

This means the bug only manifests when the user explicitly passes `--fork` on their own repository.

### GitHub API behavior

GitHub's fork API (`POST /repos/{owner}/{repo}/forks`) returns HTTP 403 when:

1. The authenticated user IS the repository owner (cannot fork own repo)
2. The repository is empty (no git content)
3. The token lacks required scopes

The existing code at line 660 only checked for case 2 (empty repositories), missing case 1 entirely.

## Impact

- **Severity**: High — blocks `solve` entirely for repository owners using `--fork`
- **Users affected**: Any user who runs `solve` with `--fork` (or equivalent configuration) on their own repository
- **Workaround**: Remove `--fork` flag or use `--auto-pull-request-creation false`

## Solution

Added an owner detection check immediately after retrieving the current user (before any fork-related operations). When `currentUser === owner`, the function returns early with the original repository (no fork), skipping all fork creation logic.

**Code location:** `src/solve.repository.lib.mjs:420-427`

```javascript
// Check if user owns the repository (Issue #1206)
// GitHub doesn't allow forking your own repositories and returns HTTP 403
// If the user is the owner, skip fork creation and work directly with the repo
if (currentUser === owner) {
  await log(`${formatAligned('✅', 'Owner detected:', 'You own this repository, fork is not needed')}`);
  await log(`${formatAligned('', 'Working directly:', `Using ${owner}/${repo} without fork`)}`);
  return { repoToClone, forkedRepo, upstreamRemote, prForkOwner: forkOwner };
}
```

### Design decisions

1. **Early return pattern**: The fix returns immediately when the owner is detected, avoiding unnecessary API calls (fork conflict detection, fork existence checks, fork creation)
2. **Preserves initial values**: `repoToClone` remains `${owner}/${repo}`, `forkedRepo` remains `null`, and `upstreamRemote` remains `null` — identical to the no-fork case
3. **Organization edge case**: When the `owner` is an organization, `currentUser !== owner`, so the fork logic proceeds normally. Organization members with push/admin access should use `--auto-fork` (which correctly checks permissions) rather than `--fork`

## Files Changed

| File                                  | Change                                           |
| ------------------------------------- | ------------------------------------------------ |
| `src/solve.repository.lib.mjs`        | Added owner detection check in `setupRepository` |
| `tests/test-owner-fork-detection.mjs` | 10 tests for owner detection logic               |

## Test Coverage

- 10 new tests in `tests/test-owner-fork-detection.mjs`
- All 10 existing tests in `tests/test-fork-parent-validation.mjs` continue to pass

## Related Issues

- Issue #344 — Fork conflict detection (already solved)
- Issue #906 — Not a GitHub fork detection (already solved)
- Issue #967 — Fork of fork validation (already solved)
