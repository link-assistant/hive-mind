# Free Models Support in Hive-Mind

This document provides comprehensive information about the free models supported by hive-mind when using the `--tool agent` option.

## Available Free Models

Hive-mind supports free models from two providers:

1. **OpenCode Zen** - 5 free models with `opencode/` prefix
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

### 2. opencode/minimax-m2.1-free

- **Short Alias**: `minimax-m2.1-free`
- **Provider**: OpenCode Zen
- **Status**: Fully Supported
- **Features**: Reasoning, tool calling, temperature control
- **Context Window**: 204,800 tokens
- **Output Limit**: 131,072 tokens
- **Cost**: Free (no input/output charges)
- **Knowledge Cutoff**: January 2025
- **Release Date**: December 23, 2025
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

### 4. opencode/glm-4.7-free

- **Short Alias**: `glm-4.7-free`
- **Provider**: OpenCode Zen
- **Status**: Fully Supported
- **Features**: Reasoning, tool calling, interleaved thinking, temperature control
- **Context Window**: 204,800 tokens
- **Output Limit**: 131,072 tokens
- **Cost**: Free (no input/output charges)
- **Knowledge Cutoff**: April 2025
- **Release Date**: December 22, 2025
- **Open Weights**: Yes

### 5. opencode/big-pickle

- **Short Alias**: `big-pickle`
- **Provider**: OpenCode Zen
- **Status**: Fully Supported
- **Features**: Reasoning, tool calling, temperature control
- **Context Window**: 200,000 tokens
- **Output Limit**: 128,000 tokens
- **Cost**: Free (no input/output charges)
- **Knowledge Cutoff**: January 2025

---

## Kilo Gateway Free Models

[Kilo Gateway](https://kilo.ai) provides access to 500+ AI models through an OpenAI-compatible API. The following free models are available without API key configuration.

### 1. kilo/glm-5-free **Recommended for Kilo**

- **Short Alias**: `glm-5-free` or `kilo-glm-5-free`
- **Provider**: Kilo Gateway (Z.AI)
- **Status**: Fully Supported (Free for limited time)
- **Features**: Deep reasoning, fast inference, bilingual (Chinese/English), tool calling, structured outputs
- **Context Window**: 202,752 tokens
- **Output Limit**: 131,072 tokens
- **Cost**: Free (limited time offer)
- **Release Date**: February 11, 2026
- **Special Features**: "Matches Opus 4.5 on many tasks" - [Kilo Blog](https://blog.kilo.ai/p/glm-5-free-limited-time)

### 2. kilo/glm-4.7-free

- **Short Alias**: `kilo-glm-4.7-free`
- **Provider**: Kilo Gateway (Z.AI)
- **Status**: Fully Supported
- **Features**: Agent-centric, strong coding capabilities, tool calling
- **Context Window**: 131,072 tokens
- **Output Limit**: 65,536 tokens
- **Cost**: Free

### 3. kilo/kimi-k2.5-free

- **Short Alias**: `kilo-kimi-k2.5-free`
- **Provider**: Kilo Gateway (MoonshotAI)
- **Status**: Fully Supported
- **Features**: Agentic capabilities, tool use, reasoning, code synthesis
- **Context Window**: 131,072 tokens
- **Output Limit**: 65,536 tokens
- **Cost**: Free

### 4. kilo/minimax-m2.1-free

- **Short Alias**: `kilo-minimax-m2.1-free`
- **Provider**: Kilo Gateway (MiniMax)
- **Status**: Fully Supported
- **Features**: Strong general-purpose performance
- **Context Window**: 131,072 tokens
- **Output Limit**: 65,536 tokens
- **Cost**: Free

### 5. kilo/giga-potato-free

- **Short Alias**: `kilo-giga-potato-free`
- **Provider**: Kilo Gateway
- **Status**: Fully Supported (Evaluation period)
- **Features**: General-purpose evaluation model
- **Context Window**: 65,536 tokens
- **Output Limit**: 32,768 tokens
- **Cost**: Free (during evaluation)

### 6. kilo/trinity-large-preview

- **Short Alias**: `kilo-trinity-large-preview`
- **Provider**: Kilo Gateway (Arcee AI)
- **Status**: Fully Supported (Preview)
- **Features**: Strong capabilities, preview model
- **Context Window**: 65,536 tokens
- **Output Limit**: 32,768 tokens
- **Cost**: Free (preview)

---

## Usage Examples

### Command Line Usage

```bash
# OpenCode Zen models
solve https://github.com/owner/repo/issues/123 --tool agent --model kimi-k2.5-free
hive https://github.com/owner/repo --tool agent --model opencode/glm-4.7-free

# Kilo Gateway models
solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free
hive https://github.com/owner/repo --tool agent --model glm-5-free
hive https://github.com/owner/repo --tool agent --model kilo-glm-4.7-free
```

### Telegram Bot Usage

```bash
# OpenCode Zen models
/solve https://github.com/owner/repo/issues/123 --tool agent --model kimi-k2.5-free
/solve https://github.com/owner/repo/issues/123 --tool agent --model big-pickle

# Kilo Gateway models
/solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free
/solve https://github.com/owner/repo/issues/123 --tool agent --model glm-5-free
/hive https://github.com/owner/repo --tool agent --model kilo-glm-4.7-free

# Default model (kimi-k2.5-free via OpenCode Zen):
/solve https://github.com/owner/repo/issues/123 --tool agent
```

### Direct Agent CLI Usage

```bash
# OpenCode Zen models
echo "Your prompt here" | agent --model opencode/kimi-k2.5-free
echo "Your prompt here" | agent --model opencode/big-pickle

# Kilo Gateway models
echo "Your prompt here" | agent --model kilo/glm-5-free
echo "Your prompt here" | agent --model kilo/glm-4.7-free
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
- `kilo/minimax-m2.1-free` - Strong general-purpose performance

**For Large Context Tasks**:

- `opencode/kimi-k2.5-free` - Largest context (262,144 tokens)
- `kilo/glm-5-free` - Very large context (202,752 tokens)
- `opencode/glm-4.7-free` - Large context (204,800 tokens)

**Agent-Centric / Coding**:

- `kilo/glm-4.7-free` - Purpose-built for agent-centric applications
- `kilo/kimi-k2.5-free` - Optimized for tool use and code synthesis
- `opencode/glm-4.7-free` - Strong coding performance

---

## Provider Comparison

| Feature       | OpenCode Zen      | Kilo Gateway             |
| ------------- | ----------------- | ------------------------ |
| Free Models   | 5 models          | 6 models                 |
| Default Model | kimi-k2.5-free    | glm-5-free (recommended) |
| API Format    | OpenAI-compatible | OpenAI-compatible        |
| Free API Key  | `public`          | `public`                 |
| Total Models  | 50+               | 500+                     |
| Flagship Free | Kimi K2.5         | GLM-5 (limited time)     |
| BYOK Support  | Yes               | Yes                      |

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
- [OpenCode Zen Documentation](https://opencode.ai/docs/zen/) - OpenCode Zen provider details
- [Kilo Gateway Documentation](https://kilo.ai/docs/gateway) - Kilo Gateway provider details

---

**Last Updated**: February 13, 2026
**Hive-Mind Version**: 1.22.6
**Agent CLI Version**: Latest (with Kilo support from PR #160)
