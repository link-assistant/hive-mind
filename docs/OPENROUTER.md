# OpenRouter Setup Guide

This guide explains how to configure OpenRouter for both Claude Code CLI and @link-assistant/agent, enabling you to use 500+ AI models from 60+ providers through a unified API.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Claude Code CLI with OpenRouter](#claude-code-cli-with-openrouter)
- [Agent CLI with OpenRouter](#agent-cli-with-openrouter)
- [Model Selection](#model-selection)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

## Overview

OpenRouter provides a unified API gateway that allows you to access various AI models without requiring individual subscriptions. Benefits include:

- **500+ Models**: Access to models from OpenAI, Anthropic, Google, Meta, and 60+ providers
- **Pay-as-you-go**: No monthly subscriptions required
- **Unified API**: Single API key works across all providers
- **Fallback Support**: Automatic failover between providers

## Prerequisites

1. **OpenRouter Account**: Sign up at [openrouter.ai](https://openrouter.ai/)
2. **API Key**: Get your API key from [OpenRouter Keys](https://openrouter.ai/keys)
3. **Claude Code CLI** and/or **@link-assistant/agent** installed

## Claude Code CLI with OpenRouter

Claude Code CLI can connect to OpenRouter using Anthropic's native protocol.

### Step 1: Set Environment Variables

Add these to your shell profile (`~/.bashrc`, `~/.zshrc`, or `~/.config/fish/config.fish`):

```bash
# Required: Point Claude Code to OpenRouter
export ANTHROPIC_BASE_URL="https://openrouter.ai/api"

# Required: Your OpenRouter API key
export ANTHROPIC_AUTH_TOKEN="sk-or-v1-your-api-key-here"

# Required: Must be explicitly blank to prevent conflicts
export ANTHROPIC_API_KEY=""
```

### Step 2: Model Configuration (Optional)

Override default models with OpenRouter-compatible alternatives:

```bash
# Use specific models from OpenRouter
export ANTHROPIC_DEFAULT_SONNET_MODEL="anthropic/claude-sonnet-4"
export ANTHROPIC_DEFAULT_OPUS_MODEL="anthropic/claude-opus-4"
export ANTHROPIC_SMALL_FAST_MODEL="anthropic/claude-haiku"
```

### Step 3: Apply Configuration

```bash
# Reload shell profile
source ~/.bashrc  # or ~/.zshrc
```

### Alternative: Project-Level Configuration

Create `.claude/settings.local.json` in your project root:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://openrouter.ai/api",
    "ANTHROPIC_AUTH_TOKEN": "sk-or-v1-your-api-key-here",
    "ANTHROPIC_API_KEY": ""
  }
}
```

**Note**: Add `.claude/settings.local.json` to `.gitignore` to protect your API key.

### Step 4: Launch Claude Code

```bash
cd /path/to/your/project
claude
```

## Agent CLI with OpenRouter

@link-assistant/agent supports OpenRouter through the `agent auth login` command or environment variables.

### Method 1: Interactive Authentication

```bash
# Start interactive login
agent auth login

# Select "openrouter" from the provider list
# Enter your OpenRouter API key when prompted
```

### Method 2: Environment Variable

```bash
export OPENROUTER_API_KEY="sk-or-v1-your-api-key-here"
```

### Method 3: Direct Model Usage

```bash
# Use any OpenRouter model with the openrouter/ prefix
echo "hello" | agent --model openrouter/anthropic/claude-sonnet-4

# Or use OpenCode Zen models (default)
echo "hello" | agent --model opencode/grok-code
```

### Check Authentication Status

```bash
# List configured credentials
agent auth list

# Should show:
# ◆ openrouter api-key
```

## Model Selection

### Claude Code CLI Models via OpenRouter

| Use Case         | Environment Variable             | Example Value               |
| ---------------- | -------------------------------- | --------------------------- |
| Main model       | `ANTHROPIC_DEFAULT_SONNET_MODEL` | `anthropic/claude-sonnet-4` |
| Powerful model   | `ANTHROPIC_DEFAULT_OPUS_MODEL`   | `anthropic/claude-opus-4`   |
| Fast/cheap model | `ANTHROPIC_SMALL_FAST_MODEL`     | `anthropic/claude-haiku`    |

### Agent CLI Models via OpenRouter

Use the `openrouter/` prefix followed by the provider and model:

```bash
# Anthropic models
agent --model openrouter/anthropic/claude-sonnet-4

# OpenAI models
agent --model openrouter/openai/gpt-4o

# Google models
agent --model openrouter/google/gemini-2.0-flash

# Meta models
agent --model openrouter/meta-llama/llama-3.1-405b-instruct
```

### Important: Tool Use Support

When selecting alternative models, ensure they support **tool use** capabilities. Claude Code and agent rely on tools to:

- Read and write files
- Execute terminal commands
- Search codebases
- Perform web searches

Models without tool use support will not function properly.

## Verification

### Claude Code CLI

Run `/status` within Claude Code to verify the connection:

```
Claude Code v1.x.x
Connected to: openrouter.ai
Model: anthropic/claude-sonnet-4
```

Also check the [OpenRouter Activity Dashboard](https://openrouter.ai/activity) for real-time request logs.

### Agent CLI

```bash
# Simple test
echo "What is 2+2?" | agent --model openrouter/anthropic/claude-sonnet-4

# Check configured credentials
agent auth list
```

## Troubleshooting

### "Authentication failed" Error

1. Verify your API key is correct at [openrouter.ai/keys](https://openrouter.ai/keys)
2. Ensure `ANTHROPIC_API_KEY=""` is explicitly set (blank) for Claude Code
3. Check for typos in the `ANTHROPIC_AUTH_TOKEN` value

### "Model not found" Error

1. Verify the model ID at [openrouter.ai/models](https://openrouter.ai/models)
2. Use the full model path: `provider/model-name`
3. Check if the model is available in your region

### "Insufficient credits" Error

1. Add credits at [openrouter.ai/credits](https://openrouter.ai/credits)
2. Check your usage at [openrouter.ai/activity](https://openrouter.ai/activity)

### Claude Code Not Using OpenRouter

Verify environment variables are set:

```bash
echo $ANTHROPIC_BASE_URL
# Should output: https://openrouter.ai/api

echo $ANTHROPIC_AUTH_TOKEN
# Should output: sk-or-v1-...

echo $ANTHROPIC_API_KEY
# Should be empty
```

### Agent CLI Auth Issues

```bash
# Remove existing credentials
agent auth logout
# Select "openrouter"

# Re-authenticate
agent auth login
# Select "openrouter" and enter your API key
```

## Security Best Practices

1. **Never commit API keys**: Add configuration files to `.gitignore`
2. **Use environment variables**: Prefer shell profile over project files
3. **Rotate keys regularly**: Generate new keys at [openrouter.ai/keys](https://openrouter.ai/keys)
4. **Monitor usage**: Check [activity dashboard](https://openrouter.ai/activity) for suspicious requests

## References

- [OpenRouter Documentation](https://openrouter.ai/docs)
- [OpenRouter Models](https://openrouter.ai/models)
- [Claude Code CLI](https://claude.ai/code)
- [@link-assistant/agent](https://github.com/link-assistant/agent)
