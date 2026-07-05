# Configuration Guide (languages: en • [zh](CONFIGURATION.zh.md) • [hi](CONFIGURATION.hi.md) • [ru](CONFIGURATION.ru.md))

The Hive Mind application supports extensive configuration through environment variables and command-line options. This document provides a comprehensive reference for all available configuration options.

> **OpenRouter Integration**: For using Claude Code CLI or @link-assistant/agent with OpenRouter (500+ models from 60+ providers), see the dedicated [OpenRouter Setup Guide](./OPENROUTER.md).

## Table of Contents

- [Environment Variables](#environment-variables)
  - [Timeout Configurations](#1-timeout-configurations)
  - [Auto-Continue Settings](#2-auto-continue-settings)
  - [Limit Reset Settings](#22-limit-reset-settings)
  - [GitHub API Limits](#3-github-api-limits)
  - [System Resource Limits](#4-system-resource-limits)
  - [Docker Isolation Settings](#41-docker-isolation-settings)
  - [Retry Configurations](#5-retry-configurations)
  - [Cache TTL Configurations](#51-cache-ttl-configurations)
  - [Claude Code CLI Configurations](#52-claude-code-cli-configurations)
  - [File and Path Settings](#6-file-and-path-settings)
  - [Text Processing](#7-text-processing)
  - [Display Settings](#8-display-settings)
  - [Sentry Error Tracking](#9-sentry-error-tracking)
  - [External URLs](#10-external-urls)
  - [Model Configuration](#11-model-configuration)
  - [Version Settings](#12-version-settings)
  - [Merge Queue Configurations](#121-merge-queue-configurations)
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

| Environment Variable                 | Default | Description                                                                   |
| ------------------------------------ | ------- | ----------------------------------------------------------------------------- |
| `HIVE_MIND_CLAUDE_TIMEOUT_SECONDS`   | 60      | Claude CLI timeout in seconds                                                 |
| `HIVE_MIND_OPENCODE_TIMEOUT_SECONDS` | 60      | OpenCode CLI timeout in seconds                                               |
| `HIVE_MIND_CODEX_TIMEOUT_SECONDS`    | 60      | Codex CLI timeout in seconds                                                  |
| `HIVE_MIND_GITHUB_API_DELAY_MS`      | 5000    | Delay between GitHub API calls (ms)                                           |
| `HIVE_MIND_GITHUB_REPO_DELAY_MS`     | 2000    | Delay between repository operations (ms)                                      |
| `HIVE_MIND_RETRY_BASE_DELAY_MS`      | 5000    | Base delay for retry operations (ms)                                          |
| `HIVE_MIND_RETRY_BACKOFF_DELAY_MS`   | 1000    | Backoff delay for retries (ms)                                                |
| `HIVE_MIND_RESULT_STREAM_CLOSE_MS`   | 30000   | Timeout (ms) to wait for stream close after result event before force-killing |

### 2. Auto-Continue Settings

| Environment Variable                | Default | Description                                     |
| ----------------------------------- | ------- | ----------------------------------------------- |
| `HIVE_MIND_AUTO_CONTINUE_AGE_HOURS` | 24      | Minimum age of PRs before auto-continue (hours) |

### 2.2. Limit Reset Settings

| Environment Variable              | Default | Description                                        |
| --------------------------------- | ------- | -------------------------------------------------- |
| `HIVE_MIND_LIMIT_RESET_BUFFER_MS` | 300000  | Buffer time (5 min) to wait after limit reset (ms) |

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
| `HIVE_MIND_MIN_DISK_SPACE_MB`    | 10240   | Minimum required disk space in MB |
| `HIVE_MIND_DEFAULT_PAGE_SIZE_KB` | 16      | Default memory page size in KB    |

### 4.1. Docker Isolation Settings

| Environment Variable            | Default      | Description                                                                                                                                                                |
| ------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HIVE_MIND_KEEP_TASK_CONTAINER` | `on-failure` | Docker task-container retention after terminal completion: `always`, `on-failure`, or `never`. `on-failure` removes successful containers and keeps failed ones for debug. |

### 5. Retry Configurations

| Environment Variable                   | Default | Description                         |
| -------------------------------------- | ------- | ----------------------------------- |
| `HIVE_MIND_MAX_FORK_RETRIES`           | 5       | Maximum fork creation retries       |
| `HIVE_MIND_MAX_VERIFY_RETRIES`         | 5       | Maximum verification retries        |
| `HIVE_MIND_MAX_API_RETRIES`            | 3       | Maximum API call retries            |
| `HIVE_MIND_RETRY_BACKOFF_MULTIPLIER`   | 2       | Retry backoff multiplier            |
| `HIVE_MIND_MAX_503_RETRIES`            | 3       | Maximum 503 error retries           |
| `HIVE_MIND_INITIAL_503_RETRY_DELAY_MS` | 300000  | Initial 503 retry delay (5 minutes) |

### 5.1. Cache TTL Configurations

These settings control how long API responses are cached before making a new request.

| Environment Variable               | Default | Description                                                                                                                                                                                        |
| ---------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HIVE_MIND_API_CACHE_TTL_MS`       | 180000  | General API cache TTL in ms (3 minutes). Used for GitHub API.                                                                                                                                      |
| `HIVE_MIND_USAGE_API_CACHE_TTL_MS` | 780000  | Claude Usage API cache TTL in ms (13 minutes). **Important:** The Claude Usage API has stricter rate limiting. Calling it more frequently may return null values or a 429 "Resets in Xm Xs" error. |
| `HIVE_MIND_SYSTEM_CACHE_TTL_MS`    | 60000   | System metrics cache TTL in ms (1 minute max). Used for RAM, CPU, and disk space. Higher values are capped at 1 minute.                                                                            |

**Note:** The Claude Usage API (`/api/oauth/usage`) is rate-limited more strictly than other APIs. If you experience `null` values or `Resets in 3m Xs` errors in the `/limits` command output, the API call frequency is too high. The default 13-minute TTL was raised from 10 minutes in [issue #1798](https://github.com/link-assistant/hive-mind/issues/1798) to add a 3-minute safety margin above the observed rate-limit window. See [Issue #1074](https://github.com/link-assistant/hive-mind/issues/1074) for the original investigation.

### 5.2. Claude Code CLI Configurations

These settings control Claude Code CLI behavior, including output limits and MCP timeouts.

| Environment Variable                    | Default | Description                                                                                           |
| --------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS`         | 64000   | Maximum output tokens for Claude Code CLI responses (also: `HIVE_MIND_CLAUDE_CODE_MAX_OUTPUT_TOKENS`) |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS_OPUS_46` | 128000  | Maximum output tokens for Opus 4.6+ (also: `HIVE_MIND_CLAUDE_CODE_MAX_OUTPUT_TOKENS_OPUS_46`)         |
| `MCP_TIMEOUT`                           | 900000  | MCP server startup timeout in ms (15 min) (also: `HIVE_MIND_MCP_TIMEOUT`)                             |
| `MCP_TOOL_TIMEOUT`                      | 900000  | MCP tool execution timeout in ms (15 min) (also: `HIVE_MIND_MCP_TOOL_TIMEOUT`)                        |
| `HIVE_MIND_MAX_THINKING_BUDGET_OPUS_46` | 31999   | Default max thinking budget for Opus 4.6+ models                                                      |

**Note:** Claude models support different max output tokens: Opus 4.6 (the default `opus` alias) supports 128K tokens, while Sonnet 4.5, Opus 4.5, and Haiku 4.5 support 64K tokens. The MCP timeouts (15 minutes by default) accommodate long-running Playwright operations. See [Issue #1076](https://github.com/link-assistant/hive-mind/issues/1076) and [Issue #1066](https://github.com/link-assistant/hive-mind/issues/1066) for details.

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

| Environment Variable                                | Default    | Description                                                  |
| --------------------------------------------------- | ---------- | ------------------------------------------------------------ |
| `HIVE_MIND_SENTRY_DSN`                              | (provided) | Sentry DSN for error tracking                                |
| `HIVE_MIND_SENTRY_TRACES_SAMPLE_RATE_DEV`           | 1.0        | Trace sample rate in development                             |
| `HIVE_MIND_SENTRY_TRACES_SAMPLE_RATE_PROD`          | 0.1        | Trace sample rate in production                              |
| `HIVE_MIND_SENTRY_PROFILE_SESSION_SAMPLE_RATE_DEV`  | 1.0        | Profile sample rate in development                           |
| `HIVE_MIND_SENTRY_PROFILE_SESSION_SAMPLE_RATE_PROD` | 0.1        | Profile sample rate in production                            |
| `HIVE_MIND_NO_SENTRY`                               | true       | Disable Sentry (set to "true"; Sentry is off by default)     |
| `DISABLE_SENTRY`                                    | true       | Alternative way to disable Sentry (Sentry is off by default) |
| `HIVE_MIND_SENTRY`                                  | false      | Enable Sentry (set to "true" to opt in)                      |

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

### 12.1. Merge Queue Configurations

These settings control the merge queue behavior for automated PR merging.

| Environment Variable                        | Default  | Description                                                |
| ------------------------------------------- | -------- | ---------------------------------------------------------- |
| `HIVE_MIND_MERGE_QUEUE_MAX_PRS`             | 10       | Maximum PRs to process in one merge session                |
| `HIVE_MIND_MERGE_QUEUE_CI_POLL_INTERVAL_MS` | 300000   | CI/CD polling interval in ms (5 minutes)                   |
| `HIVE_MIND_MERGE_QUEUE_CI_TIMEOUT_MS`       | 25200000 | CI/CD timeout in ms (7 hours)                              |
| `HIVE_MIND_MERGE_QUEUE_POST_MERGE_WAIT_MS`  | 60000    | Wait time after merge before processing next PR (1 minute) |
| `HIVE_MIND_MERGE_QUEUE_MERGE_METHOD`        | merge    | Default merge method: `merge`, `squash`, or `rebase`       |

**Note:** See [Issue #1143](https://github.com/link-assistant/hive-mind/issues/1143) and [Issue #1269](https://github.com/link-assistant/hive-mind/issues/1269) for details.

`/merge` accepts repository, issue, and pull request targets. When an issue or
pull request target is not mergeable yet, the merge queue waits up to
`HIVE_MIND_MERGE_QUEUE_CI_TIMEOUT_MS` and polls every
`HIVE_MIND_MERGE_QUEUE_CI_POLL_INTERVAL_MS` before failing the target.

### 13. Telegram Bot

| Environment Variable                       | Default    | Description                                                                  |
| ------------------------------------------ | ---------- | ---------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`                       | (required) | Telegram bot token from @BotFather                                           |
| `TELEGRAM_ALLOWED_CHATS`                   | (all)      | Allowed chat IDs (Links Notation)                                            |
| `TELEGRAM_SOLVE_OVERRIDES`                 | (none)     | Override options for /solve (Links Notation)                                 |
| `TELEGRAM_HIVE_OVERRIDES`                  | (none)     | Override options for /hive (Links Notation)                                  |
| `TELEGRAM_SOLVE`                           | true       | Enable /solve command                                                        |
| `TELEGRAM_HIVE`                            | true       | Enable /hive command                                                         |
| `TELEGRAM_TASK`                            | true       | Enable /task and /split commands                                             |
| `TELEGRAM_AUTH`                            | true       | Enable experimental private /auth command for allowlisted chat owners        |
| `TELEGRAM_AUTO_START_SCREEN_WATCH_MESSAGE` | false      | Auto-start a separate live terminal watch message for public /solve sessions |
| `TELEGRAM_BOT_VERBOSE`                     | false      | Enable verbose logging                                                       |
| `TELEGRAM_CONFIGURATION`                   | (none)     | LINO configuration string                                                    |

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

Playwright MCP (Model Context Protocol) provides browser automation capabilities for supported AI tools including Claude Code, Codex, OpenCode, Agent, Qwen Code, and Gemini CLI, enabling web scraping, UI testing, and interaction with dynamic web pages.

#### Installation

```bash
# Recommended: Install with memory-safe settings (for servers and Docker)
claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080
codex mcp add playwright -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080

# Minimal installation (for local development)
claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless
codex mcp add playwright -- npx -y @playwright/mcp@latest --isolated --headless
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

Claude Code, Codex, and other CLIs do not share MCP registration automatically. Register Playwright MCP in each CLI you expect to use. A working Claude configuration does not make `codex mcp list` show the same server.

| Scope     | Description                     | Config Location                     |
| --------- | ------------------------------- | ----------------------------------- |
| `local`   | Current directory only          | `~/.claude.json` (project-specific) |
| `project` | Team-shared via version control | `.mcp.json` (project root)          |
| `user`    | Available globally              | `~/.claude.json` (user section)     |

#### JSON Configuration

Claude Code example (`~/.claude.json`):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--isolated", "--headless", "--no-sandbox", "--timeout-action=600000", "--viewport-size", "1920x1080"],
      "env": {
        "PLAYWRIGHT_BROWSERS_PATH": "/opt/playwright/browsers"
      }
    }
  }
}
```

Codex stores MCP configuration separately. Use the Codex CLI to inspect or register its own Playwright entry:

```bash
# List configured MCP servers
codex mcp list

# Add server
codex mcp add playwright -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080

# Remove server
codex mcp remove playwright
```

#### MCP Commands

```bash
# List configured MCP servers
claude mcp list
codex mcp list

# Get server details
claude mcp get playwright

# Remove server
claude mcp remove playwright
codex mcp remove playwright
```

#### Preflight Timeout

Before starting a working session, `solve` runs a local Playwright MCP preflight
that calls `claude mcp list` / `codex mcp list`. Those commands perform a live
health check against every registered MCP server (Playwright MCP launches a
browser to report its status), so on a cold npx cache or a busy CI host the
probe can take longer than a few seconds.

The probe timeout defaults to **30 seconds** and is overridable:

```bash
# Give the mcp list probe up to 90 seconds (slow/cold environments)
PLAYWRIGHT_MCP_PREFLIGHT_TIMEOUT_SECONDS=90 solve <issue-url>
```

If the probe is still inconclusive (it times out or the CLI is missing), the
preflight no longer aborts the run: it falls back to checking whether the local
`@playwright/mcp` package is installed. When the package is present, the server
connects on demand via Tool Search (see
[case study issue-1943](./case-studies/issue-1943/README.md) and
[issue-1901](./case-studies/issue-1901/README.md)), so the working session
proceeds. The preflight only fails when the `@playwright/mcp` package itself is
genuinely unavailable. Use `--no-playwright-mcp` to skip the preflight entirely
when browser automation is intentionally disabled.

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

| Option                                                           | Alias | Type    | Default             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------- | ----- | ------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--model`                                                        | `-m`  | string  | depends on `--tool` | Model to use. Current defaults: `sonnet` for Claude, `nemotron-3-super-free` for Agent, `grok-code-fast-1` for OpenCode, `gpt-5.5` for Codex (with runtime fallback if the local Codex catalog has not exposed it yet), `qwen3-coder-plus` for Qwen Code, and `gemini-2.5-flash` for Gemini CLI.                                                                                                                                                                                                                                   |
| `--fallback-model`                                               |       | string  |                     | Fallback model to switch to on model capacity or overload errors. When supported, retries resume the same session with this model. Defaults: Claude `opus`/`opus-4-7` falls back to `opus-4-6`; Codex `gpt-5.5` falls back to `gpt-5.4`; other tools and models stay unset unless you pass this explicitly.                                                                                                                                                                                                                        |
| `--sub-agent-model`                                              |       | string  |                     | Claude Code subagent/agent-team model override. Sets `CLAUDE_CODE_SUBAGENT_MODEL` only when provided. Accepts Claude model aliases, full model IDs, or `inherit` to use normal Claude Code subagent model resolution. Only works with `--tool claude`.                                                                                                                                                                                                                                                                             |
| `--worker-model`                                                 |       | string  |                     | Alias for --model: execution/worker model when --plan-model is specified                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--tool`                                                         |       | string  | claude              | AI tool (claude, opencode, codex, agent, qwen, gemini)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--plan`                                                         |       | boolean | false               | Enable plan mode: opus for planning, sonnet for execution (--tool claude only)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--plan-model`                                                   |       | string  |                     | Model for plan mode (e.g., opus). Auto-switches to opusplan mode (--tool claude only)                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `--think`                                                        |       | string  |                     | Thinking level (off, low, medium, high, xhigh, max). If omitted, Hive Mind does not request extra reasoning by default: Claude runs without extra thinking budget/effort overrides, Codex uses reasoning `none`, and Agent/OpenCode add no thinking prompt to their default models. `max` stays `max` on supported Claude effort models; `xhigh` is native only on Opus 4.7. For Codex, `xhigh`/`max` map to `xhigh`.                                                                                                              |
| `--thinking-budget`                                              |       | number  |                     | Thinking token budget (0-31999). Controls MAX_THINKING_TOKENS                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--thinking-budget-claude-minimum-version`                       |       | string  | 2.1.12              | Minimum Claude Code version supporting --thinking-budget                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--max-thinking-budget`                                          |       | number  | 31999               | Maximum thinking budget for level mappings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--sub-session-size`                                             |       | string  | 150k                | Cap on sub-session size between auto-compaction events. Accepts a token count (e.g. `150k`, `1m`, `200000`), a percentage of the model context window (e.g. `50%`), or `default` to keep the tool's built-in threshold. For Claude this maps to `CLAUDE_CODE_AUTO_COMPACT_WINDOW` + `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` env vars. For Codex this maps to `-c model_auto_compact_token_limit`.                                                                                                                                        |
| `--disable-1m-context`                                           |       | boolean | true                | Disable the 1M extended context window so the model uses its standard 200K-400K window. Helps preserve reasoning quality and reduces cost. For Claude this sets `CLAUDE_CODE_DISABLE_1M_CONTEXT=1`. For Codex this sets `-c model_context_window=200000`. Use `--no-disable-1m-context` to allow the 1M window.                                                                                                                                                                                                                    |
| `--show-thinking-content`                                        |       | boolean | false               | Show thinking content in Claude responses. Opus 4.7 omits thinking by default; this opts in (--tool claude only)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `--fork`                                                         | `-f`  | boolean | false               | Fork repo if no write access                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `--auto-fork`                                                    |       | boolean | true                | Automatically fork public repos without write access                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--base-branch`                                                  | `-b`  | string  | (default)           | Target branch for PR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--resume`                                                       | `-r`  | string  |                     | Resume from session ID                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--working-directory`                                            | `-d`  | string  |                     | Use specified working directory (essential for --resume)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--verbose`                                                      | `-v`  | boolean | false               | Enable verbose logging                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--dry-run`                                                      | `-n`  | boolean | false               | Prepare only, don't execute                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--only-prepare-command`                                         |       | boolean | false               | Only prepare and print the command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--skip-tool-connection-check`                                   |       | boolean | false               | Skip tool connection check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--auto-pull-request-creation`                                   |       | boolean | true                | Create draft PR before execution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `--attach-logs`                                                  |       | boolean | false               | Attach logs to PR (sensitive)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--attach-solution-summary`                                      |       | boolean | false               | Attach AI solution summary as PR/issue comment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--auto-attach-solution-summary`                                 |       | boolean | true                | Auto-attach summary only if AI didn't post comments (use `--no-auto-attach-solution-summary` to disable)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--dangerously-skip-output-sanitization`                         |       | boolean | false               | DANGEROUS: skip pattern-based sanitization of generated output. Active local token masking stays enabled unless `--dangerously-skip-active-tokens-output-sanitization` is also set.                                                                                                                                                                                                                                                                                                                                                |
| `--dangerously-skip-code-output-sanitization`                    |       | boolean | false               | DANGEROUS: allow generated code output to bypass code-specific output sanitization. Active local token masking stays enabled unless `--dangerously-skip-active-tokens-output-sanitization` is also set.                                                                                                                                                                                                                                                                                                                            |
| `--dangerously-skip-active-tokens-output-sanitization`           |       | boolean | false               | DANGEROUS: skip masking known active local tokens in output. Use only for controlled debugging because this can expose currently usable credentials.                                                                                                                                                                                                                                                                                                                                                                               |
| `--auto-close-pull-request-on-fail`                              |       | boolean | false               | Close PR on fail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `--auto-continue`                                                |       | boolean | true                | Continue with existing PR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--auto-resume-on-limit-reset`                                   |       | boolean | true                | Auto-resume when limit resets (maintains session context)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--auto-restart-on-limit-reset`                                  |       | boolean | false               | Auto-restart when limit resets (fresh start without --resume)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--auto-resume-on-errors`                                        |       | boolean | false               | Auto-resume on network errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--auto-continue-only-on-new-comments`                           |       | boolean | false               | Fail if no new comments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `--auto-commit-uncommitted-changes`                              |       | boolean | false               | Auto-commit changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--auto-restart-on-uncommitted-changes`                          |       | boolean | true                | Auto-restart on uncommitted changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--auto-restart-max-iterations`                                  |       | number  | 5                   | Max auto-restart iterations before stopping (0 = unlimited)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--resume-on-auto-restart`                                       |       | boolean | false               | [EXPERIMENTAL] Resume the previous Claude session during uncommitted-change auto-restart and send only a minimal restart prompt                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--auto-resume-max-iterations`                                   |       | number  | 5                   | Max automatic resume/restart continuations after usage-limit resets (0 = unlimited)                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--auto-merge`                                                   |       | boolean | false               | Auto-merge PR when session finishes and CI passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--auto-restart-until-mergeable`                                 |       | boolean | true                | Auto-restart until PR becomes mergeable. Detects billing limits and stops with a comment for private repos.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--auto-input-until-mergeable`                                   |       | boolean | false               | [EXPERIMENTAL] Keep feeding new issue/PR events (uncommitted changes, CI/CD failures, PR/issue comments, issue title/description edits) into the running AI session, in all ways possible. For `--tool claude` and `--tool agent`, streams events directly into the live process via stream-json stdin and implies `--accept-incomming-comments-as-input` plus `--queue-comments-to-input`. For codex, opencode, gemini, qwen, and unknown tools, uses the universal restart/resume fallback. See `docs/case-studies/issue-2007/`. |
| `--wait-for-all-actions-in-repository-before-mergeable`          |       | boolean | false               | Wait for ALL active GitHub Actions runs in repo to complete before declaring PR mergeable. Blocks on ANY active run regardless of branch. Use this only when repository-wide pipelines truly interact and unrelated branches must block mergeability.                                                                                                                                                                                                                                                                              |
| `--auto-restart-on-non-updated-pull-request-description`         |       | boolean | false               | Auto-restart if PR description has placeholder text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--auto-merge-default-branch-to-pull-request-branch`             |       | boolean | false               | Merge default branch to PR branch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--allow-fork-divergence-resolution-using-force-push-with-lease` |       | boolean | false               | Allow force-push on fork divergence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--allow-force-non-fork-repository-deletion`                     |       | boolean | false               | Allow deletion of non-fork repositories even when they contain additional commits (DANGEROUS: data loss possible)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--allow-to-push-to-contributors-pull-requests-as-maintainer`    |       | boolean | false               | Push to contributor's fork as maintainer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--prefix-fork-name-with-owner-name`                             |       | boolean | true                | Prefix fork with owner name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--continue-only-on-feedback`                                    |       | boolean | false               | Only continue if feedback detected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--watch`                                                        | `-w`  | boolean | false               | Monitor for feedback and auto-restart                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `--watch-interval`                                               |       | number  | 60                  | Feedback check interval (seconds)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--auto-delete-branch-on-merge`                                  |       | boolean | false               | Automatically delete the branch after the pull request is merged in --watch mode or by --auto-merge. Enables full GitHub Flow support (issue #401).                                                                                                                                                                                                                                                                                                                                                                                |
| `--min-disk-space`                                               |       | number  | 10240               | Minimum disk space in MB                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--log-dir`                                                      | `-l`  | string  | (cwd)               | Directory for log files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `--sentry`                                                       |       | boolean | false               | Enable Sentry error tracking (disabled by default for privacy; use --sentry to opt in)                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--auto-accept-invite`                                           |       | boolean | true                | Auto-accept pending GitHub repo/org invitation for the target repository before checking write access (use `--no-auto-accept-invite` to disable)                                                                                                                                                                                                                                                                                                                                                                                   |
| `--auto-report-issue`                                            |       | boolean | false               | Automatically create a GitHub issue on failure without prompting (includes error details and logs)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--disable-report-issue`                                         |       | boolean | false               | Disable error issue creation entirely (overrides --auto-report-issue)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `--disable-issue-auto-creation-on-error`                         |       | boolean | false               | Disable creating a new GitHub error-report issue when solve fails, including the interactive prompt. Does not disable posting failure logs or comments to the original issue or pull request.                                                                                                                                                                                                                                                                                                                                      |
| `--auto-cleanup`                                                 |       | boolean | (varies)            | Delete temp directory on completion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--claude-file`                                                  |       | boolean | false               | Create CLAUDE.md for task details (mutually exclusive with --gitkeep-file)                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--gitkeep-file`                                                 |       | boolean | true                | Create .gitkeep instead of CLAUDE.md (default for all --tool values, mutually exclusive with --claude-file)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--auto-gitkeep-file`                                            |       | boolean | true                | Auto use .gitkeep if CLAUDE.md is in .gitignore                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--force-git-keep-commit`                                        |       | boolean | false               | If the auto-PR placeholder (.gitkeep) is listed in .gitignore, commit it anyway with `git add -f` instead of stopping (issue #1825). Off by default.                                                                                                                                                                                                                                                                                                                                                                               |
| `--remove-git-keep-from-git-ignore`                              |       | boolean | false               | If the auto-PR placeholder (.gitkeep) is listed in .gitignore, remove that entry from .gitignore first, then commit normally (issue #1825). Off by default.                                                                                                                                                                                                                                                                                                                                                                        |
| `--auto-support-agents-md-as-claude-md`                          |       | boolean | false               | [EXPERIMENTAL] Temporarily copy AGENTS.md/agents.md to CLAUDE.md while Claude runs, then remove the temporary copy                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--execute-tool-with-bun`                                        |       | boolean | false               | Execute AI tool using bunx (experimental)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--enable-workspaces`                                            |       | boolean | false               | Use separate workspace directory structure (experimental)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--interactive-mode`                                             |       | boolean | false               | [EXPERIMENTAL] Post output as PR comments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--interactive-image-upload`                                     |       | boolean | true                | [EXPERIMENTAL] When `--interactive-mode` is on, upload images the AI reads/writes to hidden custom Git refs (`refs/hive-mind-media/...`) and embed them inline in PR comments. Enabled by default; use `--no-interactive-image-upload` to disable.                                                                                                                                                                                                                                                                                 |
| `--accept-incomming-comments-as-input`                           |       | boolean | false               | [EXPERIMENTAL] Accept new PR/issue comments as input for the running stream-json tool during execution (excludes outgoing comments generated by solve itself). Does not require `--interactive-mode`. Only supported for `--tool claude` and `--tool agent`.                                                                                                                                                                                                                                                                       |
| `--exclude-all-own-incomming-comments-from-input`                |       | boolean | false               | [EXPERIMENTAL] Combined with `--accept-incomming-comments-as-input`, also exclude comments written by the same GitHub user that solve runs as (prevents self-talk).                                                                                                                                                                                                                                                                                                                                                                |
| `--bidirectional-interactive-mode`                               |       | boolean | false               | [EXPERIMENTAL] Convenience flag that enables `--interactive-mode`, `--accept-incomming-comments-as-input`, and `--exclude-all-own-incomming-comments-from-input` together. Only supported for `--tool claude` and `--tool agent`.                                                                                                                                                                                                                                                                                                  |
| `--stream-comments-to-input`                                     |       | boolean | false               | [EXPERIMENTAL] When `--accept-incomming-comments-as-input` is enabled, forward each new PR/issue comment to the AI immediately as it arrives. Default mode for `--accept-incomming-comments-as-input` on its own. Mutually exclusive with `--queue-comments-to-input` (queue mode wins if both are set). Only supported for `--tool claude` and `--tool agent`.                                                                                                                                                                    |
| `--queue-comments-to-input`                                      |       | boolean | false               | [EXPERIMENTAL] When `--accept-incomming-comments-as-input` is enabled, queue new PR/issue comments and only flush them once the AI signals it is idle. Default mode implied by `--auto-input-until-mergeable`. Mutually exclusive with `--stream-comments-to-input` (queue mode wins if both are set). Only supported for `--tool claude` and `--tool agent`.                                                                                                                                                                      |
| `--prompt-plan-sub-agent`                                        |       | boolean | false               | Use Plan sub-agent for planning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--prompt-explore-sub-agent`                                     |       | boolean | false               | Use Explore sub-agent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `--prompt-general-purpose-sub-agent`                             |       | boolean | false               | Use general-purpose sub agents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--tokens-budget-stats`                                          |       | boolean | true                | Show token budget statistics (use `--no-tokens-budget-stats` to disable)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--prompt-issue-reporting`                                       |       | boolean | false               | Auto-create issues for spotted bugs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--prompt-case-studies`                                          |       | boolean | false               | Create case study documentation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--prompt-architecture-care`                                     |       | boolean | false               | [EXPERIMENTAL] Manage REQUIREMENTS.md and ARCHITECTURE.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--use-handoff`                                                  |       | boolean | false               | [EXPERIMENTAL] Enable the HANDOFF.md continuity Agent Skill so Claude and Codex can continue each other's work in a single PR. A native SKILL.md (Agent Skills standard) is deployed for each tool (`.claude/skills/handoff/`, `.agents/skills/handoff/`) and git-excluded; the branch-committed HANDOFF.md is the shared cross-tool memory (issue #1877)                                                                                                                                                                          |
| `--prompt-playwright-mcp`                                        |       | boolean | true                | Playwright MCP hints (only if MCP installed, use `--no-prompt-playwright-mcp` to disable)                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--prompt-check-sibling-pull-requests`                           |       | boolean | true                | Check sibling PRs when studying related work (use `--no-prompt-check-sibling-pull-requests` to disable)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `--github-rate-limits-logging`                                   |       | boolean | false               | Log GitHub API rate-limit usage after each centralized gh command retry wrapper call (disabled by default)                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--prompt-experiments-folder`                                    |       | string  | ./experiments       | Path to experiments folder (empty to disable)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--prompt-examples-folder`                                       |       | string  | ./examples          | Path to examples folder (empty to disable)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--playwright-mcp`                                               |       | boolean | true                | Enable Playwright MCP server connection for this session (use `--no-playwright-mcp` to physically disable without affecting global MCP registration)                                                                                                                                                                                                                                                                                                                                                                               |
| `--playwright-mcp-auto-cleanup`                                  |       | boolean | true                | Auto-remove .playwright-mcp/ folder before uncommitted check                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `--useless-tools-disabled`                                       |       | boolean | true                | Disable Claude Code tools and MCP servers with no value in headless runs (CronCreate, EnterPlanMode, RemoteTrigger, claude.ai Gmail/Drive/Calendar, …). Use `--no-useless-tools-disabled` to keep them enabled.                                                                                                                                                                                                                                                                                                                    |
| `--auto-gh-configuration-repair`                                 |       | boolean | false               | Auto-repair git config using gh-setup-git-identity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--auto-init-repository`                                         |       | boolean | false               | Automatically initialize empty repositories by creating README.md, enabling branch creation on repos with no commits                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--prompt-ensure-all-requirements-are-met`                       |       | boolean | false               | [EXPERIMENTAL] Add prompt hint to ensure all changes meet all discussed requirements                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--prompt-subagents-via-agent-commander`                         |       | boolean | false               | Use agent-commander for subagent delegation (requires installation)                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--finalize`                                                     |       | number  | 0                   | [EXPERIMENTAL] After solve completes, restart AI N times with requirements-check prompt                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `--finalize-model`                                               |       | string  |                     | [EXPERIMENTAL] Model override for --finalize iterations (defaults to --model)                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--keep-working-until-all-requirements-are-fully-done`           |       | string  |                     | [EXPERIMENTAL] After solve completes, scan the PR description, AI solution summary and changed markdown for deferred/out-of-scope work (e.g. "future work", "out of scope", "TODO", "follow-up PR") and auto-restart the AI to finish everything in this single PR. Accepts a number of restarts (default: 5), or "forever"/"unlimited" to remove the limit. Aliases (prefix each with `--`): keep-going-until-all-requirements-are-fully-done, keep-working, keep-going                                                           |
| `--escalate`                                                     |       | string  |                     | [EXPERIMENTAL] Start solving with a cheaper/lower-tier model and escalate to a more capable (more expensive) model while unfinished work remains. Accepts a range `<lower>-<upper>` using short Claude tier names (ladder: haiku < sonnet < opus < fable), e.g. `sonnet-opus`. A single name (e.g. `opus`) means just that tier. Bare flag means `sonnet-fable`. See `docs/case-studies/issue-1885/`.                                                                                                                              |
| `--escalate-from`                                                |       | string  |                     | [EXPERIMENTAL] Shortcut for `--escalate <model>-fable`: start from the given model (haiku/sonnet/opus/fable, aliases accepted) and escalate up to the top of the ladder. Takes precedence over `--escalate`.                                                                                                                                                                                                                                                                                                                       |
| `--escalate-steps`                                               |       | number  | 1                   | [EXPERIMENTAL] How many working sessions to keep each model tier before escalating to the next one (default: 1). For example 2 keeps the lower tier for two sessions, then the next for two, and so on. Only used with `--escalate` / `--escalate-from`.                                                                                                                                                                                                                                                                           |
| `--working-session-live-progress`                                |       | string  | false               | [EXPERIMENTAL] Live progress monitoring: "comment" (per-session PR comment) or "pr" (updates PR description)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `--do-not-shutdown-in-the-middle-of-working-session`             |       | boolean | false               | [EXPERIMENTAL] On interrupt (CTRL+C / SIGTERM), do not abort the AI tool mid-run. If an AI working session is in progress, wait for it to finish, auto-commit any uncommitted changes, then shut down gracefully. If solve is only idle-waiting (e.g. for CI/CD), stop immediately. A second interrupt force-stops. hive passes this automatically to every /solve worker. See `docs/case-studies/issue-1823/`.                                                                                                                    |
| `--language`                                                     |       | string  |                     | Language for user-facing output (`en`, `ru`, `zh`, `hi`). Defaults to detected system locale. Sets both UI and work tracks at once. Equivalent to passing `--ui-language` and `--work-language` together.                                                                                                                                                                                                                                                                                                                          |
| `--ui-language`                                                  |       | string  |                     | Override only the UI/log track (`en`, `ru`, `zh`, `hi`). Affects terminal status/error messages and locale-driven bot strings. Takes precedence over `--language`. Code, identifiers, and CLI strings stay in their original form.                                                                                                                                                                                                                                                                                                 |
| `--work-language`                                                |       | string  |                     | Override only the work track (`en`, `ru`, `zh`, `hi`). Affects the language the AI uses for free-form output (PR/issue comments, commit messages, chat replies) via a system-prompt directive. Takes precedence over `--language`.                                                                                                                                                                                                                                                                                                 |
| `--auto-language`                                                |       | boolean | false               | Experimental and disabled by default. Automatically detect the target issue or pull request language from title/body and set the AI work language to English or Russian when one language has more than 51% of all words. Explicit `--work-language` or the hidden prompt-language alias takes precedence.                                                                                                                                                                                                                         |
| `--gemini-sandbox`                                               |       | boolean | false               | Run gemini-cli inside its sandbox (passes the gemini-cli sandbox flag). Only used when `--tool gemini`.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `--gemini-extensions`                                            |       | string  |                     | Comma-separated list of gemini-cli extensions to load (passes the gemini-cli extensions flag). Only used when `--tool gemini`.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--gemini-include-directories`                                   |       | string  |                     | Extra directories to expose to gemini-cli (passes the gemini-cli include-directories flag, in addition to `tempDir`/`workspaceTmpDir` which are always included). Only used when `--tool gemini`.                                                                                                                                                                                                                                                                                                                                  |
| `--gemini-allowed-mcp-servers`                                   |       | string  |                     | Comma-separated list of MCP server names that gemini-cli is allowed to call (passes the gemini-cli allowed-mcp-server-names flag). Only used when `--tool gemini`.                                                                                                                                                                                                                                                                                                                                                                 |

### hive Options

```bash
hive <github-url> [options]
```

| Option                                               | Alias | Type    | Default       | Description                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | ----- | ------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--monitor-tag`                                      | `-t`  | string  | "help wanted" | Label to monitor                                                                                                                                                                                                                                                                                   |
| `--all-issues`                                       | `-a`  | boolean | false         | Monitor all issues (ignore labels)                                                                                                                                                                                                                                                                 |
| `--skip-issues-with-prs`                             | `-s`  | boolean | false         | Skip issues with existing PRs                                                                                                                                                                                                                                                                      |
| `--concurrency`                                      | `-c`  | number  | 2             | Parallel workers                                                                                                                                                                                                                                                                                   |
| `--pull-requests-per-issue`                          | `-p`  | number  | 1             | Number of PRs per issue                                                                                                                                                                                                                                                                            |
| `--model`                                            | `-m`  | string  | sonnet        | Model to use                                                                                                                                                                                                                                                                                       |
| `--sub-agent-model`                                  |       | string  |               | Claude Code subagent/agent-team model override forwarded to solve workers. Sets `CLAUDE_CODE_SUBAGENT_MODEL` only when provided. Accepts Claude model aliases, full model IDs, or `inherit`. Only works with `--tool claude`.                                                                      |
| `--tool`                                             |       | string  | claude        | AI tool (claude, opencode, codex, agent, qwen, gemini)                                                                                                                                                                                                                                             |
| `--interval`                                         | `-i`  | number  | 300           | Poll interval (seconds)                                                                                                                                                                                                                                                                            |
| `--max-issues`                                       |       | number  | 0             | Limit processed issues (0 = unlimited)                                                                                                                                                                                                                                                             |
| `--once`                                             |       | boolean | false         | Single run (don't monitor)                                                                                                                                                                                                                                                                         |
| `--dry-run`                                          |       | boolean | false         | List issues without processing                                                                                                                                                                                                                                                                     |
| `--skip-tool-connection-check`                       |       | boolean | false         | Skip tool connection check                                                                                                                                                                                                                                                                         |
| `--verbose`                                          | `-v`  | boolean | false         | Enable verbose logging                                                                                                                                                                                                                                                                             |
| `--min-disk-space`                                   |       | number  | 10240         | Minimum disk space in MB                                                                                                                                                                                                                                                                           |
| `--auto-cleanup`                                     |       | boolean | false         | Clean temp directories on success                                                                                                                                                                                                                                                                  |
| `--fork`                                             | `-f`  | boolean | false         | Fork repos if no write access                                                                                                                                                                                                                                                                      |
| `--auto-fork`                                        |       | boolean | true          | Automatically fork public repos                                                                                                                                                                                                                                                                    |
| `--auto-init-repository`                             |       | boolean | false         | Auto-initialize empty repos by creating README.md (passed to solve)                                                                                                                                                                                                                                |
| `--auto-accept-invite`                               |       | boolean | true          | Auto-accept pending GitHub repo/org invitation for the target repository (use `--no-auto-accept-invite` to disable)                                                                                                                                                                                |
| `--attach-logs`                                      |       | boolean | false         | Attach logs to PRs (sensitive)                                                                                                                                                                                                                                                                     |
| `--attach-solution-summary`                          |       | boolean | false         | Attach AI solution summary as comment                                                                                                                                                                                                                                                              |
| `--auto-attach-solution-summary`                     |       | boolean | true          | Auto-attach summary if no AI comments (use `--no-auto-attach-solution-summary` to disable)                                                                                                                                                                                                         |
| `--project-number`                                   | `-pn` | number  |               | GitHub Project number to monitor                                                                                                                                                                                                                                                                   |
| `--project-owner`                                    | `-po` | string  |               | GitHub Project owner                                                                                                                                                                                                                                                                               |
| `--project-status`                                   | `-ps` | string  | "Ready"       | Project status column to monitor                                                                                                                                                                                                                                                                   |
| `--project-mode`                                     | `-pm` | boolean | false         | Enable project-based monitoring                                                                                                                                                                                                                                                                    |
| `--youtrack-mode`                                    |       | boolean | false         | Enable YouTrack mode                                                                                                                                                                                                                                                                               |
| `--youtrack-stage`                                   |       | string  |               | Override YouTrack stage                                                                                                                                                                                                                                                                            |
| `--youtrack-project`                                 |       | string  |               | Override YouTrack project code                                                                                                                                                                                                                                                                     |
| `--target-branch`                                    | `-tb` | string  | (default)     | Target branch for PRs                                                                                                                                                                                                                                                                              |
| `--log-dir`                                          | `-l`  | string  | (cwd)         | Directory for log files                                                                                                                                                                                                                                                                            |
| `--auto-continue`                                    |       | boolean | true          | Pass --auto-continue to solve                                                                                                                                                                                                                                                                      |
| `--auto-resume-on-limit-reset`                       |       | boolean | true          | Auto-resume when limit resets (passed to solve)                                                                                                                                                                                                                                                    |
| `--do-not-shutdown-in-the-middle-of-working-session` |       | boolean | true          | [EXPERIMENTAL] On CTRL+C, let each solve worker finish its current AI working session and auto-commit before shutting down (idle/CI-waiting workers stop immediately). Second CTRL+C force-stops. Enabled by default for hive; `--no-do-not-shutdown-in-the-middle-of-working-session` to disable. |
| `--think`                                            |       | string  |               | Thinking level (off, low, medium, high, xhigh, max)                                                                                                                                                                                                                                                |
| `--prompt-plan-sub-agent`                            |       | boolean | false         | Use Plan sub-agent                                                                                                                                                                                                                                                                                 |
| `--sentry`                                           |       | boolean | false         | Enable Sentry error tracking (disabled by default for privacy; use --sentry to opt in)                                                                                                                                                                                                             |
| `--watch`                                            | `-w`  | boolean | false         | Monitor for feedback and auto-restart                                                                                                                                                                                                                                                              |
| `--issue-order`                                      | `-o`  | string  | "asc"         | Order issues by date (asc, desc)                                                                                                                                                                                                                                                                   |
| `--prefix-fork-name-with-owner-name`                 |       | boolean | true          | Prefix fork with owner name                                                                                                                                                                                                                                                                        |
| `--interactive-mode`                                 |       | boolean | false         | [EXPERIMENTAL] Post output as PR comments                                                                                                                                                                                                                                                          |
| `--prompt-explore-sub-agent`                         |       | boolean | false         | Use Explore sub-agent                                                                                                                                                                                                                                                                              |
| `--prompt-general-purpose-sub-agent`                 |       | boolean | false         | Use general-purpose sub agents                                                                                                                                                                                                                                                                     |
| `--tokens-budget-stats`                              |       | boolean | true          | Show token budget statistics (use `--no-tokens-budget-stats` to disable)                                                                                                                                                                                                                           |
| `--prompt-issue-reporting`                           |       | boolean | false         | Auto-create issues for spotted bugs                                                                                                                                                                                                                                                                |
| `--prompt-case-studies`                              |       | boolean | false         | Create case study documentation                                                                                                                                                                                                                                                                    |
| `--prompt-playwright-mcp`                            |       | boolean | true          | Playwright MCP hints (only if installed)                                                                                                                                                                                                                                                           |
| `--playwright-mcp`                                   |       | boolean | true          | Enable Playwright MCP for this session (`--no-playwright-mcp` to disable)                                                                                                                                                                                                                          |
| `--prompt-check-sibling-pull-requests`               |       | boolean | true          | Check sibling PRs when studying related work                                                                                                                                                                                                                                                       |
| `--github-rate-limits-logging`                       |       | boolean | false         | Log GitHub API rate-limit usage after centralized gh retry wrapper calls                                                                                                                                                                                                                           |

### hive-telegram-bot Options

```bash
hive-telegram-bot [options]
```

| Option                              | Alias | Type    | Default    | Description                                                                                                                                                                                                 |
| ----------------------------------- | ----- | ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--token`                           | `-t`  | string  | (required) | Telegram bot token from @BotFather                                                                                                                                                                          |
| `--allowed-chats`                   |       | string  | (all)      | Allowed chat IDs (Links Notation)                                                                                                                                                                           |
| `--solve-overrides`                 |       | string  | (none)     | Override options for /solve                                                                                                                                                                                 |
| `--hive-overrides`                  |       | string  | (none)     | Override options for /hive                                                                                                                                                                                  |
| `--solve`                           |       | boolean | true       | Enable /solve command (--no-solve to disable)                                                                                                                                                               |
| `--hive`                            |       | boolean | true       | Enable /hive command (--no-hive to disable)                                                                                                                                                                 |
| `--task`                            |       | boolean | true       | Enable /task and /split commands (--no-task to disable)                                                                                                                                                     |
| `--auth`                            |       | boolean | true       | Enable experimental private /auth command for allowlisted chat owners (--no-auth to disable)                                                                                                                |
| `--configuration`                   | `-c`  | string  |            | LINO configuration string                                                                                                                                                                                   |
| `--verbose`                         | `-v`  | boolean | false      | Enable verbose logging                                                                                                                                                                                      |
| `--dry-run`                         |       | boolean | false      | Validate without starting bot                                                                                                                                                                               |
| `--auto-start-screen-watch-message` |       | boolean | false      | Experimental: auto-start a separate `/terminal_watch` message for public `/solve` sessions. Private or unknown-visibility repositories never auto-start watch messages.                                     |
| `--isolation`                       |       | string  | `docker`   | Isolation backend (`screen`, `tmux`, `docker`). Default `docker` runs Telegram-bot work sessions in Docker isolation with success cleanup. Pass `--isolation ''` (or set `TELEGRAM_ISOLATION=`) to opt out. |

When `/solve` is enabled, the Telegram bot also accepts `/do` and `/continue`
as plain `/solve` aliases. The `/claude`, `/codex`, `/opencode`, `/agent`, `/qwen`,
and `/gemini` commands are per-tool aliases equivalent to `/solve --tool claude`,
`/solve --tool codex`, `/solve --tool opencode`, `/solve --tool agent`,
`/solve --tool qwen`, and `/solve --tool gemini`.

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

# Enable Sentry error tracking (disabled by default)
export HIVE_MIND_SENTRY=true

# Configure for GitHub Enterprise
export HIVE_MIND_GITHUB_BASE_URL=https://github.enterprise.com
```

### Running with Custom Configuration

```bash
# Run with custom timeouts
HIVE_MIND_CLAUDE_TIMEOUT_SECONDS=120 HIVE_MIND_RETRY_BASE_DELAY_MS=10000 hive https://github.com/owner/repo

# Run with increased limits
HIVE_MIND_GITHUB_FILE_MAX_SIZE=52428800 HIVE_MIND_MIN_DISK_SPACE_MB=20480 solve https://github.com/owner/repo/issues/123

# Run with custom auto-continue settings (--auto-continue is enabled by default)
HIVE_MIND_AUTO_CONTINUE_AGE_HOURS=12 solve https://github.com/owner/repo/issues/456
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

### Tool-Specific Default Values

`--model` and reasoning behavior depend on the selected `--tool`:

| Tool       | Default model                                               | Default reasoning behavior                                                               |
| ---------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `claude`   | `sonnet`                                                    | No extra thinking is requested unless you pass `--think` or `--thinking-budget`          |
| `codex`    | `gpt-5.5` preferred, with runtime fallback to local catalog | Codex runs with `reasoning_effort=none` unless you pass `--think` or `--thinking-budget` |
| `opencode` | `grok-code-fast-1`                                          | No extra thinking prompt is added for the default model                                  |
| `agent`    | `nemotron-3-super-free`                                     | No extra thinking prompt is added for the default model                                  |
| `gemini`   | `flash`                                                     | No extra thinking prompt is added for the default model                                  |
| `qwen`     | `qwen3-coder-plus`                                          | No extra thinking prompt is added for the default model                                  |
| `gemini`   | `gemini-2.5-flash`                                          | No extra thinking prompt is added for the default model                                  |

Additional tool-sensitive file-passing defaults:

| Option           | Default |
| ---------------- | ------- |
| `--claude-file`  | `false` |
| `--gitkeep-file` | `true`  |

**Rationale for `--gitkeep-file` default:**

- `.gitkeep` is the default for all tools: CLAUDE.md and AGENT.md files generally do not help AI tools and should be avoided (see [explanation](https://youtu.be/GcNu6wrLTJc))
- Use `--claude-file` to explicitly opt in to CLAUDE.md-based task passing if needed
