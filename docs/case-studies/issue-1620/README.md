# Case Study: Issue #1620 - Add Full Support for Opus 4.7

## Overview

This case study documents the implementation of Claude Opus 4.7 support in Hive Mind, including setting it as the default model for the `opus` alias with `--tool claude`.

## Issue Details

- **Issue**: [#1620](https://github.com/link-assistant/hive-mind/issues/1620)
- **Title**: Add full support for Opus 4.7
- **Labels**: documentation, enhancement
- **Date**: April 2026

## Model Information

### Claude Opus 4.7 Specifications

| Attribute             | Value                                               |
| --------------------- | --------------------------------------------------- |
| **API Model ID**      | `claude-opus-4-7`                                   |
| **Release Date**      | April 16, 2026                                      |
| **Context Window**    | 200K tokens (default) / 1M tokens (standard API)    |
| **Max Output**        | 128K tokens                                         |
| **Pricing**           | $5 / input MTok, $25 / output MTok                  |
| **Extended Thinking** | Removed (replaced by Adaptive Thinking)             |
| **Adaptive Thinking** | Yes (off by default, must be explicitly enabled)    |
| **Effort Levels**     | low, medium, high, xhigh (new), max                 |
| **Task Budgets**      | Yes (beta, advisory token budget for agentic loops) |

### Key Improvements Over Opus 4.6

According to Anthropic's official release:

1. **High-Resolution Image Support**: Maximum image resolution increased to 2576px / 3.75MP (from 1568px / 1.15MP), with 1:1 coordinate mapping
2. **Knowledge Work**: Improved .docx redlining, .pptx editing, charts/figure analysis
3. **Memory**: Better at writing and using file-system-based memory for agents
4. **Literal Instruction Following**: More precise, less implicit generalization
5. **New `xhigh` Effort Level**: Optimized for coding and agentic use cases
6. **Task Budgets (Beta)**: Advisory token budgets across full agentic loops

### Breaking Changes in Opus 4.7

1. **Extended thinking budgets removed**: `thinking: {"type": "enabled", "budget_tokens": N}` returns 400 error. Must use `thinking: {"type": "adaptive"}` instead.
2. **Sampling parameters removed**: `temperature`, `top_p`, `top_k` non-default values return 400 error.
3. **Thinking content omitted by default**: Must set `display: "summarized"` to see thinking blocks.
4. **Updated tokenizer**: May use 1.0-1.35x more tokens for the same text content.

### Model Hierarchy (Current Generation)

| Model             | Description                                       | API ID                      |
| ----------------- | ------------------------------------------------- | --------------------------- |
| Claude Opus 4.7   | Most capable GA model, complex reasoning & agents | `claude-opus-4-7`           |
| Claude Opus 4.6   | Previous most capable model                       | `claude-opus-4-6`           |
| Claude Sonnet 4.6 | Best speed/intelligence ratio                     | `claude-sonnet-4-6`         |
| Claude Haiku 4.5  | Fastest, near-frontier intelligence               | `claude-haiku-4-5-20251001` |

## Implementation Plan

### 1. Update Model Mappings

Add Opus 4.7 entries to `src/models/index.mjs`:

- `claudeModels` - Main model mapping module
- `CLAUDE_MODELS` - Validation-extended model map
- `MODELS_SUPPORTING_1M_CONTEXT` - 1M context support list

### 2. Add Aliases

Support the following aliases:

- `opus` -> `claude-opus-4-7` (new default)
- `opus-4-7` -> `claude-opus-4-7`
- `claude-opus-4-7` -> `claude-opus-4-7`
- `opus-4-6` -> `claude-opus-4-6` (backward compatibility)
- `claude-opus-4-6` -> `claude-opus-4-6` (backward compatibility)

### 3. Enable 1M Context Support

Add Opus 4.7 to `MODELS_SUPPORTING_1M_CONTEXT` to enable `[1m]` suffix support. Opus 4.7 provides 1M context at standard API pricing with no long-context premium.

### 4. Update Default Model Configuration

Change `opus` alias mapping from `claude-opus-4-6` to `claude-opus-4-7`.

### 5. Config Compatibility

The `isOpus46OrLater` function already handles `opus-4-7` pattern matching, so max output tokens (128K) and thinking budget settings apply automatically.

## Sources

### Official Anthropic Documentation

- [Claude Opus 4.7 Announcement](https://www.anthropic.com/news/claude-opus-4-7)
- [What's New in Claude Opus 4.7](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7)
- [Claude Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Migration Guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide#migrating-to-claude-opus-4-7)

### Related Issues

- [#1221](https://github.com/link-assistant/hive-mind/issues/1221) - Original [1m] suffix and Opus support
- [#1238](https://github.com/link-assistant/hive-mind/issues/1238) - Opus 4.5/4.6 max output tokens
- [#1329](https://github.com/link-assistant/hive-mind/issues/1329) - Sonnet 4.6 default model
- [#1433](https://github.com/link-assistant/hive-mind/issues/1433) - Opus 4.6 as default for 'opus' alias

## Test Coverage

- `tests/test-opus-47-model-support.mjs` - 41 tests covering:
  - Default alias mapping (opus -> claude-opus-4-7)
  - Direct model ID validation
  - Version aliases (opus-4-7, claude-opus-4-7)
  - Backward compatibility (opus-4-6, claude-opus-4-6 still work)
  - 1M context support and [1m] suffix
  - isOpus46OrLater detection
  - Max output tokens (128K)
  - Thinking budget (31999)
  - Case insensitivity
  - Available model names listing
