# OpenRouter 配置指南 (languages: [en](OPENROUTER.md) • zh • [hi](OPENROUTER.hi.md) • [ru](OPENROUTER.ru.md))

本指南介绍如何为 Claude Code CLI 和 @link-assistant/agent 配置 OpenRouter，让您通过统一的 API 使用来自 60+ 个提供商的 500+ AI 模型。

## 目录

- [概述](#overview)
- [前提条件](#prerequisites)
- [Claude Code CLI 与 OpenRouter](#claude-code-cli-with-openrouter)
- [Agent CLI 与 OpenRouter](#agent-cli-with-openrouter)
- [模型选择](#model-selection)
- [验证](#verification)
- [故障排除](#troubleshooting)

## 概述

OpenRouter 提供了一个统一的 API 网关，让您无需单独订阅即可访问各种 AI 模型。优势包括：

- **500+ 个模型**：访问来自 OpenAI、Anthropic、Google、Meta 及 60+ 个提供商的模型
- **按需付费**：无需月度订阅
- **统一 API**：单个 API 密钥适用于所有提供商
- **故障转移支持**：提供商之间的自动故障切换

## 前提条件

1. **OpenRouter 账户**：在 [openrouter.ai](https://openrouter.ai/) 注册
2. **API 密钥**：从 [OpenRouter Keys](https://openrouter.ai/keys) 获取您的 API 密钥
3. 已安装 **Claude Code CLI** 和/或 **@link-assistant/agent**

## Claude Code CLI 与 OpenRouter

Claude Code CLI 可以使用 Anthropic 的原生协议连接到 OpenRouter。

### 步骤 1：设置环境变量

将以下内容添加到您的 shell 配置文件（`~/.bashrc`、`~/.zshrc` 或 `~/.config/fish/config.fish`）：

```bash
# 必填：将 Claude Code 指向 OpenRouter
export ANTHROPIC_BASE_URL="https://openrouter.ai/api"

# 必填：您的 OpenRouter API 密钥
export ANTHROPIC_AUTH_TOKEN="sk-or-v1-your-api-key-here"

# 必填：必须明确置空以防止冲突
export ANTHROPIC_API_KEY=""
```

### 步骤 2：模型配置（可选）

用 OpenRouter 兼容的替代方案覆盖默认模型：

```bash
# 使用 OpenRouter 中的特定模型
export ANTHROPIC_DEFAULT_SONNET_MODEL="anthropic/claude-sonnet-4"
export ANTHROPIC_DEFAULT_OPUS_MODEL="anthropic/claude-opus-4"
export ANTHROPIC_SMALL_FAST_MODEL="anthropic/claude-haiku"
```

### 步骤 3：应用配置

```bash
# 重新加载 shell 配置文件
source ~/.bashrc  # 或 ~/.zshrc
```

### 替代方案：项目级配置

在项目根目录创建 `.claude/settings.local.json`：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://openrouter.ai/api",
    "ANTHROPIC_AUTH_TOKEN": "sk-or-v1-your-api-key-here",
    "ANTHROPIC_API_KEY": ""
  }
}
```

**注意**：将 `.claude/settings.local.json` 添加到 `.gitignore` 以保护您的 API 密钥。

### 步骤 4：启动 Claude Code

```bash
cd /path/to/your/project
claude
```

## Agent CLI 与 OpenRouter

@link-assistant/agent 通过 `agent auth login` 命令或环境变量支持 OpenRouter。

### 方法 1：交互式认证

```bash
# 开始交互式登录
agent auth login

# 从提供商列表中选择 "openrouter"
# 在提示时输入您的 OpenRouter API 密钥
```

### 方法 2：环境变量

```bash
export OPENROUTER_API_KEY="sk-or-v1-your-api-key-here"
```

### 方法 3：直接模型用法

```bash
# 使用带 openrouter/ 前缀的任何 OpenRouter 模型
echo "hello" | agent --model openrouter/anthropic/claude-sonnet-4

# 或使用 OpenCode Zen 模型（默认）
echo "hello" | agent --model opencode/grok-code
```

### 检查认证状态

```bash
# 列出已配置的凭据
agent auth list

# 应显示：
# ◆ openrouter api-key
```

## 模型选择

### 通过 OpenRouter 的 Claude Code CLI 模型

| 使用场景     | 环境变量                         | 示例值                      |
| ------------ | -------------------------------- | --------------------------- |
| 主模型       | `ANTHROPIC_DEFAULT_SONNET_MODEL` | `anthropic/claude-sonnet-4` |
| 强大模型     | `ANTHROPIC_DEFAULT_OPUS_MODEL`   | `anthropic/claude-opus-4`   |
| 快速/廉价模型 | `ANTHROPIC_SMALL_FAST_MODEL`    | `anthropic/claude-haiku`    |

### 通过 OpenRouter 的 Agent CLI 模型

使用 `openrouter/` 前缀后跟提供商和模型：

```bash
# Anthropic 模型
agent --model openrouter/anthropic/claude-sonnet-4

# OpenAI 模型
agent --model openrouter/openai/gpt-4o

# Google 模型
agent --model openrouter/google/gemini-2.0-flash

# Meta 模型
agent --model openrouter/meta-llama/llama-3.1-405b-instruct
```

### 重要：工具使用支持

选择替代模型时，请确保它们支持**工具使用**功能。Claude Code 和 agent 依赖工具来：

- 读写文件
- 执行终端命令
- 搜索代码库
- 执行网络搜索

不支持工具使用的模型将无法正常工作。

## 验证

### Claude Code CLI

在 Claude Code 中运行 `/status` 以验证连接：

```
Claude Code v1.x.x
Connected to: openrouter.ai
Model: anthropic/claude-sonnet-4
```

还可以查看 [OpenRouter 活动仪表板](https://openrouter.ai/activity) 以获取实时请求日志。

### Agent CLI

```bash
# 简单测试
echo "What is 2+2?" | agent --model openrouter/anthropic/claude-sonnet-4

# 检查已配置的凭据
agent auth list
```

## 故障排除

### "Authentication failed"（认证失败）错误

1. 在 [openrouter.ai/keys](https://openrouter.ai/keys) 验证您的 API 密钥是否正确
2. 确保 `ANTHROPIC_API_KEY=""` 已明确设置（空值）以用于 Claude Code
3. 检查 `ANTHROPIC_AUTH_TOKEN` 值是否有拼写错误

### "Model not found"（未找到模型）错误

1. 在 [openrouter.ai/models](https://openrouter.ai/models) 验证模型 ID
2. 使用完整的模型路径：`provider/model-name`
3. 检查该模型是否在您的地区可用

### "Insufficient credits"（积分不足）错误

1. 在 [openrouter.ai/credits](https://openrouter.ai/credits) 添加积分
2. 在 [openrouter.ai/activity](https://openrouter.ai/activity) 检查您的使用情况

### Claude Code 未使用 OpenRouter

验证环境变量是否已设置：

```bash
echo $ANTHROPIC_BASE_URL
# 应输出：https://openrouter.ai/api

echo $ANTHROPIC_AUTH_TOKEN
# 应输出：sk-or-v1-...

echo $ANTHROPIC_API_KEY
# 应为空
```

### Agent CLI 认证问题

```bash
# 删除现有凭据
agent auth logout
# 选择 "openrouter"

# 重新认证
agent auth login
# 选择 "openrouter" 并输入您的 API 密钥
```

## 安全最佳实践

1. **永远不要提交 API 密钥**：将配置文件添加到 `.gitignore`
2. **使用环境变量**：优先使用 shell 配置文件而非项目文件
3. **定期轮换密钥**：在 [openrouter.ai/keys](https://openrouter.ai/keys) 生成新密钥
4. **监控使用情况**：查看[活动仪表板](https://openrouter.ai/activity)以检测可疑请求

## 参考资料

- [OpenRouter 文档](https://openrouter.ai/docs)
- [OpenRouter 模型](https://openrouter.ai/models)
- [Claude Code CLI](https://claude.ai/code)
- [@link-assistant/agent](https://github.com/link-assistant/agent)
