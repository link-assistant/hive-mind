# GitHub Actions Integration

This document describes how to use the **Solve Issue** GitHub Action to automatically solve GitHub issues using AI.

## Overview

The `solve-issue.yml` workflow enables you to:

- Manually trigger issue solving from the GitHub UI
- Use free AI models (Kimi, etc.) that require no AI provider authentication
- Leverage GitHub's automatic authentication for the `gh` CLI
- Optionally use a Personal Access Token for cross-repository access

## Quick Start

### 1. Navigate to Actions

1. Go to your repository on GitHub
2. Click the **Actions** tab
3. Select **Solve Issue** from the workflows list
4. Click **Run workflow**

### 2. Fill in Parameters

| Parameter           | Required | Description                                                              |
| ------------------- | -------- | ------------------------------------------------------------------------ |
| `issue_url`         | Yes      | Full GitHub issue URL (e.g., `https://github.com/owner/repo/issues/123`) |
| `model`             | No       | AI model to use (default: `kimi-k2.5-free`)                              |
| `auto_pull_request` | No       | Create draft PR before solving (default: `true`)                         |
| `auto_fork`         | No       | Fork repo if no write access (default: `false`)                          |
| `verbose`           | No       | Enable verbose logging (default: `false`)                                |
| `pat_secret_name`   | No       | Secret name for cross-repo PAT (optional)                                |

### 3. Click "Run workflow"

The workflow will:

1. Validate the issue URL
2. Check repository access
3. Run the solve command with the specified AI model
4. Create a pull request with the solution

## Available AI Models

All models are free and require **no AI provider authentication**:

| Model                      | Provider     | Context     | Best For                        |
| -------------------------- | ------------ | ----------- | ------------------------------- |
| `kimi-k2.5-free` (default) | OpenCode Zen | 262K tokens | Large context tasks, multimodal |
| `minimax-m2.1-free`        | OpenCode Zen | 204K tokens | Efficient inference             |
| `gpt-5-nano`               | OpenCode Zen | 200K tokens | General reasoning               |
| `glm-4.7-free`             | OpenCode Zen | 204K tokens | Coding performance              |
| `big-pickle`               | OpenCode Zen | 200K tokens | Balanced performance            |

## Authentication Methods

### Default: GITHUB_TOKEN (Recommended)

The workflow uses GitHub's automatic `GITHUB_TOKEN` by default. This token:

- Is automatically created for every workflow run
- Requires no manual setup
- Has permissions scoped to the current repository
- Can read/write issues, PRs, and code in the same repository

**Permissions configured in workflow:**

```yaml
permissions:
  contents: write # Push code to branches
  pull-requests: write # Create and update PRs
  issues: write # Comment on issues
```

### Optional: Personal Access Token (PAT)

Use a PAT when you need to:

- Solve issues in a **different repository**
- Have **higher rate limits**
- Trigger **other workflows** from your changes

#### Setting up a PAT:

1. Go to [GitHub Settings > Developer Settings > Personal Access Tokens](https://github.com/settings/tokens?type=beta)
2. Click **Generate new token** (fine-grained)
3. Select required permissions:
   - `Contents: Read and write`
   - `Pull requests: Read and write`
   - `Issues: Read and write`
4. Add the token as a repository secret:
   - Go to **Settings > Secrets and variables > Actions**
   - Click **New repository secret**
   - Name it (e.g., `HIVE_MIND_PAT`)
5. When running the workflow, enter the secret name in `pat_secret_name`

## Examples

### Example 1: Solve an Issue in the Same Repository

```
issue_url: https://github.com/your-org/your-repo/issues/42
model: kimi-k2.5-free
auto_pull_request: true
auto_fork: false
verbose: false
pat_secret_name: (leave empty)
```

### Example 2: Solve an Issue in Another Repository

```
issue_url: https://github.com/other-org/other-repo/issues/123
model: kimi-k2.5-free
auto_pull_request: true
auto_fork: true
verbose: true
pat_secret_name: HIVE_MIND_PAT
```

### Example 3: Solve a Public Issue Without Write Access

```
issue_url: https://github.com/open-source-project/repo/issues/456
model: gpt-5-nano
auto_pull_request: true
auto_fork: true
verbose: false
pat_secret_name: (leave empty for public repos with auto-fork)
```

## Workflow Outputs

After the workflow completes, check:

1. **Job Summary**: Click on the completed workflow run to see a summary table with:
   - Input parameters used
   - Recent PRs in the repository

2. **Logs**: Expand the job steps to see detailed execution logs

3. **Pull Request**: If successful, a new PR will be created linking to the original issue

## Troubleshooting

### "Invalid GitHub issue/PR URL format"

Ensure the URL follows this pattern:

```
https://github.com/owner/repo/issues/123
https://github.com/owner/repo/pull/456
```

### "No write access - may need --auto-fork or PAT"

**For public repositories**: Enable `auto_fork: true`

**For private repositories**:

1. Create a PAT with appropriate permissions
2. Add it as a repository secret
3. Enter the secret name in `pat_secret_name`

### "Could not fetch PRs"

This may happen when:

- Using `GITHUB_TOKEN` for a different repository
- The repository is private and token lacks access

**Solution**: Use a PAT with access to the target repository.

### Rate Limiting

| Token Type   | Rate Limit          |
| ------------ | ------------------- |
| GITHUB_TOKEN | 1,000 requests/hour |
| PAT          | 5,000 requests/hour |

If you hit rate limits, consider using a PAT for higher limits.

## Security Considerations

1. **Prefer GITHUB_TOKEN** when possible - it's automatic and has minimal scope
2. **Use fine-grained PATs** over classic tokens - they have more granular permissions
3. **Never commit tokens** to the repository
4. **Review generated PRs** before merging - AI solutions should always be reviewed

## Comparison with Other Methods

| Method         | Use Case           | Setup   | Cross-Repo |
| -------------- | ------------------ | ------- | ---------- |
| GitHub Actions | CI/CD integration  | Easy    | PAT needed |
| Docker         | Local development  | Medium  | Yes        |
| CLI            | Direct usage       | Easy    | Yes        |
| Telegram Bot   | Team collaboration | Complex | Yes        |

## Related Documentation

- [FREE_MODELS.md](./FREE_MODELS.md) - Details on free AI models
- [DOCKER.md](./DOCKER.md) - Running in Docker
- [CONFIGURATION.md](./CONFIGURATION.md) - Full configuration options
- [Case Study: Issue #1265](./case-studies/issue-1265/README.md) - Research and design details
