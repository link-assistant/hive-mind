# Case Study: Issue #1832 - Add Support for Claude Opus 4.8

## Overview

This case study documents the implementation of Claude Opus 4.8 support in Hive Mind, including setting it as the default model for the `opus` alias with `--tool claude`.

## Issue Details

- **Issue**: [#1832](https://github.com/link-assistant/hive-mind/issues/1832)
- **Title**: Add support for Claude Opus 4.8
- **Labels**: documentation, enhancement
- **Date**: May 2026
- **Pull Request**: [#1833](https://github.com/link-assistant/hive-mind/pull/1833)

## Requirements

Extracted verbatim from the issue body:

1. Claude Opus 4.8 should become the new default for `--model opus` at the `claude` tool.
2. All other models need to be supported as usual with their aliases.
3. Compile related data to `./docs/case-studies/issue-1832` and produce a deep case study analysis.
4. List each and every requirement from the issue.
5. Propose possible solutions and solution plans for each requirement.
6. Check known existing components/libraries that solve similar problems or can help.
7. Plan and execute everything in a single pull request (PR #1833 already exists in draft state).

## Model Information

### Claude Opus 4.8 Specifications

| Attribute                | Value                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------- |
| **API Model ID**         | `claude-opus-4-8`                                                                  |
| **Release Date**         | May 28, 2026                                                                       |
| **Context Window**       | 1M tokens by default on Claude API, Amazon Bedrock, Vertex AI (200K on MS Foundry) |
| **Max Output**           | 128K tokens                                                                        |
| **Pricing (Regular)**    | $5 / input MTok, $25 / output MTok                                                 |
| **Pricing (Fast Mode)**  | $10 / input MTok, $50 / output MTok (research preview)                             |
| **Adaptive Thinking**    | Yes (only supported thinking-on mode)                                              |
| **Effort Levels**        | low, medium, high (default), xhigh, max                                            |
| **Prompt Cache Minimum** | 1,024 tokens (lower than 4.7)                                                      |
| **Knowledge Cutoff**     | January 2026                                                                       |

### Key Improvements Over Opus 4.7

According to Anthropic's official release:

1. **Long-horizon agentic coding**: Better long-context handling, fewer compactions, better compaction recovery.
2. **Reasoning effort calibration**: More reliable behavior at each effort level across domains.
3. **Tool triggering**: Fewer cases of skipping a required tool call.
4. **Honesty and uncertainty flagging**: ~4x less likely to overlook code flaws.
5. **Mid-conversation system messages** (new): Accepts `role: "system"` after a user turn in the `messages` array, preserving prompt cache hits.
6. **Refusal stop details** (now publicly documented): `stop_details` object on refusal responses describes refusal category.
7. **Fast mode** (research preview): `speed: "fast"` gives up to 2.5x higher output tokens per second at premium pricing.
8. **Lower prompt cache minimum**: 1,024 tokens (lower than 4.7) — more prompts qualify for caching.
9. **Default effort = `high`**: Across the Claude API and Claude Code.
10. **Adaptive thinking improvements**: Fewer wasted thinking tokens at the same effort on bimodal workloads.

### API Constraints (Inherited from Opus 4.7 — No Breaking Changes)

Anthropic explicitly notes that code running on Opus 4.7 needs no changes for Opus 4.8:

- **Sampling parameters still rejected**: `temperature`, `top_p`, `top_k` non-default values return a 400 error.
- **Adaptive thinking only**: `thinking: {"type": "enabled", "budget_tokens": N}` still returns 400; must use `thinking: {"type": "adaptive"}` with the `effort` parameter.
- **Tools and platform features unchanged**: Same set as Opus 4.7.

### Model Hierarchy (Current Generation)

| Model             | Description                                       | API ID                      |
| ----------------- | ------------------------------------------------- | --------------------------- |
| Claude Opus 4.8   | Most capable GA model, complex reasoning & agents | `claude-opus-4-8`           |
| Claude Opus 4.7   | Previous most capable model                       | `claude-opus-4-7`           |
| Claude Opus 4.6   | Older Opus generation                             | `claude-opus-4-6`           |
| Claude Sonnet 4.6 | Best speed/intelligence ratio                     | `claude-sonnet-4-6`         |
| Claude Haiku 4.5  | Fastest, near-frontier intelligence               | `claude-haiku-4-5-20251001` |

## Existing Components & Libraries (Reuse Analysis)

This change is structurally identical to issue #1620 (Opus 4.7 support). The Hive Mind codebase already provides every primitive needed:

- **`src/models/index.mjs`**: Centralized model registry with `claudeModels`, `CLAUDE_MODELS`, `MODELS_SUPPORTING_1M_CONTEXT`, `primaryModelNames`, `defaultFallbackModels`, validation, and fuzzy suggestion helpers.
- **`src/config.lib.mjs`**: Houses Claude model classifiers (`isOpus46OrLater`, `isOpus47OrLater`), effort-level support detection (`supportsXHighEffortLevel`, `supportsMaxEffortLevel`), and the `getClaudeEnv` mapper.
- **`src/solve.config.lib.mjs`**: Centralized yargs option definitions including `--think`, `--thinking-budget`, `--show-thinking-content`, and fallback-model documentation.
- **`tests/test-opus-47-model-support.mjs`**: Comprehensive template (19 sections) covering model mapping, 1M context, effort levels, env-var translation, and cross-model think matrices.
- **`docs/case-studies/issue-1620/README.md`**: Established case-study format and structure.

No new external libraries are required. All work is additive within existing modules.

## Implementation Plan

### 1. Update Model Mappings

Add Opus 4.8 entries to `src/models/index.mjs`:

- `claudeModels` — Main model mapping module. Set `opus: 'claude-opus-4-8'`. Add `opus-4-8` and `claude-opus-4-8` keys.
- `CLAUDE_MODELS` — Validation-extended model map. Add `claude-opus-4-8` mapping to itself.
- `MODELS_SUPPORTING_1M_CONTEXT` — Add `claude-opus-4-8` and `opus-4-8`.
- `defaultFallbackModels.claude` — Add `'claude-opus-4-8': 'opus-4-7'` so unavailable 4.8 falls back to 4.7.

### 2. Add Aliases

Support the following aliases:

- `opus` -> `claude-opus-4-8` (new default)
- `opus-4-8` -> `claude-opus-4-8`
- `claude-opus-4-8` -> `claude-opus-4-8`
- `opus-4-7` -> `claude-opus-4-7` (backward compatibility — keep working)
- `claude-opus-4-7` -> `claude-opus-4-7` (backward compatibility)
- All earlier Opus aliases remain unchanged.

### 3. Enable 1M Context Support

Add Opus 4.8 to `MODELS_SUPPORTING_1M_CONTEXT` to enable `[1m]` suffix support. Per Anthropic, 1M context is the default on Opus 4.8 (no beta header required).

### 4. Update Default Model Configuration

Change `opus` alias mapping from `claude-opus-4-7` to `claude-opus-4-8` in the `claudeModels` table.

### 5. Adaptive Thinking and Effort Levels

Opus 4.8 **always uses adaptive thinking** — same constraint as Opus 4.7 — so the existing Opus 4.7 paths apply with one extension:

- **`isOpus48OrLater()`** helper added to `config.lib.mjs` to distinguish Opus 4.8+ from earlier Opus generations.
- **`isOpus47OrLater()`** updated to also match `opus-4-8` (Opus 4.8 inherits 4.7 behaviour).
- **`isOpus46OrLater()`** updated to also match `opus-4-8`.
- **`isOpus47()`** private helper updated so `xhigh` effort detection covers `opus-4-8`.
- **`MAX_THINKING_TOKENS` removed from env** for Opus 4.8 (same as 4.7 — adaptive thinking only).
- **Effort levels are unchanged**: `low`, `medium`, `high`, `xhigh`, `max`.
- **Default effort = `high`** is enforced by Claude Code itself; Hive Mind continues to set `CLAUDE_CODE_EFFORT_LEVEL` only when `--think` is explicitly provided.

#### Effort Level Mapping (hive-mind `--think` → Claude Code `CLAUDE_CODE_EFFORT_LEVEL`)

| `--think` | Opus 4.8 Effort | Opus 4.7 Effort | Opus 4.6 / Sonnet 4.6 / Mythos Effort | Opus 4.5 Effort |
| --------- | --------------- | --------------- | ------------------------------------- | --------------- |
| `off`     | (none)          | (none)          | (none)                                | (none)          |
| `low`     | `low`           | `low`           | `low`                                 | `low`           |
| `medium`  | `medium`        | `medium`        | `medium`                              | `medium`        |
| `high`    | `high`          | `high`          | `high`                                | `high`          |
| `xhigh`   | `xhigh`         | `xhigh`         | `max`                                 | `high`          |
| `max`     | `max`           | `max`           | `max`                                 | `high`          |

#### Claude Code Environment Variables for Opus 4.8

| Variable                                | Opus 4.8 Behavior                                    |
| --------------------------------------- | ---------------------------------------------------- |
| `MAX_THINKING_TOKENS`                   | Not set (removed from env; Opus 4.8 ignores it)      |
| `CLAUDE_CODE_EFFORT_LEVEL`              | Set to effort level (low/medium/high/xhigh/max)      |
| `CLAUDE_CODE_SHOW_THINKING`             | Set to `1` when `--show-thinking-content` is enabled |
| `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` | Has no effect on Opus 4.8 (always adaptive)          |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS`         | 128000 (same as Opus 4.7)                            |

### 6. Config Compatibility

The `isOpus46OrLater` function handles `opus-4-8` pattern matching once extended, so max output tokens (128K) and thinking budget settings apply automatically. The new `isOpus48OrLater` function provides finer-grained control for Opus 4.8-specific behaviour (e.g., future mid-conversation system message integration or fast mode wiring, neither of which is exposed by Claude Code today).

### 7. Documentation Updates

- Update option descriptions in `src/solve.config.lib.mjs` that mention Opus 4.7 to mention Opus 4.8 as the new default.
- Update `docs/CONFIGURATION.md` if it references Opus 4.7 as the default.
- Update `CHANGELOG.md` with a 1.74.0 entry summarising Opus 4.8 support.
- Bump `package.json` version to trigger the release workflow.

### 8. Out of Scope (Tracked for Future Issues)

The following Opus 4.8-only features are not exposed today through Claude Code or Hive Mind and are deferred:

- **Mid-conversation system messages**: Direct Messages API feature; Claude Code does not expose `role: "system"` interleaving today.
- **Fast mode** (`speed: "fast"`): Direct Messages API parameter; not currently surfaced by Claude Code CLI.
- **Refusal stop details**: Direct Messages API stop reason; not currently surfaced by Claude Code CLI.

These remain available to direct Claude API consumers and can be wired through in future hive-mind releases if Claude Code gains support.

## Sources

### Official Anthropic Documentation

- [Claude Opus 4.8 Announcement](https://www.anthropic.com/news/claude-opus-4-8)
- [What's New in Claude Opus 4.8](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-8)
- [Migrating to Claude Opus 4.8](https://platform.claude.com/docs/en/about-claude/models/migration-guide#migrating-from-claude-opus-47)
- [Adaptive Thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)
- [Effort Parameter](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Mid-conversation System Messages](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages)
- [Fast Mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode)
- [Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Handling Stop Reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)
- [Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview)

### Related Issues

- [#1221](https://github.com/link-assistant/hive-mind/issues/1221) - Original [1m] suffix and Opus support
- [#1238](https://github.com/link-assistant/hive-mind/issues/1238) - Opus 4.5/4.6 max output tokens
- [#1329](https://github.com/link-assistant/hive-mind/issues/1329) - Sonnet 4.6 default model
- [#1433](https://github.com/link-assistant/hive-mind/issues/1433) - Opus 4.6 as default for `opus` alias
- [#1620](https://github.com/link-assistant/hive-mind/issues/1620) - Opus 4.7 as default for `opus` alias (direct predecessor)

## Test Coverage

- `tests/test-opus-48-model-support.mjs` — Model and effort tests covering:
  - Default alias mapping (`opus` -> `claude-opus-4-8`)
  - Direct model ID validation (`claude-opus-4-8`)
  - Version aliases (`opus-4-8`, `claude-opus-4-8`)
  - Backward compatibility (`opus-4-7`, `claude-opus-4-7`, `opus-4-6`, `claude-opus-4-6` still work)
  - 1M context support and `[1m]` suffix
  - `isOpus46OrLater` detection covers 4.8
  - `isOpus47OrLater` detection covers 4.8
  - `isOpus48OrLater` detection (positive + negative cases)
  - Max output tokens (128K)
  - Thinking budget (31999)
  - Case insensitivity
  - Available model names listing
  - Opus 4.8 effort levels with `xhigh` and `max` support
  - `getClaudeEnv` for Opus 4.8: no `MAX_THINKING_TOKENS`, correct effort levels
  - Cross-model effort mapping matrix (4.8 alongside 4.7, 4.6, 4.5, Sonnet 4.6)
  - `--show-thinking-content` env var on Opus 4.8
