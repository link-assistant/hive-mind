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
| **Adaptive Thinking** | Yes (only supported thinking-on mode)               |
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

### 5. Adaptive Thinking and Effort Levels (Issue #1620 Comment Feedback)

Opus 4.7 **always uses adaptive thinking** — `MAX_THINKING_TOKENS` and `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` have no effect. Key changes implemented:

- **`isOpus47OrLater()`** helper function added to `config.lib.mjs` to distinguish Opus 4.7+ from Opus 4.6
- **`MAX_THINKING_TOKENS` removed from env** for Opus 4.7 (deleted from env to prevent interference)
- **`xhigh` effort level** supported: `--think xhigh` maps to `CLAUDE_CODE_EFFORT_LEVEL=xhigh` for Opus 4.7
- **`max` effort preserved**: `--think max` and full `--thinking-budget` map to `CLAUDE_CODE_EFFORT_LEVEL=max` on models that support `max`
- **Effort-capable model detection** covers Claude Mythos Preview, Opus 4.7, Opus 4.6, Sonnet 4.6, and Opus 4.5
- **`--show-thinking-content` option** added (disabled by default), sets `CLAUDE_CODE_SHOW_THINKING=1` env var

#### Effort Level Mapping (hive-mind `--think` → Claude Code `CLAUDE_CODE_EFFORT_LEVEL`)

| `--think` | Opus 4.7 Effort | Opus 4.6 / Sonnet 4.6 / Mythos Effort | Opus 4.5 Effort |
| --------- | --------------- | ------------------------------------- | --------------- |
| `off`     | (none)          | (none)                                | (none)          |
| `low`     | `low`           | `low`                                 | `low`           |
| `medium`  | `medium`        | `medium`                              | `medium`        |
| `high`    | `high`          | `high`                                | `high`          |
| `xhigh`   | `xhigh`         | `max`                                 | `high`          |
| `max`     | `max`           | `max`                                 | `high`          |

For models without effort support, such as Haiku 4.5, `--think` still controls `MAX_THINKING_TOKENS` and no `CLAUDE_CODE_EFFORT_LEVEL` is set.

Full `--thinking-budget` values map to `max` on Opus 4.7, Opus 4.6, Sonnet 4.6, and Mythos. Opus 4.5 receives `high` effort plus the requested `MAX_THINKING_TOKENS`, because Anthropic's effort table lists Opus 4.5 as effort-capable but does not list `max` for it.

#### Claude Code Environment Variables for Opus 4.7

| Variable                                | Opus 4.7 Behavior                                    |
| --------------------------------------- | ---------------------------------------------------- |
| `MAX_THINKING_TOKENS`                   | Not set (removed from env; Opus 4.7 ignores it)      |
| `CLAUDE_CODE_EFFORT_LEVEL`              | Set to effort level (low/medium/high/xhigh/max)      |
| `CLAUDE_CODE_SHOW_THINKING`             | Set to `1` when `--show-thinking-content` is enabled |
| `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` | Has no effect on Opus 4.7 (always adaptive)          |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS`         | 128000 (same as Opus 4.6)                            |

#### Claude Code CLI Flags Reference

| Flag        | Description                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `--effort`  | Set effort level: `low`, `medium`, `high`, `xhigh`, `max`; available levels depend on the model |
| `--model`   | Set model: `opus` (→ Opus 4.7), `opus-4-6`, `sonnet`, etc.                                      |
| `--verbose` | Enable verbose logging with full turn-by-turn output                                            |

### 6. Config Compatibility

The `isOpus46OrLater` function handles `opus-4-7` pattern matching, so max output tokens (128K) and thinking budget settings apply automatically. The new `isOpus47OrLater` function provides finer-grained control for Opus 4.7-specific behavior.

## Sources

### Official Anthropic Documentation

- [Claude Opus 4.7 Announcement](https://www.anthropic.com/news/claude-opus-4-7)
- [What's New in Claude Opus 4.7](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7)
- [Claude Effort Parameter](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Claude Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Migration Guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide#migrating-to-claude-opus-4-7)
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) — `--effort` flag for effort levels
- [Claude Code Environment Variables](https://code.claude.com/docs/en/env-vars) — `MAX_THINKING_TOKENS`, `CLAUDE_CODE_EFFORT_LEVEL`, `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING`
- [Claude Code Model Configuration](https://code.claude.com/docs/en/model-config) — Effort level details, adaptive reasoning per model

### Related Issues

- [#1221](https://github.com/link-assistant/hive-mind/issues/1221) - Original [1m] suffix and Opus support
- [#1238](https://github.com/link-assistant/hive-mind/issues/1238) - Opus 4.5/4.6 max output tokens
- [#1329](https://github.com/link-assistant/hive-mind/issues/1329) - Sonnet 4.6 default model
- [#1433](https://github.com/link-assistant/hive-mind/issues/1433) - Opus 4.6 as default for 'opus' alias

## Test Coverage

- `tests/test-opus-47-model-support.mjs` - model and effort tests covering:
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
  - `isOpus47OrLater` detection (9 tests: opus, opusplan, opus-4-7, claude-opus-4-7, opus-5, negatives)
  - Opus 4.7 effort levels with `xhigh` and `max` support
  - `getClaudeEnv` for Opus 4.7: no MAX_THINKING_TOKENS, correct effort levels
  - Opus 4.6 / Sonnet 4.6 / Opus 4.5 cross-model effort mapping
  - `--show-thinking-content` option: CLAUDE_CODE_SHOW_THINKING env var (3 tests)
