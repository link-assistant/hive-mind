# Case Study: Issue #1017 - Git Authentication Failure in Docker Container

## Error Message

```
fatal: could not read Username for 'https://github.com': No such device or address
```

## Issue Link

https://github.com/link-assistant/hive-mind/issues/1017

## Date of Occurrence

2025-12-28T05:55:01.355Z to 2025-12-28T05:55:17.626Z

## Environment

- Running inside Docker container
- GitHub CLI (`gh`) authenticated with token (verified via `gh auth status`)
- Node.js v20.19.6
- solve v0.51.18
- Two concurrent solve commands were running on the same fork

## Timeline of Events

### Sequence for First Command (issue #5)

1. **05:55:01.355Z** - Command started: `solve https://github.com/Krol-X/NiceMusicLibrary/issues/5 --model opus --attach-logs --verbose --no-tool-check --auto-continue-on-limit-reset`
2. **05:55:08.004Z** - Skipped tool connection validation and GitHub authentication check (due to `--no-tool-check`)
3. **05:55:08.914Z** - Auto-fork enabled (no write access to target repo)
4. **05:55:13.846Z** - Fork verified: `konard/Krol-X-NiceMusicLibrary`
5. **05:55:14.326Z** - Started cloning repository
6. **05:55:16.375Z** - Clone completed to `/tmp/gh-issue-solver-1766901311709`
7. **05:55:16.889Z** - Upstream fetched successfully
8. **05:55:17.323Z** - Default branch synced with upstream/main
9. **05:55:17.323Z** - Started pushing to fork
10. **05:55:17.618Z** - **FAILURE**: `git push origin main` failed with authentication error
11. **05:55:17.626Z** - Repository setup failed

### Sequence for Second Command (issue #11)

Almost identical timeline, running approximately 17 seconds after the first command. Same error occurred.

## Root Cause Analysis

### Primary Cause: Git Credential Helper Not Configured Before Push

The code in `solve.repository.lib.mjs` uses:

1. `gh repo clone` for cloning (line 804) - **Works correctly** because `gh` handles authentication
2. `git push origin main` for syncing fork (line 921) - **Fails** because native git doesn't have credentials configured

The credential helper setup (`gh auth setup-git`) in `solve.repo-setup.lib.mjs` happens **AFTER** the `setupUpstreamAndSync` call:

```javascript
// From solve.repo-setup.lib.mjs lines 6-22
export async function setupRepositoryAndClone({ ... }) {
  // ...
  await setupUpstreamAndSync(tempDir, forkedRepo, upstreamRemote, owner, repo, argv);  // Line 13 - Push happens here!
  // ...
  const authSetupResult = await $({ cwd: tempDir })`gh auth setup-git 2>&1`;  // Line 18 - Too late!
  // ...
}
```

### Secondary Cause: Non-Interactive Environment (Docker Container)

Git's default behavior when encountering authentication issues is to prompt the user for credentials. In a Docker container:

- There is no TTY (terminal) attached
- Git cannot open `/dev/tty` to prompt for credentials
- This results in the cryptic error: "No such device or address"

### Contributing Factor: Dual Authentication Systems

