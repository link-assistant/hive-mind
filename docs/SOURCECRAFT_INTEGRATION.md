# SourceCraft Integration Guide

## Overview

This document describes the SourceCraft platform integration for hive-mind. SourceCraft is a git-based code repository management platform with CI/CD capabilities, similar to GitHub.

## Current Status

### ✅ Completed Components

1. **Provider Abstraction Layer** (`src/providers/provider.interface.mjs`)
   - Defines the `RepositoryProvider` interface that all providers must implement
   - Factory function `getProviderForUrl()` to auto-detect provider from URL
   - Helper function `detectProviderFromUrl()` for provider type detection

2. **GitHub Provider** (`src/providers/github-provider.mjs`)
   - Wraps existing `github.lib.mjs` functionality to conform to provider interface
   - Uses GitHub CLI (`gh`) for all operations
   - Fully compatible with existing hive-mind workflow

3. **SourceCraft Provider** (`src/providers/sourcecraft-provider.mjs`)
   - Implements SourceCraft REST API client
   - Maps SourceCraft API to provider interface
   - Handles slug-based URLs (SourceCraft uses slugs instead of numeric IDs)

### 🚧 Integration Points (Work in Progress)

The following modules need to be updated to use the provider abstraction:

1. **solve.mjs** - Main issue solver
   - URL validation to support both GitHub and SourceCraft
   - Repository operations (clone, fork, PR creation)
   - Issue/PR fetching and commenting

2. **hive.mjs** - Orchestration system
   - Issue monitoring and fetching
   - Multi-repository support
   - Provider-aware worker spawning

3. **review.mjs** - Code review automation
   - PR fetching and analysis
   - Review comment posting

## Architecture

### Provider Interface

All repository providers must implement these core methods:

```javascript
class RepositoryProvider {
  getName()                                    // 'github' or 'sourcecraft'
  parseUrl(url)                                // Parse and validate URLs
  checkRepositoryWritePermission(owner, repo)  // Verify access
  getIssue(number, owner, repo)                // Fetch issue details
  getPullRequest(number, owner, repo)          // Fetch PR details
  createPullRequest(options)                   // Create new PR
  addComment(type, number, owner, repo, body)  // Add comment
  getComments(type, number, owner, repo)       // Get comments
  forkRepository(owner, repo)                  // Fork repository
  getCloneUrl(owner, repo)                     // Get git clone URL
  detectRepositoryVisibility(owner, repo)      // Check if public/private
  listIssues(owner, repo, options)             // List issues with filters
  listPullRequests(owner, repo, options)       // List PRs with filters
  checkAuthentication()                        // Verify auth status
}
```

### URL Format Differences

**GitHub:**
```
https://github.com/{owner}/{repo}/issues/{number}
https://github.com/{owner}/{repo}/pull/{number}
```

**SourceCraft:**
```
https://sourcecraft.dev/{org_slug}/{repo_slug}/issues/{issue_slug}
https://sourcecraft.dev/{org_slug}/{repo_slug}/pullrequests/{pr_slug}
```

**Key Difference:** SourceCraft uses slugs (text identifiers) instead of numeric IDs.

## Configuration

### Environment Variables

#### SourceCraft Authentication

```bash
# Required for SourceCraft operations
export SOURCECRAFT_API_TOKEN="your-api-token-here"
```

#### GitHub Authentication (existing)

```bash
# GitHub CLI handles this automatically
gh auth login
```

### Configuration Files

SourceCraft configuration can also be stored in:
- `~/.config/sourcecraft/config.yml`
- `.sourcecraftrc` in project root

Example `.sourcecraftrc`:
```yaml
api_token: "your-api-token-here"
default_org: "my-organization"
```

## API Integration

### SourceCraft API

**Base URL:** `https://api.sourcecraft.tech`

