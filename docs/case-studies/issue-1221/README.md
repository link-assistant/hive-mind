# Case Study: Claude Opus 4.6 Model Support

## Issue Reference

- **Issue**: https://github.com/link-assistant/hive-mind/issues/1221
- **Title**: Claude Opus 4.6 model support
- **Author**: konard
- **Labels**: enhancement

## Executive Summary

This case study documents the implementation of Claude Opus 4.6 model support in hive-mind, including:

1. Adding `claude-opus-4-6` as the default model for the `opus` alias
2. Adding `claude-opus-4-5` alias for backward compatibility
3. Supporting the `[1m]` suffix for 1 million token context window
4. Updating max output tokens (128k for Opus 4.6) and thinking budget (64k)

## Requirements Analysis

### From Issue Description

1. **Default model change**: `--model opus` should now use `claude-opus-4-6` (previously `claude-opus-4-5-20251101`)
2. **Direct model support**: `--model claude-opus-4-6` should work
3. **Backward compatibility alias**: `--model claude-opus-4-5` should map to `claude-opus-4-5-20251101`
4. **Specific model IDs**: All date-stamped models (e.g., `claude-opus-4-5-20251101`) should continue to work
5. **Max output tokens**: Opus 4.6 supports 128k output tokens (up from 64k)
6. **Thinking budget**: Default thinking budget should be increased to 64k for Opus 4.6
7. **[1m] suffix support**: Support for 1 million context window via `[1m]` suffix (e.g., `opus[1m]`, `claude-opus-4-6[1m]`)

## Research Findings

### Model Specifications (from platform.claude.com)

| Feature                       | Claude Opus 4.6          | Claude Opus 4.5            |
| ----------------------------- | ------------------------ | -------------------------- |
| **API ID**                    | `claude-opus-4-6`        | `claude-opus-4-5-20251101` |
| **API Alias**                 | `claude-opus-4-6`        | `claude-opus-4-5`          |
| **Context Window**            | 200K / 1M (beta)         | 200K                       |
| **Max Output**                | 128K tokens              | 64K tokens                 |
| **Extended Thinking**         | Yes                      | Yes                        |
| **Adaptive Thinking**         | Yes                      | No                         |
| **Effort Levels**             | low/medium/high          | N/A                        |
| **Pricing**                   | $5/M input, $25/M output | $5/M input, $25/M output   |
| **Reliable Knowledge Cutoff** | May 2025                 | May 2025                   |
| **Training Data Cutoff**      | Aug 2025                 | Aug 2025                   |

### Claude Code Integration (from code.claude.com/docs)

#### Model Aliases in Claude Code

- `opus` -> Latest Opus (currently Opus 4.6)
- `sonnet` -> Latest Sonnet (currently Sonnet 4.5)
- `haiku` -> Fast and efficient Haiku
- `sonnet[1m]` -> Sonnet with 1M context
- `opusplan` -> Opus for planning, Sonnet for execution

#### 1M Context Window ([1m] suffix)

- Available for Opus 4.6 and Sonnet 4.5
- Requires `context-1m-2025-08-07` beta header for API usage
- Can be used with aliases: `sonnet[1m]`, `opus[1m]`
- Can be used with full model names: `claude-opus-4-6[1m]`
- Different pricing applies for requests exceeding 200K tokens

#### Effort Level (Opus 4.6 only)

- Controls adaptive reasoning depth
- Three levels: `low`, `medium`, `high` (default)
- Set via `/model` slider, `CLAUDE_CODE_EFFORT_LEVEL` env var, or `effortLevel` setting

### Key Differences from Opus 4.5

1. **Adaptive Thinking**: Opus 4.6 has adaptive thinking, 4.5 does not
2. **Effort Levels**: Only Opus 4.6 supports effort level adjustment
3. **Max Output**: 128K (4.6) vs 64K (4.5)
4. **1M Context**: Opus 4.6 supports 1M context, 4.5 does not

## Implementation Plan

### Files to Modify

1. **src/model-validation.lib.mjs**
   - Add `claude-opus-4-6` to CLAUDE_MODELS
   - Add `claude-opus-4-5` alias for backward compatibility
   - Update `opus` alias to use `claude-opus-4-6`
   - Add support for `[1m]` suffix parsing and validation

2. **src/claude.lib.mjs**
   - Update `availableModels` object
   - Add `mapModelToId` logic for `[1m]` suffix handling
   - Potentially update output token handling for Opus 4.6

3. **src/model-mapping.lib.mjs**
   - Update `claudeModels` object with new aliases

4. **src/config.lib.mjs**
   - Consider updating default max output tokens for Opus 4.6 (128k)
   - Consider updating default thinking budget for Opus 4.6 (64k)

### Implementation Approach

1. **[1m] Suffix Handling**
   - Parse model name to extract base model and `[1m]` suffix
   - Validate base model against CLAUDE_MODELS
   - Reconstruct full model name with suffix for API call
   - Only allow `[1m]` suffix for supported models (Opus 4.6, Sonnet 4.5)

2. **Backward Compatibility**
   - Keep `claude-opus-4-5-20251101` working
   - Add `claude-opus-4-5` as alias pointing to `claude-opus-4-5-20251101`
   - Ensure existing workflows don't break

3. **Configuration Updates**
   - Consider model-specific max output tokens
   - Consider model-specific thinking budgets

## External References

- [Claude Model Configuration](https://code.claude.com/docs/en/model-config)
- [Claude Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Claude Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Extended Thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [1M Context Window](https://platform.claude.com/docs/en/build-with-claude/context-windows#1m-token-context-window)

## Risk Assessment

### Low Risk

- Adding new model aliases (purely additive)
- Updating default `opus` to point to new model

### Medium Risk

- `[1m]` suffix parsing (new feature, needs thorough testing)
- Changing default thinking budget (may affect performance)

### Mitigation

- Comprehensive test coverage for all model aliases
- Test `[1m]` suffix with various model combinations
- Document breaking changes in PR description

## Test Plan

1. **Unit Tests**
   - Validate `claude-opus-4-6` is accepted
   - Validate `claude-opus-4-5` maps to `claude-opus-4-5-20251101`
   - Validate `opus` maps to `claude-opus-4-6`
   - Validate `[1m]` suffix parsing for supported models
   - Validate `[1m]` suffix rejected for unsupported models

2. **Integration Tests**
   - Run actual Claude CLI with new model
   - Verify `--model opus` works correctly
   - Verify `--model opus[1m]` works correctly

3. **Regression Tests**
   - All existing model aliases still work
   - All date-stamped model IDs still work