As documented in [mislav/hub#1644](https://github.com/mislav/hub/issues/1644):

- `gh` CLI has its own authentication (using `GITHUB_TOKEN` or `gh auth login`)
- Git has its own credential system (stored credentials, credential helpers)
- These two systems are completely independent
- Just because `gh auth status` shows authenticated doesn't mean native `git` commands will work

## Evidence from Logs

From `log1-solve-2025-12-28T05-55-01-355Z.log`:

```
[2025-12-28T05:55:08.004Z] [INFO] ⏩ Skipping tool connection validation (dry-run mode or skip-tool-connection-check enabled)
[2025-12-28T05:55:08.004Z] [INFO] ⏩ Skipping GitHub authentication check (dry-run mode or skip-tool-connection-check enabled)
...
[2025-12-28T05:55:17.323Z] [INFO] 🔄 Pushing to fork:          main branch
[2025-12-28T05:55:17.618Z] [INFO] ❌ FATAL ERROR:              Failed to push updated default branch to fork
[2025-12-28T05:55:17.619Z] [INFO]  Push error:               fatal: could not read Username for 'https://github.com': No such device or address
```

Key observations:

1. Authentication check was skipped due to `--no-tool-check` flag
2. The push failed immediately after attempting (295ms from start to error)
3. The error clearly indicates git couldn't prompt for credentials

## Proposed Solutions

### Solution 1: Use `gh repo sync` Instead of `git push` (Recommended)

The GitHub CLI provides `gh repo sync` which:

- Uses GitHub's authenticated API
- Handles all credential management internally
- Can sync a fork with its parent in one command

Change in `solve.repository.lib.mjs`:

```javascript
// Instead of:
const pushResult = await $({ cwd: tempDir })`git push origin ${upstreamDefaultBranch}`;

// Use:
const syncResult = await $({ cwd: tempDir })`gh repo sync --branch ${upstreamDefaultBranch}`;
```

Pros:

- Single command solution
- Uses existing `gh` authentication
- More robust than manual git commands

Cons:

- Requires understanding of `gh repo sync` behavior
- May need additional flags for force-sync scenarios

### Solution 2: Move `gh auth setup-git` Earlier

Move the `gh auth setup-git` call to execute BEFORE any git operations:

```javascript
export async function setupRepositoryAndClone({ ... }) {
  // Set up git authentication FIRST
  const authSetupResult = await $({ cwd: tempDir })`gh auth setup-git 2>&1`;

  // Then proceed with repository operations
  await cloneRepository(repoToClone, tempDir, argv, owner, repo);
  await setupUpstreamAndSync(tempDir, forkedRepo, upstreamRemote, owner, repo, argv);
  // ...
}
```

Pros:

- Minimal code change
- Native git commands will work after setup

Cons:

- `gh auth setup-git` may fail silently
- Adds global git configuration side effects

### Solution 3: Use Token-Embedded URLs (Not Recommended)

Configure git remote URLs to include the token:

```
https://${GITHUB_TOKEN}:x-oauth-basic@github.com/${owner}/${repo}.git
```

Pros:

- Works without credential helper

Cons:

- Token exposure in git config
- Security risk if repository is shared
- More complex to maintain

## Recommended Implementation

**Solution 1 (Use `gh repo sync`)** is the recommended approach because:

1. It's the most robust solution
2. It uses the existing `gh` authentication
3. It's specifically designed for syncing forks
4. It handles edge cases like force-sync properly

## Additional Considerations

### Concurrent Execution Issue

The user mentioned running two commands on the same fork simultaneously. While this didn't directly cause the authentication error, it could lead to:

- Race conditions when both try to sync the fork
- One command's changes being overwritten by the other
- Potential merge conflicts

Recommendation: Implement locking mechanism or better coordination for concurrent operations on the same fork.

## References

- [docker/build-push-action#1112](https://github.com/docker/build-push-action/issues/1112) - Similar issue with git authentication in Docker builds
- [mislav/hub#1644](https://github.com/mislav/hub/issues/1644) - Detailed explanation of dual authentication systems
- [Jenkins Community Forum](https://community.jenkins.io/t/fatal-could-not-read-username-for-https-github-com-no-such-device-or-address/11254) - Similar issue in CI environments
- [GitHub CLI `gh repo sync` documentation](https://cli.github.com/manual/gh_repo_sync)
- [GitHub CLI `gh auth setup-git` documentation](https://cli.github.com/manual/gh_auth_setup-git)

## Appendix: Related Files

- `src/solve.repository.lib.mjs` - Contains the failing `git push` code
- `src/solve.repo-setup.lib.mjs` - Contains the `gh auth setup-git` call (executed too late)
- `docs/case-studies/issue-1017/log1-solve-2025-12-28T05-55-01-355Z.log` - Full log for first command
- `docs/case-studies/issue-1017/log2-solve-2025-12-28T05-55-18-438Z.log` - Full log for second command
