# Free Models Support in Hive-Mind

This document provides comprehensive information about the free models supported by hive-mind when using the `--tool agent` option.

## Available Free Models

The following free models are fully supported and tested in hive-mind:

### 1. opencode/kimi-k2.5-free ⭐ **Default Model**

- **Short Alias**: `kimi-k2.5-free`
- **Provider**: OpenCode Zen
- **Status**: ✅ Fully Supported (Default for `--tool agent`)
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
- **Status**: ✅ Fully Supported
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
- **Status**: ✅ Fully Supported
- **Features**: Reasoning, tool calling, structured output, temperature control
- **Context Window**: 200,000 tokens
- **Output Limit**: 128,000 tokens
- **Cost**: Free (no input/output charges)
- **Knowledge Cutoff**: January 2025

### 4. opencode/glm-4.7-free

- **Short Alias**: `glm-4.7-free`
- **Provider**: OpenCode Zen
- **Status**: ✅ Fully Supported
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
- **Status**: ✅ Fully Supported
- **Features**: Reasoning, tool calling, temperature control
- **Context Window**: 200,000 tokens
- **Output Limit**: 128,000 tokens
- **Cost**: Free (no input/output charges)
- **Knowledge Cutoff**: January 2025

## Usage Examples

### Command Line Usage

```bash
# Using full model names
hive --tool agent --model opencode/kimi-k2.5-free https://github.com/owner/repo/issues/123
hive --tool agent --model opencode/minimax-m2.1-free https://github.com/owner/repo/issues/123
hive --tool agent --model opencode/gpt-5-nano https://github.com/owner/repo/issues/123
hive --tool agent --model opencode/glm-4.7-free https://github.com/owner/repo/issues/123
hive --tool agent --model opencode/big-pickle https://github.com/owner/repo/issues/123

# Using short aliases
hive --tool agent --model kimi-k2.5-free https://github.com/owner/repo/issues/123
hive --tool agent --model minimax-m2.1-free https://github.com/owner/repo/issues/123
hive --tool agent --model gpt-5-nano https://github.com/owner/repo/issues/123
hive --tool agent --model glm-4.7-free https://github.com/owner/repo/issues/123
hive --tool agent --model big-pickle https://github.com/owner/repo/issues/123
```

### Telegram Bot Usage

```bash
# Using /solve command in Telegram group chats
/solve https://github.com/owner/repo/issues/123 --tool agent --model kimi-k2.5-free
/solve https://github.com/owner/repo/issues/123 --tool agent --model minimax-m2.1-free
/solve https://github.com/owner/repo/issues/123 --tool agent --model gpt-5-nano
/solve https://github.com/owner/repo/issues/123 --tool agent --model glm-4.7-free
/solve https://github.com/owner/repo/issues/123 --tool agent --model big-pickle

# Note: kimi-k2.5-free is the default, so --model flag is optional:
/solve https://github.com/owner/repo/issues/123 --tool agent
```

### Direct Agent CLI Usage

```bash
# All models also work directly with agent CLI
echo "Your prompt here" | agent --model opencode/kimi-k2.5-free
echo "Your prompt here" | agent --model opencode/big-pickle
```

## Model Selection Guide

### For Different Use Cases

**General Purpose & Reasoning**:

- `opencode/gpt-5-nano` - Strong general reasoning capabilities
- `opencode/big-pickle` - Well-balanced performance

**Latest Open Source Models**:

- `opencode/glm-4.7-free` - Latest GLM model with strong coding performance
- `opencode/minimax-m2.1-free` - Latest MiniMax model with efficient inference
- `opencode/kimi-k2.5-free` - Cutting-edge multimodal agentic model

**For Large Context Tasks**:

- `opencode/kimi-k2.5-free` - Largest context window (262,144 tokens)
- `opencode/glm-4.7-free` - Large context (204,800 tokens)
- `opencode/minimax-m2.1-free` - Large context (204,800 tokens)

## Testing and Validation

All free models have been tested and validated for:

1. **Model Configuration**: All models are properly configured in `src/model-validation.lib.mjs` and `src/model-mapping.lib.mjs`
2. **CLI Integration**: All models are accepted by both hive-mind and agent CLI
3. **Tool Compatibility**: All models are compatible with the `--tool agent` option
4. **Case Insensitive Usage**: Models can be specified in any case (e.g., `OPENCODE/BIG-PICKLE`)
5. **Alias Support**: Short aliases work for all models

## Error Handling

If you encounter issues with any of these models:

1. **Check Model Spelling**: Ensure exact model name or alias is used
2. **Update Dependencies**: Run `npm install` to ensure latest agent CLI
3. **Check Network**: Some models may require internet access for first-time setup
4. **Verify API Keys**: Ensure OpenCode credentials are properly configured

## Comparison with Premium Models

| Feature      | Free Models        | Premium Models    |
| ------------ | ------------------ | ----------------- |
| Cost         | Free               | Paid              |
| Open Weights | ✅ All free models | ❌ Premium models |
| Context Size | Large (200K-262K)  | Varies            |
| Tool Calling | ✅ All models      | ✅ All models     |
| Reasoning    | ✅ All models      | ✅ All models     |
| Multimodal   | ✅ kimi-k2.5-free  | Varies            |

## Implementation Notes

- All free models use the `opencode/` prefix as per Issue #1185
- Models are validated both in hive-mind and agent CLI
- Configuration is synchronized between `model-validation.lib.mjs` and `model-mapping.lib.mjs`
- Comprehensive test suite ensures compatibility and prevents regressions

## Related Documentation

- [Model Validation Library](../src/model-validation.lib.mjs) - Core model validation logic
- [Model Mapping Library](../src/model-mapping.lib.mjs) - Tool-specific model mapping
- [Agent CLI Documentation](https://github.com/link-assistant/agent) - Direct agent CLI usage
- [Free Model Tests](../tests/test-free-models.mjs) - Comprehensive test suite

---

**Last Updated**: February 9, 2026  
**Hive-Mind Version**: 1.18.0  
**Agent CLI Version**: Latest