**Key Endpoints:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/repos/{org}/{repo}` | GET | Get repository info |
| `/repos/{org}/{repo}/issues` | GET | List issues |
| `/repos/{org}/{repo}/issues` | POST | Create issue |
| `/repos/{org}/{repo}/issues/{slug}` | GET | Get issue details |
| `/repos/{org}/{repo}/issues/{slug}/comments` | GET | Get issue comments |
| `/repos/{org}/{repo}/issues/{slug}/comments` | POST | Add issue comment |
| `/repos/{org}/{repo}/pullrequests` | GET | List PRs |
| `/repos/{org}/{repo}/pullrequests` | POST | Create PR |
| `/repos/{org}/{repo}/pullrequests/{slug}` | GET | Get PR details |
| `/repos/{org}/{repo}/pullrequests/{slug}/comments` | POST | Add PR comment |
| `/repos/{org}/{repo}/fork` | POST | Fork repository |

**Authentication:**
```bash
Authorization: Bearer {api_token}
```

### API Documentation

- Swagger/OpenAPI spec: https://api.sourcecraft.tech/sourcecraft.swagger.json
- Developer docs: https://sourcecraft.dev/portal/docs/en/

## Usage Examples

### Solving SourceCraft Issues

```bash
# Solve SourceCraft issue (auto-detect provider from URL)
solve https://sourcecraft.dev/org/repo/issues/bug-123 --model opus

# With fork mode
solve https://sourcecraft.dev/org/repo/issues/feature-456 --fork --model sonnet

# With auto-continue
solve https://sourcecraft.dev/org/repo/issues/task-789 --auto-continue --attach-logs
```

### Monitoring SourceCraft Repositories

```bash
# Monitor single SourceCraft repository
hive https://sourcecraft.dev/org/repo --monitor-tag "help wanted" --concurrency 3

# Monitor all issues
hive https://sourcecraft.dev/org/repo --all-issues --max-issues 10
```

### Reviewing SourceCraft PRs

```bash
# Review SourceCraft pull request
review --url https://sourcecraft.dev/org/repo/pullrequests/pr-123
```

## Implementation Roadmap

### Phase 1: Core Infrastructure ✅

- [x] Provider abstraction interface
- [x] GitHub provider wrapper
- [x] SourceCraft API client
- [x] URL parsing for SourceCraft

### Phase 2: solve.mjs Integration 🚧

- [ ] Update `solve.validation.lib.mjs` to support SourceCraft URLs
- [ ] Modify `solve.mjs` to use provider factory
- [ ] Update repository operations to be provider-agnostic
- [ ] Test end-to-end issue solving with SourceCraft

### Phase 3: hive.mjs Integration 🚧

- [ ] Update `hive.mjs` URL validation for SourceCraft
- [ ] Modify issue fetching to use provider interface
- [ ] Update worker spawn commands to detect provider
- [ ] Test concurrent issue processing

### Phase 4: Additional Features 📋

- [ ] review.mjs integration
- [ ] YouTrack mode compatibility
- [ ] GitHub Projects equivalent for SourceCraft
- [ ] Cross-platform PR references
- [ ] Unified authentication management

### Phase 5: Testing & Documentation 📋

- [ ] Unit tests for SourceCraft provider
- [ ] Integration tests with test SourceCraft instance
- [ ] Update README with SourceCraft examples
- [ ] Add troubleshooting guide
- [ ] Performance benchmarking

## Known Limitations

### Current Constraints

1. **Fork Support Unclear**
   - SourceCraft API docs don't clearly specify fork functionality
   - Implementation assumes `/repos/{org}/{repo}/fork` endpoint exists
   - Needs verification with actual SourceCraft instance

2. **SSH Key Management**
   - SourceCraft requires SSH keys for git operations
   - No automated SSH key setup yet
   - Users must manually configure SSH keys in SourceCraft

3. **Webhook Support**
   - No documented webhook API for SourceCraft
   - Watch mode (`--watch`) relies on polling
   - May need custom webhook implementation

4. **Rate Limiting**
   - SourceCraft rate limits unknown
   - No exponential backoff implemented yet
   - May need rate limit handling similar to GitHub

5. **Authentication Flow**
   - No CLI tool equivalent to `gh` for SourceCraft
   - Requires manual API token configuration
   - No OAuth flow implemented

### API Gaps

The following SourceCraft API features need clarification:

- **Repository permissions model** - How to check write access?
- **Pull request approval workflow** - Required reviewers?
- **Branch protection rules** - Are they supported?
- **CI/CD integration** - How to trigger pipelines?
- **Organization permissions** - How to query user roles?

## Testing

### Manual Testing

1. Set up SourceCraft API token:
   ```bash
   export SOURCECRAFT_API_TOKEN="your-token"
   ```

2. Test URL parsing:
   ```bash
   node -e "
   import('./src/providers/provider.interface.mjs').then(m => {
     const provider = m.getProviderForUrl('https://sourcecraft.dev/org/repo/issues/1');
     console.log(await provider.parseUrl('https://sourcecraft.dev/org/repo/issues/1'));
   });
   "
   ```

3. Test issue fetching:
   ```bash
   node -e "
   import('./src/providers/sourcecraft-provider.mjs').then(m => {
     const provider = new m.SourceCraftProvider();
     console.log(await provider.getIssue('issue-slug', 'org', 'repo'));
   });
   "
   ```

### Integration Testing

Create test repository on SourceCraft:
```bash
# Create test issue
curl -X POST https://api.sourcecraft.tech/repos/test-org/test-repo/issues \
  -H "Authorization: Bearer $SOURCECRAFT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Issue", "description": "Testing hive-mind integration"}'

