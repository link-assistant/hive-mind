# Hive-Mind Coolify Deployment Guide

This guide explains how to deploy the Hive-Mind application to Coolify, a self-hosted PaaS platform.

## Prerequisites

1. **Coolify Instance**: A running Coolify installation (v4+)
2. **GitHub Token**: Personal access token with repo permissions
3. **Claude API Key**: For AI-powered issue solving (optional but recommended)
4. **Server Requirements**:
   - Minimum 2GB RAM (4GB+ recommended)
   - 2+ CPU cores
   - 10GB+ disk space

## Deployment Methods

### Method 1: Direct GitHub Repository Deployment (Recommended)

1. **In Coolify Dashboard**:
   - Click "New Resource" → "Docker Compose"
   - Select your server and destination

2. **Configure Source**:
   - Source: "GitHub Repository"
   - Repository: `https://github.com/your-fork/hive-mind`
   - Branch: `main`
   - Build Path: `/coolify`
   - Docker Compose File: `docker-compose.yml`

3. **Set Environment Variables**:

   ```bash
   GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   GITHUB_URL=https://github.com/org-or-repo-to-monitor
   CLAUDE_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

4. **Deploy**:
   - Click "Deploy"
   - Monitor build logs
   - Application will start automatically

### Method 2: Docker Image Deployment

1. **Build and Push Image** (on your local machine):

   ```bash
   cd hive-mind/coolify
   docker build -t your-registry/hive-mind:latest -f Dockerfile ..
   docker push your-registry/hive-mind:latest
   ```

2. **In Coolify**:
   - New Resource → Docker Image
   - Image: `your-registry/hive-mind:latest`
   - Add environment variables (see below)

### Method 3: Docker Compose with Raw Configuration

1. **In Coolify**:
   - New Resource → Docker Compose
   - Select "Raw Docker Compose"

2. **Paste the docker-compose.yml** from this directory

3. **Configure environment variables**

## Environment Variables Configuration

### Required Variables

| Variable         | Description                                           | Example             |
| ---------------- | ----------------------------------------------------- | ------------------- |
| `GITHUB_TOKEN`   | GitHub personal access token                          | `ghp_xxxxxxxxxxxx`  |
| `CLAUDE_API_KEY` | Claude/Anthropic API key (or configure interactively) | `sk-ant-xxxxxxxxxx` |

### Specifying What to Monitor

You can specify the GitHub repository or organization to monitor in two ways:

1. **As a command argument** (most flexible):

   ```bash
   # In Coolify, set the command to:
   node hive.mjs https://github.com/facebook/react
   ```

2. **As an environment variable**:
   ```bash
   GITHUB_URL=https://github.com/microsoft
   ```

### Optional Variables

| Variable       | Default       | Description                         |
| -------------- | ------------- | ----------------------------------- |
| `MONITOR_TAG`  | `help wanted` | GitHub label to monitor             |
| `ALL_ISSUES`   | `false`       | Process all open issues             |
| `CONCURRENCY`  | `2`           | Concurrent solve processes          |
| `INTERVAL`     | `300`         | Polling interval (seconds)          |
| `MODEL`        | `sonnet`      | AI model (opus/sonnet)              |
| `FORK`         | `false`       | Work in fork instead of branch      |
| `MAX_ISSUES`   | `0`           | Max issues to process (0=unlimited) |
| `VERBOSE`      | `false`       | Enable verbose logging              |
| `CPU_LIMIT`    | `2`           | CPU core limit                      |
| `MEMORY_LIMIT` | `4G`          | Memory limit                        |

## Setting Up Credentials

### GitHub Token

1. Go to GitHub → Settings → Developer Settings → Personal Access Tokens
2. Generate new token (classic) with scopes:
   - `repo` (full control)
   - `workflow` (if modifying GitHub Actions)
3. Copy token and add to Coolify environment variables

### Claude Configuration

You have two options for Claude authentication:

#### Option 1: API Key (Traditional)

1. Sign up at [Anthropic Console](https://console.anthropic.com)
2. Create API key
3. Add to Coolify as `CLAUDE_API_KEY`

#### Option 2: Claude Max Plan (Recommended for heavy usage)

If you have a Claude Max subscription with unlimited usage:

1. **Deploy the container first** with empty `CLAUDE_API_KEY`

2. **Access the container terminal in Coolify**:
   - Go to your application in Coolify
   - Click "Terminal" tab
   - You'll get a shell into the running container

3. **Run Claude authentication interactively**:

   ```bash
   # For Claude Code users:
   claude
   # or
   code

   # Follow the prompts to authenticate with your Claude account
   # This will open a browser authentication flow
   ```

4. **Verify authentication**:

   ```bash
   claude api "Hello, are you working?"
   ```

5. **Important**: Your authentication will persist across container restarts because we mount:
   - `~/.claude` directory as persistent volume
   - `~/.config` directory as persistent volume

This method gives you unlimited API usage through your Claude Max subscription instead of pay-per-token API pricing.

### Git Configuration (Optional)

If you need specific git config:

1. Create a `.gitconfig` file locally
2. Mount it as a volume in Coolify:
   ```yaml
   volumes:
     - ./git-config:/home/hive/.gitconfig:ro
   ```

## Persistent Storage

### Important Volumes

The docker-compose.yml configures several persistent volumes that Coolify will manage:

| Volume            | Container Path          | Purpose                            |
| ----------------- | ----------------------- | ---------------------------------- |
| `./claude-config` | `/home/hive/.claude`    | Claude authentication & settings   |
| `./config`        | `/home/hive/.config`    | General config (Claude Code, etc.) |
| `./gh-config`     | `/home/hive/.config/gh` | GitHub CLI config                  |
| `./output`        | `/app/output`           | Generated PRs and code             |
| `./logs`          | `/app/claude-logs`      | Execution logs                     |
| `./sessions`      | `/app/claude-sessions`  | Session data                       |

**Note**: These volumes are automatically created by Coolify and will persist across container updates and restarts.

## Monitoring & Logs

### View Logs in Coolify

1. Go to your application in Coolify
2. Click "Logs" tab
3. You'll see real-time logs from the hive-mind process

### Health Checks

The container includes a health check that verifies the main process is running. Coolify will automatically restart if unhealthy.

### Access Container Terminal

To access the container for debugging or configuration:

1. In Coolify, go to your application
2. Click "Terminal" tab
3. You now have shell access for:
   - Running `claude` or `code` for authentication
   - Checking logs: `tail -f /app/claude-logs/*`
   - Debugging issues: `ps aux`, `df -h`, etc.

## Common Issues & Troubleshooting

### Container Keeps Restarting

**Problem**: Health check failing
**Solution**:

- Check if `GITHUB_URL` is provided
- Verify GitHub token is valid
- Increase memory limit if OOM

### GitHub Authentication Fails

**Problem**: Cannot access repositories
**Solution**:

- Verify `GITHUB_TOKEN` has correct permissions
- Check token hasn't expired
- For private repos, ensure token has `repo` scope

### Claude API Errors

**Problem**: AI features not working
**Solution**:

- Verify `CLAUDE_API_KEY` is correct
- Check API rate limits
- Ensure billing is active on Anthropic account

### High Memory Usage

**Problem**: Container using too much memory
**Solution**:

- Reduce `CONCURRENCY` setting
- Increase `MEMORY_LIMIT`
- Process fewer issues with `MAX_ISSUES`

### Slow Processing

**Problem**: Issues taking too long
**Solution**:

- Increase `CPU_LIMIT`
- Use `sonnet` model instead of `opus`
- Reduce `PULL_REQUESTS_PER_ISSUE`

## Advanced Configuration

### Custom Command Arguments

Override the default command in Coolify:

```bash
node hive.mjs https://github.com/org/repo --all-issues --concurrency 4
```

### Resource Scaling

For high-volume processing:

```yaml
CPU_LIMIT=4
MEMORY_LIMIT=8G
CONCURRENCY=4
```

### Network Configuration

If you need to connect to other services:

1. Create a network in Coolify
2. Attach both services to the same network
3. Use service names for internal communication

## Security Considerations

1. **Never commit** `.env` files with real credentials
2. **Use Coolify secrets** for sensitive values
3. **Rotate tokens** regularly
4. **Limit permissions** to minimum required
5. **Monitor usage** for unusual activity

## Updating

To update to the latest version:

1. **In Coolify**:
   - Go to your application
   - Click "Redeploy"
   - Or enable "Auto Deploy" for automatic updates

2. **Manual Update**:
   ```bash
   docker pull your-image:latest
   # Then redeploy in Coolify
   ```

## Support

- **Hive-Mind Issues**: https://github.com/link-assistant/hive-mind/issues
- **Coolify Documentation**: https://coolify.io/docs
- **Coolify Discord**: https://discord.gg/coolify

## Example Deployment Commands

### Monitor a specific repository

```bash
GITHUB_URL=https://github.com/facebook/react
MONITOR_TAG="good first issue"
```

### Monitor an entire organization

```bash
GITHUB_URL=https://github.com/microsoft
ALL_ISSUES=true
CONCURRENCY=4
```

### Test with dry run

```bash
GITHUB_URL=https://github.com/test/repo
DRY_RUN=true
VERBOSE=true
```
