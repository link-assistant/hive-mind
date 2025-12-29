# Configuration Guide

The Hive Mind application supports extensive configuration through environment variables and command-line options. This document provides a comprehensive reference for all available configuration options.

## Table of Contents

- [Environment Variables](#environment-variables)
  - [Timeout Configurations](#1-timeout-configurations)
  - [Auto-Continue Settings](#2-auto-continue-settings)
  - [GitHub API Limits](#3-github-api-limits)
  - [System Resource Limits](#4-system-resource-limits)
  - [Retry Configurations](#5-retry-configurations)
  - [File and Path Settings](#6-file-and-path-settings)
  - [Text Processing](#7-text-processing)
  - [Display Settings](#8-display-settings)
  - [Sentry Error Tracking](#9-sentry-error-tracking)
  - [External URLs](#10-external-urls)
  - [Model Configuration](#11-model-configuration)
  - [Version Settings](#12-version-settings)
  - [Telegram Bot](#13-telegram-bot)
  - [YouTrack Integration](#14-youtrack-integration)
  - [Tool Paths](#15-tool-paths)
  - [Debug and Development](#16-debug-and-development)
  - [Playwright MCP](#17-playwright-mcp)
- [Command-Line Options](#command-line-options)
  - [solve Options](#solve-options)
  - [hive Options](#hive-options)
  - [hive-telegram-bot Options](#hive-telegram-bot-options)
- [Usage Examples](#usage-examples)

---

## Environment Variables

All environment variables are managed through the `src/config.lib.mjs` module which uses `getenv` for robust handling. The configuration uses camelCase property names for consistency with JavaScript conventions.

### 1. Timeout Configurations

| Environment Variable                 | Default | Description                              |
| ------------------------------------ | ------- | ---------------------------------------- |
| `HIVE_MIND_CLAUDE_TIMEOUT_SECONDS`   | 60      | Claude CLI timeout in seconds            |
| `HIVE_MIND_OPENCODE_TIMEOUT_SECONDS` | 60      | OpenCode CLI timeout in seconds          |
| `HIVE_MIND_CODEX_TIMEOUT_SECONDS`    | 60      | Codex CLI timeout in seconds             |
| `HIVE_MIND_GITHUB_API_DELAY_MS`      | 5000    | Delay between GitHub API calls (ms)      |
| `HIVE_MIND_GITHUB_REPO_DELAY_MS`     | 2000    | Delay between repository operations (ms) |
| `HIVE_MIND_RETRY_BASE_DELAY_MS`      | 5000    | Base delay for retry operations (ms)     |
| `HIVE_MIND_RETRY_BACKOFF_DELAY_MS`   | 1000    | Backoff delay for retries (ms)           |

### 2. Auto-Continue Settings

| Environment Variable                | Default | Description                                     |
| ----------------------------------- | ------- | ----------------------------------------------- |
| `HIVE_MIND_AUTO_CONTINUE_AGE_HOURS` | 24      | Minimum age of PRs before auto-continue (hours) |

### 3. GitHub API Limits

| Environment Variable                   | Default  | Description                                      |
| -------------------------------------- | -------- | ------------------------------------------------ |
| `HIVE_MIND_GITHUB_COMMENT_MAX_SIZE`    | 65536    | Maximum size of GitHub comments (bytes)          |
| `HIVE_MIND_GITHUB_FILE_MAX_SIZE`       | 26214400 | Maximum file size for GitHub operations (25MB)   |
| `HIVE_MIND_GITHUB_ISSUE_BODY_MAX_SIZE` | 60000    | Maximum size of issue body (bytes)               |
| `HIVE_MIND_GITHUB_ATTACHMENT_MAX_SIZE` | 10485760 | Maximum attachment size (10MB)                   |
| `HIVE_MIND_GITHUB_BUFFER_MAX_SIZE`     | 10485760 | Maximum buffer size for GitHub operations (10MB) |

### 4. System Resource Limits

| Environment Variable             | Default | Description                       |
| -------------------------------- | ------- | --------------------------------- |
| `HIVE_MIND_MIN_DISK_SPACE_MB`    | 2048    | Minimum required disk space in MB |
| `HIVE_MIND_DEFAULT_PAGE_SIZE_KB` | 16      | Default memory page size in KB    |

### 5. Retry Configurations

| Environment Variable                   | Default | Description                         |
| -------------------------------------- | ------- | ----------------------------------- |
| `HIVE_MIND_MAX_FORK_RETRIES`           | 5       | Maximum fork creation retries       |
| `HIVE_MIND_MAX_VERIFY_RETRIES`         | 5       | Maximum verification retries        |
| `HIVE_MIND_MAX_API_RETRIES`            | 3       | Maximum API call retries            |
| `HIVE_MIND_RETRY_BACKOFF_MULTIPLIER`   | 2       | Retry backoff multiplier            |
| `HIVE_MIND_MAX_503_RETRIES`            | 3       | Maximum 503 error retries           |
| `HIVE_MIND_INITIAL_503_RETRY_DELAY_MS` | 300000  | Initial 503 retry delay (5 minutes) |

### 6. File and Path Settings

| Environment Variable           | Default       | Description              |
| ------------------------------ | ------------- | ------------------------ |
| `HIVE_MIND_TEMP_DIR`           | /tmp          | Temporary directory path |
| `HIVE_MIND_TASK_INFO_FILENAME` | CLAUDE.md     | Task info filename       |
| `HIVE_MIND_PROC_MEMINFO`       | /proc/meminfo | Path to memory info file |

### 7. Text Processing

| Environment Variable               | Default | Description                              |
| ---------------------------------- | ------- | ---------------------------------------- |
| `HIVE_MIND_TOKEN_MASK_MIN_LENGTH`  | 12      | Minimum length for token masking         |
| `HIVE_MIND_TOKEN_MASK_START_CHARS` | 5       | Characters to show at start when masking |
| `HIVE_MIND_TOKEN_MASK_END_CHARS`   | 5       | Characters to show at end when masking   |
| `HIVE_MIND_TEXT_PREVIEW_LENGTH`    | 100     | Length of text previews                  |
| `HIVE_MIND_LOG_TRUNCATION_LENGTH`  | 5000    | Log truncation length                    |

### 8. Display Settings

| Environment Variable    | Default | Description                         |
| ----------------------- | ------- | ----------------------------------- |
| `HIVE_MIND_LABEL_WIDTH` | 25      | Width of labels in formatted output |

### 9. Sentry Error Tracking

| Environment Variable                                | Default    | Description                        |
| --------------------------------------------------- | ---------- | ---------------------------------- |
| `HIVE_MIND_SENTRY_DSN`                              | (provided) | Sentry DSN for error tracking      |
| `HIVE_MIND_SENTRY_TRACES_SAMPLE_RATE_DEV`           | 1.0        | Trace sample rate in development   |
| `HIVE_MIND_SENTRY_TRACES_SAMPLE_RATE_PROD`          | 0.1        | Trace sample rate in production    |
| `HIVE_MIND_SENTRY_PROFILE_SESSION_SAMPLE_RATE_DEV`  | 1.0        | Profile sample rate in development |
| `HIVE_MIND_SENTRY_PROFILE_SESSION_SAMPLE_RATE_PROD` | 0.1        | Profile sample rate in production  |
| `HIVE_MIND_NO_SENTRY`                               | false      | Disable Sentry (set to "true")     |
| `DISABLE_SENTRY`                                    | false      | Alternative way to disable Sentry  |

### 10. External URLs

| Environment Variable        | Default            | Description                             |
| --------------------------- | ------------------ | --------------------------------------- |
| `HIVE_MIND_GITHUB_BASE_URL` | https://github.com | GitHub base URL (for GitHub Enterprise) |
| `HIVE_MIND_BUN_INSTALL_URL` | https://bun.sh/    | Bun installation URL                    |

### 11. Model Configuration

| Environment Variable         | Default             | Description                       |
| ---------------------------- | ------------------- | --------------------------------- |
| `HIVE_MIND_AVAILABLE_MODELS` | opus, sonnet, haiku | Available models (Links Notation) |
| `HIVE_MIND_DEFAULT_MODEL`    | sonnet              | Default model to use              |
| `HIVE_MIND_RESTRICT_MODELS`  | false               | Restrict to listed models only    |

### 12. Version Settings

| Environment Variable         | Default | Description             |
| ---------------------------- | ------- | ----------------------- |
| `HIVE_MIND_VERSION_FALLBACK` | 0.14.3  | Fallback version number |
| `HIVE_MIND_VERSION_DEFAULT`  | 0.14.3  | Default version number  |

### 13. Telegram Bot

| Environment Variable       | Default    | Description                                  |
| -------------------------- | ---------- | -------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`       | (required) | Telegram bot token from @BotFather           |
| `TELEGRAM_ALLOWED_CHATS`   | (all)      | Allowed chat IDs (Links Notation)            |
| `TELEGRAM_SOLVE_OVERRIDES` | (none)     | Override options for /solve (Links Notation) |
| `TELEGRAM_HIVE_OVERRIDES`  | (none)     | Override options for /hive (Links Notation)  |
| `TELEGRAM_SOLVE`           | true       | Enable /solve command                        |
| `TELEGRAM_HIVE`            | true       | Enable /hive command                         |
| `TELEGRAM_BOT_VERBOSE`     | false      | Enable verbose logging                       |
| `TELEGRAM_CONFIGURATION`   | (none)     | LINO configuration string                    |

### 14. YouTrack Integration

| Environment Variable    | Default    | Description                                       |
| ----------------------- | ---------- | ------------------------------------------------- |
| `YOUTRACK_URL`          | (required) | YouTrack instance URL                             |
| `YOUTRACK_API_KEY`      | (required) | YouTrack API authentication key                   |
| `YOUTRACK_PROJECT_CODE` | (required) | YouTrack project code                             |
| `YOUTRACK_STAGE`        | (required) | YouTrack stage to monitor                         |
| `YOUTRACK_NEXT_STAGE`   | (optional) | YouTrack stage to move issues to after processing |

### 15. Tool Paths

| Environment Variable | Default  | Description                     |
| -------------------- | -------- | ------------------------------- |
| `CLAUDE_PATH`        | claude   | Path to Claude CLI executable   |
| `OPENCODE_PATH`      | opencode | Path to OpenCode CLI executable |
| `CODEX_PATH`         | codex    | Path to Codex CLI executable    |
| `AGENT_PATH`         | agent    | Path to Agent CLI executable    |

### 16. Debug and Development

| Environment Variable | Default    | Description           |
| -------------------- | ---------- | --------------------- |
| `DEBUG`              | false      | Enable debug mode     |
| `NODE_ENV`           | production | Node.js environment   |
| `CI`                 | false      | CI environment flag   |
| `VERBOSE`            | false      | Enable verbose output |

### 17. Playwright MCP

Playwright MCP (Model Context Protocol) provides browser automation capabilities for Claude Code, enabling web scraping, UI testing, and interaction with dynamic web pages.

#### Installation

```bash
# Recommended: Install with memory-safe settings
claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless

# With additional options for servers
claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000
```

#### Command-Line Arguments

| Argument                 | Description                                    | Memory Impact                              |
| ------------------------ | ---------------------------------------------- | ------------------------------------------ |
| `--isolated`             | Ephemeral browser contexts (MOST IMPORTANT)    | **HIGH** - Prevents process accumulation   |
| `--headless`             | Run browser in headless mode                   | **MEDIUM** - Reduces UI memory overhead    |
| `--browser <type>`       | Browser: chromium, firefox, webkit, msedge     | **VARIES** - WebKit often uses less memory |
| `--no-sandbox`           | Disable sandbox (controlled environments only) | **LOW** - Reduces memory slightly          |
| `--timeout-action <ms>`  | Timeout for actions (default: 5000)            | **N/A** - Prevents hung processes          |
| `--viewport-size <size>` | Set viewport dimensions (e.g., "1280x720")     | **LOW** - Affects rendering memory         |
| `--storage-state <path>` | Load auth state without full profile           | **MEDIUM** - Auth without profile bloat    |

#### Scope Options

| Scope     | Description                     | Config Location                     |
| --------- | ------------------------------- | ----------------------------------- |
| `local`   | Current directory only          | `~/.claude.json` (project-specific) |
| `project` | Team-shared via version control | `.mcp.json` (project root)          |
| `user`    | Available globally              | `~/.claude.json` (user section)     |

#### JSON Configuration

Direct configuration in `~/.claude.json`:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--isolated", "--headless"],
      "env": {
        "PLAYWRIGHT_BROWSERS_PATH": "/opt/playwright/browsers"
      }
    }
  }
}
```

#### MCP Commands

```bash
# List configured MCP servers
claude mcp list

# Get server details
claude mcp get playwright

# Remove server
claude mcp remove playwright
```

#### Best Practices

1. **Always use `--isolated` mode** - Prevents Chrome process accumulation and memory leaks
2. **Pin to a specific version** - Use `@playwright/mcp@0.0.49` instead of `@latest` for stability
3. **Use `--headless` for servers** - Reduces memory overhead in CI/CD and production environments
4. **Restart Claude Code periodically** - For long-running sessions to clear accumulated browser resources

For comprehensive configuration options, troubleshooting, and advanced use cases, see the detailed guide:
[Playwright MCP Configuration Guide](./case-studies/issue-837-playwright-mcp-chrome-leak/04-CLAUDE-PLAYWRIGHT-MCP-CONFIGURATION.md)

---

## Command-Line Options

### solve Options

```bash
solve <issue-url> [options]
```

| Option                                                           | Alias | Type    | Default   | Description                                                                               |
| ---------------------------------------------------------------- | ----- | ------- | --------- | ----------------------------------------------------------------------------------------- |
| `--model`                                                        | `-m`  | string  | sonnet    | Model (opus, sonnet, haiku for claude; grok-code-fast-1 for opencode; gpt-5 for codex)    |
| `--tool`                                                         |       | string  | claude    | AI tool (claude, opencode, codex, agent)                                                  |
| `--think`                                                        |       | string  |           | Thinking level (low, medium, high, max)                                                   |
| `--fork`                                                         | `-f`  | boolean | false     | Fork repo if no write access                                                              |
| `--auto-fork`                                                    |       | boolean | true      | Automatically fork public repos without write access                                      |
| `--base-branch`                                                  | `-b`  | string  | (default) | Target branch for PR                                                                      |
| `--resume`                                                       | `-r`  | string  |           | Resume from session ID                                                                    |
| `--verbose`                                                      | `-v`  | boolean | false     | Enable verbose logging                                                                    |
| `--dry-run`                                                      | `-n`  | boolean | false     | Prepare only, don't execute                                                               |
| `--only-prepare-command`                                         |       | boolean | false     | Only prepare and print the command                                                        |
| `--skip-tool-connection-check`                                   |       | boolean | false     | Skip tool connection check                                                                |
| `--auto-pull-request-creation`                                   |       | boolean | true      | Create draft PR before execution                                                          |
| `--attach-logs`                                                  |       | boolean | false     | Attach logs to PR (sensitive)                                                             |
| `--auto-close-pull-request-on-fail`                              |       | boolean | false     | Close PR on fail                                                                          |
| `--auto-continue`                                                |       | boolean | true      | Continue with existing PR                                                                 |
| `--auto-continue-on-limit-reset`                                 |       | boolean | false     | Auto-continue when limit resets                                                           |
| `--auto-resume-on-errors`                                        |       | boolean | false     | Auto-resume on network errors                                                             |
| `--auto-continue-only-on-new-comments`                           |       | boolean | false     | Fail if no new comments                                                                   |
| `--auto-commit-uncommitted-changes`                              |       | boolean | false     | Auto-commit changes                                                                       |
| `--auto-restart-on-uncommitted-changes`                          |       | boolean | true      | Auto-restart on uncommitted changes                                                       |
| `--auto-restart-max-iterations`                                  |       | number  | 3         | Max auto-restart iterations                                                               |
| `--auto-merge-default-branch-to-pull-request-branch`             |       | boolean | false     | Merge default branch to PR branch                                                         |
| `--allow-fork-divergence-resolution-using-force-push-with-lease` |       | boolean | false     | Allow force-push on fork divergence                                                       |
| `--allow-to-push-to-contributors-pull-requests-as-maintainer`    |       | boolean | false     | Push to contributor's fork as maintainer                                                  |
| `--prefix-fork-name-with-owner-name`                             |       | boolean | true      | Prefix fork with owner name                                                               |
| `--continue-only-on-feedback`                                    |       | boolean | false     | Only continue if feedback detected                                                        |
| `--watch`                                                        | `-w`  | boolean | false     | Monitor for feedback and auto-restart                                                     |
| `--watch-interval`                                               |       | number  | 60        | Feedback check interval (seconds)                                                         |
| `--min-disk-space`                                               |       | number  | 2048      | Minimum disk space in MB                                                                  |
| `--log-dir`                                                      | `-l`  | string  | (cwd)     | Directory for log files                                                                   |
| `--sentry`                                                       |       | boolean | true      | Enable Sentry (use --no-sentry to disable)                                                |
| `--auto-cleanup`                                                 |       | boolean | (varies)  | Delete temp directory on completion                                                       |
| `--claude-file`                                                  |       | boolean | true      | Create CLAUDE.md for task details                                                         |
| `--gitkeep-file`                                                 |       | boolean | false     | Create .gitkeep instead of CLAUDE.md                                                      |
| `--interactive-mode`                                             |       | boolean | false     | [EXPERIMENTAL] Post output as PR comments                                                 |
| `--prompt-plan-sub-agent`                                        |       | boolean | false     | Use Plan sub-agent for planning                                                           |
| `--prompt-explore-sub-agent`                                     |       | boolean | false     | Use Explore sub-agent                                                                     |
| `--prompt-general-purpose-sub-agent`                             |       | boolean | false     | Use general-purpose sub agents                                                            |
| `--tokens-budget-stats`                                          |       | boolean | false     | [EXPERIMENTAL] Show token budget statistics                                               |
| `--prompt-issue-reporting`                                       |       | boolean | false     | Auto-create issues for spotted bugs                                                       |
| `--prompt-case-studies`                                          |       | boolean | false     | Create case study documentation                                                           |
| `--prompt-playwright-mcp`                                        |       | boolean | true      | Playwright MCP hints (only if MCP installed, use `--no-prompt-playwright-mcp` to disable) |

### hive Options

```bash
hive <github-url> [options]
```

| Option                               | Alias | Type    | Default       | Description                                 |
| ------------------------------------ | ----- | ------- | ------------- | ------------------------------------------- |
| `--monitor-tag`                      | `-t`  | string  | "help wanted" | Label to monitor                            |
| `--all-issues`                       | `-a`  | boolean | false         | Monitor all issues (ignore labels)          |
| `--skip-issues-with-prs`             | `-s`  | boolean | false         | Skip issues with existing PRs               |
| `--concurrency`                      | `-c`  | number  | 2             | Parallel workers                            |
| `--pull-requests-per-issue`          | `-p`  | number  | 1             | Number of PRs per issue                     |
| `--model`                            | `-m`  | string  | sonnet        | Model to use                                |
| `--tool`                             |       | string  | claude        | AI tool (claude, opencode, agent)           |
| `--interval`                         | `-i`  | number  | 300           | Poll interval (seconds)                     |
| `--max-issues`                       |       | number  | 0             | Limit processed issues (0 = unlimited)      |
| `--once`                             |       | boolean | false         | Single run (don't monitor)                  |
| `--dry-run`                          |       | boolean | false         | List issues without processing              |
| `--skip-tool-connection-check`       |       | boolean | false         | Skip tool connection check                  |
| `--verbose`                          | `-v`  | boolean | false         | Enable verbose logging                      |
| `--min-disk-space`                   |       | number  | 2048          | Minimum disk space in MB                    |
| `--auto-cleanup`                     |       | boolean | false         | Clean temp directories on success           |
| `--fork`                             | `-f`  | boolean | false         | Fork repos if no write access               |
| `--auto-fork`                        |       | boolean | true          | Automatically fork public repos             |
| `--attach-logs`                      |       | boolean | false         | Attach logs to PRs (sensitive)              |
| `--project-number`                   | `-pn` | number  |               | GitHub Project number to monitor            |
| `--project-owner`                    | `-po` | string  |               | GitHub Project owner                        |
| `--project-status`                   | `-ps` | string  | "Ready"       | Project status column to monitor            |
| `--project-mode`                     | `-pm` | boolean | false         | Enable project-based monitoring             |
| `--youtrack-mode`                    |       | boolean | false         | Enable YouTrack mode                        |
| `--youtrack-stage`                   |       | string  |               | Override YouTrack stage                     |
| `--youtrack-project`                 |       | string  |               | Override YouTrack project code              |
| `--target-branch`                    | `-tb` | string  | (default)     | Target branch for PRs                       |
| `--log-dir`                          | `-l`  | string  | (cwd)         | Directory for log files                     |
| `--auto-continue`                    |       | boolean | true          | Pass --auto-continue to solve               |
| `--think`                            |       | string  |               | Thinking level (low, medium, high, max)     |
| `--prompt-plan-sub-agent`            |       | boolean | false         | Use Plan sub-agent                          |
| `--sentry`                           |       | boolean | true          | Enable Sentry (use --no-sentry to disable)  |
| `--watch`                            | `-w`  | boolean | false         | Monitor for feedback and auto-restart       |
| `--issue-order`                      | `-o`  | string  | "asc"         | Order issues by date (asc, desc)            |
| `--prefix-fork-name-with-owner-name` |       | boolean | true          | Prefix fork with owner name                 |
| `--interactive-mode`                 |       | boolean | false         | [EXPERIMENTAL] Post output as PR comments   |
| `--prompt-explore-sub-agent`         |       | boolean | false         | Use Explore sub-agent                       |
| `--prompt-general-purpose-sub-agent` |       | boolean | false         | Use general-purpose sub agents              |
| `--tokens-budget-stats`              |       | boolean | false         | [EXPERIMENTAL] Show token budget statistics |
| `--prompt-issue-reporting`           |       | boolean | false         | Auto-create issues for spotted bugs         |
| `--prompt-case-studies`              |       | boolean | false         | Create case study documentation             |
| `--prompt-playwright-mcp`            |       | boolean | true          | Playwright MCP hints (only if installed)    |

### hive-telegram-bot Options

```bash
hive-telegram-bot [options]
```

| Option              | Alias | Type    | Default    | Description                                   |
| ------------------- | ----- | ------- | ---------- | --------------------------------------------- |
| `--token`           | `-t`  | string  | (required) | Telegram bot token from @BotFather            |
| `--allowed-chats`   |       | string  | (all)      | Allowed chat IDs (Links Notation)             |
| `--solve-overrides` |       | string  | (none)     | Override options for /solve                   |
| `--hive-overrides`  |       | string  | (none)     | Override options for /hive                    |
| `--solve`           |       | boolean | true       | Enable /solve command (--no-solve to disable) |
| `--hive`            |       | boolean | true       | Enable /hive command (--no-hive to disable)   |
| `--configuration`   | `-c`  | string  |            | LINO configuration string                     |
| `--verbose`         | `-v`  | boolean | false      | Enable verbose logging                        |
| `--dry-run`         |       | boolean | false      | Validate without starting bot                 |

---

## Usage Examples

### Setting Environment Variables

```bash
# Increase Claude timeout to 2 minutes
export HIVE_MIND_CLAUDE_TIMEOUT_SECONDS=120

# Reduce GitHub API delay for faster operations
export HIVE_MIND_GITHUB_API_DELAY_MS=2000

# Increase auto-continue threshold to 48 hours
export HIVE_MIND_AUTO_CONTINUE_AGE_HOURS=48

# Use custom temporary directory
export HIVE_MIND_TEMP_DIR=/var/tmp/hive-mind

# Disable Sentry in production
export HIVE_MIND_SENTRY_DSN=""

# Configure for GitHub Enterprise
export HIVE_MIND_GITHUB_BASE_URL=https://github.enterprise.com
```

### Running with Custom Configuration

```bash
# Run with custom timeouts
HIVE_MIND_CLAUDE_TIMEOUT_SECONDS=120 HIVE_MIND_RETRY_BASE_DELAY_MS=10000 hive https://github.com/owner/repo

# Run with increased limits
HIVE_MIND_GITHUB_FILE_MAX_SIZE=52428800 HIVE_MIND_MIN_DISK_SPACE_MB=1000 solve https://github.com/owner/repo/issues/123

# Run with custom auto-continue settings
HIVE_MIND_AUTO_CONTINUE_AGE_HOURS=12 solve --auto-continue https://github.com/owner/repo/issues/456
```

### Configuration File (Optional)

You can create a `.env` file in your project root:

```bash
# .env file
HIVE_MIND_CLAUDE_TIMEOUT_SECONDS=90
HIVE_MIND_GITHUB_API_DELAY_MS=3000
HIVE_MIND_AUTO_CONTINUE_AGE_HOURS=36
HIVE_MIND_TEMP_DIR=/opt/hive-mind/tmp
HIVE_MIND_SENTRY_DSN=your-custom-sentry-dsn
```

Then source it before running:

```bash
source .env
hive https://github.com/owner/repo
```

### Developer Usage

```javascript
import { timeouts, githubLimits, sentry } from './config.lib.mjs';

// Use configuration values
const timeout = timeouts.claudeCli;
const maxSize = githubLimits.fileMaxSize;
const dsn = sentry.dsn;
```

---

## Notes

- All timeout values are in milliseconds unless otherwise specified
- All size limits are in bytes unless otherwise specified
- Sample rates must be between 0.0 and 1.0
- The application validates all configuration values on startup
- Invalid values will cause the application to fail with an error message
- Use `--verbose` flag to see configuration values being used
