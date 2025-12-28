# Case Study: GitHub Auth Token Invalidation Across Docker Sessions (Issue #1021)

## Executive Summary

This case study documents an investigation into GitHub authentication token invalidation that occurred when running the `gh-setup-git-identity` command across multiple environments (local Docker container and remote server). The investigation revealed that this is an expected behavior due to GitHub's OAuth token limits and the `gh auth login` token replacement mechanism.

## Issue Description

**Issue URL:** https://github.com/link-assistant/hive-mind/issues/1021

**Reported Behavior:**

> At the same time I was executing `gh-setup-git-identity` command on the remote server. And for some reason executing `gh-setup-git-identity` remotely did destroy GitHub Auth session locally in docker. That is strange. A retried it later and seems `gh-setup-git-identity` works in a such a way. If repeated, for example if I then execute `gh-setup-git-identity` locally in docker I get a problem now on server there GitHub Auth goes away.

**Key Observation:** Running `gh-setup-git-identity` on one machine caused the GitHub authentication session on another machine to become invalid.

## Timeline of Events

Based on the log file from the gist (https://gist.github.com/konard/a430347f7f9aff41b7e0c64a7289712a):

| Timestamp (UTC)                | Event                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| 2025-12-28T09:05:36            | `solve` command started in Docker container                                                         |
| 2025-12-28T09:05:42            | GitHub authentication check skipped (`--no-tool-check` enabled)                                     |
| 2025-12-28T09:05:43 - 09:06:07 | Repository operations (fork, clone, branch creation, push, PR creation) completed successfully      |
| 2025-12-28T09:06:14            | Claude AI execution started                                                                         |
| ~09:06:14 - 09:12:59           | Claude AI working on the issue (multiple tool calls)                                                |
| 2025-12-28T09:12:59            | **First authentication failure detected** - `git push` failed with "Invalid username or token"      |
| 2025-12-28T09:13:06            | `gh auth status` confirmed token invalid: "The token in /home/hive/.config/gh/hosts.yml is invalid" |

The authentication was working at 09:06:07 (successful push) but failed at 09:12:59 (approximately 7 minutes later).

## Root Cause Analysis

### Primary Root Cause: GitHub OAuth Token Limits

GitHub imposes a limit of **10 tokens per user/application/scope combination**. When this limit is exceeded, the **oldest tokens are automatically revoked**.

From [GitHub Documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation):

> "There is a limit of ten tokens that are issued per user/application/scope combination, and a rate limit of ten tokens created per hour. If an application creates more than ten tokens for the same user and the same scopes, the oldest tokens with the same user/application/scope combination are revoked."

### Secondary Cause: gh auth login Token Replacement Behavior

When `gh auth login` is executed, it:

1. Creates a new OAuth token through GitHub's device code flow
2. Stores the new token in the local credentials store
3. **Does NOT revoke the old token** on GitHub's side

From [GitHub CLI Issue #9233](https://github.com/cli/cli/issues/9233):

> "Whenever an already logged-in user runs a gh auth login or gh auth refresh, a new OAuth app token is generated and replaces the previous token in the credentials store. The problem is that the old token is not revoked during this process."

### How These Combine to Cause the Issue

```
User runs gh-setup-git-identity on:

Machine A (Docker local)    Machine B (Remote server)
         |                           |
         v                           v
    Token #1 created            (not yet)
         |                           |
         v                           v
    Stored locally              gh-setup-git-identity
         |                           |
         |                           v
         |                      Token #2 created
         |                           |
         |                           v
         |                      Stored locally
         |                           |
         |                           |
         v                           v
    ...continues...            gh-setup-git-identity
         |                      (run again)
         |                           |
         |                           v
         |                      Token #3 created
         |                           |
    ... (tokens accumulate) ...      |
         |                           |
         v                           v
    Token #1 still valid?      After 10 tokens total,
         |                      oldest tokens are
         |                      REVOKED by GitHub!
         v                           |
    Token #1 REVOKED!  <-------------+
    (oldest token removed)
```

### Timeline Hypothesis

The user likely had multiple tokens already active from previous sessions. When `gh-setup-git-identity` was run on the remote server during the solve operation, it created a new token that caused the total count to exceed 10, triggering GitHub to revoke the oldest token - which happened to be the one in use by the Docker container.

## Evidence from Logs

### Successful Authentication (Earlier)

```
[2025-12-28T09:05:55.246Z] [INFO]    Push exit code: 0
[2025-12-28T09:05:55.246Z] [INFO]    Push output: remote:
remote: Create a pull request for 'issue-133-434c3df37b90' on GitHub by visiting:
```

### Authentication Failure (Later)

```
[2025-12-28T09:12:59.875Z]
"content": "Exit code 128\nremote: Invalid username or token. Password authentication is not supported for Git operations.\nfatal: Authentication failed for 'https://github.com/konard/andchir-install_scripts.git/'",
"is_error": true
```

### gh auth status Confirmation

```
[2025-12-28T09:13:06.601Z]
"content": "Exit code 1\ngithub.com\n  X Failed to log in to github.com account konard (/home/hive/.config/gh/hosts.yml)\n  - Active account: true\n  - The token in /home/hive/.config/gh/hosts.yml is invalid.\n  - To re-authenticate, run: gh auth login -h github.com\n  - To forget about this account, run: gh auth logout -h github.com -u konard",
"is_error": true
```

## The `gh-setup-git-identity` Command

### What It Does

The `gh-setup-git-identity` command (version 0.7.0) is a utility that:

1. **Checks authentication**: Calls `gh auth status` to verify GitHub CLI is authenticated
2. **Triggers login if needed**: If not authenticated, runs `gh auth login` with specific scopes (`repo,workflow,user,read:org,gist`)
3. **Sets up git credential helper**: Runs `gh auth setup-git`
4. **Configures git identity**: Sets `git config user.name` and `git config user.email` based on GitHub profile

### Key Code Paths

From `src/index.js`:

```javascript
// runGhAuthLogin creates a new OAuth token
export async function runGhAuthLogin(options = {}) {
  const args = ['auth', 'login'];
  // ... builds arguments ...
  const result = await execInteractiveCommand('gh', args, { input: inputValue });
}
```

From `src/cli.js` (inferred from README):

```javascript
// On each run, if not authenticated, triggers gh auth login
// This creates a new token on GitHub's servers
```

### The Problem

Every time `gh-setup-git-identity` prompts for authentication, it creates a **new token**. If the user has multiple environments (Docker container, remote server, local machine, CI/CD), each authentication creates a new token without revoking old ones.

## Proposed Solutions

### Short-term Mitigations

#### 1. Use Personal Access Tokens (PATs) Instead of OAuth Flow

Instead of using `gh auth login` which creates OAuth tokens:

```bash
# Create a PAT in GitHub Settings > Developer settings > Personal access tokens
# Then use it:
echo "ghp_xxxxxxxxxxxxxxxxxxxx" | gh auth login --with-token
```

**Pros:**

- PATs don't count toward the 10-token limit
- Can be shared across multiple environments
- Explicit control over token lifecycle

**Cons:**

- Requires manual token management
- Token stored in plain text during input

#### 2. Check for Existing Valid Auth Before Login

Modify `gh-setup-git-identity` to avoid unnecessary re-authentication:

```bash
# Before running gh auth login, check if already authenticated
if gh auth status &>/dev/null; then
  echo "Already authenticated, skipping login"
else
  gh auth login ...
fi
```

**Current behavior in `gh-setup-git-identity`:** Already implements this check via `isGhAuthenticated()`, but if authentication fails or is explicitly triggered, it still creates new tokens.

#### 3. Revoke Old Tokens Manually

Users should periodically clean up old OAuth tokens:

1. Go to GitHub Settings > Applications > Authorized OAuth Apps
2. Find "GitHub CLI" entries
3. Revoke tokens that are no longer needed

#### 4. Use GITHUB_TOKEN Environment Variable

For programmatic use, set a consistent token:

```bash
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"
# Or
export GH_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"
```

### Medium-term Solutions (Code Changes)

#### 1. Add Token Reuse Logic

Modify `gh-setup-git-identity` to:

- Store a hash of the current token
- Check if the same token is already valid before creating a new one
- Warn users when approaching the 10-token limit

#### 2. Implement Token Synchronization

For multi-environment setups:

- Store token in a shared secure location (e.g., encrypted file on shared storage)
- Check shared token before creating new ones

#### 3. Add Warning Messages

Add informative warnings:

```
WARNING: You have multiple active GitHub CLI sessions.
Running gh auth login will create a new token.
If you have more than 10 active tokens, the oldest will be revoked.
```

### Long-term Solutions (Upstream Changes)

#### 1. GitHub CLI Token Revocation

As requested in [cli/cli#9233](https://github.com/cli/cli/issues/9233):

- Automatically revoke old tokens when running `gh auth login`
- This is currently blocked due to platform limitations

#### 2. Short-lived OAuth Tokens

Support for short-lived OAuth tokens ([cli/cli#5924](https://github.com/cli/cli/issues/5924)):

- Tokens would automatically expire
- Reduces the accumulation of stale tokens

## Recommendations

### For Individual Users

1. **Use PATs for multi-environment setups**
   - Create a single PAT with appropriate scopes
   - Use `gh auth login --with-token` consistently

2. **Regularly audit active tokens**
   - Visit GitHub Settings > Applications > Authorized OAuth Apps
   - Revoke unused tokens

3. **Be aware of the 10-token limit**
   - If you use GitHub CLI on multiple machines, tokens accumulate
   - Each `gh auth login` creates a new token

### For Administrators

1. **Monitor SAML SSO token lists**
   - Token bloat can occur in organizations
   - Consider periodic cleanup policies

2. **Document authentication best practices**
   - Educate users about token limits
   - Provide standard authentication procedures

### For `gh-setup-git-identity` Development

1. **Add token limit awareness**
   - Query active token count if possible
   - Warn users when approaching limits

2. **Consider token reuse**
   - If a valid token exists, don't create a new one
   - Only re-authenticate when necessary

3. **Document this behavior**
   - Add clear documentation about GitHub's token limits
   - Explain multi-environment implications

## Conclusion

The reported issue is not a bug in `gh-setup-git-identity` or the `solve` command, but rather an expected consequence of GitHub's OAuth token management:

1. **GitHub limits OAuth tokens to 10 per user/application/scope combination**
2. **When the limit is exceeded, the oldest tokens are automatically revoked**
3. **Running `gh auth login` on multiple environments creates multiple tokens**
4. **Tokens are not automatically revoked when new ones are created**

This creates a "musical chairs" scenario where the last environment to authenticate causes the first environment to lose its authentication.

## References

- [GitHub Token Expiration and Revocation Documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation)
- [GitHub CLI gh auth login Manual](https://cli.github.com/manual/gh_auth_login)
- [GitHub CLI Issue #9233: Invalidate previous OAuth token](https://github.com/cli/cli/issues/9233)
- [GitHub CLI Issue #5924: Support for short-lived OAuth tokens](https://github.com/cli/cli/issues/5924)
- [gh-setup-git-identity npm package](https://www.npmjs.com/package/gh-setup-git-identity)
- [Original Issue Gist Log](https://gist.github.com/konard/a430347f7f9aff41b7e0c64a7289712a)

## Appendix: Related Files

- `issue-1021-gist-log.txt` - Full log file from the gist (OAuth tokens have been redacted for security)
- `timeline.md` - Detailed event timeline
- `solutions.md` - Proposed solutions with implementation details
- Original gist: https://gist.github.com/konard/a430347f7f9aff41b7e0c64a7289712a

**Note:** The log file included in this case study has had OAuth tokens redacted (`gho_REDACTED_TOKEN`) for security purposes. The original log is available in the gist linked above.
