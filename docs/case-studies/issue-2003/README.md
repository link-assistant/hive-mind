# Case Study: Issue #2003 - Fully Support Current Claude Models & Make Sonnet 5 the Default

## Overview

This case study documents two closely related changes for Hive Mind:

1. **Add support for Claude Sonnet 5** (`claude-sonnet-5`) — Anthropic's newly released Sonnet-generation model — as a selectable model via `--model` for `--tool claude`, with full support for the `[1m]` context suffix, the effort-level ladder (including `xhigh` and `max`), 128K max output tokens, adaptive-thinking-only environment handling, and a documented default fallback.
2. **Promote Sonnet 5 to be the default** for `--tool claude` by remapping the bare `sonnet` alias from `claude-sonnet-4-6` to `claude-sonnet-5`.

Unlike issue #1875 (which only _added_ Fable 5 without changing defaults), this issue explicitly asks to _change the default_ — the title says "update `sonnet` alias to point to `claude-sonnet-5` (making it default model for `--tool claude`)". This is the same kind of change that issue #1832 made for the `opus` alias (Opus 4.7 → Opus 4.8).

## Issue Details

- **Issue**: [#2003](https://github.com/link-assistant/hive-mind/issues/2003)
- **Title**: Make sure we fully support all models Claude Code CLI currently support, and also update `sonnet` alias to point to `claude-sonnet-5` (making it default model for `--tool claude`)
- **Labels**: documentation, enhancement
- **Author**: konard (Konstantin Diachenko)
- **Created**: 2026-07-01
- **Pull Request**: [#2004](https://github.com/link-assistant/hive-mind/pull/2004)
- **Reference links in issue body**:
  - https://www.anthropic.com/news/claude-sonnet-5
  - https://www.anthropic.com/news/redeploying-fable-5

## Requirements

### From the issue title (the concrete, testable requirements)

- **R1 — Full model coverage.** "Make sure we fully support all models Claude Code CLI currently support." Ensure the current Claude model line-up is fully registered and selectable, including the newly released **Claude Sonnet 5** and the **redeployed Fable 5**.
- **R2 — Default remap.** "Update `sonnet` alias to point to `claude-sonnet-5` (making it default model for `--tool claude`)." The bare `sonnet` alias must resolve to `claude-sonnet-5`, and because `defaultModels.claude === 'sonnet'`, that makes Sonnet 5 the default model for the claude tool.

### From the issue body (process requirements, boilerplate template)

- **R3 — Collect related data** into `./docs/case-studies/issue-2003/` (see `data/` subfolder).
- **R4 — Deep case study analysis**, including searching online for additional facts and data.
- **R5 — List each and all requirements** from the issue (this section).
- **R6 — Propose solutions/plans** for each requirement, checking existing components/libraries that solve a similar problem.
- **R7 — Plan and execute everything in the single PR #2004** until every requirement is fully addressed.

## Model Information

### Claude Sonnet 5 Specifications

Authoritative values from the [models.dev](https://models.dev/api.json) registry (the same source Hive Mind already uses for pricing/specs) and Anthropic's announcement:

| Attribute          | Value                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------- |
| **API Model ID**   | `claude-sonnet-5`                                                                       |
| **Context Window** | 1,000,000 tokens                                                                        |
| **Max Output**     | 128,000 tokens                                                                          |
| **Pricing**        | $2 / input MTok, $10 / output MTok (cache read $0.20, cache write $2.50)                |
| **Reasoning**      | Yes (effort levels)                                                                     |
| **Effort Levels**  | low, medium, high (default), **xhigh**, max                                             |
| **Thinking Mode**  | Adaptive thinking only (`temperature: false` in models.dev → no manual/extended budget) |
| **Announcement**   | https://www.anthropic.com/news/claude-sonnet-5                                          |

### How Sonnet 5 differs from Sonnet 4.6

The distinction matters because it drives which capability classifier each model uses:

| Attribute         | Sonnet 4.6 (`claude-sonnet-4-6`) | Sonnet 5 (`claude-sonnet-5`)           |
| ----------------- | -------------------------------- | -------------------------------------- |
| Max output tokens | 64,000                           | **128,000**                            |
| `xhigh` effort    | Not supported                    | **Supported**                          |
| Thinking mode     | `MAX_THINKING_TOKENS` (manual)   | **Adaptive-thinking-only** (no budget) |
| Input / output $  | $3 / $15                         | **$2 / $10** (cheaper)                 |
| Context window    | 1M                               | 1M                                     |

Because Sonnet 5 is cheaper, has a larger output ceiling, and reasons more capably, promoting it to the default for `--tool claude` is a strict improvement for most users.

### Fable 5 redeployment

The issue also links Anthropic's ["Redeploying Fable 5"](https://www.anthropic.com/news/redeploying-fable-5) note. Fable 5 (`claude-fable-5`) and its sibling Mythos 5 were already fully supported in Hive Mind by issue #1875 (aliases, `[1m]`, effort ladder incl. `xhigh`/`max`, 128K output, adaptive-thinking-only handling, and the documented Opus 4.8 fallback). The redeployment does not change the model ID or its API constraints, so **no code change is required for Fable 5** — its existing registration already satisfies R1. This case study records that verification so the "full coverage" requirement is explicitly closed rather than silently assumed.

## Current Claude Model Coverage (post-change)

| Alias(es)                               | Resolves to                  | Notes                               |
| --------------------------------------- | ---------------------------- | ----------------------------------- |
| `sonnet`, `sonnet-5`, `claude-sonnet-5` | `claude-sonnet-5`            | **New default** (Issue #2003)       |
| `sonnet-4-6`, `claude-sonnet-4-6`       | `claude-sonnet-4-6`          | Retained for backward compatibility |
| `sonnet-4-5`, `claude-sonnet-4-5`       | `claude-sonnet-4-5-20250929` | Retained                            |
| `opus`, `opus-4-8`, `claude-opus-4-8`   | `claude-opus-4-8`            | Default opus (Issue #1832)          |
| `opus-4-7` … `opus-4-5`                 | corresponding IDs            | Retained                            |
| `haiku`, `haiku-4-5`                    | `claude-haiku-4-5-20251001`  | Retained                            |
| `haiku-3-5`, `haiku-3`                  | legacy IDs                   | Retained                            |
| `fable`, `fable-5`, `claude-fable-5`    | `claude-fable-5`             | Supported (Issue #1875)             |
| `mythos-5`, `claude-mythos-5`           | `claude-mythos-5`            | Supported (Issue #1875)             |
| `opusplan`                              | opusplan mode                | Opus plans, Sonnet executes         |

## Solution Plan (per requirement) & existing components used

The codebase already has a well-factored, single-source-of-truth model layer (built up over issues #1221/#1329/#1620/#1832/#1875). The change reuses those existing components rather than adding new machinery:

**R2 (default remap) + R1 (coverage) — `src/models/index.mjs`**

- Change `claudeModels.sonnet` from `claude-sonnet-4-6` → `claude-sonnet-5`.
- Add short alias `sonnet-5` and full-ID identity `claude-sonnet-5` (the `CLAUDE_MODELS` map inherits it via the `claudeModels` spread).
- Add `claude-sonnet-5` and `sonnet-5` to `MODELS_SUPPORTING_1M_CONTEXT` so `[1m]` works.
- Add `defaultFallbackModels.claude['claude-sonnet-5'] = 'sonnet-4-6'` (mirrors the Opus fallback chain).
- `defaultModels.claude` stays `'sonnet'` and `primaryModelNames.claude` still lists `sonnet`, so the default automatically follows the remapped alias.

**R1 (capabilities) — `src/config.lib.mjs`**

- Add an `isSonnet5` classifier (Sonnet 5 needs _different_ behavior from Sonnet 4.6, so it cannot reuse `isSonnet46OrLater` for these three decisions):
  - `supportsXHighEffortLevel` → include `isSonnet5` (Sonnet 5 supports `xhigh`).
  - `getMaxOutputTokensForModel` → return 128K for `isSonnet5` (matches the Opus 4.6+ ceiling constant `maxOutputTokensOpus46`).
  - `getClaudeEnv` `adaptiveThinkingOnly` → include `isSonnet5` so `MAX_THINKING_TOKENS` is not set (Sonnet 5 rejects a manual thinking budget).
- Effort/max support already flow through the existing `isSonnet46OrLater` (which matches `sonnet-5`), so `supportsEffortLevel` / `supportsMaxEffortLevel` need no change.

**R1 (escalation) — `src/solve.escalate.lib.mjs`**

- Add `sonnet-5` and `claude-sonnet-5` to `TIER_ALIASES` → `sonnet` tier, so `--escalate-from`/`--escalate-to` accept the new aliases.

**R1 (docs/help) — `src/solve.config.lib.mjs`**

- Update the `--think` option description so Sonnet 5 appears in the `xhigh`-capable list.

**R1 (regression safety) — tests**

- New `tests/test-sonnet-5-model-support.mjs` (comprehensive: alias resolution, `[1m]`, `isSonnet5`, effort levels, 128K output, adaptive-thinking-only env, fallback, escalate tier, backward compat).
- Update pre-existing tests whose assertions assumed bare `sonnet` = Sonnet 4.6. Explicit `sonnet-4-6` assertions were preserved (and, where a test exercised the manual-thinking path, switched to the explicit `sonnet-4-6` alias so that behavior stays covered).

**R7 — single PR + release trigger**

- All changes land in PR #2004. A `.changeset/` entry is added so the automated release picks up the change.

## Why a dedicated `isSonnet5` classifier (not just reusing `isSonnet46OrLater`)

`isSonnet46OrLater` already returns `true` for `sonnet-5`, which is correct for "does this support effort/max levels". But three behaviors differ between Sonnet 4.6 and Sonnet 5 (output ceiling, `xhigh`, adaptive-only thinking). Overloading `isSonnet46OrLater` for those would incorrectly grant Sonnet 4.6 the 128K ceiling and `xhigh`, and would break Sonnet 4.6's manual `MAX_THINKING_TOKENS` path. A separate, narrow `isSonnet5` predicate keeps each model's behavior exact — the same pattern the codebase already uses to separate `isOpus47`, `isFable5OrMythos5`, etc.

## Verification

- New and updated model-support tests pass (`test-sonnet-5-model-support.mjs`, `test-sonnet-46-model-support.mjs`, `test-opus-46/47/48-model-support.mjs`, `test-fable-5-model-support.mjs`).
- Full default suite (`npm test`) passes with no regressions.

## Data Files

The `data/` subfolder contains the raw source material collected for this analysis:

- `issue-2003.json` — the GitHub issue (title, body, labels, author, timestamps).
- `issue-2003-comments.json` — issue comments.
- `pr-2004.json` — the pull request metadata.
- `models-dev-anthropic.json` — the full [models.dev](https://models.dev/api.json) registry snapshot used to confirm Sonnet 5's context/output/pricing/thinking specs.
