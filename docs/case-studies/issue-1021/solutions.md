# Issue #1021: Proposed Solutions

## Problem Summary

When running `gh-setup-git-identity` on multiple machines, GitHub's OAuth token limit (10 tokens per user/application/scope) can be exceeded, causing the oldest tokens to be automatically revoked. This breaks authentication on machines using those older tokens.

## Solution Categories

### 1. Immediate Workarounds (No Code Changes)

#### A. Use Personal Access Tokens (PATs)

Instead of OAuth device flow, use a Personal Access Token:

```bash
# 1. Create a PAT at: https://github.com/settings/tokens
#    Select scopes: repo, workflow, user, read:org, gist

# 2. Authenticate with the PAT
echo "ghp_your_token_here" | gh auth login --with-token

# 3. (Optional) Set up git credential helper
gh auth setup-git
```

**Advantages:**
- PATs don't count toward the 10-token OAuth limit
- Single token works across all environments
- Explicit control over token lifetime

**Disadvantages:**
- Token must be managed manually
- Token visible during input (use secure methods in scripts)

#### B. Token Cleanup Before Multi-Machine Use

Before using `gh-setup-git-identity` on a new machine:

1. Visit https://github.com/settings/applications
2. Find "GitHub CLI" under "Authorized OAuth Apps"
3. Click on it and review active tokens
4. Revoke tokens you no longer need

#### C. Sequential Authentication (Avoid Parallel Sessions)

If you must use OAuth flow:
- Don't authenticate on multiple machines simultaneously
- Wait for one session to complete before starting another
- Be aware that each `gh auth login` creates a new token

### 2. Code Changes to `gh-setup-git-identity`

#### A. Add Check for Existing Valid Token

```javascript
// Before triggering gh auth login, verify if current token is valid
export async function setupGitIdentity(options = {}) {
  // Check if already authenticated with a working token
  const isAuthenticated = await isGhAuthenticated(options);

  if (isAuthenticated) {
    // Also verify the token actually works (not just stored)
    const tokenWorks = await verifyTokenWorks(options);
    if (tokenWorks) {
      options.logger?.log('Using existing valid authentication');
      // Skip re-authentication, proceed with identity setup
      return await configureGitIdentity(options);
    }
  }

  // Only if not authenticated or token invalid, proceed with login
  await runGhAuthLogin(options);
  // ...
}

async function verifyTokenWorks(options = {}) {
  // Make a simple API call to verify token works
  const result = await execCommand('gh', ['api', 'user']);
  return result.exitCode === 0;
}
```

#### B. Add Warning About Multi-Environment Usage

```javascript
// Add warning when running authentication
export async function runGhAuthLogin(options = {}) {
  const log = createDefaultLogger(options);

  log.warn(() => `
WARNING: Running gh auth login creates a new OAuth token.
GitHub limits you to 10 OAuth tokens per application.
If you use GitHub CLI on multiple machines, old tokens may be revoked.
Consider using a Personal Access Token instead:
  echo "your_pat" | gh auth login --with-token
`);

  // ... rest of authentication logic
}
```

#### C. Add Token Count Awareness (If API Allows)

```javascript
// Check current token count before creating new one
async function getActiveTokenCount() {
  // Note: This may not be possible via public API
  // Would need to check GitHub API capabilities
  const result = await execCommand('gh', [
    'api',
    '/applications/:client_id/tokens',
    '--method', 'GET'
  ]);
  // Parse and return count
}
```

### 3. Hive-Mind System Level Solutions

#### A. Shared Token Store

For Docker-based deployments:

```yaml
# docker-compose.yml
services:
  hive-worker:
    volumes:
      # Share the gh config directory across containers
      - gh-config:/home/hive/.config/gh
    environment:
      - GH_TOKEN=${GH_TOKEN}  # Or use environment variable

volumes:
  gh-config:
    # Persistent volume for shared token
```

#### B. Token Injection at Runtime

```bash
# startup-script.sh
# Use a pre-configured token from secrets management
if [ -n "$HIVE_GH_TOKEN" ]; then
  echo "$HIVE_GH_TOKEN" | gh auth login --with-token
  echo "Using shared authentication token"
else
  # Fallback to interactive authentication
  gh-setup-git-identity
fi
```

#### C. Token Refresh Mechanism

```javascript
// Add to solve.mjs or similar
async function ensureAuthentication() {
  const status = await execCommand('gh', ['auth', 'status']);

  if (status.exitCode !== 0) {
    // Token invalid, check for shared token
    const sharedToken = process.env.HIVE_GH_TOKEN;
    if (sharedToken) {
      await execCommand('gh', ['auth', 'login', '--with-token'], {
        input: sharedToken
      });
    } else {
      throw new Error('Authentication lost. Please re-authenticate manually.');
    }
  }
}
```

### 4. Documentation Improvements

#### A. Update README with Multi-Environment Guidance

Add to `gh-setup-git-identity` README:

```markdown
## Multi-Environment Usage

GitHub limits OAuth tokens to 10 per user per application. If you use
`gh-setup-git-identity` on multiple machines, be aware that:

1. Each `gh auth login` creates a new token
2. When you exceed 10 tokens, the oldest is automatically revoked
3. This may invalidate sessions on other machines

**Recommended Approach for Multiple Machines:**

Use a Personal Access Token instead of OAuth:

\`\`\`bash
# Create PAT at https://github.com/settings/tokens
# Then use:
echo "ghp_your_token" | gh auth login --with-token
gh auth setup-git
\`\`\`
```

#### B. Add Troubleshooting Section

```markdown
## Troubleshooting

### "The token is invalid" Error

If you see this error, your OAuth token may have been revoked because:

1. You authenticated on another machine (10-token limit exceeded)
2. The token expired (unused for 1 year)
3. The token was revoked manually

**Solution:** Re-authenticate with `gh auth login` or use a PAT.
```

### 5. Upstream Contributions

#### A. GitHub CLI Feature Request

Support automatic token revocation:
- Reference: https://github.com/cli/cli/issues/9233
- Request: Revoke old tokens when creating new ones

#### B. Short-Lived Tokens

Support short-lived OAuth tokens:
- Reference: https://github.com/cli/cli/issues/5924
- Benefit: Tokens auto-expire, reducing accumulation

## Implementation Priority

| Priority | Solution | Effort | Impact |
|----------|----------|--------|--------|
| High | Document PAT usage | Low | High |
| High | Add warning message | Low | Medium |
| Medium | Check existing valid token | Medium | High |
| Medium | Shared token store | Medium | High |
| Low | Token count awareness | High | Medium |
| Low | Upstream contributions | High | Long-term |

## Recommended Implementation Order

1. **Immediate:** Update documentation with PAT guidance
2. **Short-term:** Add warning about multi-environment usage
3. **Medium-term:** Implement token validation before re-auth
4. **Long-term:** Implement shared token infrastructure
