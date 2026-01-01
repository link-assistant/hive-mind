# Hive Mind: Usage Guide

This document covers how to use Hive Mind after installation. For installation instructions, see:

- [README.md](../README.md) - Quick start and Ubuntu 24.04 server installation
- [DOCKER.md](./DOCKER.md) - Docker installation
- [HELM.md](./HELM.md) - Kubernetes/Helm installation

## Prerequisites

Before using Hive Mind, ensure you have completed authentication:

1. **GitHub CLI authentication** - Required for repository access
2. **Claude authentication** - Required for AI operations

If you haven't authenticated yet, see the [Authentication](#authentication) section below.

## Usage Options

Once your environment is set up (via any installation method), you can use Hive Mind in two ways:

1. **[CLI (Command Line)](#cli-usage)** - Direct terminal commands
2. **[Telegram Bot](#telegram-bot)** - Remote control via Telegram

---

## CLI Usage

### solve - Solve GitHub Issues

The `solve` command automatically resolves GitHub issues by creating pull requests.

```bash
solve <issue-url> [options]
```

**Examples:**

```bash
# Solve using maximum power
solve https://github.com/owner/repo/issues/123 --auto-continue --attach-logs --verbose --model opus --auto-fork --think max

# Solve with auto-fork if no write access
solve https://github.com/owner/repo/issues/123 --auto-fork --model sonnet

# Solve issue with PR to custom branch (manual fork mode)
solve https://github.com/owner/repo/issues/123 --base-branch develop --fork

# Continue working on existing PR
solve https://github.com/owner/repo/pull/456 --model opus

# Resume from Claude session when limit is reached
solve https://github.com/owner/repo/issues/123 --resume session-id

# Dry run to see what would happen
solve https://github.com/owner/repo/issues/123 --dry-run
```

**Most frequently used options:**

| Option    | Alias | Description                             | Default |
| --------- | ----- | --------------------------------------- | ------- |
| `--model` | `-m`  | AI model to use (sonnet, opus, haiku)   | sonnet  |
| `--think` |       | Thinking level (low, medium, high, max) | -       |

**Other useful options:**

| Option          | Alias | Description                                   | Default |
| --------------- | ----- | --------------------------------------------- | ------- |
| `--tool`        |       | AI tool (claude, opencode, codex, agent)      | claude  |
| `--verbose`     | `-v`  | Enable verbose logging                        | false   |
| `--attach-logs` |       | Attach logs to PR (may expose sensitive data) | false   |
| `--help`        | `-h`  | Show all available options                    | -       |

> **Full options list**: See [CONFIGURATION.md](./CONFIGURATION.md#solve-options) for all available options including forking, auto-continue, watch mode, and experimental features.

### hive - Orchestrate Multiple Issues

The `hive` command monitors repositories and solves multiple issues automatically.

```bash
hive <github-url> [options]
```

**Examples:**

```bash
# Monitor single repository with specific label
hive https://github.com/owner/repo --monitor-tag "bug" --concurrency 4

# Monitor all issues in an organization with auto-fork
hive https://github.com/microsoft --all-issues --max-issues 20 --once --auto-fork

# Monitor user repositories with high concurrency
hive https://github.com/username --all-issues --concurrency 8 --interval 120 --auto-fork

# Skip issues that already have PRs
hive https://github.com/org/repo --skip-issues-with-prs --verbose

# Auto-cleanup temporary files and auto-fork if needed
hive https://github.com/org/repo --auto-cleanup --auto-fork --concurrency 5
```

**Most frequently used options:**

| Option         | Alias | Description                             | Default |
| -------------- | ----- | --------------------------------------- | ------- |
| `--model`      | `-m`  | AI model to use (sonnet, opus, haiku)   | sonnet  |
| `--think`      |       | Thinking level (low, medium, high, max) | -       |
| `--all-issues` | `-a`  | Monitor all issues (ignore labels)      | false   |
| `--once`       |       | Single run (don't monitor continuously) | false   |

**Other useful options:**

| Option                   | Alias | Description                                    | Default |
| ------------------------ | ----- | ---------------------------------------------- | ------- |
| `--tool`                 |       | AI tool (claude, opencode, agent)              | claude  |
| `--concurrency`          | `-c`  | Number of parallel workers                     | 2       |
| `--skip-issues-with-prs` | `-s`  | Skip issues with existing PRs                  | false   |
| `--verbose`              | `-v`  | Enable verbose logging                         | false   |
| `--attach-logs`          |       | Attach logs to PRs (may expose sensitive data) | false   |
| `--help`                 | `-h`  | Show all available options                     | -       |

> **Full options list**: See [CONFIGURATION.md](./CONFIGURATION.md#hive-options) for all available options including project monitoring, YouTrack integration, and experimental features.

### Session Management

```bash
# Resume when Claude hits limit
solve https://github.com/owner/repo/issues/123 --resume 657e6db1-6eb3-4a8d

# Continue session interactively in Claude Code
(cd /tmp/gh-issue-solver-123456789 && claude --resume session-id)
```

### Monitoring & Logging

Find resume commands in logs:

```bash
grep -E '\(cd /tmp/gh-issue-solver-[0-9]+ && claude --resume [0-9a-f-]{36}\)' hive-*.log
```

---

## Telegram Bot

The Telegram bot provides remote control of Hive Mind from any device.

### Test Drive

Want to see the Hive Mind in action? Join our Telegram channel:

**[Join https://t.me/hive_mind_pull_requests](https://t.me/hive_mind_pull_requests)**

### Starting the Bot

**Using Links Notation (recommended):**

```bash
screen -S bot # Enter new screen for bot

hive-telegram-bot --configuration "
  TELEGRAM_BOT_TOKEN: '849...355:AAG...rgk_YZk...aPU'
  TELEGRAM_ALLOWED_CHATS:
    -1002975819706
    -1002861722681
  TELEGRAM_HIVE_OVERRIDES:
    --all-issues
    --once
    --skip-issues-with-prs
    --attach-logs
    --verbose
    --no-tool-check
    --auto-continue-on-limit-reset
  TELEGRAM_SOLVE_OVERRIDES:
    --attach-logs
    --verbose
    --no-tool-check
    --auto-continue-on-limit-reset
  TELEGRAM_BOT_VERBOSE: true
"

# Press CTRL + A + D for detach from screen
```

**Using individual command-line options:**

```bash
screen -S bot # Enter new screen for bot

hive-telegram-bot --token 849...355:AAG...rgk_YZk...aPU --allowed-chats "(
  -1002975819706
  -1002861722681
)" --hive-overrides "(
  --all-issues
  --once
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
  --auto-continue-on-limit-reset
)" --solve-overrides "(
  --attach-logs
  --verbose
  --no-tool-check
  --auto-continue-on-limit-reset
)" --verbose

# Press CTRL + A + D for detach from screen
```

**Note:** Register your own bot with https://t.me/BotFather to get the bot token.

### Bot Commands

All commands work in **group chats only** (not in private messages):

#### `/solve` - Solve GitHub Issues

```
/solve <github-url> [options]

Examples:
/solve https://github.com/owner/repo/issues/123 --model sonnet
/solve https://github.com/owner/repo/issues/123 --model opus --think max
```

#### `/hive` - Run Hive Orchestration

```
/hive <github-url> [options]

Examples:
/hive https://github.com/owner/repo
/hive https://github.com/owner/repo --all-issues --max-issues 10
/hive https://github.com/microsoft --all-issues --concurrency 3
```

#### `/limits` - Show Usage Limits

```
/limits

Shows:
- CPU usage and load average
- RAM usage (used vs total)
- Disk space usage
- GitHub API rate limits
- Claude usage limits (session and weekly)
```

#### `/help` - Get Help and Diagnostic Info

```
/help

Shows:
- Chat ID (needed for TELEGRAM_ALLOWED_CHATS)
- Chat type
- Available commands
- Usage examples
```

### Bot Features

- **Group Chat Only**: Commands work only in group chats (not private messages)
- **Full Options Support**: All command-line options work in Telegram
- **Screen Sessions**: Commands run in detached screen sessions
- **Chat Restrictions**: Optional whitelist of allowed chat IDs
- **Diagnostic Tools**: Get chat ID and configuration info

### Bot Security Notes

- Only works in group chats where the bot is admin
- Optional chat ID restrictions via `TELEGRAM_ALLOWED_CHATS`
- Commands run as the system user running the bot
- Ensure proper authentication (`gh auth login`, `claude`)

---

## Authentication

### GitHub CLI Authentication

```bash
gh-setup-git-identity
```

Or manually:

```bash
gh auth login -h github.com -s repo,workflow,user,read:org,gist
```

Follow the prompts to authenticate with your GitHub account. The system will perform all actions using this account.

### Claude Authentication

```bash
claude
```

Follow the on-screen instructions to complete authentication.

### Codex Authentication (Optional)

For OpenAI Codex users:

1. Connect to your instance with SSH tunnel:

   ```bash
   ssh -L 1455:localhost:1455 root@123.123.123.123
   ```

2. Start codex login OAuth server:

   ```bash
   codex login
   ```

3. Copy the OAuth link and open it in your browser on the machine where you started the tunnel.

---

## Advanced Usage

### Review Commands (Alpha)

```bash
# Run collaborative review process
review --repo owner/repo --pr 456

# Multiple AI reviewers for consensus
./reviewers-hive.mjs --agents 3 --consensus-threshold 0.8
```

### Environment Variables & Configuration

For comprehensive configuration including environment variables, timeouts, retry limits, Telegram bot settings, YouTrack integration, and all CLI options, see [CONFIGURATION.md](./CONFIGURATION.md).

---

## Getting Help

- Use `--help` flag with any command for detailed options
- See [CONFIGURATION.md](./CONFIGURATION.md) for full configuration reference
- See [FEATURES.md](./FEATURES.md) for feature explanations
- See [COMPARISON.md](./COMPARISON.md) for comparisons with alternatives
- Report issues at https://github.com/link-assistant/hive-mind/issues
