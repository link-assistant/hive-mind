# Case Study: Issue #1265 - GitHub Action Prototype for Manual Issue Solving

## Summary

Create a GitHub Action workflow that can be manually triggered with an issue URL, using free AI models (Kimi) that don't require authentication, combined with GitHub Actions' built-in authentication for the `gh` CLI tool.

## Requirements Analysis

### Primary Goals

1. **Manual Trigger**: Use `workflow_dispatch` to allow users to manually run the action with an issue URL as input
2. **Free AI Model**: Use Kimi (via `--tool agent`) which works without AI provider authentication
3. **GitHub CLI Auth**: Leverage GitHub Actions' automatic `GITHUB_TOKEN` for `gh` CLI authentication
4. **Single Run**: One GitHub Action run = one task solution (no Telegram bot needed)

### User Requirements from Issue

- Use free Kimi model (no AI authentication required)
- Use GitHub Actions auth for `gh` CLI tool
- If GitHub Actions default token doesn't work, consider:
  - Personal access token (PAT)
  - Secret with token name
  - All optional variants technically possible
- Use Docker with solve command
- No Telegram bot support needed for GitHub Actions

## Research Findings

### 1. Kimi Model - Free AI Without Authentication

Based on research and the existing `docs/FREE_MODELS.md`:

| Model               | Provider     | Context Window | Cost |
| ------------------- | ------------ | -------------- | ---- |
| `kimi-k2.5-free`    | OpenCode Zen | 262,144 tokens | Free |
| `minimax-m2.1-free` | OpenCode Zen | 204,800 tokens | Free |
| `gpt-5-nano`        | OpenCode Zen | 200,000 tokens | Free |
| `glm-4.7-free`      | OpenCode Zen | 204,800 tokens | Free |
| `big-pickle`        | OpenCode Zen | 200,000 tokens | Free |

**Key Point**: These models work with `--tool agent` and require **NO AI provider authentication**.

**Usage**:

```bash
hive --tool agent --model kimi-k2.5-free https://github.com/owner/repo/issues/123
# or using short alias
solve https://github.com/owner/repo/issues/123 --tool agent --model kimi-k2.5-free
```

### 2. GitHub Actions Authentication for `gh` CLI

#### GITHUB_TOKEN Default Behavior

GitHub automatically creates `GITHUB_TOKEN` for every workflow run. Key capabilities:

| Permission      | Scope      | What It Can Do                 |
| --------------- | ---------- | ------------------------------ |
| `contents`      | read/write | Read and push code to branches |
| `pull-requests` | read/write | Create, update, comment on PRs |
| `issues`        | read/write | Create, comment on issues      |
| `actions`       | read/write | Trigger other workflows        |
| `checks`        | read/write | Create check runs              |
| `statuses`      | read/write | Update commit statuses         |

#### Using with `gh` CLI

```yaml
- name: Run solve command
  env:
    GH_TOKEN: ${{ github.token }}
  run: |
    gh auth status
    # gh commands will use GITHUB_TOKEN automatically
```

#### Default vs Explicit Permissions

| Aspect        | Default | With `permissions` key |
| ------------- | ------- | ---------------------- |
| Contents      | read    | Must specify `write`   |
| Pull-requests | read    | Must specify `write`   |
| Issues        | read    | Must specify `write`   |

**Important**: When using `permissions` key, all unspecified permissions default to `none` (except metadata: read).

#### GITHUB_TOKEN Limitations

1. **Cannot access other repositories** - only the repository where workflow runs
2. **Cannot trigger workflows** - won't trigger new workflow runs when pushing
3. **Scoped to single repository** - cannot interact with issues/PRs in other repos
4. **Read-only for fork PRs** - limited for pull requests from forks

#### When Personal Access Token (PAT) is Needed

- Working with multiple repositories
- Triggering other workflows
- Cross-repository operations
- Higher rate limits needed

### 3. Docker Integration

The existing `docker-solve.sh` shows the pattern for running solve in Docker:

```bash
docker run --rm -it \
    -v ~/.config/gh:/workspace/.persisted-configs/gh:ro \
    -v "$(pwd)/output:/workspace/output" \
    -e GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
    hive-mind-solver \
    bash -c "./solve.mjs $*"
```

