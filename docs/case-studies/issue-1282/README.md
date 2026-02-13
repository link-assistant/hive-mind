# Case Study: Adding Kilo Gateway Models Support

## Issue Reference

- **Issue**: [#1282](https://github.com/link-assistant/hive-mind/issues/1282)
- **Related PR**: [agent#160](https://github.com/link-assistant/agent/pull/160) - Kilo Gateway provider implementation
- **Date**: February 13, 2026

## Summary

This case study documents the integration of Kilo Gateway models into hive-mind, following the agent CLI's implementation of the Kilo provider. The goal is to ensure users can access free Kilo models through the `--tool agent` option in both solve/hive commands and the Telegram bot.

## Background

### What is Kilo Gateway?

[Kilo](https://kilo.ai) is an open-source AI coding agent platform that provides unified access to 500+ AI models through an OpenAI-compatible API at `https://api.kilo.ai/api/gateway`. Key features include:

- **500+ AI Models**: Access to models from Z.AI, MoonshotAI, MiniMax, Anthropic, OpenAI, Google, and more
- **Free Tier**: Several free models available without API key (using `public` key)
- **BYOK Support**: Bring your own API keys with encrypted-at-rest storage
- **OpenAI-Compatible API**: Drop-in replacement for OpenAI's `/chat/completions` endpoint

### Comparison: OpenCode Zen vs Kilo Gateway

| Feature       | OpenCode Zen        | Kilo Gateway              |
| ------------- | ------------------- | ------------------------- |
| Free Models   | 5 (Kimi K2.5, etc.) | 6+ (GLM-5, GLM 4.7, etc.) |
| Flagship Free | Kimi K2.5 Free      | GLM-5 (limited time)      |
| API Format    | OpenAI-compatible   | OpenAI-compatible         |
| Free API Key  | `public`            | `public`                  |
| Total Models  | 50+                 | 500+                      |
| BYOK Support  | Yes                 | Yes                       |

## Research Data

### Available Kilo Free Models

| Model                   | Model ID                     | Provider   | Context Window | Status              |
| ----------------------- | ---------------------------- | ---------- | -------------- | ------------------- |
| **GLM-5 (recommended)** | `kilo/glm-5-free`            | Z.AI       | 202,752 tokens | Free (limited time) |
| GLM 4.7                 | `kilo/glm-4.7-free`          | Z.AI       | 131,072 tokens | Free                |
| Kimi K2.5               | `kilo/kimi-k2.5-free`        | MoonshotAI | 131,072 tokens | Free                |
| MiniMax M2.1            | `kilo/minimax-m2.1-free`     | MiniMax    | 131,072 tokens | Free                |
| Giga Potato             | `kilo/giga-potato-free`      | Unknown    | 65,536 tokens  | Free (evaluation)   |
| Trinity Large Preview   | `kilo/trinity-large-preview` | Arcee AI   | 65,536 tokens  | Free (preview)      |

### GLM-5 Specifications

GLM-5 is Z.AI's (Zhipu AI) flagship model with enhanced reasoning and coding capabilities:

| Property           | Value             |
| ------------------ | ----------------- |
| Model ID           | `kilo/glm-5-free` |
| Context Window     | 202,752 tokens    |
| Max Output Tokens  | 131,072 tokens    |
| Function Calling   | Yes               |
| Tool Choice        | Yes               |
| Structured Outputs | Yes (JSON schema) |
| Reasoning Tokens   | Yes               |
| Release Date       | February 11, 2026 |

GLM-5 reportedly "matches Opus 4.5 on many tasks" according to [Kilo's blog post](https://blog.kilo.ai/p/glm-5-free-limited-time).

## Implementation

### Changes Required

1. **model-validation.lib.mjs**: Add Kilo models to `AGENT_MODELS` constant
2. **model-mapping.lib.mjs**: Add Kilo models to `agentModels` mapping
3. **FREE_MODELS.md**: Update documentation with Kilo models section

### Model Naming Convention

Kilo models use the `kilo/` prefix:

- `kilo/glm-5-free` - GLM-5 (flagship free model)
- `kilo/glm-4.7-free` - GLM 4.7
- `kilo/kimi-k2.5-free` - Kimi K2.5
- `kilo/minimax-m2.1-free` - MiniMax M2.1
- `kilo/giga-potato-free` - Giga Potato
- `kilo/trinity-large-preview` - Trinity Large Preview

Short aliases are also supported (without prefix):

- `glm-5-free`
- `kilo-glm-4.7-free`
- etc.

## Usage Examples

### Command Line

```bash
# Using Kilo GLM-5 (recommended)
solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free

# Using Kilo GLM 4.7
hive https://github.com/owner/repo --tool agent --model kilo/glm-4.7-free
```

### Telegram Bot

```
/solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free
/hive https://github.com/owner/repo --tool agent --model kilo/glm-4.7-free
```

## Sources

- [Kilo Gateway Documentation](https://kilo.ai/docs/gateway)
- [Free and Budget Models](https://kilo.ai/docs/advanced-usage/free-and-budget-models)
- [GLM-5 Free Announcement](https://blog.kilo.ai/p/glm-5-free-limited-time)
- [OpenCode Zen Documentation](https://opencode.ai/docs/zen/)
- [Agent PR #160 - Kilo Provider](https://github.com/link-assistant/agent/pull/160)

## Related Issues

- [Agent Issue #159](https://github.com/link-assistant/agent/issues/159) - Original Kilo provider request
- [Hive-Mind Issue #1185](https://github.com/link-assistant/hive-mind/issues/1185) - OpenCode Zen model prefix standardization
