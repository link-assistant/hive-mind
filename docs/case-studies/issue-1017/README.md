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

### Primary Cause: Git Credential Helper Not Configured

The error occurred because the `gh-setup-git-identity` GitHub Action (used in Docker container setup) was not running `gh auth setup-git` to configure git to use GitHub CLI as a credential helper.

The workflow uses:

1. `gh repo clone` for cloning - **Works correctly** because `gh` handles authentication internally
2. `git push origin main` for syncing fork - **Fails** because native git doesn't have credentials configured

### Key Issue: Dual Authentication Systems

As documented in [mislav/hub#1644](https://github.com/mislav/hub/issues/1644):

- `gh` CLI has its own authentication (using `GITHUB_TOKEN` or `gh auth login`)
- Git has its own credential system (stored credentials, credential helpers)
- These two systems are completely independent
- Just because `gh auth status` shows authenticated doesn't mean native `git` commands will work

### Contributing Factor: Non-Interactive Environment (Docker Container)

Git's default behavior when encountering authentication issues is to prompt the user for credentials. In a Docker container:

- There is no TTY (terminal) attached
- Git cannot open `/dev/tty` to prompt for credentials
- This results in the cryptic error: "No such device or address"

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

## Solution: Fix Applied in gh-setup-git-identity Action

The fix was implemented in the external `gh-setup-git-identity` GitHub Action:

**Fix PR:** https://github.com/link-foundation/gh-setup-git-identity/pull/25

### What the Fix Does

The `gh-setup-git-identity` action now automatically runs `gh auth setup-git` after successful authentication. This command:

1. Configures git to use GitHub CLI as a credential helper
2. Bridges the gap between `gh` authentication and git's credential system
3. Ensures native `git push` commands work in non-interactive environments

### Key Changes in gh-setup-git-identity PR #25

1. **New Function `runGhAuthSetupGit()`:** Configures git to use GitHub CLI as credential helper
2. **CLI Integration:** Automatically runs `gh auth setup-git -h <hostname>` after successful `gh auth login`
3. **Fallback for Already Authenticated:** Also runs setup when already authenticated to ensure proper configuration

### Why No Code Changes Needed in hive-mind

Since the fix is in the external `gh-setup-git-identity` action:

- The action is used when setting up Docker containers for the solve process
- With the fix applied, `gh auth setup-git` runs automatically during container setup
- Native `git push` commands will work correctly because the credential helper is configured
- No changes to `src/solve.repository.lib.mjs` are needed

## Alternative Solutions Considered

### Solution A: Use `gh repo sync` Instead of `git push`

Replace direct `git push` commands with `gh repo sync` which uses GitHub's authenticated API directly.

Pros:
- Uses existing `gh` authentication
- More robust than manual git commands

Cons:
- Requires code changes in hive-mind
- May introduce subtle behavior differences

### Solution B: Token-Embedded URLs (Not Recommended)

Configure git remote URLs to include the token:

```
https://${GITHUB_TOKEN}:x-oauth-basic@github.com/${owner}/${repo}.git
```

Cons:
- Token exposure in git config
- Security risk if repository is shared
- More complex to maintain

## Additional Considerations

### Concurrent Execution Issue

The user mentioned running two commands on the same fork simultaneously. While this didn't directly cause the authentication error, it could lead to:

- Race conditions when both try to sync the fork
- One command's changes being overwritten by the other
- Potential merge conflicts

## References

- [link-foundation/gh-setup-git-identity#25](https://github.com/link-foundation/gh-setup-git-identity/pull/25) - The actual fix PR
- [docker/build-push-action#1112](https://github.com/docker/build-push-action/issues/1112) - Similar issue with git authentication in Docker builds
- [mislav/hub#1644](https://github.com/mislav/hub/issues/1644) - Detailed explanation of dual authentication systems
- [Jenkins Community Forum](https://community.jenkins.io/t/fatal-could-not-read-username-for-https-github-com-no-such-device-or-address/11254) - Similar issue in CI environments
- [GitHub CLI `gh auth setup-git` documentation](https://cli.github.com/manual/gh_auth_setup-git)

## Appendix: Related Files

- `docs/case-studies/issue-1017/log1-solve-2025-12-28T05-55-01-355Z.log` - Full log for first command
- `docs/case-studies/issue-1017/log2-solve-2025-12-28T05-55-18-438Z.log` - Full log for second command