For GitHub Actions, we can use `konard/hive-mind:latest` Docker image.

## Proposed Solutions

### Solution 1: Basic GITHUB_TOKEN (Recommended for Same-Repo)

**Pros**: No additional secrets needed, automatic, secure
**Cons**: Limited to same repository, can't trigger other workflows

```yaml
name: Solve Issue

on:
  workflow_dispatch:
    inputs:
      issue_url:
        description: 'GitHub issue URL to solve'
        required: true
        type: string
      model:
        description: 'AI model to use'
        required: false
        default: 'kimi-k2.5-free'
        type: choice
        options:
          - kimi-k2.5-free
          - minimax-m2.1-free
          - gpt-5-nano

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  solve:
    runs-on: ubuntu-latest
    container:
      image: konard/hive-mind:latest
    steps:
      - name: Solve Issue
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          solve "${{ inputs.issue_url }}" --tool agent --model ${{ inputs.model }}
```

### Solution 2: Personal Access Token (For Cross-Repo)

**Pros**: Can work with any repository
**Cons**: Requires manual token creation and secret management

```yaml
name: Solve Issue (PAT)

on:
  workflow_dispatch:
    inputs:
      issue_url:
        description: 'GitHub issue URL to solve'
        required: true
      pat_secret_name:
        description: 'Name of the secret containing PAT (optional)'
        required: false
        default: 'GITHUB_TOKEN'

jobs:
  solve:
    runs-on: ubuntu-latest
    container:
      image: konard/hive-mind:latest
    steps:
      - name: Solve Issue
        env:
          GH_TOKEN: ${{ secrets[inputs.pat_secret_name] || github.token }}
        run: |
          solve "${{ inputs.issue_url }}" --tool agent --model kimi-k2.5-free
```

### Solution 3: GitHub App Token (Enterprise)

**Pros**: Fine-grained permissions, can be scoped across repos
**Cons**: Requires GitHub App setup

```yaml
- uses: actions/create-github-app-token@v1
  id: app-token
  with:
    app-id: ${{ vars.APP_ID }}
    private-key: ${{ secrets.APP_PRIVATE_KEY }}

- name: Solve Issue
  env:
    GH_TOKEN: ${{ steps.app-token.outputs.token }}
  run: solve "${{ inputs.issue_url }}" --tool agent
```

## Implementation Recommendation

For the initial prototype, implement **Solution 1** with graceful fallback to **Solution 2**:

1. Use `GITHUB_TOKEN` by default (works for same-repo issues)
2. Accept optional `pat_secret_name` input for cross-repo scenarios
3. Document both approaches clearly

## Additional Considerations

### Rate Limits

| Token Type         | Rate Limit                           |
| ------------------ | ------------------------------------ |
| GITHUB_TOKEN       | 1,000 requests/hour per repo         |
| PAT (classic)      | 5,000 requests/hour                  |
| PAT (fine-grained) | 5,000 requests/hour                  |
| GitHub App         | 5,000 requests/hour per installation |

### Security Best Practices

1. Always use minimal required permissions
2. Prefer `GITHUB_TOKEN` over PAT when possible
3. Use fine-grained PAT over classic PAT
4. Never commit tokens to repository
5. Audit token usage regularly

## References

### Internal Documentation

- [FREE_MODELS.md](../../FREE_MODELS.md) - Free AI models documentation
- [DOCKER.md](../../DOCKER.md) - Docker setup guide
- [agent.lib.mjs](../../../src/agent.lib.mjs) - Agent tool implementation

### External Sources

- [GitHub Actions - Automatic Token Authentication](https://docs.github.com/en/actions/security-guides/automatic-token-authentication)
- [Controlling GITHUB_TOKEN Permissions](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/controlling-permissions-for-github_token)
- [Manually Running a Workflow](https://docs.github.com/en/actions/managing-workflow-runs/manually-running-a-workflow)
- [GitHub CLI in Actions](https://josh-ops.com/posts/gh-auth-login-in-actions/)
- [Kimi K2.5 on OpenRouter](https://openrouter.ai/moonshotai/kimi-k2.5)
- [OpenCode Kimi K2.5 Free Guide](https://blog.wenhaofree.com/en/posts/articles/opencode-kimi-k25-free-guide/)
