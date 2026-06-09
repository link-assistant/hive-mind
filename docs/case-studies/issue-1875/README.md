# Case Study: Issue #1875 - Add Support for Claude Fable 5

## Overview

This case study documents adding support for **Claude Fable 5** (`claude-fable-5`) to Hive Mind, alongside its sibling **Claude Mythos 5** (`claude-mythos-5`). Both are made selectable through the existing `--model` flag with `--tool claude`, with full support for the `[1m]` context suffix, the effort-level ladder (including `xhigh` and `max`), 128K max output tokens, adaptive-thinking-only environment handling, and documented default fallbacks.

Unlike issue #1832 (which promoted Opus 4.8 to be the **default** for the `opus` alias), this issue only asks to **add support** for a new model. Fable 5 is therefore registered as a selectable model **without changing any existing defaults** — `opus` still maps to Opus 4.8 and `sonnet` to Sonnet 4.6. This is the conservative reading of "add support" and avoids silently moving users onto a more expensive model that carries refusal classifiers.

## Issue Details

- **Issue**: [#1875](https://github.com/link-assistant/hive-mind/issues/1875)
- **Title**: Add support for Claude Fable 5
- **Labels**: documentation, enhancement
- **Author**: konard (Konstantin Diachenko)
- **Created**: 2026-06-09
- **Pull Request**: [#1876](https://github.com/link-assistant/hive-mind/pull/1876)
- **Reference link in issue**: https://platform.claude.com/docs/en/about-claude/models/overview

## Requirements

Extracted from the issue body:

1. **Add support for Claude Fable 5** (the issue title) — register the model so it is selectable via `--model` for the `claude` tool, following the established pattern used for prior Claude models.
2. **Collect related data** into `./docs/case-studies/issue-1875` (see `data/` subfolder).
3. **Do a deep case study analysis**, including searching online for additional facts and data.
4. **List each and all requirements** from the issue (this section).
5. **Propose possible solutions and solution plans** for each requirement, checking known existing components/libraries that solve a similar problem.
6. **Plan and execute everything in a single pull request** (PR #1876 already exists) until every requirement is fully addressed.

### Interpretation Decision

The title says "Add support", not "Make default". Fable 5 is the more expensive, safety-classified model. The implemented change therefore:

- Adds `fable`, `fable-5`, `claude-fable-5` as selectable aliases.
- Additionally adds `mythos-5` / `claude-mythos-5` (the un-classified sibling) for forward compatibility, since both ship together and share identical API constraints.
- **Leaves `opus`, `sonnet`, `haiku`, and `opusplan` defaults unchanged.**
- Adds `fable` to the primary (recommended) model names shown in CLI help so users discover it.

## Model Information

### Claude Fable 5 Specifications

| Attribute               | Value                                                                          |
| ----------------------- | ------------------------------------------------------------------------------ |
| **API Model ID**        | `claude-fable-5`                                                               |
| **Class**               | Mythos-class model wrapped in safety classifiers                               |
| **Availability**        | Generally available, June 9, 2026                                              |
| **Context Window**      | 1M tokens by default                                                           |
| **Max Output**          | 128K tokens                                                                    |
| **Pricing**             | $10 / input MTok, $50 / output MTok                                            |
| **Adaptive Thinking**   | Always on (only supported thinking mode; manual/extended thinking unavailable) |
| **Effort Levels**       | low, medium, high (default), xhigh, max                                        |
| **Safety Classifiers**  | Yes — can refuse high-risk requests (`stop_reason: "refusal"`, HTTP 200)       |
| **Documented Fallback** | Falls back to Claude Opus 4.8 on classifier refusal                            |

### Claude Mythos 5 Specifications

| Attribute              | Value                                             |
| ---------------------- | ------------------------------------------------- |
| **API Model ID**       | `claude-mythos-5`                                 |
| **Class**              | Mythos-class model **without** safety classifiers |
| **Availability**       | Limited availability (Project Glasswing)          |
| **Context Window**     | 1M tokens by default                              |
| **Max Output**         | 128K tokens                                       |
| **Adaptive Thinking**  | Always on (same constraint as Fable 5)            |
| **Effort Levels**      | low, medium, high (default), xhigh, max           |
| **Safety Classifiers** | No (un-classified sibling of Fable 5)             |

### API Constraints (Shared by Fable 5 and Mythos 5)

- **Adaptive thinking only**: extended/manual thinking is unavailable and `thinking: {type: "disabled"}` is **rejected**. Consequently `MAX_THINKING_TOKENS` (including `MAX_THINKING_TOKENS=0`) must **not** be sent — the env var has to be removed, exactly as for Opus 4.7/4.8.
- **Effort parameter** drives reasoning depth across `low`/`medium`/`high`/`xhigh`/`max`, default `high`.
- **1M context window** by default.
- **128K max output tokens**.

### Distinction from Claude Mythos Preview

The codebase already had an `isMythosPreview` classifier (matching any `mythos` substring) that grants base effort support and `max`, but **not** `xhigh`. Claude Mythos 5 **does** support `xhigh`. A dedicated `isMythos5` classifier was therefore added so that `supportsXHighEffortLevel` returns `true` for Mythos 5 specifically, while Mythos Preview behaviour is left unchanged.

### Model Hierarchy (Current Generation)

| Model             | Description                                            | API ID                      | Default alias?  |
| ----------------- | ------------------------------------------------------ | --------------------------- | --------------- |
| Claude Fable 5    | Most capable widely released (Mythos-class) model, GA  | `claude-fable-5`            | No (`fable`)    |
| Claude Mythos 5   | Un-classified sibling of Fable 5, limited availability | `claude-mythos-5`           | No (`mythos-5`) |
| Claude Opus 4.8   | Most capable GA Opus model, default for `opus`         | `claude-opus-4-8`           | Yes (`opus`)    |
| Claude Sonnet 4.6 | Best speed/intelligence ratio, default for `sonnet`    | `claude-sonnet-4-6`         | Yes (`sonnet`)  |
| Claude Haiku 4.5  | Fastest, near-frontier intelligence                    | `claude-haiku-4-5-20251001` | Yes (`haiku`)   |

## Existing Components & Libraries (Reuse Analysis)

This change is structurally similar to issue #1832 (Opus 4.8) and #1620 (Opus 4.7). The codebase already provides every primitive needed — **no new external libraries are required**, all work is additive:

- **`src/models/index.mjs`** — Centralized model registry: `claudeModels`, `CLAUDE_MODELS`, `MODELS_SUPPORTING_1M_CONTEXT`, `primaryModelNames`, `defaultFallbackModels`, plus validation (`validateModelName`), fuzzy suggestion, and `resolveDefaultFallbackModel`. This is the single source of truth; `src/claude.lib.mjs` imports `CLAUDE_MODELS` as `availableModels`, so registering aliases cascades automatically with **no edit to `claude.lib.mjs`**.
- **`src/config.lib.mjs`** — Claude model classifiers (`isOpus46OrLater`, `isOpus47OrLater`, `isMythosPreview`, …), effort-level detection (`supportsEffortLevel`, `supportsXHighEffortLevel`, `supportsMaxEffortLevel`), `getMaxOutputTokensForModel`, and the `getClaudeEnv` env mapper.
- **`src/solve.config.lib.mjs`** — Centralized yargs option definitions for `--think`, `--thinking-budget`, and `--fallback-model` documentation.
- **`src/model-info.lib.mjs`** — Fetches model metadata from the models.dev API only; it holds **no local model map**, so **no edit is required** there.
- **`tests/test-opus-48-model-support.mjs`** — Comprehensive test template (20 sections) reused as the structural basis for `tests/test-fable-5-model-support.mjs`.
- **`docs/case-studies/issue-1832/README.md`** — Established case-study format reused for this document.

## Implementation Plan & Executed Changes

### 1. Register Model Aliases (`src/models/index.mjs`)

Added to `claudeModels`:

```js
fable: 'claude-fable-5',
'fable-5': 'claude-fable-5',
'claude-fable-5': 'claude-fable-5',
'mythos-5': 'claude-mythos-5',
'claude-mythos-5': 'claude-mythos-5',
```

Added `claude-fable-5` and `claude-mythos-5` self-mappings to `CLAUDE_MODELS` (validation-extended map). Defaults (`opus`, `sonnet`, `haiku`, `opusplan`) were **not** touched.

### 2. Enable 1M Context (`MODELS_SUPPORTING_1M_CONTEXT`)

Added `claude-fable-5`, `claude-mythos-5`, `fable`, `fable-5`, and `mythos-5` so the `[1m]` suffix validates and resolves (e.g. `fable[1m]` -> `claude-fable-5[1m]`).

### 3. Discoverability (`primaryModelNames`)

Changed `claude: ['opus', 'sonnet', 'haiku', 'opusplan']` to include `'fable'` so Fable 5 appears in `--model` help text.

### 4. Default Fallbacks (`defaultFallbackModels.claude`)

```js
'claude-fable-5': 'opus',   // mirrors the documented Fable 5 -> Opus 4.8 safety fallback
'claude-mythos-5': 'fable', // limited-availability Mythos 5 -> generally available Fable 5
```

This mirrors the documented behaviour: Fable 5's classifiers hand high-risk requests off to Opus 4.8.

### 5. Model Classifiers (`src/config.lib.mjs`)

Added three exported helpers:

- `isFable5(model)` — matches `fable`, `fable-5`, `claude-fable-5`.
- `isMythos5(model)` — matches `mythos-5`, `claude-mythos-5` (the `-5`/`5` form specifically, so it grants `xhigh` which Mythos Preview lacks).
- `isFable5OrMythos5(model)` — union of the two.

Wired them into:

- `supportsEffortLevel` — Fable 5 / Mythos 5 support the effort ladder.
- `supportsXHighEffortLevel` — Fable 5 / Mythos 5 (plus Opus 4.7) support `xhigh`.
- `supportsMaxEffortLevel` — Fable 5 / Mythos 5 support `max`.
- `getMaxOutputTokensForModel` — returns 128K (`maxOutputTokensOpus46`) for Fable 5 / Mythos 5.
- `getClaudeEnv` — renamed the internal `opus47` flag to `adaptiveThinkingOnly = isOpus47OrLater(model) || isFable5OrMythos5(model)`; when set, `MAX_THINKING_TOKENS` is **deleted** from the env (never `=0`), because these models reject disabled thinking.

### 6. Documentation Strings (`src/solve.config.lib.mjs`)

- `--think` description now reads "Fable 5/Mythos 5/Opus 4.8/4.7 support xhigh and max; Opus 4.6/Sonnet 4.6/Mythos Preview support max".
- `--fallback-model` description now documents the new defaults (`claude fable/claude-fable-5 -> opus`; `claude mythos-5/claude-mythos-5 -> fable`) and notes the Fable 5 safety-classifier refusal trigger.

#### Effort Level Mapping (`--think` → `CLAUDE_CODE_EFFORT_LEVEL`)

| `--think` | Fable 5 / Mythos 5 | Opus 4.8 / 4.7 | Opus 4.6 / Sonnet 4.6 / Mythos Preview | Opus 4.5 |
| --------- | ------------------ | -------------- | -------------------------------------- | -------- |
| `off`     | (none)             | (none)         | (none)                                 | (none)   |
| `low`     | `low`              | `low`          | `low`                                  | `low`    |
| `medium`  | `medium`           | `medium`       | `medium`                               | `medium` |
| `high`    | `high`             | `high`         | `high`                                 | `high`   |
| `xhigh`   | `xhigh`            | `xhigh`        | `max`                                  | `high`   |
| `max`     | `max`              | `max`          | `max`                                  | `high`   |

#### Claude Code Environment Variables for Fable 5 / Mythos 5

| Variable                        | Behavior                                             |
| ------------------------------- | ---------------------------------------------------- |
| `MAX_THINKING_TOKENS`           | Not set (removed from env; rejected by these models) |
| `CLAUDE_CODE_EFFORT_LEVEL`      | Set to effort level (low/medium/high/xhigh/max)      |
| `CLAUDE_CODE_SHOW_THINKING`     | Set to `1` when `--show-thinking-content` is enabled |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | 128000                                               |

### 7. Out of Scope (Deferred)

- **Safety classifier refusal handling at runtime**: Fable 5 returns `stop_reason: "refusal"` (HTTP 200) for high-risk prompts. Surfacing/auto-retrying against the fallback model at the orchestration layer depends on Claude Code CLI exposing the refusal stop reason, which it does not today. The documented default fallback (`claude-fable-5 -> opus`) is registered so the wiring is ready when the CLI surfaces it.
- **Changing any default alias**: explicitly out of scope per the interpretation decision above.

## Online Research

Authoritative facts were gathered from Anthropic's official model documentation and announcement material for the June 9, 2026 Fable 5 / Mythos 5 release. Key confirmed facts used in this implementation:

- Fable 5 (`claude-fable-5`) is a Mythos-class model wrapped in safety classifiers; GA June 9, 2026.
- Mythos 5 (`claude-mythos-5`) is the un-classified sibling, limited availability via Project Glasswing.
- Both: 1M context, 128K output, effort `low`–`max` including `xhigh`, default `high`, adaptive-thinking-only.
- Fable 5 pricing $10 / $50 per MTok.
- Fable 5 classifiers refuse high-risk queries (cyber/bio/chem/uplift categories) with `stop_reason: "refusal"` and fall back to Opus 4.8.

### Sources

- [Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview) (link from the issue)
- [Introducing Claude Fable 5 and Claude Mythos 5](https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5)
- [Adaptive Thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)
- [Effort Parameter](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Handling Stop Reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)

### Related Issues

- [#1221](https://github.com/link-assistant/hive-mind/issues/1221) - Original `[1m]` suffix and Opus support
- [#1238](https://github.com/link-assistant/hive-mind/issues/1238) - Opus 4.5/4.6 max output tokens & effort levels
- [#1329](https://github.com/link-assistant/hive-mind/issues/1329) - Sonnet 4.6 default model
- [#1620](https://github.com/link-assistant/hive-mind/issues/1620) - Opus 4.7 support (adaptive-thinking-only precedent)
- [#1832](https://github.com/link-assistant/hive-mind/issues/1832) - Opus 4.8 support (direct structural predecessor)

## Data Inventory

Files compiled under `docs/case-studies/issue-1875/data/`:

| File                       | Contents                                                  |
| -------------------------- | --------------------------------------------------------- |
| `issue-1875.json`          | The GitHub issue payload (title, body, labels, author).   |
| `issue-1875-comments.json` | Issue comments (empty — no comments at time of analysis). |
| `pr-1876.json`             | The pull request payload for PR #1876.                    |

## Test Coverage

`tests/test-fable-5-model-support.mjs` — 127 tests across 12 sections:

1. Fable 5 alias resolution (`fable`, `fable-5`, `claude-fable-5`) via `claudeModels`, `CLAUDE_MODELS`, `availableModels`, `validateModelName`, `mapModelToId`.
2. Mythos 5 alias resolution (`mythos-5`, `claude-mythos-5`).
3. `isFable5` / `isMythos5` / `isFable5OrMythos5` classifier helpers (positive + negative cases).
4. 1M context support and the `[1m]` suffix.
5. Effort-level support, including `xhigh` and `max`.
6. 128K max output tokens.
7. Adaptive-thinking-only env handling (`MAX_THINKING_TOKENS` deleted, including inherited values).
8. Default fallback models (`claude-fable-5 -> opus`, `claude-mythos-5 -> fable`).
9. Available / primary model names listing.
10. Case insensitivity (`FABLE`, `CLAUDE-FABLE-5`, `MYTHOS-5`).
11. Backward compatibility (`opus`, `sonnet`, `opus-4-8` fallback, Haiku output tokens unchanged).
12. Cross-model `--think` level matrix for all four Fable 5 / Mythos 5 aliases.

Run with:

```bash
node tests/test-fable-5-model-support.mjs
```

## Verification

- `node tests/test-fable-5-model-support.mjs` → **127 passed, 0 failed**.
- `node tests/test-opus-48-model-support.mjs` → all passed (no regression).
- `node tests/test-opus-47-model-support.mjs` / `test-opus-46-model-support.mjs` → all passed (no regression).
- Manual resolution check confirms: `fable`/`fable-5`/`claude-fable-5` -> `claude-fable-5`; `mythos-5`/`claude-mythos-5` -> `claude-mythos-5`; 1M, effort (xhigh+max), 128K output, fallback (`opus`/`fable`), and `MAX_THINKING_TOKENS` removal all behave as specified.
