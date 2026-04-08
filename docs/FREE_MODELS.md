# Free Models Support in Hive-Mind

This document provides comprehensive information about the free models supported by hive-mind when using the `--tool agent` option.

> **Last Updated:** April 8, 2026
> **Related:**
>
> - [Agent CLI FREE_MODELS.md](https://github.com/link-assistant/agent/blob/main/FREE_MODELS.md) - Upstream free models list (canonical source)
> - [Agent PR #234](https://github.com/link-assistant/agent/pull/234) - Upstream: qwen3.6-plus-free as default, add nemotron-3-super-free
> - [Agent PR #209](https://github.com/link-assistant/agent/pull/209) - Upstream free model updates (minimax-m2.5-free as default)
> - [Agent Issue #208](https://github.com/link-assistant/agent/issues/208) - kimi-k2.5-free removed from OpenCode Zen

## Available Free Models

Hive-mind supports free models from two providers:

1. **OpenCode Zen** - 5 free models with `opencode/` prefix
2. **Kilo Gateway** - 6 free models with `kilo/` prefix (Issue #1282)

---

## OpenCode Zen Free Models

### 1. opencode/qwen3.6-plus-free **Default Model**

- **Short Alias**: `qwen3.6-plus-free`
- **Provider**: OpenCode Zen
- **Status**: Fully Supported (Default for `--tool agent` as of Issue #1543)
- **Features**: Reasoning, tool calling, temperature control
- **Context Window**: ~1,000,000 tokens
- **Output Limit**: 65,536 tokens
- **Cost**: Free (no input/output charges)
- **Knowledge Cutoff**: March 2025
- **Release Date**: March 2026
- **Open Weights**: Yes
- **Notes**: Largest context window among free models (5x larger than minimax-m2.5-free)

### 2. opencode/nemotron-3-super-free

- **Short Alias**: `nemotron-3-super-free`
- **Provider**: OpenCode Zen
- **Status**: Fully Supported (Added in Issue #1543)
- **Features**: Reasoning, tool calling, hybrid Mamba-Transformer architecture
- **Context Window**: ~262,144 tokens
- **Output Limit**: 262,144 tokens
- **Cost**: Free (no input/output charges)
- **Knowledge Cutoff**: January 2025
- **Release Date**: March 2026
- **Open Weights**: Yes
- **Notes**: NVIDIA hybrid Mamba-Transformer MoE, strong reasoning capabilities

### 3. opencode/minimax-m2.5-free

- **Short Alias**: `minimax-m2.5-free`
- **Provider**: OpenCode Zen
- **Status**: Fully Supported (Former default, Issue #1391)
- **Features**: Reasoning, tool calling, temperature control
- **Context Window**: 204,800 tokens
- **Output Limit**: 131,072 tokens
- **Cost**: Free (no input/output charges)
- **Knowledge Cutoff**: January 2025
- **Release Date**: February 2026
- **Open Weights**: Yes

### 4. opencode/gpt-5-nano

- **Short Alias**: `gpt-5-nano`
- **Provider**: OpenCode Zen
- **Status**: Fully Supported
- **Features**: Reasoning, tool calling, structured output, temperature control
- **Context Window**: ~400,000 tokens
- **Output Limit**: 128,000 tokens
- **Cost**: Free (no input/output charges)
- **Knowledge Cutoff**: January 2025

### 5. opencode/big-pickle

- **Short Alias**: `big-pickle`
- **Provider**: OpenCode Zen
- **Status**: Fully Supported
- **Features**: Reasoning, tool calling, temperature control
- **Context Window**: ~200,000 tokens
- **Output Limit**: 128,000 tokens
- **Cost**: Free (no input/output charges)
- **Knowledge Cutoff**: January 2025

---

## Discontinued OpenCode Zen Free Models

The following models were previously free but are no longer available:

| Model             | Former Model ID              | Status                                                                                                       |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Kimi K2.5 Free    | `opencode/kimi-k2.5-free`    | Removed from OpenCode Zen (March 2026) — see [agent#208](https://github.com/link-assistant/agent/issues/208) |
| Grok Code Fast 1  | `opencode/grok-code`         | Discontinued January 2026                                                                                    |
| MiniMax M2.1 Free | `opencode/minimax-m2.1-free` | Replaced by `opencode/minimax-m2.5-free`                                                                     |
| GLM 4.7 Free      | `opencode/glm-4.7-free`      | No longer free on OpenCode Zen                                                                               |

> **Note:** See [OpenCode Zen Documentation](https://opencode.ai/docs/zen/) and [Agent CLI FREE_MODELS.md](https://github.com/link-assistant/agent/blob/main/FREE_MODELS.md) for the current list of free models.

---

## Kilo Gateway Free Models

[Kilo Gateway](https://kilo.ai) provides access to 500+ AI models through an OpenAI-compatible API. The following free models are available without API key configuration.

> **Note:** Kilo-exclusive models (models only available on Kilo Gateway) support short aliases without the `kilo/` prefix. For example, you can use `glm-5-free` instead of `kilo/glm-5-free` since this model is unique to Kilo.

### 1. kilo/glm-5-free **Recommended for Kilo**

- **Model ID**: `kilo/glm-5-free`
- **Short Alias**: `glm-5-free` (Kilo-exclusive model)
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
- **Short Alias**: `glm-4.5-air-free` (Kilo-exclusive model)
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
- **Short Alias**: `deepseek-r1-free` (Kilo-exclusive model)
- **Provider**: Kilo Gateway (DeepSeek)
- **Status**: Fully Supported
- **Features**: Advanced reasoning, open-source, fully open reasoning tokens
- **Context Window**: 163,840 tokens
- **Output Limit**: 65,536 tokens
- **Cost**: Free

### 5. kilo/giga-potato-free

- **Model ID**: `kilo/giga-potato-free`
- **Short Alias**: `giga-potato-free` (Kilo-exclusive model)
- **Provider**: Kilo Gateway
- **Status**: Fully Supported (Evaluation period)
- **Features**: General-purpose evaluation model
- **Context Window**: 256,000 tokens
- **Output Limit**: 131,072 tokens
- **Cost**: Free (during evaluation)

### 6. kilo/trinity-large-preview

- **Model ID**: `kilo/trinity-large-preview`
- **Short Alias**: `trinity-large-preview` (Kilo-exclusive model)
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
# OpenCode Zen models (short aliases without prefix)
solve https://github.com/owner/repo/issues/123 --tool agent --model qwen3.6-plus-free
solve https://github.com/owner/repo/issues/123 --tool agent --model nemotron-3-super-free
hive https://github.com/owner/repo --tool agent --model minimax-m2.5-free

# OpenCode Zen models (full model IDs)
solve https://github.com/owner/repo/issues/123 --tool agent --model opencode/qwen3.6-plus-free
hive https://github.com/owner/repo --tool agent --model opencode/big-pickle

# Kilo Gateway models (full model IDs)
solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free
hive https://github.com/owner/repo --tool agent --model kilo/deepseek-r1-free

# Kilo-exclusive models (short aliases without kilo/ prefix)
solve https://github.com/owner/repo/issues/123 --tool agent --model glm-5-free
hive https://github.com/owner/repo --tool agent --model deepseek-r1-free
```

### Telegram Bot Usage

```bash
# OpenCode Zen models (short aliases)
/solve https://github.com/owner/repo/issues/123 --tool agent --model qwen3.6-plus-free
/solve https://github.com/owner/repo/issues/123 --tool agent --model nemotron-3-super-free
/solve https://github.com/owner/repo/issues/123 --tool agent --model minimax-m2.5-free

# Kilo Gateway models (full model IDs)
/solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free
/hive https://github.com/owner/repo --tool agent --model kilo/glm-4.5-air-free

# Kilo-exclusive models (short aliases without kilo/ prefix)
/solve https://github.com/owner/repo/issues/123 --tool agent --model glm-5-free
/hive https://github.com/owner/repo --tool agent --model glm-4.5-air-free

# Default model (qwen3.6-plus-free via OpenCode Zen):
/solve https://github.com/owner/repo/issues/123 --tool agent
```

### Direct Agent CLI Usage

```bash
# OpenCode Zen models
echo "Your prompt here" | agent --model opencode/qwen3.6-plus-free
echo "Your prompt here" | agent --model opencode/nemotron-3-super-free
echo "Your prompt here" | agent --model opencode/minimax-m2.5-free

# Kilo Gateway models
echo "Your prompt here" | agent --model kilo/glm-5-free
echo "Your prompt here" | agent --model kilo/deepseek-r1-free
```

---

## Model Selection Guide

### For Different Use Cases

**Flagship Free Models**:

- `opencode/qwen3.6-plus-free` - Largest context (~1M tokens), strong agent performance (OpenCode, default)
- `kilo/glm-5-free` - Z.AI flagship, matches Opus 4.5 on many tasks (Kilo)
- `opencode/nemotron-3-super-free` - NVIDIA hybrid Mamba-Transformer, strong reasoning (OpenCode)

**General Purpose & Reasoning**:

- `opencode/gpt-5-nano` - Strong general reasoning capabilities
- `opencode/big-pickle` - Well-balanced performance
- `kilo/minimax-m2.5-free` - Strong general-purpose performance
- `kilo/deepseek-r1-free` - Advanced reasoning model

**For Large Context Tasks**:

- `opencode/qwen3.6-plus-free` - Largest context (~1,000,000 tokens)
- `opencode/gpt-5-nano` - Very large context (~400,000 tokens)
- `opencode/nemotron-3-super-free` - Large context (~262,144 tokens)
- `kilo/giga-potato-free` - Large context (256,000 tokens)
- `opencode/minimax-m2.5-free` - Large context (204,800 tokens)

**Agent-Centric / Coding**:

- `kilo/glm-4.5-air-free` - Purpose-built for agent-centric applications
- `kilo/deepseek-r1-free` - Optimized for reasoning and code synthesis
- `opencode/minimax-m2.5-free` - Strong coding performance

---

## Provider Comparison

| Feature       | OpenCode Zen                                  | Kilo Gateway             |
| ------------- | --------------------------------------------- | ------------------------ |
| Free Models   | 5 models                                      | 6 models                 |
| Default Model | qwen3.6-plus-free (~1M context)               | glm-5-free (recommended) |
| API Format    | OpenAI-compatible                             | OpenAI-compatible        |
| Free API Key  | `public`                                      | `public`                 |
| Total Models  | 50+                                           | 500+                     |
| Flagship Free | Qwen 3.6 Plus (~1M context)                   | GLM-5 (limited time)     |
| BYOK Support  | Yes                                           | Yes                      |
| New Models    | Qwen 3.6 Plus, Nemotron 3 Super (Issue #1543) | DeepSeek R1, GLM 4.5 Air |

---

## Testing and Validation

All free models have been tested and validated for:

1. **Model Configuration**: All models are properly configured in `src/models/index.mjs`
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

- [Agent CLI FREE_MODELS.md](https://github.com/link-assistant/agent/blob/main/FREE_MODELS.md) - Canonical upstream free models list
- [Models Module](../src/models/index.mjs) - Unified model data, validation, mapping, and info
- [Agent CLI Documentation](https://github.com/link-assistant/agent) - Direct agent CLI usage
- [Agent Kilo Documentation](https://github.com/link-assistant/agent/blob/main/docs/kilo.md) - Kilo Gateway details
- [Case Study: Issue #1282](./case-studies/issue-1282/README.md) - Kilo models integration analysis
- [Case Study: Issue #1300](./case-studies/issue-1300/README.md) - Free models update (MiniMax M2.5, DeepSeek R1)
- [Case Study: Issue #1391](./case-studies/issue-1391/README.md) - Free models update (minimax-m2.5-free as default, kimi-k2.5-free deprecated)
- [Case Study: Issue #1473](./case-studies/issue-1473/README.md) - Model recognition fix and free models sync
- [Case Study: Issue #1543](./case-studies/issue-1543/README.md) - Free models update (qwen3.6-plus-free as default, nemotron-3-super-free added)
- [OpenCode Zen Documentation](https://opencode.ai/docs/zen/) - OpenCode Zen provider details
- [Kilo Gateway Documentation](https://kilo.ai/docs/gateway) - Kilo Gateway provider details

---

**Last Updated**: April 8, 2026
**Hive-Mind Version**: 1.46.9
**Agent CLI Version**: Latest (with free model updates from PR #234)
