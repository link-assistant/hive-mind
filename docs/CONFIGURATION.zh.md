# 配置指南 (languages: [en](CONFIGURATION.md) • zh • [hi](CONFIGURATION.hi.md) • [ru](CONFIGURATION.ru.md))

Hive Mind 应用程序支持通过环境变量和命令行选项进行广泛配置。本文档提供了所有可用配置选项的完整参考。

> **OpenRouter 集成**：如需将 Claude Code CLI 或 @link-assistant/agent 与 OpenRouter（来自 60+ 个提供商的 500+ 个模型）结合使用，请参阅专门的 [OpenRouter 配置指南](./OPENROUTER.zh.md)。

## 目录

- [环境变量](#environment-variables)
  - [超时配置](#1-timeout-configurations)
  - [自动继续设置](#2-auto-continue-settings)
  - [限额重置设置](#22-limit-reset-settings)
  - [GitHub API 限制](#3-github-api-limits)
  - [系统资源限制](#4-system-resource-limits)
  - [重试配置](#5-retry-configurations)
  - [缓存 TTL 配置](#51-cache-ttl-configurations)
  - [Claude Code CLI 配置](#52-claude-code-cli-configurations)
  - [文件和路径设置](#6-file-and-path-settings)
  - [文本处理](#7-text-processing)
  - [显示设置](#8-display-settings)
  - [Sentry 错误跟踪](#9-sentry-error-tracking)
  - [外部 URL](#10-external-urls)
  - [模型配置](#11-model-configuration)
  - [版本设置](#12-version-settings)
  - [合并队列配置](#121-merge-queue-configurations)
  - [Telegram Bot](#13-telegram-bot)
  - [YouTrack 集成](#14-youtrack-integration)
  - [工具路径](#15-tool-paths)
  - [调试和开发](#16-debug-and-development)
  - [Playwright MCP](#17-playwright-mcp)
- [命令行选项](#command-line-options)
  - [solve 选项](#solve-options)
  - [hive 选项](#hive-options)
  - [hive-telegram-bot 选项](#hive-telegram-bot-options)
- [使用示例](#usage-examples)

---

## 环境变量

所有环境变量均通过 `src/config.lib.mjs` 模块管理，该模块使用 `getenv` 进行可靠处理。配置使用驼峰命名的属性名，以与 JavaScript 约定保持一致。

### 1. 超时配置

| 环境变量                             | 默认值 | 描述                                                   |
| ------------------------------------ | ------ | ------------------------------------------------------ |
| `HIVE_MIND_CLAUDE_TIMEOUT_SECONDS`   | 60     | Claude CLI 超时时间（秒）                              |
| `HIVE_MIND_OPENCODE_TIMEOUT_SECONDS` | 60     | OpenCode CLI 超时时间（秒）                            |
| `HIVE_MIND_CODEX_TIMEOUT_SECONDS`    | 60     | Codex CLI 超时时间（秒）                               |
| `HIVE_MIND_GITHUB_API_DELAY_MS`      | 5000   | GitHub API 调用之间的延迟（毫秒）                      |
| `HIVE_MIND_GITHUB_REPO_DELAY_MS`     | 2000   | 仓库操作之间的延迟（毫秒）                             |
| `HIVE_MIND_RETRY_BASE_DELAY_MS`      | 5000   | 重试操作的基础延迟（毫秒）                             |
| `HIVE_MIND_RETRY_BACKOFF_DELAY_MS`   | 1000   | 重试的退避延迟（毫秒）                                 |
| `HIVE_MIND_RESULT_STREAM_CLOSE_MS`   | 30000  | 结果事件后等待流关闭的超时时间（毫秒），超时后强制终止 |

### 2. 自动继续设置

| 环境变量                            | 默认值 | 描述                             |
| ----------------------------------- | ------ | -------------------------------- |
| `HIVE_MIND_AUTO_CONTINUE_AGE_HOURS` | 24     | 自动继续前 PR 的最小时间（小时） |

### 2.2. 限额重置设置

| 环境变量                          | 默认值 | 描述                                     |
| --------------------------------- | ------ | ---------------------------------------- |
| `HIVE_MIND_LIMIT_RESET_BUFFER_MS` | 300000 | 限额重置后的缓冲等待时间（5 分钟，毫秒） |

### 3. GitHub API 限制

| 环境变量                               | 默认值   | 描述                                |
| -------------------------------------- | -------- | ----------------------------------- |
| `HIVE_MIND_GITHUB_COMMENT_MAX_SIZE`    | 65536    | GitHub 评论的最大大小（字节）       |
| `HIVE_MIND_GITHUB_FILE_MAX_SIZE`       | 26214400 | GitHub 操作的最大文件大小（25MB）   |
| `HIVE_MIND_GITHUB_ISSUE_BODY_MAX_SIZE` | 60000    | Issue 正文的最大大小（字节）        |
| `HIVE_MIND_GITHUB_ATTACHMENT_MAX_SIZE` | 10485760 | 最大附件大小（10MB）                |
| `HIVE_MIND_GITHUB_BUFFER_MAX_SIZE`     | 10485760 | GitHub 操作的最大缓冲区大小（10MB） |

### 4. 系统资源限制

| 环境变量                         | 默认值 | 描述                   |
| -------------------------------- | ------ | ---------------------- |
| `HIVE_MIND_MIN_DISK_SPACE_MB`    | 2048   | 最小所需磁盘空间（MB） |
| `HIVE_MIND_DEFAULT_PAGE_SIZE_KB` | 16     | 默认内存页大小（KB）   |

### 5. 重试配置

| 环境变量                               | 默认值 | 描述                        |
| -------------------------------------- | ------ | --------------------------- |
| `HIVE_MIND_MAX_FORK_RETRIES`           | 5      | 最大 Fork 创建重试次数      |
| `HIVE_MIND_MAX_VERIFY_RETRIES`         | 5      | 最大验证重试次数            |
| `HIVE_MIND_MAX_API_RETRIES`            | 3      | 最大 API 调用重试次数       |
| `HIVE_MIND_RETRY_BACKOFF_MULTIPLIER`   | 2      | 重试退避乘数                |
| `HIVE_MIND_MAX_503_RETRIES`            | 3      | 最大 503 错误重试次数       |
| `HIVE_MIND_INITIAL_503_RETRY_DELAY_MS` | 300000 | 初始 503 重试延迟（5 分钟） |

### 5.1. 缓存 TTL 配置

这些设置控制 API 响应被缓存多长时间，超过该时间后将发起新请求。

| 环境变量                           | 默认值 | 描述                                                                                                                     |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| `HIVE_MIND_API_CACHE_TTL_MS`       | 180000 | 通用 API 缓存 TTL（毫秒，3 分钟）。用于 GitHub API。                                                                     |
| `HIVE_MIND_USAGE_API_CACHE_TTL_MS` | 600000 | Claude 用量 API 缓存 TTL（毫秒，10 分钟）。**重要：** Claude 用量 API 有更严格的速率限制。调用频率过高可能返回 null 值。 |
| `HIVE_MIND_SYSTEM_CACHE_TTL_MS`    | 120000 | 系统指标缓存 TTL（毫秒，2 分钟）。用于 RAM、CPU 和磁盘空间。                                                             |

**注意：** Claude 用量 API（`/api/oauth/usage`）的速率限制比其他 API 更严格。如果您在 `/limits` 命令输出中遇到 `null` 值，可能是 API 调用频率过高。默认的 10 分钟 TTL 旨在避免此问题。详情请参阅 [Issue #1074](https://github.com/link-assistant/hive-mind/issues/1074)。

### 5.2. Claude Code CLI 配置

这些设置控制 Claude Code CLI 的行为，包括输出限制和 MCP 超时。

| 环境变量                                | 默认值 | 描述                                                                                           |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS`         | 64000  | Claude Code CLI 响应的最大输出 token 数（也可使用：`HIVE_MIND_CLAUDE_CODE_MAX_OUTPUT_TOKENS`） |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS_OPUS_46` | 128000 | Opus 4.6+ 的最大输出 token 数（也可使用：`HIVE_MIND_CLAUDE_CODE_MAX_OUTPUT_TOKENS_OPUS_46`）   |
| `MCP_TIMEOUT`                           | 900000 | MCP 服务器启动超时（毫秒，15 分钟）（也可使用：`HIVE_MIND_MCP_TIMEOUT`）                       |
| `MCP_TOOL_TIMEOUT`                      | 900000 | MCP 工具执行超时（毫秒，15 分钟）（也可使用：`HIVE_MIND_MCP_TOOL_TIMEOUT`）                    |
| `HIVE_MIND_MAX_THINKING_BUDGET_OPUS_46` | 31999  | Opus 4.6+ 模型的默认最大思考预算                                                               |

**注意：** Claude 模型支持不同的最大输出 token 数：Opus 4.6（默认 `opus` 别名）支持 128K token，而 Sonnet 4.5、Opus 4.5 和 Haiku 4.5 支持 64K token。MCP 超时时间（默认 15 分钟）可容纳长时间运行的 Playwright 操作。详情请参阅 [Issue #1076](https://github.com/link-assistant/hive-mind/issues/1076) 和 [Issue #1066](https://github.com/link-assistant/hive-mind/issues/1066)。

### 6. 文件和路径设置

| 环境变量                       | 默认值        | 描述             |
| ------------------------------ | ------------- | ---------------- |
| `HIVE_MIND_TEMP_DIR`           | /tmp          | 临时目录路径     |
| `HIVE_MIND_TASK_INFO_FILENAME` | CLAUDE.md     | 任务信息文件名   |
| `HIVE_MIND_PROC_MEMINFO`       | /proc/meminfo | 内存信息文件路径 |

### 7. 文本处理

| 环境变量                           | 默认值 | 描述                   |
| ---------------------------------- | ------ | ---------------------- |
| `HIVE_MIND_TOKEN_MASK_MIN_LENGTH`  | 12     | Token 掩码的最小长度   |
| `HIVE_MIND_TOKEN_MASK_START_CHARS` | 5      | 掩码时显示开头的字符数 |
| `HIVE_MIND_TOKEN_MASK_END_CHARS`   | 5      | 掩码时显示结尾的字符数 |
| `HIVE_MIND_TEXT_PREVIEW_LENGTH`    | 100    | 文本预览长度           |
| `HIVE_MIND_LOG_TRUNCATION_LENGTH`  | 5000   | 日志截断长度           |

### 8. 显示设置

| 环境变量                | 默认值 | 描述                   |
| ----------------------- | ------ | ---------------------- |
| `HIVE_MIND_LABEL_WIDTH` | 25     | 格式化输出中标签的宽度 |

### 9. Sentry 错误跟踪

| 环境变量                                            | 默认值     | 描述                                        |
| --------------------------------------------------- | ---------- | ------------------------------------------- |
| `HIVE_MIND_SENTRY_DSN`                              | （已提供） | 用于错误跟踪的 Sentry DSN                   |
| `HIVE_MIND_SENTRY_TRACES_SAMPLE_RATE_DEV`           | 1.0        | 开发环境中的跟踪采样率                      |
| `HIVE_MIND_SENTRY_TRACES_SAMPLE_RATE_PROD`          | 0.1        | 生产环境中的跟踪采样率                      |
| `HIVE_MIND_SENTRY_PROFILE_SESSION_SAMPLE_RATE_DEV`  | 1.0        | 开发环境中的分析采样率                      |
| `HIVE_MIND_SENTRY_PROFILE_SESSION_SAMPLE_RATE_PROD` | 0.1        | 生产环境中的分析采样率                      |
| `HIVE_MIND_NO_SENTRY`                               | true       | 禁用 Sentry（设为 "true"；Sentry 默认关闭） |
| `DISABLE_SENTRY`                                    | true       | 另一种禁用 Sentry 的方式（Sentry 默认关闭） |
| `HIVE_MIND_SENTRY`                                  | false      | 启用 Sentry（设为 "true" 以选择启用）       |

### 10. 外部 URL

| 环境变量                    | 默认值             | 描述                                      |
| --------------------------- | ------------------ | ----------------------------------------- |
| `HIVE_MIND_GITHUB_BASE_URL` | https://github.com | GitHub 基础 URL（用于 GitHub Enterprise） |
| `HIVE_MIND_BUN_INSTALL_URL` | https://bun.sh/    | Bun 安装 URL                              |

### 11. 模型配置

| 环境变量                     | 默认值              | 描述                       |
| ---------------------------- | ------------------- | -------------------------- |
| `HIVE_MIND_AVAILABLE_MODELS` | opus, sonnet, haiku | 可用模型（Links Notation） |
| `HIVE_MIND_DEFAULT_MODEL`    | sonnet              | 默认使用的模型             |
| `HIVE_MIND_RESTRICT_MODELS`  | false               | 仅限列出的模型             |

### 12. 版本设置

| 环境变量                     | 默认值 | 描述       |
| ---------------------------- | ------ | ---------- |
| `HIVE_MIND_VERSION_FALLBACK` | 0.14.3 | 回退版本号 |
| `HIVE_MIND_VERSION_DEFAULT`  | 0.14.3 | 默认版本号 |

### 12.1. 合并队列配置

这些设置控制自动 PR 合并的合并队列行为。

| 环境变量                                    | 默认值   | 描述                                        |
| ------------------------------------------- | -------- | ------------------------------------------- |
| `HIVE_MIND_MERGE_QUEUE_MAX_PRS`             | 10       | 单次合并会话中处理的最大 PR 数              |
| `HIVE_MIND_MERGE_QUEUE_CI_POLL_INTERVAL_MS` | 300000   | CI/CD 轮询间隔（毫秒，5 分钟）              |
| `HIVE_MIND_MERGE_QUEUE_CI_TIMEOUT_MS`       | 25200000 | CI/CD 超时（毫秒，7 小时）                  |
| `HIVE_MIND_MERGE_QUEUE_POST_MERGE_WAIT_MS`  | 60000    | 合并后处理下一个 PR 前的等待时间（1 分钟）  |
| `HIVE_MIND_MERGE_QUEUE_MERGE_METHOD`        | merge    | 默认合并方法：`merge`、`squash` 或 `rebase` |

**注意：** 详情请参阅 [Issue #1143](https://github.com/link-assistant/hive-mind/issues/1143) 和 [Issue #1269](https://github.com/link-assistant/hive-mind/issues/1269)。

### 13. Telegram Bot

| 环境变量                                   | 默认值   | 描述                                                            |
| ------------------------------------------ | -------- | --------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`                       | （必填） | 来自 @BotFather 的 Telegram bot token                           |
| `TELEGRAM_ALLOWED_CHATS`                   | （全部） | 允许的聊天 ID（Links Notation）                                 |
| `TELEGRAM_SOLVE_OVERRIDES`                 | （无）   | /solve 的覆盖选项（Links Notation）                             |
| `TELEGRAM_HIVE_OVERRIDES`                  | （无）   | /hive 的覆盖选项（Links Notation）                              |
| `TELEGRAM_SOLVE`                           | true     | 启用 /solve 命令                                                |
| `TELEGRAM_HIVE`                            | true     | 启用 /hive 命令                                                 |
| `TELEGRAM_AUTO_START_SCREEN_WATCH_MESSAGE` | false    | 为公开仓库的 /solve 会话自动启动单独的 live terminal watch 消息 |
| `TELEGRAM_BOT_VERBOSE`                     | false    | 启用详细日志                                                    |
| `TELEGRAM_CONFIGURATION`                   | （无）   | LINO 配置字符串                                                 |

### 14. YouTrack 集成

| 环境变量                | 默认值   | 描述                                  |
| ----------------------- | -------- | ------------------------------------- |
| `YOUTRACK_URL`          | （必填） | YouTrack 实例 URL                     |
| `YOUTRACK_API_KEY`      | （必填） | YouTrack API 认证密钥                 |
| `YOUTRACK_PROJECT_CODE` | （必填） | YouTrack 项目代码                     |
| `YOUTRACK_STAGE`        | （必填） | 要监控的 YouTrack 阶段                |
| `YOUTRACK_NEXT_STAGE`   | （可选） | 处理后将 Issue 移动到的 YouTrack 阶段 |

### 15. 工具路径

| 环境变量        | 默认值   | 描述                        |
| --------------- | -------- | --------------------------- |
| `CLAUDE_PATH`   | claude   | Claude CLI 可执行文件路径   |
| `OPENCODE_PATH` | opencode | OpenCode CLI 可执行文件路径 |
| `CODEX_PATH`    | codex    | Codex CLI 可执行文件路径    |
| `AGENT_PATH`    | agent    | Agent CLI 可执行文件路径    |

### 16. 调试和开发

| 环境变量   | 默认值     | 描述         |
| ---------- | ---------- | ------------ |
| `DEBUG`    | false      | 启用调试模式 |
| `NODE_ENV` | production | Node.js 环境 |
| `CI`       | false      | CI 环境标志  |
| `VERBOSE`  | false      | 启用详细输出 |

### 17. Playwright MCP

Playwright MCP（模型上下文协议）为 Claude Code 提供浏览器自动化功能，支持网页抓取、UI 测试以及与动态网页的交互。

#### 安装

```bash
# 推荐：使用内存安全设置安装（适用于服务器和 Docker）
claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080

# 最简安装（适用于本地开发）
claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless
```

#### 命令行参数

| 参数                     | 描述                                      | 内存影响                           |
| ------------------------ | ----------------------------------------- | ---------------------------------- |
| `--isolated`             | 临时浏览器上下文（最重要）                | **高** - 防止进程积累              |
| `--headless`             | 以无头模式运行浏览器                      | **中** - 减少 UI 内存开销          |
| `--browser <type>`       | 浏览器：chromium、firefox、webkit、msedge | **不一** - WebKit 通常使用更少内存 |
| `--no-sandbox`           | 禁用沙盒（仅限受控环境）                  | **低** - 稍微减少内存              |
| `--timeout-action <ms>`  | 操作超时（默认：5000）                    | **不适用** - 防止进程挂起          |
| `--viewport-size <size>` | 设置视口尺寸（例如 "1280x720"）           | **低** - 影响渲染内存              |
| `--storage-state <path>` | 加载认证状态而无需完整配置文件            | **中** - 无配置文件膨胀的认证      |

#### 作用域选项

| 作用域    | 描述                   | 配置位置                     |
| --------- | ---------------------- | ---------------------------- |
| `local`   | 仅限当前目录           | `~/.claude.json`（项目特定） |
| `project` | 通过版本控制共享给团队 | `.mcp.json`（项目根目录）    |
| `user`    | 全局可用               | `~/.claude.json`（用户部分） |

#### JSON 配置

在 `~/.claude.json` 中直接配置：

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

#### MCP 命令

```bash
# 列出已配置的 MCP 服务器
claude mcp list

# 获取服务器详情
claude mcp get playwright

# 移除服务器
claude mcp remove playwright
```

#### 最佳实践

1. **始终使用 `--isolated` 模式** - 防止 Chrome 进程积累和内存泄漏
2. **固定到特定版本** - 使用 `@playwright/mcp@0.0.49` 而非 `@latest` 以确保稳定性
3. **在服务器上使用 `--headless`** - 减少 CI/CD 和生产环境中的内存开销
4. **定期重启 Claude Code** - 对于长时间运行的会话，以清除积累的浏览器资源

如需完整的配置选项、故障排除和高级使用场景，请参阅详细指南：
[Playwright MCP 配置指南](./case-studies/issue-837-playwright-mcp-chrome-leak/04-CLAUDE-PLAYWRIGHT-MCP-CONFIGURATION.md)

---

## 命令行选项

### solve 选项

```bash
solve <issue-url> [options]
```

| 选项                                                             | 别名 | 类型    | 默认值        | 描述                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | ---- | ------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--model`                                                        | `-m` | string  | sonnet        | 模型（claude 使用 opus、sonnet、haiku；opencode 使用 grok-code-fast-1；codex 使用 gpt-5）                                                                                                                                                                                                 |
| `--worker-model`                                                 |      | string  |               | --model 的别名：当指定 --plan-model 时的执行/工作模型                                                                                                                                                                                                                                     |
| `--tool`                                                         |      | string  | claude        | AI 工具（claude、opencode、codex、agent）                                                                                                                                                                                                                                                 |
| `--plan`                                                         |      | boolean | false         | 启用计划模式：opus 用于规划，sonnet 用于执行（仅限 --tool claude）                                                                                                                                                                                                                        |
| `--plan-model`                                                   |      | string  |               | 计划模式的模型（例如 opus）。自动切换到 opusplan 模式（仅限 --tool claude）                                                                                                                                                                                                               |
| `--think`                                                        |      | string  |               | 思考级别（off、low、medium、high、max）                                                                                                                                                                                                                                                   |
| `--thinking-budget`                                              |      | number  |               | 思考 token 预算（0-31999）。控制 MAX_THINKING_TOKENS                                                                                                                                                                                                                                      |
| `--thinking-budget-claude-minimum-version`                       |      | string  | 2.1.12        | 支持 --thinking-budget 的最低 Claude Code 版本                                                                                                                                                                                                                                            |
| `--max-thinking-budget`                                          |      | number  | 31999         | 级别映射的最大思考预算                                                                                                                                                                                                                                                                    |
| `--sub-session-size`                                             |      | string  | 150k          | 自动压缩之间的子会话大小上限。接受 token 数（如 `150k`、`1m`、`200000`）、模型上下文窗口的百分比（如 `50%`），或 `default` 保留工具内置阈值。Claude 设置 `CLAUDE_CODE_AUTO_COMPACT_WINDOW` + `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` 环境变量；Codex 使用 `-c model_auto_compact_token_limit`。 |
| `--disable-1m-context`                                           |      | boolean | true          | 禁用 1M 扩展上下文窗口，使模型使用其标准 200K-400K 窗口。有助于保持推理质量并降低成本。Claude 设置 `CLAUDE_CODE_DISABLE_1M_CONTEXT=1`；Codex 使用 `-c model_context_window=200000`。使用 `--no-disable-1m-context` 允许 1M 窗口。                                                         |
| `--fork`                                                         | `-f` | boolean | false         | 无写权限时 Fork 仓库                                                                                                                                                                                                                                                                      |
| `--auto-fork`                                                    |      | boolean | true          | 自动 Fork 无写权限的公开仓库                                                                                                                                                                                                                                                              |
| `--base-branch`                                                  | `-b` | string  | （默认）      | PR 的目标分支                                                                                                                                                                                                                                                                             |
| `--resume`                                                       | `-r` | string  |               | 从会话 ID 恢复                                                                                                                                                                                                                                                                            |
| `--working-directory`                                            | `-d` | string  |               | 使用指定的工作目录（--resume 必需）                                                                                                                                                                                                                                                       |
| `--verbose`                                                      | `-v` | boolean | false         | 启用详细日志                                                                                                                                                                                                                                                                              |
| `--dry-run`                                                      | `-n` | boolean | false         | 仅准备，不执行                                                                                                                                                                                                                                                                            |
| `--only-prepare-command`                                         |      | boolean | false         | 仅准备并打印命令                                                                                                                                                                                                                                                                          |
| `--skip-tool-connection-check`                                   |      | boolean | false         | 跳过工具连接检查                                                                                                                                                                                                                                                                          |
| `--auto-pull-request-creation`                                   |      | boolean | true          | 执行前创建草稿 PR                                                                                                                                                                                                                                                                         |
| `--attach-logs`                                                  |      | boolean | false         | 将日志附加到 PR（敏感信息）                                                                                                                                                                                                                                                               |
| `--attach-solution-summary`                                      |      | boolean | false         | 将 AI 解决方案摘要作为 PR/issue 评论附加                                                                                                                                                                                                                                                  |
| `--auto-attach-solution-summary`                                 |      | boolean | true          | 仅当 AI 未发布评论时自动附加摘要（使用 `--no-auto-attach-solution-summary` 禁用）                                                                                                                                                                                                         |
| `--auto-close-pull-request-on-fail`                              |      | boolean | false         | 失败时关闭 PR                                                                                                                                                                                                                                                                             |
| `--auto-continue`                                                |      | boolean | true          | 继续使用现有 PR                                                                                                                                                                                                                                                                           |
| `--auto-resume-on-limit-reset`                                   |      | boolean | true          | 限额重置时自动恢复（保持会话上下文）                                                                                                                                                                                                                                                      |
| `--auto-restart-on-limit-reset`                                  |      | boolean | false         | 限额重置时自动重启（无 --resume 的新开始）                                                                                                                                                                                                                                                |
| `--auto-resume-on-errors`                                        |      | boolean | false         | 网络错误时自动恢复                                                                                                                                                                                                                                                                        |
| `--auto-continue-only-on-new-comments`                           |      | boolean | false         | 无新评论时失败                                                                                                                                                                                                                                                                            |
| `--auto-commit-uncommitted-changes`                              |      | boolean | false         | 自动提交更改                                                                                                                                                                                                                                                                              |
| `--auto-restart-on-uncommitted-changes`                          |      | boolean | true          | 有未提交更改时自动重启                                                                                                                                                                                                                                                                    |
| `--auto-restart-max-iterations`                                  |      | number  | 5             | 停止前的最大自动重启迭代次数（0 = 不限制）                                                                                                                                                                                                                                                |
| `--auto-resume-max-iterations`                                   |      | number  | 5             | 限额重置后的最大自动恢复/重启次数（0 = 不限制）                                                                                                                                                                                                                                           |
| `--auto-merge`                                                   |      | boolean | false         | 会话结束且 CI 通过时自动合并 PR                                                                                                                                                                                                                                                           |
| `--auto-restart-until-mergeable`                                 |      | boolean | true          | 自动重启直到 PR 可合并。检测计费限额并在私有仓库中停止并发表评论。                                                                                                                                                                                                                        |
| `--auto-input-until-mergeable`                                   |      | boolean | false         | [实验性] 通过向正在运行的会话流式传输新输入（未提交的更改、CI 失败、PR/issue 评论、issue 标题/正文更新）来尽量延长单个 AI 工具会话，而不是重启。目前与 `--tool claude` 的 `--bidirectional-interactive-mode` 配合使用；对于其他工具回退到 `--auto-restart-until-mergeable`。参见 `docs/case-studies/issue-1708/`。                                                                                                                                                 |
| `--wait-for-all-actions-in-repository-before-mergeable`          |      | boolean | true          | 在宣布 PR 可合并之前，等待仓库中所有活跃的 GitHub Actions 运行完成。无论分支如何，阻止任何活跃运行以确保 CI/CD 管道交互时的安全性。                                                                                                                                                       |
| `--auto-restart-on-non-updated-pull-request-description`         |      | boolean | false         | 如果 PR 描述包含占位符文本则自动重启                                                                                                                                                                                                                                                      |
| `--auto-merge-default-branch-to-pull-request-branch`             |      | boolean | false         | 将默认分支合并到 PR 分支                                                                                                                                                                                                                                                                  |
| `--allow-fork-divergence-resolution-using-force-push-with-lease` |      | boolean | false         | 允许在 Fork 分歧时使用 force-push                                                                                                                                                                                                                                                         |
| `--allow-force-non-fork-repository-deletion`                     |      | boolean | false         | 允许删除包含额外提交的非 Fork 仓库（危险：可能丢失数据）                                                                                                                                                                                                                                  |
| `--allow-to-push-to-contributors-pull-requests-as-maintainer`    |      | boolean | false         | 作为维护者推送到贡献者的 Fork                                                                                                                                                                                                                                                             |
| `--prefix-fork-name-with-owner-name`                             |      | boolean | true          | 用所有者名称作为 Fork 前缀                                                                                                                                                                                                                                                                |
| `--continue-only-on-feedback`                                    |      | boolean | false         | 仅在检测到反馈时继续                                                                                                                                                                                                                                                                      |
| `--watch`                                                        | `-w` | boolean | false         | 监控反馈并自动重启                                                                                                                                                                                                                                                                        |
| `--watch-interval`                                               |      | number  | 60            | 反馈检查间隔（秒）                                                                                                                                                                                                                                                                        |
| `--min-disk-space`                                               |      | number  | 2048          | 最小磁盘空间（MB）                                                                                                                                                                                                                                                                        |
| `--log-dir`                                                      | `-l` | string  | （当前目录）  | 日志文件目录                                                                                                                                                                                                                                                                              |
| `--sentry`                                                       |      | boolean | false         | 启用 Sentry 错误跟踪（默认禁用以保护隐私；使用 --sentry 选择启用）                                                                                                                                                                                                                        |
| `--auto-accept-invite`                                           |      | boolean | true          | 在检查写权限之前自动接受目标仓库待处理的 GitHub 仓库/组织邀请（使用 `--no-auto-accept-invite` 禁用）                                                                                                                                                                                      |
| `--auto-report-issue`                                            |      | boolean | false         | 失败时自动创建 GitHub issue，无需提示（包含错误详情和日志）                                                                                                                                                                                                                               |
| `--disable-report-issue`                                         |      | boolean | false         | 完全禁用错误 issue 创建（覆盖 --auto-report-issue）                                                                                                                                                                                                                                       |
| `--auto-cleanup`                                                 |      | boolean | （不一）      | 完成后删除临时目录                                                                                                                                                                                                                                                                        |
| `--claude-file`                                                  |      | boolean | false         | 为任务详情创建 CLAUDE.md（与 --gitkeep-file 互斥）                                                                                                                                                                                                                                        |
| `--gitkeep-file`                                                 |      | boolean | true          | 创建 .gitkeep 而非 CLAUDE.md（所有 --tool 值的默认设置，与 --claude-file 互斥）                                                                                                                                                                                                           |
| `--auto-gitkeep-file`                                            |      | boolean | true          | 如果 CLAUDE.md 在 .gitignore 中则自动使用 .gitkeep                                                                                                                                                                                                                                        |
| `--execute-tool-with-bun`                                        |      | boolean | false         | 使用 bunx 执行 AI 工具（实验性）                                                                                                                                                                                                                                                          |
| `--enable-workspaces`                                            |      | boolean | false         | 使用独立工作区目录结构（实验性）                                                                                                                                                                                                                                                          |
| `--interactive-mode`                                             |      | boolean | false         | [实验性] 将输出作为 PR 评论发布                                                                                                                                                                                                                                                           |
| `--prompt-plan-sub-agent`                                        |      | boolean | false         | 使用计划子代理进行规划                                                                                                                                                                                                                                                                    |
| `--prompt-explore-sub-agent`                                     |      | boolean | false         | 使用探索子代理                                                                                                                                                                                                                                                                            |
| `--prompt-general-purpose-sub-agent`                             |      | boolean | false         | 使用通用子代理                                                                                                                                                                                                                                                                            |
| `--tokens-budget-stats`                                          |      | boolean | true          | 显示 token 预算统计（使用 `--no-tokens-budget-stats` 禁用）                                                                                                                                                                                                                               |
| `--prompt-issue-reporting`                                       |      | boolean | false         | 自动为发现的 bug 创建 issue                                                                                                                                                                                                                                                               |
| `--prompt-case-studies`                                          |      | boolean | false         | 创建案例研究文档                                                                                                                                                                                                                                                                          |
| `--prompt-architecture-care`                                     |      | boolean | false         | [实验性] 管理 REQUIREMENTS.md 和 ARCHITECTURE.md                                                                                                                                                                                                                                          |
| `--prompt-playwright-mcp`                                        |      | boolean | true          | Playwright MCP 提示（仅当 MCP 已安装时，使用 `--no-prompt-playwright-mcp` 禁用）                                                                                                                                                                                                          |
| `--prompt-check-sibling-pull-requests`                           |      | boolean | true          | 研究相关工作时检查同级 PR（使用 `--no-prompt-check-sibling-pull-requests` 禁用）                                                                                                                                                                                                          |
| `--prompt-experiments-folder`                                    |      | string  | ./experiments | 实验文件夹路径（留空则禁用）                                                                                                                                                                                                                                                              |
| `--prompt-examples-folder`                                       |      | string  | ./examples    | 示例文件夹路径（留空则禁用）                                                                                                                                                                                                                                                              |
| `--playwright-mcp-auto-cleanup`                                  |      | boolean | true          | 在未提交检查之前自动删除 .playwright-mcp/ 文件夹                                                                                                                                                                                                                                          |
| `--auto-gh-configuration-repair`                                 |      | boolean | false         | 使用 gh-setup-git-identity 自动修复 git 配置                                                                                                                                                                                                                                              |
| `--auto-init-repository`                                         |      | boolean | false         | 通过创建 README.md 自动初始化空仓库，允许在无提交的仓库上创建分支                                                                                                                                                                                                                         |
| `--prompt-ensure-all-requirements-are-met`                       |      | boolean | false         | [实验性] 添加提示确保所有更改满足所有讨论的需求                                                                                                                                                                                                                                           |
| `--prompt-subagents-via-agent-commander`                         |      | boolean | false         | 使用 agent-commander 进行子代理委托（需要安装）                                                                                                                                                                                                                                           |
| `--finalize`                                                     |      | number  | 0             | [实验性] solve 完成后，以需求检查提示重新启动 AI N 次                                                                                                                                                                                                                                     |
| `--finalize-model`                                               |      | string  |               | [实验性] --finalize 迭代的模型覆盖（默认为 --model）                                                                                                                                                                                                                                      |
| `--working-session-live-progress`                                |      | string  | false         | [实验性] 实时进度监控："comment"（每会话 PR 评论）或 "pr"（更新 PR 描述）                                                                                                                                                                                                                 |

### hive 选项

```bash
hive <github-url> [options]
```

| 选项                                   | 别名  | 类型    | 默认值        | 描述                                                                                 |
| -------------------------------------- | ----- | ------- | ------------- | ------------------------------------------------------------------------------------ |
| `--monitor-tag`                        | `-t`  | string  | "help wanted" | 要监控的标签                                                                         |
| `--all-issues`                         | `-a`  | boolean | false         | 监控所有 issue（忽略标签）                                                           |
| `--skip-issues-with-prs`               | `-s`  | boolean | false         | 跳过已有 PR 的 issue                                                                 |
| `--concurrency`                        | `-c`  | number  | 2             | 并行工作进程数                                                                       |
| `--pull-requests-per-issue`            | `-p`  | number  | 1             | 每个 issue 的 PR 数量                                                                |
| `--model`                              | `-m`  | string  | sonnet        | 使用的模型                                                                           |
| `--tool`                               |       | string  | claude        | AI 工具（claude、opencode、agent）                                                   |
| `--interval`                           | `-i`  | number  | 300           | 轮询间隔（秒）                                                                       |
| `--max-issues`                         |       | number  | 0             | 限制处理的 issue 数量（0 = 无限制）                                                  |
| `--once`                               |       | boolean | false         | 单次运行（不监控）                                                                   |
| `--dry-run`                            |       | boolean | false         | 列出 issue 而不处理                                                                  |
| `--skip-tool-connection-check`         |       | boolean | false         | 跳过工具连接检查                                                                     |
| `--verbose`                            | `-v`  | boolean | false         | 启用详细日志                                                                         |
| `--min-disk-space`                     |       | number  | 2048          | 最小磁盘空间（MB）                                                                   |
| `--auto-cleanup`                       |       | boolean | false         | 成功时清理临时目录                                                                   |
| `--fork`                               | `-f`  | boolean | false         | 无写权限时 Fork 仓库                                                                 |
| `--auto-fork`                          |       | boolean | true          | 自动 Fork 公开仓库                                                                   |
| `--auto-init-repository`               |       | boolean | false         | 通过创建 README.md 自动初始化空仓库（传递给 solve）                                  |
| `--auto-accept-invite`                 |       | boolean | true          | 自动接受目标仓库待处理的 GitHub 仓库/组织邀请（使用 `--no-auto-accept-invite` 禁用） |
| `--attach-logs`                        |       | boolean | false         | 将日志附加到 PR（敏感信息）                                                          |
| `--attach-solution-summary`            |       | boolean | false         | 将 AI 解决方案摘要作为评论附加                                                       |
| `--auto-attach-solution-summary`       |       | boolean | true          | 无 AI 评论时自动附加摘要（使用 `--no-auto-attach-solution-summary` 禁用）            |
| `--project-number`                     | `-pn` | number  |               | 要监控的 GitHub 项目编号                                                             |
| `--project-owner`                      | `-po` | string  |               | GitHub 项目所有者                                                                    |
| `--project-status`                     | `-ps` | string  | "Ready"       | 要监控的项目状态列                                                                   |
| `--project-mode`                       | `-pm` | boolean | false         | 启用基于项目的监控                                                                   |
| `--youtrack-mode`                      |       | boolean | false         | 启用 YouTrack 模式                                                                   |
| `--youtrack-stage`                     |       | string  |               | 覆盖 YouTrack 阶段                                                                   |
| `--youtrack-project`                   |       | string  |               | 覆盖 YouTrack 项目代码                                                               |
| `--target-branch`                      | `-tb` | string  | （默认）      | PR 的目标分支                                                                        |
| `--log-dir`                            | `-l`  | string  | （当前目录）  | 日志文件目录                                                                         |
| `--auto-continue`                      |       | boolean | true          | 将 --auto-continue 传递给 solve                                                      |
| `--auto-resume-on-limit-reset`         |       | boolean | true          | 限额重置时自动恢复（传递给 solve）                                                   |
| `--think`                              |       | string  |               | 思考级别（low、medium、high、max）                                                   |
| `--prompt-plan-sub-agent`              |       | boolean | false         | 使用计划子代理                                                                       |
| `--sentry`                             |       | boolean | false         | 启用 Sentry 错误跟踪（默认禁用以保护隐私；使用 --sentry 选择启用）                   |
| `--watch`                              | `-w`  | boolean | false         | 监控反馈并自动重启                                                                   |
| `--issue-order`                        | `-o`  | string  | "asc"         | 按日期排序 issue（asc、desc）                                                        |
| `--prefix-fork-name-with-owner-name`   |       | boolean | true          | 用所有者名称作为 Fork 前缀                                                           |
| `--interactive-mode`                   |       | boolean | false         | [实验性] 将输出作为 PR 评论发布                                                      |
| `--prompt-explore-sub-agent`           |       | boolean | false         | 使用探索子代理                                                                       |
| `--prompt-general-purpose-sub-agent`   |       | boolean | false         | 使用通用子代理                                                                       |
| `--tokens-budget-stats`                |       | boolean | true          | 显示 token 预算统计（使用 `--no-tokens-budget-stats` 禁用）                          |
| `--prompt-issue-reporting`             |       | boolean | false         | 自动为发现的 bug 创建 issue                                                          |
| `--prompt-case-studies`                |       | boolean | false         | 创建案例研究文档                                                                     |
| `--prompt-playwright-mcp`              |       | boolean | true          | Playwright MCP 提示（仅当已安装时）                                                  |
| `--prompt-check-sibling-pull-requests` |       | boolean | true          | 研究相关工作时检查同级 PR                                                            |

### hive-telegram-bot 选项

```bash
hive-telegram-bot [options]
```

| 选项                                | 别名 | 类型    | 默认值   | 描述                                                                                                                                                                                      |
| ----------------------------------- | ---- | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--token`                           | `-t` | string  | （必填） | 来自 @BotFather 的 Telegram bot token                                                                                                                                                     |
| `--allowed-chats`                   |      | string  | （全部） | 允许的聊天 ID（Links Notation）                                                                                                                                                           |
| `--solve-overrides`                 |      | string  | （无）   | /solve 的覆盖选项                                                                                                                                                                         |
| `--hive-overrides`                  |      | string  | （无）   | /hive 的覆盖选项                                                                                                                                                                          |
| `--solve`                           |      | boolean | true     | 启用 /solve 命令（使用 --no-solve 禁用）                                                                                                                                                  |
| `--hive`                            |      | boolean | true     | 启用 /hive 命令（使用 --no-hive 禁用）                                                                                                                                                    |
| `--configuration`                   | `-c` | string  |          | LINO 配置字符串                                                                                                                                                                           |
| `--verbose`                         | `-v` | boolean | false    | 启用详细日志                                                                                                                                                                              |
| `--dry-run`                         |      | boolean | false    | 验证而不启动 bot                                                                                                                                                                          |
| `--auto-start-screen-watch-message` |      | boolean | false    | 实验性：为公开仓库的 `/solve` 会话自动启动单独的 `/terminal_watch` 消息。私有仓库或可见性未知的仓库不会自动启动 watch 消息。                                                              |
| `--isolation`                       |      | string  | `screen` | 隔离后端（`screen`、`tmux`、`docker`）。默认 `screen`，使 Telegram-bot 工作会话保持分离，从而能够在 bot 重启后继续运行。要禁用，请传递 `--isolation ''`（或设置 `TELEGRAM_ISOLATION=`）。 |

启用 `/solve` 时，Telegram bot 也接受 `/do` 和 `/continue` 作为普通
`/solve` 别名。`/claude`、`/codex`、`/opencode` 和 `/agent` 是按工具划分的别名，
分别等同于 `/solve --tool claude`、`/solve --tool codex`、
`/solve --tool opencode` 和 `/solve --tool agent`。

---

## 使用示例

### 设置环境变量

```bash
# 将 Claude 超时增加到 2 分钟
export HIVE_MIND_CLAUDE_TIMEOUT_SECONDS=120

# 减少 GitHub API 延迟以加快操作速度
export HIVE_MIND_GITHUB_API_DELAY_MS=2000

# 将自动继续阈值增加到 48 小时
export HIVE_MIND_AUTO_CONTINUE_AGE_HOURS=48

# 使用自定义临时目录
export HIVE_MIND_TEMP_DIR=/var/tmp/hive-mind

# 启用 Sentry 错误跟踪（默认禁用）
export HIVE_MIND_SENTRY=true

# 为 GitHub Enterprise 配置
export HIVE_MIND_GITHUB_BASE_URL=https://github.enterprise.com
```

### 使用自定义配置运行

```bash
# 使用自定义超时运行
HIVE_MIND_CLAUDE_TIMEOUT_SECONDS=120 HIVE_MIND_RETRY_BASE_DELAY_MS=10000 hive https://github.com/owner/repo

# 使用增加的限制运行
HIVE_MIND_GITHUB_FILE_MAX_SIZE=52428800 HIVE_MIND_MIN_DISK_SPACE_MB=1000 solve https://github.com/owner/repo/issues/123

# 使用自定义自动继续设置运行（--auto-continue 默认已启用）
HIVE_MIND_AUTO_CONTINUE_AGE_HOURS=12 solve https://github.com/owner/repo/issues/456
```

### 配置文件（可选）

您可以在项目根目录创建 `.env` 文件：

```bash
# .env 文件
HIVE_MIND_CLAUDE_TIMEOUT_SECONDS=90
HIVE_MIND_GITHUB_API_DELAY_MS=3000
HIVE_MIND_AUTO_CONTINUE_AGE_HOURS=36
HIVE_MIND_TEMP_DIR=/opt/hive-mind/tmp
HIVE_MIND_SENTRY_DSN=your-custom-sentry-dsn
```

然后在运行前加载它：

```bash
source .env
hive https://github.com/owner/repo
```

### 开发者用法

```javascript
import { timeouts, githubLimits, sentry } from './config.lib.mjs';

// 使用配置值
const timeout = timeouts.claudeCli;
const maxSize = githubLimits.fileMaxSize;
const dsn = sentry.dsn;
```

---

## 注意事项

- 除非另有说明，所有超时值均以毫秒为单位
- 除非另有说明，所有大小限制均以字节为单位
- 采样率必须在 0.0 到 1.0 之间
- 应用程序在启动时验证所有配置值
- 无效值将导致应用程序失败并显示错误消息
- 使用 `--verbose` 标志查看正在使用的配置值

### 工具特定默认值

某些选项根据所选 `--tool` 具有不同的默认值：

| 选项             | `--tool claude` | `--tool agent/opencode/codex`              |
| ---------------- | --------------- | ------------------------------------------ |
| `--model`        | `sonnet`        | `grok-code` / `grok-code-fast-1` / `gpt-5` |
| `--claude-file`  | `false`         | `false`                                    |
| `--gitkeep-file` | `true`          | `true`                                     |

**`--gitkeep-file` 默认值的原因：**

- `.gitkeep` 是所有工具的默认设置：CLAUDE.md 和 AGENT.md 文件通常对 AI 工具没有帮助，应避免使用（参见[说明](https://youtu.be/GcNu6wrLTJc)）
- 如需显式使用基于 CLAUDE.md 的任务传递，请使用 `--claude-file`
