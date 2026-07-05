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
  - [Docker 隔离设置](#41-docker-isolation-settings)
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
| `HIVE_MIND_MIN_DISK_SPACE_MB`    | 10240  | 最小所需磁盘空间（MB） |
| `HIVE_MIND_DEFAULT_PAGE_SIZE_KB` | 16     | 默认内存页大小（KB）   |

### 4.1. Docker 隔离设置

| 环境变量                        | 默认值       | 描述                                                                                                                          |
| ------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `HIVE_MIND_KEEP_TASK_CONTAINER` | `on-failure` | Docker 任务容器在终止完成后的保留策略：`always`、`on-failure` 或 `never`。`on-failure` 会删除成功容器并保留失败容器以便调试。 |

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

| 环境变量                           | 默认值 | 描述                                                                                                                                                                                                                                                                |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HIVE_MIND_API_CACHE_TTL_MS`       | 180000 | 通用 API 缓存 TTL（毫秒，3 分钟）。用于 GitHub API。                                                                                                                                                                                                                |
| `HIVE_MIND_USAGE_API_CACHE_TTL_MS` | 780000 | Claude 用量 API 缓存 TTL（毫秒，13 分钟）。**重要：** Claude 用量 API 有更严格的速率限制。调用频率过高可能返回 null 值或 429 "Resets in Xm Xs" 错误。默认值已在 [issue #1798](https://github.com/link-assistant/hive-mind/issues/1798) 中从 10 分钟提高到 13 分钟。 |
| `HIVE_MIND_SYSTEM_CACHE_TTL_MS`    | 60000  | 系统指标缓存 TTL（毫秒，最多 1 分钟）。用于 RAM、CPU 和磁盘空间。更大的值会被限制为 1 分钟。                                                                                                                                                                        |

**注意：** Claude 用量 API（`/api/oauth/usage`）的速率限制比其他 API 更严格。如果您在 `/limits` 命令输出中遇到 `null` 值或 `Resets in 3m Xs` 错误，则 API 调用频率过高。默认 TTL 已在 [issue #1798](https://github.com/link-assistant/hive-mind/issues/1798) 中从 10 分钟提高到 13 分钟，在观察到的速率限制窗口之上保留 ≥ 3 分钟的安全边际。背景请参阅 [Issue #1074](https://github.com/link-assistant/hive-mind/issues/1074)。

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

`/merge` 支持仓库、Issue 和 Pull Request 目标。当 Issue 或 Pull Request
目标尚不可合并时，合并队列最多等待 `HIVE_MIND_MERGE_QUEUE_CI_TIMEOUT_MS`，并每隔
`HIVE_MIND_MERGE_QUEUE_CI_POLL_INTERVAL_MS` 轮询一次，然后才判定目标失败。

### 13. Telegram Bot

| 环境变量                                   | 默认值   | 描述                                                            |
| ------------------------------------------ | -------- | --------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`                       | （必填） | 来自 @BotFather 的 Telegram bot token                           |
| `TELEGRAM_ALLOWED_CHATS`                   | （全部） | 允许的聊天 ID（Links Notation）                                 |
| `TELEGRAM_SOLVE_OVERRIDES`                 | （无）   | /solve 的覆盖选项（Links Notation）                             |
| `TELEGRAM_HIVE_OVERRIDES`                  | （无）   | /hive 的覆盖选项（Links Notation）                              |
| `TELEGRAM_SOLVE`                           | true     | 启用 /solve 命令                                                |
| `TELEGRAM_HIVE`                            | true     | 启用 /hive 命令                                                 |
| `TELEGRAM_TASK`                            | true     | 启用 /task 和 /split 命令                                       |
| `TELEGRAM_AUTH`                            | true     | 为白名单聊天所有者启用实验性的私聊 /auth 命令                   |
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

Playwright MCP（模型上下文协议）为 Claude Code、Codex、OpenCode、Agent、Qwen Code 和 Gemini CLI 等受支持的 AI 工具提供浏览器自动化功能，支持网页抓取、UI 测试以及与动态网页的交互。

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

#### 预检超时

在启动工作会话之前，`solve` 会运行本地 Playwright MCP 预检，调用
`claude mcp list` / `codex mcp list`。这些命令会对每个已注册的 MCP 服务器执行
实时健康检查（Playwright MCP 会启动浏览器以报告其状态），因此在 npx 缓存冷启动
或繁忙的 CI 主机上，探测可能需要超过几秒钟。

探测超时默认为 **30 秒**，并且可以覆盖：

```bash
# 给 mcp list 探测最多 90 秒（缓慢/冷启动环境）
PLAYWRIGHT_MCP_PREFLIGHT_TIMEOUT_SECONDS=90 solve <issue-url>
```

如果探测仍然没有定论（超时或 CLI 缺失），预检不再中止运行：它会回退到检查本地
是否安装了 `@playwright/mcp` 包。当该包存在时，服务器会通过 Tool Search 按需连接
（参见[案例研究 issue-1943](./case-studies/issue-1943/README.md) 和
[issue-1901](./case-studies/issue-1901/README.md)），因此工作会话会继续。只有当
`@playwright/mcp` 包本身确实不可用时，预检才会失败。当有意禁用浏览器自动化时，
使用 `--no-playwright-mcp` 可完全跳过预检。

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

| 选项                                                             | 别名 | 类型    | 默认值        | 描述                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ---- | ------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--model`                                                        | `-m` | string  | sonnet        | 模型（claude 使用 opus、sonnet、haiku；opencode 使用 grok-code-fast-1；codex 使用 gpt-5；qwen 使用 qwen3-coder-plus；gemini 使用 gemini-2.5-flash）                                                                                                                                                                                                                                                                                                                            |
| `--sub-agent-model`                                              |      | string  |               | Claude Code subagent/agent team 模型覆盖。仅在提供时设置 `CLAUDE_CODE_SUBAGENT_MODEL`。接受 Claude 模型别名、完整模型 ID，或 `inherit` 以使用正常的 Claude Code subagent 模型解析。仅适用于 `--tool claude`。                                                                                                                                                                                                                                                                  |
| `--worker-model`                                                 |      | string  |               | --model 的别名：当指定 --plan-model 时的执行/工作模型                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--tool`                                                         |      | string  | claude        | AI 工具（claude、opencode、codex、agent、qwen、gemini）                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--plan`                                                         |      | boolean | false         | 启用计划模式：opus 用于规划，sonnet 用于执行（仅限 --tool claude）                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--plan-model`                                                   |      | string  |               | 计划模式的模型（例如 opus）。自动切换到 opusplan 模式（仅限 --tool claude）                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--think`                                                        |      | string  |               | 思考级别（off、low、medium、high、max）                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--thinking-budget`                                              |      | number  |               | 思考 token 预算（0-31999）。控制 MAX_THINKING_TOKENS                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--thinking-budget-claude-minimum-version`                       |      | string  | 2.1.12        | 支持 --thinking-budget 的最低 Claude Code 版本                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--max-thinking-budget`                                          |      | number  | 31999         | 级别映射的最大思考预算                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--sub-session-size`                                             |      | string  | 150k          | 自动压缩之间的子会话大小上限。接受 token 数（如 `150k`、`1m`、`200000`）、模型上下文窗口的百分比（如 `50%`），或 `default` 保留工具内置阈值。Claude 设置 `CLAUDE_CODE_AUTO_COMPACT_WINDOW` + `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` 环境变量；Codex 使用 `-c model_auto_compact_token_limit`。                                                                                                                                                                                      |
| `--disable-1m-context`                                           |      | boolean | true          | 禁用 1M 扩展上下文窗口，使模型使用其标准 200K-400K 窗口。有助于保持推理质量并降低成本。Claude 设置 `CLAUDE_CODE_DISABLE_1M_CONTEXT=1`；Codex 使用 `-c model_context_window=200000`。使用 `--no-disable-1m-context` 允许 1M 窗口。                                                                                                                                                                                                                                              |
| `--fork`                                                         | `-f` | boolean | false         | 无写权限时 Fork 仓库                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--auto-fork`                                                    |      | boolean | true          | 自动 Fork 无写权限的公开仓库                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `--base-branch`                                                  | `-b` | string  | （默认）      | PR 的目标分支                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--resume`                                                       | `-r` | string  |               | 从会话 ID 恢复                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--working-directory`                                            | `-d` | string  |               | 使用指定的工作目录（--resume 必需）                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `--verbose`                                                      | `-v` | boolean | false         | 启用详细日志                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `--dry-run`                                                      | `-n` | boolean | false         | 仅准备，不执行                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--only-prepare-command`                                         |      | boolean | false         | 仅准备并打印命令                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--skip-tool-connection-check`                                   |      | boolean | false         | 跳过工具连接检查                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--auto-pull-request-creation`                                   |      | boolean | true          | 执行前创建草稿 PR                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `--attach-logs`                                                  |      | boolean | false         | 将日志附加到 PR（敏感信息）                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--attach-solution-summary`                                      |      | boolean | false         | 将 AI 解决方案摘要作为 PR/issue 评论附加                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `--auto-attach-solution-summary`                                 |      | boolean | true          | 仅当 AI 未发布评论时自动附加摘要（使用 `--no-auto-attach-solution-summary` 禁用）                                                                                                                                                                                                                                                                                                                                                                                              |
| `--dangerously-skip-output-sanitization`                         |      | boolean | false         | 危险：跳过生成输出的基于模式的清理。除非同时设置 `--dangerously-skip-active-tokens-output-sanitization`，否则仍会屏蔽活动的本地 token。                                                                                                                                                                                                                                                                                                                                        |
| `--dangerously-skip-code-output-sanitization`                    |      | boolean | false         | 危险：允许生成的代码输出绕过代码专用输出清理。除非同时设置 `--dangerously-skip-active-tokens-output-sanitization`，否则仍会屏蔽活动的本地 token。                                                                                                                                                                                                                                                                                                                              |
| `--dangerously-skip-active-tokens-output-sanitization`           |      | boolean | false         | 危险：跳过对已知活动本地 token 的输出屏蔽。仅用于受控调试，因为这可能暴露当前可用的凭据。                                                                                                                                                                                                                                                                                                                                                                                      |
| `--auto-close-pull-request-on-fail`                              |      | boolean | false         | 失败时关闭 PR                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--auto-continue`                                                |      | boolean | true          | 继续使用现有 PR                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--auto-resume-on-limit-reset`                                   |      | boolean | true          | 限额重置时自动恢复（保持会话上下文）                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--auto-restart-on-limit-reset`                                  |      | boolean | false         | 限额重置时自动重启（无 --resume 的新开始）                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--auto-resume-on-errors`                                        |      | boolean | false         | 网络错误时自动恢复                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--auto-continue-only-on-new-comments`                           |      | boolean | false         | 无新评论时失败                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--auto-commit-uncommitted-changes`                              |      | boolean | false         | 自动提交更改                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `--auto-restart-on-uncommitted-changes`                          |      | boolean | true          | 有未提交更改时自动重启                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--auto-restart-max-iterations`                                  |      | number  | 5             | 停止前的最大自动重启迭代次数（0 = 不限制）                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--resume-on-auto-restart`                                       |      | boolean | false         | [实验性] 在未提交更改自动重启时恢复上一个 Claude 会话，并仅发送最小重启提示                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--auto-resume-max-iterations`                                   |      | number  | 5             | 限额重置后的最大自动恢复/重启次数（0 = 不限制）                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--auto-merge`                                                   |      | boolean | false         | 会话结束且 CI 通过时自动合并 PR                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--auto-restart-until-mergeable`                                 |      | boolean | true          | 自动重启直到 PR 可合并。检测计费限额并在私有仓库中停止并发表评论。                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--auto-input-until-mergeable`                                   |      | boolean | false         | [实验性] 通过向正在运行的会话流式传输新输入（未提交的更改、CI 失败、PR/issue 评论、issue 标题/正文更新）来尽量延长单个 AI 工具会话，而不是重启。隐含 `--accept-incomming-comments-as-input` 与 `--queue-comments-to-input`（让 AI 完成当前步骤后再被新输入打断）。不会启用 `--interactive-mode` 或 `--bidirectional-interactive-mode`。Claude 和 Agent 使用实时 stream-json；Codex、OpenCode、Gemini、Qwen 和未知工具使用重启/恢复回退。参见 `docs/case-studies/issue-2007/`。 |
| `--wait-for-all-actions-in-repository-before-mergeable`          |      | boolean | true          | 在宣布 PR 可合并之前，等待仓库中所有活跃的 GitHub Actions 运行完成。无论分支如何，阻止任何活跃运行以确保 CI/CD 管道交互时的安全性。                                                                                                                                                                                                                                                                                                                                            |
| `--auto-restart-on-non-updated-pull-request-description`         |      | boolean | false         | 如果 PR 描述包含占位符文本则自动重启                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--auto-merge-default-branch-to-pull-request-branch`             |      | boolean | false         | 将默认分支合并到 PR 分支                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `--allow-fork-divergence-resolution-using-force-push-with-lease` |      | boolean | false         | 允许在 Fork 分歧时使用 force-push                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `--allow-force-non-fork-repository-deletion`                     |      | boolean | false         | 允许删除包含额外提交的非 Fork 仓库（危险：可能丢失数据）                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `--allow-to-push-to-contributors-pull-requests-as-maintainer`    |      | boolean | false         | 作为维护者推送到贡献者的 Fork                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--prefix-fork-name-with-owner-name`                             |      | boolean | true          | 用所有者名称作为 Fork 前缀                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--continue-only-on-feedback`                                    |      | boolean | false         | 仅在检测到反馈时继续                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--watch`                                                        | `-w` | boolean | false         | 监控反馈并自动重启                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--watch-interval`                                               |      | number  | 60            | 反馈检查间隔（秒）                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--auto-delete-branch-on-merge`                                  |      | boolean | false         | 在 --watch 模式下检测到拉取请求已合并，或通过 --auto-merge 合并后，自动删除分支。实现完整的 GitHub Flow 支持（issue #401）。                                                                                                                                                                                                                                                                                                                                                   |
| `--min-disk-space`                                               |      | number  | 10240         | 最小磁盘空间（MB）                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--log-dir`                                                      | `-l` | string  | （当前目录）  | 日志文件目录                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `--sentry`                                                       |      | boolean | false         | 启用 Sentry 错误跟踪（默认禁用以保护隐私；使用 --sentry 选择启用）                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--auto-accept-invite`                                           |      | boolean | true          | 在检查写权限之前自动接受目标仓库待处理的 GitHub 仓库/组织邀请（使用 `--no-auto-accept-invite` 禁用）                                                                                                                                                                                                                                                                                                                                                                           |
| `--auto-report-issue`                                            |      | boolean | false         | 失败时自动创建 GitHub issue，无需提示（包含错误详情和日志）                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--disable-report-issue`                                         |      | boolean | false         | 完全禁用错误 issue 创建（覆盖 --auto-report-issue）                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `--disable-issue-auto-creation-on-error`                         |      | boolean | false         | solve 失败时禁用创建新的 GitHub 错误报告 issue，包括交互式提示。不会禁用向原始 issue 或拉取请求发布失败日志或评论。                                                                                                                                                                                                                                                                                                                                                            |
| `--auto-cleanup`                                                 |      | boolean | （不一）      | 完成后删除临时目录                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--claude-file`                                                  |      | boolean | false         | 为任务详情创建 CLAUDE.md（与 --gitkeep-file 互斥）                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--gitkeep-file`                                                 |      | boolean | true          | 创建 .gitkeep 而非 CLAUDE.md（所有 --tool 值的默认设置，与 --claude-file 互斥）                                                                                                                                                                                                                                                                                                                                                                                                |
| `--auto-gitkeep-file`                                            |      | boolean | true          | 如果 CLAUDE.md 在 .gitignore 中则自动使用 .gitkeep                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--force-git-keep-commit`                                        |      | boolean | false         | 如果自动 PR 占位文件（.gitkeep）被列在 .gitignore 中，使用 `git add -f` 强制提交而不是停止（issue #1825）。默认关闭。                                                                                                                                                                                                                                                                                                                                                          |
| `--remove-git-keep-from-git-ignore`                              |      | boolean | false         | 如果自动 PR 占位文件（.gitkeep）被列在 .gitignore 中，先从 .gitignore 中移除该条目，然后正常提交（issue #1825）。默认关闭。                                                                                                                                                                                                                                                                                                                                                    |
| `--auto-support-agents-md-as-claude-md`                          |      | boolean | false         | [实验性] 在 Claude 运行期间临时将 AGENTS.md/agents.md 复制为 CLAUDE.md，然后删除临时副本                                                                                                                                                                                                                                                                                                                                                                                       |
| `--execute-tool-with-bun`                                        |      | boolean | false         | 使用 bunx 执行 AI 工具（实验性）                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--enable-workspaces`                                            |      | boolean | false         | 使用独立工作区目录结构（实验性）                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--interactive-mode`                                             |      | boolean | false         | [实验性] 将输出作为 PR 评论发布                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--interactive-image-upload`                                     |      | boolean | true          | [实验性] 当启用 `--interactive-mode` 时，将 AI 读取/写入的图像上传到隐藏的自定义 Git refs（`refs/hive-mind-media/...`）并在 PR 评论中内联嵌入。默认启用；使用 `--no-interactive-image-upload` 禁用。                                                                                                                                                                                                                                                                           |
| `--prompt-plan-sub-agent`                                        |      | boolean | false         | 使用计划子代理进行规划                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--prompt-explore-sub-agent`                                     |      | boolean | false         | 使用探索子代理                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--prompt-general-purpose-sub-agent`                             |      | boolean | false         | 使用通用子代理                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--tokens-budget-stats`                                          |      | boolean | true          | 显示 token 预算统计（使用 `--no-tokens-budget-stats` 禁用）                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--prompt-issue-reporting`                                       |      | boolean | false         | 自动为发现的 bug 创建 issue                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--prompt-case-studies`                                          |      | boolean | false         | 创建案例研究文档                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--prompt-architecture-care`                                     |      | boolean | false         | [实验性] 管理 REQUIREMENTS.md 和 ARCHITECTURE.md                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--use-handoff`                                                  |      | boolean | false         | [实验性] 启用 HANDOFF.md 连续性 Agent Skill，使 Claude 和 Codex 能在同一个 PR 中接续彼此的工作。为每个工具原生部署 SKILL.md（Agent Skills 标准）（`.claude/skills/handoff/`、`.agents/skills/handoff/`）并通过 git 排除；提交到分支的 HANDOFF.md 作为跨工具的共享记忆（issue #1877）                                                                                                                                                                                           |
| `--prompt-playwright-mcp`                                        |      | boolean | true          | Playwright MCP 提示（仅当 MCP 已安装时，使用 `--no-prompt-playwright-mcp` 禁用）                                                                                                                                                                                                                                                                                                                                                                                               |
| `--prompt-check-sibling-pull-requests`                           |      | boolean | true          | 研究相关工作时检查同级 PR（使用 `--no-prompt-check-sibling-pull-requests` 禁用）                                                                                                                                                                                                                                                                                                                                                                                               |
| `--github-rate-limits-logging`                                   |      | boolean | false         | 在每次集中式 gh 命令重试包装器调用后记录 GitHub API 速率限制使用情况（默认禁用）                                                                                                                                                                                                                                                                                                                                                                                               |
| `--prompt-experiments-folder`                                    |      | string  | ./experiments | 实验文件夹路径（留空则禁用）                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `--prompt-examples-folder`                                       |      | string  | ./examples    | 示例文件夹路径（留空则禁用）                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `--playwright-mcp-auto-cleanup`                                  |      | boolean | true          | 在未提交检查之前自动删除 .playwright-mcp/ 文件夹                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--auto-gh-configuration-repair`                                 |      | boolean | false         | 使用 gh-setup-git-identity 自动修复 git 配置                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `--auto-init-repository`                                         |      | boolean | false         | 通过创建 README.md 自动初始化空仓库，允许在无提交的仓库上创建分支                                                                                                                                                                                                                                                                                                                                                                                                              |
| `--prompt-ensure-all-requirements-are-met`                       |      | boolean | false         | [实验性] 添加提示确保所有更改满足所有讨论的需求                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--prompt-subagents-via-agent-commander`                         |      | boolean | false         | 使用 agent-commander 进行子代理委托（需要安装）                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--finalize`                                                     |      | number  | 0             | [实验性] solve 完成后，以需求检查提示重新启动 AI N 次                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--finalize-model`                                               |      | string  |               | [实验性] --finalize 迭代的模型覆盖（默认为 --model）                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--keep-working-until-all-requirements-are-fully-done`           |      | string  |               | [实验性] solve 完成后，扫描 PR 描述、AI 解决方案摘要和更改的 markdown 文档以查找推迟/超出范围的工作（例如 "future work"、"out of scope"、"TODO"、"follow-up PR"），并自动重启 AI 以在此单个 PR 中完成所有工作。接受重启次数（默认：5），或 "forever"/"unlimited" 以移除限制。别名（每个加 `--` 前缀）：keep-going-until-all-requirements-are-fully-done, keep-working, keep-going                                                                                              |
| `--escalate`                                                     |      | string  |               | [实验性] 先用更便宜/更低级的模型开始解决，并在仍有未完成工作时升级到更强大（更昂贵）的模型。接受范围 `<下限>-<上限>`，使用 Claude 简短级别名称（阶梯：haiku < sonnet < opus < fable），例如 `sonnet-opus`。单个名称（例如 `opus`）表示仅该级别。裸标志表示 `sonnet-fable`。参见 `docs/case-studies/issue-1885/`。                                                                                                                                                              |
| `--escalate-from`                                                |      | string  |               | [实验性] `--escalate <模型>-fable` 的快捷方式：从给定模型（haiku/sonnet/opus/fable，接受别名）开始并升级到阶梯顶端。优先于 `--escalate`。                                                                                                                                                                                                                                                                                                                                      |
| `--escalate-steps`                                               |      | number  | 1             | [实验性] 在升级到下一级之前，每个模型级别保持多少个工作会话（默认：1）。例如 2 表示低级别保持两个会话，然后下一级保持两个，依此类推。仅与 `--escalate` / `--escalate-from` 一起使用。                                                                                                                                                                                                                                                                                          |
| `--working-session-live-progress`                                |      | string  | false         | [实验性] 实时进度监控："comment"（每会话 PR 评论）或 "pr"（更新 PR 描述）                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--do-not-shutdown-in-the-middle-of-working-session`             |      | boolean | false         | [实验性] 收到中断（CTRL+C / SIGTERM）时不在运行中途中止 AI 工具。如果 AI 工作会话正在进行，等待其完成，自动提交所有未提交的更改，然后优雅关闭。如果 solve 只是在空闲等待（例如等待 CI/CD），则立即停止。再次中断将强制停止。hive 会自动将此传递给每个 /solve worker。参见 `docs/case-studies/issue-1823/`。                                                                                                                                                                    |
| `--language`                                                     |      | string  |               | 用户可见输出的语言（`en`、`ru`、`zh`、`hi`）。默认按系统区域设置自动检测。同时设置 UI 与 work 两条语言轨道。等价于同时传入 `--ui-language` 和 `--work-language`。                                                                                                                                                                                                                                                                                                              |
| `--ui-language`                                                  |      | string  |               | 仅覆盖 UI/日志轨道的语言（`en`、`ru`、`zh`、`hi`）。影响终端状态/错误消息及与区域相关的机器人字符串。优先级高于 `--language`。代码、标识符与 CLI 字符串保留原文。                                                                                                                                                                                                                                                                                                              |
| `--work-language`                                                |      | string  |               | 仅覆盖 work 轨道的语言（`en`、`ru`、`zh`、`hi`）。通过系统提示词指令决定 AI 自由文本（PR/issue 评论、提交信息、会话回复）使用的语言。优先级高于 `--language`。                                                                                                                                                                                                                                                                                                                 |
| `--auto-language`                                                |      | boolean | false         | 实验性功能，默认关闭。根据目标 issue 或 PR 的标题和正文自动检测语言，并在某种语言超过全部词的 51% 时将 AI 工作语言设为英语或俄语。显式 `--work-language` 或隐藏的 prompt-language 别名优先。                                                                                                                                                                                                                                                                                   |
| `--gemini-sandbox`                                               |      | boolean | false         | 在 gemini-cli 的沙箱中运行（向 gemini-cli 传递 sandbox 标志）。仅在 `--tool gemini` 时生效。                                                                                                                                                                                                                                                                                                                                                                                   |
| `--gemini-extensions`                                            |      | string  |               | 要加载的 gemini-cli 扩展列表（逗号分隔，向 gemini-cli 传递 extensions 标志）。仅在 `--tool gemini` 时生效。                                                                                                                                                                                                                                                                                                                                                                    |
| `--gemini-include-directories`                                   |      | string  |               | 暴露给 gemini-cli 的额外目录（向 gemini-cli 传递 include-directories 标志，`tempDir`/`workspaceTmpDir` 始终包含在内）。仅在 `--tool gemini` 时生效。                                                                                                                                                                                                                                                                                                                           |
| `--gemini-allowed-mcp-servers`                                   |      | string  |               | gemini-cli 允许调用的 MCP 服务器名称列表（逗号分隔，向 gemini-cli 传递 allowed-mcp-server-names 标志）。仅在 `--tool gemini` 时生效。                                                                                                                                                                                                                                                                                                                                          |

### hive 选项

```bash
hive <github-url> [options]
```

| 选项                                                 | 别名  | 类型    | 默认值        | 描述                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ----- | ------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--monitor-tag`                                      | `-t`  | string  | "help wanted" | 要监控的标签                                                                                                                                                                                                                  |
| `--all-issues`                                       | `-a`  | boolean | false         | 监控所有 issue（忽略标签）                                                                                                                                                                                                    |
| `--skip-issues-with-prs`                             | `-s`  | boolean | false         | 跳过已有 PR 的 issue                                                                                                                                                                                                          |
| `--concurrency`                                      | `-c`  | number  | 2             | 并行工作进程数                                                                                                                                                                                                                |
| `--pull-requests-per-issue`                          | `-p`  | number  | 1             | 每个 issue 的 PR 数量                                                                                                                                                                                                         |
| `--model`                                            | `-m`  | string  | sonnet        | 使用的模型                                                                                                                                                                                                                    |
| `--sub-agent-model`                                  |       | string  |               | 转发给 solve workers 的 Claude Code subagent/agent team 模型覆盖。仅在提供时设置 `CLAUDE_CODE_SUBAGENT_MODEL`。接受 Claude 模型别名、完整模型 ID，或 `inherit`。仅适用于 `--tool claude`。                                    |
| `--tool`                                             |       | string  | claude        | AI 工具（claude、opencode、codex、agent、qwen、gemini）                                                                                                                                                                       |
| `--interval`                                         | `-i`  | number  | 300           | 轮询间隔（秒）                                                                                                                                                                                                                |
| `--max-issues`                                       |       | number  | 0             | 限制处理的 issue 数量（0 = 无限制）                                                                                                                                                                                           |
| `--once`                                             |       | boolean | false         | 单次运行（不监控）                                                                                                                                                                                                            |
| `--dry-run`                                          |       | boolean | false         | 列出 issue 而不处理                                                                                                                                                                                                           |
| `--skip-tool-connection-check`                       |       | boolean | false         | 跳过工具连接检查                                                                                                                                                                                                              |
| `--verbose`                                          | `-v`  | boolean | false         | 启用详细日志                                                                                                                                                                                                                  |
| `--min-disk-space`                                   |       | number  | 10240         | 最小磁盘空间（MB）                                                                                                                                                                                                            |
| `--auto-cleanup`                                     |       | boolean | false         | 成功时清理临时目录                                                                                                                                                                                                            |
| `--fork`                                             | `-f`  | boolean | false         | 无写权限时 Fork 仓库                                                                                                                                                                                                          |
| `--auto-fork`                                        |       | boolean | true          | 自动 Fork 公开仓库                                                                                                                                                                                                            |
| `--auto-init-repository`                             |       | boolean | false         | 通过创建 README.md 自动初始化空仓库（传递给 solve）                                                                                                                                                                           |
| `--auto-accept-invite`                               |       | boolean | true          | 自动接受目标仓库待处理的 GitHub 仓库/组织邀请（使用 `--no-auto-accept-invite` 禁用）                                                                                                                                          |
| `--attach-logs`                                      |       | boolean | false         | 将日志附加到 PR（敏感信息）                                                                                                                                                                                                   |
| `--attach-solution-summary`                          |       | boolean | false         | 将 AI 解决方案摘要作为评论附加                                                                                                                                                                                                |
| `--auto-attach-solution-summary`                     |       | boolean | true          | 无 AI 评论时自动附加摘要（使用 `--no-auto-attach-solution-summary` 禁用）                                                                                                                                                     |
| `--project-number`                                   | `-pn` | number  |               | 要监控的 GitHub 项目编号                                                                                                                                                                                                      |
| `--project-owner`                                    | `-po` | string  |               | GitHub 项目所有者                                                                                                                                                                                                             |
| `--project-status`                                   | `-ps` | string  | "Ready"       | 要监控的项目状态列                                                                                                                                                                                                            |
| `--project-mode`                                     | `-pm` | boolean | false         | 启用基于项目的监控                                                                                                                                                                                                            |
| `--youtrack-mode`                                    |       | boolean | false         | 启用 YouTrack 模式                                                                                                                                                                                                            |
| `--youtrack-stage`                                   |       | string  |               | 覆盖 YouTrack 阶段                                                                                                                                                                                                            |
| `--youtrack-project`                                 |       | string  |               | 覆盖 YouTrack 项目代码                                                                                                                                                                                                        |
| `--target-branch`                                    | `-tb` | string  | （默认）      | PR 的目标分支                                                                                                                                                                                                                 |
| `--log-dir`                                          | `-l`  | string  | （当前目录）  | 日志文件目录                                                                                                                                                                                                                  |
| `--auto-continue`                                    |       | boolean | true          | 将 --auto-continue 传递给 solve                                                                                                                                                                                               |
| `--auto-resume-on-limit-reset`                       |       | boolean | true          | 限额重置时自动恢复（传递给 solve）                                                                                                                                                                                            |
| `--do-not-shutdown-in-the-middle-of-working-session` |       | boolean | true          | [实验性] 收到 CTRL+C 时，让每个 solve worker 完成当前 AI 工作会话并在关闭前自动提交（空闲/等待 CI 的 worker 立即停止）。再次 CTRL+C 强制停止。hive 默认启用；`--no-do-not-shutdown-in-the-middle-of-working-session` 可禁用。 |
| `--think`                                            |       | string  |               | 思考级别（low、medium、high、max）                                                                                                                                                                                            |
| `--prompt-plan-sub-agent`                            |       | boolean | false         | 使用计划子代理                                                                                                                                                                                                                |
| `--sentry`                                           |       | boolean | false         | 启用 Sentry 错误跟踪（默认禁用以保护隐私；使用 --sentry 选择启用）                                                                                                                                                            |
| `--watch`                                            | `-w`  | boolean | false         | 监控反馈并自动重启                                                                                                                                                                                                            |
| `--issue-order`                                      | `-o`  | string  | "asc"         | 按日期排序 issue（asc、desc）                                                                                                                                                                                                 |
| `--prefix-fork-name-with-owner-name`                 |       | boolean | true          | 用所有者名称作为 Fork 前缀                                                                                                                                                                                                    |
| `--interactive-mode`                                 |       | boolean | false         | [实验性] 将输出作为 PR 评论发布                                                                                                                                                                                               |
| `--prompt-explore-sub-agent`                         |       | boolean | false         | 使用探索子代理                                                                                                                                                                                                                |
| `--prompt-general-purpose-sub-agent`                 |       | boolean | false         | 使用通用子代理                                                                                                                                                                                                                |
| `--tokens-budget-stats`                              |       | boolean | true          | 显示 token 预算统计（使用 `--no-tokens-budget-stats` 禁用）                                                                                                                                                                   |
| `--prompt-issue-reporting`                           |       | boolean | false         | 自动为发现的 bug 创建 issue                                                                                                                                                                                                   |
| `--prompt-case-studies`                              |       | boolean | false         | 创建案例研究文档                                                                                                                                                                                                              |
| `--prompt-playwright-mcp`                            |       | boolean | true          | Playwright MCP 提示（仅当已安装时）                                                                                                                                                                                           |
| `--prompt-check-sibling-pull-requests`               |       | boolean | true          | 研究相关工作时检查同级 PR                                                                                                                                                                                                     |
| `--github-rate-limits-logging`                       |       | boolean | false         | 在 gh 重试包装器调用后记录 GitHub API 速率限制使用情况                                                                                                                                                                        |

### hive-telegram-bot 选项

```bash
hive-telegram-bot [options]
```

| 选项                                | 别名 | 类型    | 默认值   | 描述                                                                                                                                                                                 |
| ----------------------------------- | ---- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--token`                           | `-t` | string  | （必填） | 来自 @BotFather 的 Telegram bot token                                                                                                                                                |
| `--allowed-chats`                   |      | string  | （全部） | 允许的聊天 ID（Links Notation）                                                                                                                                                      |
| `--solve-overrides`                 |      | string  | （无）   | /solve 的覆盖选项                                                                                                                                                                    |
| `--hive-overrides`                  |      | string  | （无）   | /hive 的覆盖选项                                                                                                                                                                     |
| `--solve`                           |      | boolean | true     | 启用 /solve 命令（使用 --no-solve 禁用）                                                                                                                                             |
| `--hive`                            |      | boolean | true     | 启用 /hive 命令（使用 --no-hive 禁用）                                                                                                                                               |
| `--task`                            |      | boolean | true     | 启用 /task 和 /split 命令（使用 --no-task 禁用）                                                                                                                                     |
| `--auth`                            |      | boolean | true     | 为白名单聊天所有者启用实验性的私聊 /auth 命令（使用 --no-auth 禁用）                                                                                                                 |
| `--configuration`                   | `-c` | string  |          | LINO 配置字符串                                                                                                                                                                      |
| `--verbose`                         | `-v` | boolean | false    | 启用详细日志                                                                                                                                                                         |
| `--dry-run`                         |      | boolean | false    | 验证而不启动 bot                                                                                                                                                                     |
| `--auto-start-screen-watch-message` |      | boolean | false    | 实验性：为公开仓库的 `/solve` 会话自动启动单独的 `/terminal_watch` 消息。私有仓库或可见性未知的仓库不会自动启动 watch 消息。                                                         |
| `--isolation`                       |      | string  | `docker` | 隔离后端（`screen`、`tmux`、`docker`）。默认 `docker`，使 Telegram-bot 工作会话在 Docker 隔离中运行并在成功后清理。要禁用，请传递 `--isolation ''`（或设置 `TELEGRAM_ISOLATION=`）。 |

启用 `/solve` 时，Telegram bot 也接受 `/do` 和 `/continue` 作为普通
`/solve` 别名。`/claude`、`/codex`、`/opencode`、`/agent`、`/qwen` 和 `/gemini` 是按工具划分的别名，
分别等同于 `/solve --tool claude`、`/solve --tool codex`、
`/solve --tool opencode`、`/solve --tool agent`、`/solve --tool qwen`
和 `/solve --tool gemini`。

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
HIVE_MIND_GITHUB_FILE_MAX_SIZE=52428800 HIVE_MIND_MIN_DISK_SPACE_MB=20480 solve https://github.com/owner/repo/issues/123

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

| 选项             | `--tool claude` | `--tool agent/opencode/codex/gemini/qwen`                                               |
| ---------------- | --------------- | --------------------------------------------------------------------------------------- |
| `--model`        | `sonnet`        | `nemotron-3-super-free` / `grok-code-fast-1` / `gpt-5.5` / `flash` / `qwen3-coder-plus` |
| `--claude-file`  | `false`         | `false`                                                                                 |
| `--gitkeep-file` | `true`          | `true`                                                                                  |

**`--gitkeep-file` 默认值的原因：**

- `.gitkeep` 是所有工具的默认设置：CLAUDE.md 和 AGENT.md 文件通常对 AI 工具没有帮助，应避免使用（参见[说明](https://youtu.be/GcNu6wrLTJc)）
- 如需显式使用基于 CLAUDE.md 的任务传递，请使用 `--claude-file`