# Test solving
solve https://sourcecraft.dev/test-org/test-repo/issues/test-1 --dry-run
```

## Troubleshooting

### Common Issues

**1. "SourceCraft API token not configured"**

Solution:
```bash
export SOURCECRAFT_API_TOKEN="your-token-here"
```

**2. "Failed to parse SourceCraft URL"**

Check URL format:
- Correct: `https://sourcecraft.dev/org/repo/issues/slug`
- Incorrect: `https://sourcecraft.dev/org/repo/issues/123` (if 123 is not the slug)

**3. "No write access to SourceCraft repository"**

Solution: Use `--fork` flag or request collaborator access

**4. "SSH key not configured"**

Solution: Configure SSH keys in SourceCraft:
1. Generate SSH key: `ssh-keygen -t ed25519 -C "your-email@example.com"`
2. Add to SourceCraft: https://sourcecraft.dev/portal/docs/en/sourcecraft/security/ssh

### Debug Mode

Enable verbose logging:
```bash
solve https://sourcecraft.dev/org/repo/issues/slug --verbose
```

Check API responses:
```bash
curl -v https://api.sourcecraft.tech/repos/org/repo \
  -H "Authorization: Bearer $SOURCECRAFT_API_TOKEN"
```

## Contributing

To contribute to SourceCraft integration:

1. Review the provider interface in `src/providers/provider.interface.mjs`
2. Test your changes with a SourceCraft test repository
3. Add tests for new functionality
4. Update documentation
5. Submit PR with descriptive commit messages

### Development Setup

```bash
# Clone hive-mind
git clone https://github.com/deep-assistant/hive-mind
cd hive-mind

# Install dependencies
npm install

# Set up SourceCraft token
export SOURCECRAFT_API_TOKEN="your-test-token"

# Run tests
npm test

# Test with dry-run
./solve.mjs https://sourcecraft.dev/org/repo/issues/test --dry-run --verbose
```

## Resources

- **SourceCraft Website:** https://sourcecraft.dev
- **API Documentation:** https://api.sourcecraft.tech/sourcecraft.swagger.json
- **Developer Portal:** https://sourcecraft.dev/portal/docs/en/
- **SSH Setup Guide:** https://sourcecraft.dev/portal/docs/en/sourcecraft/security/ssh
- **Personal Access Tokens:** https://sourcecraft.dev/portal/docs/en/sourcecraft/security/pat

## Future Enhancements

### Planned Features

1. **SourceCraft CLI Tool**
   - Similar to `gh` for GitHub
   - Simplify authentication and common operations
   - Integrate with system keychain

2. **Unified Configuration**
   - Single config file for both GitHub and SourceCraft
   - Profile management (dev, prod, personal, work)
   - Credential encryption

3. **Cross-Platform Features**
   - Link GitHub and SourceCraft issues
   - Sync PR status between platforms
   - Unified search across providers

4. **Enhanced Analytics**
   - Track success rates per provider
   - Compare performance metrics
   - Provider-specific optimizations

5. **Plugin System**
   - Allow third-party providers
   - Custom provider implementations
   - Provider-specific extensions

## Support

For SourceCraft integration issues:
- Open an issue: https://github.com/deep-assistant/hive-mind/issues
- Tag with `sourcecraft` label
- Include provider detection output
- Attach debug logs (with tokens redacted)

## License

This integration follows the main hive-mind license (Unlicense).
