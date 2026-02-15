# Free Models Support in Hive-Mind

This document provides comprehensive information about the free models supported by hive-mind when using the `--tool agent` option.

> **Last Updated:** February 2026
> **Related:** [Agent PR #191](https://github.com/link-assistant/agent/pull/191) - Upstream free model updates

## Available Free Models

Hive-mind supports free models from two providers:

1. **OpenCode Zen** - 4 free models with `opencode/` prefix
2. **Kilo Gateway** - 6 free models with `kilo/` prefix (Issue #1282)

---

## OpenCode Zen Free Models

### 1. opencode/kimi-k2.5-free **Default Model**

- **Short Alias**: `kimi-k2.5-free`
- **Provider**: OpenCode Zen
- **Status**: Fully Supported (Default for `--tool agent`)
- **Features**: Reasoning, tool calling, temperature control
- **Context Window**: 262,144 tokens
- **Output Limit**: 262,144 tokens
- **Cost**: Free (no input/output charges)
- **Knowledge Cutoff**: August 2024
- **Release Date**: January 27, 2026
- **Open Weights**: Yes
- **Special Features**: Visual agentic intelligence, multimodal capabilities, agent swarm architecture

### 2. opencode/minimax-m2.5-free

- **Short Alias**: `minimax-m2.5-free`
- **Provider**: OpenCode Zen
- **Status**: Fully Supported (upgraded from M2.1)
- **Features**: Reasoning, tool calling, temperature control
- **Context Window**: 204,800 tokens
- **Output Limit**: 131,072 tokens
- **Cost**: Free (no input/output charges)
- **Knowledge Cutoff**: January 2025
- **Release Date**: February 2026
- **Open Weights**: Yes

### 3. opencode/gpt-5-nano

- **Short Alias**: `gpt-5-nano`
- **Provider**: OpenCode Zen
- **Status**: Fully Supported
- **Features**: Reasoning, tool calling, structured output, temperature control
- **Context Window**: 200,000 tokens
- **Output Limit**: 128,000 tokens
- **Cost**: Free (no input/output charges)
- **Knowledge Cutoff**: January 2025

### 4. opencode/big-pickle

- **Short Alias**: `big-pickle`
- **Provider**: OpenCode Zen
- **Status**: Fully Supported
- **Features**: Reasoning, tool calling, temperature control
- **Context Window**: 200,000 tokens
- **Output Limit**: 128,000 tokens
- **Cost**: Free (no input/output charges)
- **Knowledge Cutoff**: January 2025

---

## Discontinued OpenCode Zen Free Models

The following models were previously free but are no longer available:

| Model             | Former Model ID              | Status                                   |
| ----------------- | ---------------------------- | ---------------------------------------- |
| MiniMax M2.1 Free | `opencode/minimax-m2.1-free` | Replaced by `opencode/minimax-m2.5-free` |
| GLM 4.7 Free      | `opencode/glm-4.7-free`      | No longer free on OpenCode Zen           |

> **Note:** See [OpenCode Zen Documentation](https://opencode.ai/docs/zen/) for the current list of free models.

---

## Kilo Gateway Free Models

[Kilo Gateway](https://kilo.ai) provides access to 500+ AI models through an OpenAI-compatible API. The following free models are available without API key configuration.

### 1. kilo/glm-5-free **Recommended for Kilo**

- **Model ID**: `kilo/glm-5-free`
- **Provider**: Kilo Gateway (Z.AI)
- **Status**: Fully Supported (Free for limited time)
- **Features**: Deep reasoning, fast inference, bilingual (Chinese/English), tool calling, structured outputs
- **Context Window**: 202,752 tokens
- **Output Limit**: 131,072 tokens
- **Cost**: Free (limited time offer)
- **Release Date**: February 11, 2026
- **Special Features**: "Matches Opus 4.5 on many tasks" - [Kilo Blog](https://blog.kilo.ai/p/glm-5-free-limited-time)

### 2. kilo/glm-4.5-air-free

- **Model ID**: `kilo/glm-4.5-air-free`
- **Provider**: Kilo Gateway (Z.AI)
- **Status**: Fully Supported
- **Features**: Agent-centric, lightweight, fast inference
- **Context Window**: 131,072 tokens
- **Output Limit**: 65,536 tokens
- **Cost**: Free

### 3. kilo/minimax-m2.5-free

- **Model ID**: `kilo/minimax-m2.5-free`
- **Provider**: Kilo Gateway (MiniMax)
- **Status**: Fully Supported (upgraded from M2.1)
- **Features**: Strong general-purpose performance
- **Context Window**: 204,800 tokens
- **Output Limit**: 131,072 tokens
- **Cost**: Free

### 4. kilo/deepseek-r1-free

- **Model ID**: `kilo/deepseek-r1-free`
- **Provider**: Kilo Gateway (DeepSeek)
- **Status**: Fully Supported
- **Features**: Advanced reasoning, open-source, fully open reasoning tokens
- **Context Window**: 163,840 tokens
- **Output Limit**: 65,536 tokens
- **Cost**: Free

### 5. kilo/giga-potato-free

- **Model ID**: `kilo/giga-potato-free`
- **Provider**: Kilo Gateway
- **Status**: Fully Supported (Evaluation period)
- **Features**: General-purpose evaluation model
- **Context Window**: 256,000 tokens
- **Output Limit**: 131,072 tokens
- **Cost**: Free (during evaluation)

### 6. kilo/trinity-large-preview

- **Model ID**: `kilo/trinity-large-preview`
- **Provider**: Kilo Gateway (Arcee AI)
- **Status**: Fully Supported (Preview)
- **Features**: Strong capabilities, preview model
- **Context Window**: 131,000 tokens
- **Output Limit**: 65,536 tokens
- **Cost**: Free (preview)

---

---

## Discontinued Kilo Gateway Free Models

The following Kilo models were previously the recommended free models but have been updated:

| Model        | Former Model ID          | Status                               |
| ------------ | ------------------------ | ------------------------------------ |
| GLM 4.7      | `kilo/glm-4.7-free`      | Replaced by `kilo/glm-4.5-air-free`  |
| Kimi K2.5    | `kilo/kimi-k2.5-free`    | Replaced by other Kilo free models   |
| MiniMax M2.1 | `kilo/minimax-m2.1-free` | Replaced by `kilo/minimax-m2.5-free` |

> **Note:** See [Kilo Free Models Documentation](https://kilo.ai/docs/advanced-usage/free-and-budget-models) for current availability.

---

## Usage Examples

### Command Line Usage

```bash
# OpenCode Zen models
solve https://github.com/owner/repo/issues/123 --tool agent --model kimi-k2.5-free
hive https://github.com/owner/repo --tool agent --model opencode/minimax-m2.5-free

# Kilo Gateway models
solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free
hive https://github.com/owner/repo --tool agent --model kilo/deepseek-r1-free
```

### Telegram Bot Usage

```bash
# OpenCode Zen models
/solve https://github.com/owner/repo/issues/123 --tool agent --model kimi-k2.5-free
/solve https://github.com/owner/repo/issues/123 --tool agent --model minimax-m2.5-free

# Kilo Gateway models
/solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free
/hive https://github.com/owner/repo --tool agent --model kilo/glm-4.5-air-free

# Default model (kimi-k2.5-free via OpenCode Zen):
/solve https://github.com/owner/repo/issues/123 --tool agent
```

### Direct Agent CLI Usage

```bash
# OpenCode Zen models
echo "Your prompt here" | agent --model opencode/kimi-k2.5-free
echo "Your prompt here" | agent --model opencode/minimax-m2.5-free

# Kilo Gateway models
echo "Your prompt here" | agent --model kilo/glm-5-free
echo "Your prompt here" | agent --model kilo/deepseek-r1-free
```

---

## Model Selection Guide

### For Different Use Cases

**Flagship Free Models**:

- `kilo/glm-5-free` - Z.AI flagship, matches Opus 4.5 on many tasks (Kilo)
- `opencode/kimi-k2.5-free` - Cutting-edge multimodal agentic model (OpenCode)

**General Purpose & Reasoning**:

- `opencode/gpt-5-nano` - Strong general reasoning capabilities
- `opencode/big-pickle` - Well-balanced performance
- `kilo/minimax-m2.5-free` - Strong general-purpose performance
- `kilo/deepseek-r1-free` - Advanced reasoning model

**For Large Context Tasks**:

- `opencode/kimi-k2.5-free` - Largest context (262,144 tokens)
- `kilo/giga-potato-free` - Very large context (256,000 tokens)
- `opencode/minimax-m2.5-free` - Large context (204,800 tokens)
- `kilo/glm-5-free` - Large context (202,752 tokens)

**Agent-Centric / Coding**:

- `kilo/glm-4.5-air-free` - Purpose-built for agent-centric applications
- `kilo/deepseek-r1-free` - Optimized for reasoning and code synthesis
- `opencode/minimax-m2.5-free` - Strong coding performance

---

## Provider Comparison

| Feature       | OpenCode Zen                      | Kilo Gateway             |
| ------------- | --------------------------------- | ------------------------ |
| Free Models   | 4 models                          | 6 models                 |
| Default Model | kimi-k2.5-free                    | glm-5-free (recommended) |
| API Format    | OpenAI-compatible                 | OpenAI-compatible        |
| Free API Key  | `public`                          | `public`                 |
| Total Models  | 50+                               | 500+                     |
| Flagship Free | Kimi K2.5                         | GLM-5 (limited time)     |
| BYOK Support  | Yes                               | Yes                      |
| New Models    | MiniMax M2.5 (upgraded from M2.1) | DeepSeek R1, GLM 4.5 Air |

---

## Testing and Validation

All free models have been tested and validated for:

1. **Model Configuration**: All models are properly configured in `src/model-validation.lib.mjs` and `src/model-mapping.lib.mjs`
2. **CLI Integration**: All models are accepted by both hive-mind and agent CLI
3. **Tool Compatibility**: All models are compatible with the `--tool agent` option
4. **Case Insensitive Usage**: Models can be specified in any case (e.g., `KILO/GLM-5-FREE`)
5. **Alias Support**: Short aliases work for all models

---

## Error Handling

If you encounter issues with any of these models:

1. **Check Model Spelling**: Ensure exact model name or alias is used
2. **Update Dependencies**: Run `npm install` to ensure latest agent CLI
3. **Check Network**: Some models may require internet access for first-time setup
4. **Verify Provider**: Ensure correct provider prefix (`opencode/` or `kilo/`)

---

## Related Documentation

- [Model Validation Library](../src/model-validation.lib.mjs) - Core model validation logic
- [Model Mapping Library](../src/model-mapping.lib.mjs) - Tool-specific model mapping
- [Agent CLI Documentation](https://github.com/link-assistant/agent) - Direct agent CLI usage
- [Agent Kilo Documentation](https://github.com/link-assistant/agent/blob/main/docs/kilo.md) - Kilo Gateway details
- [Case Study: Issue #1282](./case-studies/issue-1282/README.md) - Kilo models integration analysis
- [Case Study: Issue #1300](./case-studies/issue-1300/README.md) - Free models update (MiniMax M2.5, DeepSeek R1)
- [OpenCode Zen Documentation](https://opencode.ai/docs/zen/) - OpenCode Zen provider details
- [Kilo Gateway Documentation](https://kilo.ai/docs/gateway) - Kilo Gateway provider details

---

**Last Updated**: February 15, 2026
**Hive-Mind Version**: 1.23.7
**Agent CLI Version**: Latest (with free model updates from PR #191)
