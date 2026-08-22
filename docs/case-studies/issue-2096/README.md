# Case Study: Issue #2096 - Add Support for Claude Opus 5 & Make It the Default for `/claude` and `/solve`

## Overview

This case study documents the change to add **Claude Opus 5** (`claude-opus-5`) — Anthropic's newest and strongest Opus-generation model — and promote it to be the default for `--tool claude` (and therefore for the `/claude` and `/solve` commands):

1. **Add support for Claude Opus 5** (`claude-opus-5`) as a selectable model via `--model` for `--tool claude`, with full support for the `[1m]` context suffix, the effort-level ladder (including `xhigh` and `max`), 128K max output tokens, adaptive-thinking-only environment handling, and a documented default fallback.
2. **Promote Opus 5 to be the default** for `--tool claude` by remapping the bare `opus` alias from `claude-opus-4-8` to `claude-opus-5`. Because `defaultModels.claude === 'opus'`, this automatically makes Opus 5 the default for `/claude` and for `/solve`.

This is the direct Opus-generation analogue of issue #2003 (which promoted Sonnet 5) and issue #1832 (which promoted Opus 4.8). The same single-source-of-truth model layer is reused, so the change is small and surgical.

## Issue Details

- **Issue**: [#2096](https://github.com/link-assistant/hive-mind/issues/2096)
- **Title**: Add support for Claude Opus 5, set it default for `/claude` command and for `/solve` command.
- **Author**: konard (Konstantin Diachenko)
- **Pull Request**: [#2097](https://github.com/link-assistant/hive-mind/pull/2097)

## Requirements

### From the issue title & body (the concrete, testable requirements)

- **R1 — Add Opus 5.** Add support for **Claude Opus 5** (`claude-opus-5`) as a fully registered, selectable model for `--tool claude`.
- **R2 — Default remap.** Make Opus 5 the default for the `/claude` command and the `/solve` command. The bare `opus` alias must resolve to `claude-opus-5`, and because `defaultModels.claude === 'opus'`, that makes Opus 5 the default model for the claude tool (and thus for `/solve`, which defaults to `--tool claude`).
- **R3 — Full model coverage.** "Make sure all other Claude models are fully supported in the best possible way in all details." Verify the whole current Claude line-up remains registered and correct.
- **R4 — Nuances & documentation.** "Make sure the system fully supports all new settings of Claude Code and all nuances of each model, well documented."

### From the issue body (process requirements, boilerplate template)

- **R5 — Collect related data** into `./docs/case-studies/issue-2096/` (see `data/` subfolder).
- **R6 — Deep case study analysis**, including searching online for additional facts and data.
- **R7 — List each and all requirements** from the issue (this section).
- **R8 — Propose solutions/plans** for each requirement, checking existing components/libraries that solve a similar problem.
- **R9 — Plan and execute everything in the single PR #2097** until every requirement is fully addressed.

## Model Information

### Claude Opus 5 Specifications

Authoritative values from the [models.dev](https://models.dev/api.json) registry (the same source Hive Mind already uses for pricing/specs) and Anthropic's announcement:

| Attribute          | Value                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------- |
| **API Model ID**   | `claude-opus-5`                                                                         |
| **Context Window** | 1,000,000 tokens                                                                        |
| **Max Output**     | 128,000 tokens                                                                          |
| **Pricing**        | $5 / input MTok, $25 / output MTok (cache read $0.50, cache write $6.25)                |
| **Reasoning**      | Yes (effort levels)                                                                     |
| **Effort Levels**  | low, medium, high (default), **xhigh**, max                                             |
| **Thinking Mode**  | Adaptive thinking only (`temperature: false` in models.dev → no manual/extended budget) |
| **Knowledge**      | 2026-05                                                                                 |
| **Released**       | 2026-07-24                                                                              |
| **Announcement**   | https://www.anthropic.com/news/claude-opus-5                                            |

### How Opus 5 relates to Opus 4.8

Opus 5 shares **identical API constraints** with Opus 4.8 (verified against the models.dev snapshot in `data/`), which is why it slots into the existing Opus 4.8+ capability path with minimal new code:

| Attribute         | Opus 4.8 (`claude-opus-4-8`)                 | Opus 5 (`claude-opus-5`)                       |
| ----------------- | -------------------------------------------- | ---------------------------------------------- |
| Max output tokens | 128,000                                      | 128,000                                        |
| Context window    | 1M                                           | 1M                                             |
| `xhigh` effort    | Supported                                    | **Supported**                                  |
| `max` effort      | Supported                                    | **Supported**                                  |
| Thinking mode     | Adaptive-thinking-only (`temperature:false`) | Adaptive-thinking-only (`temperature:false`)   |
| Input / output $  | $5 / $25                                     | $5 / $25                                       |
| Knowledge cutoff  | 2026-01                                      | **2026-05** (newer)                            |
| Fast mode         | `fast-mode` beta (not wired in CLI)          | `fast-mode-2026-02-01` beta (not wired in CLI) |

Because the API contract is the same, Opus 5 is a strict, drop-in upgrade: newer knowledge and stronger reasoning at the same price and limits. That is why the only genuine code gap was a single effort-level classifier (see below).

### "Fast mode" note

The models.dev entry for Opus 5 exposes an experimental `fast` mode (beta header `fast-mode-2026-02-01`, higher-cost/faster output). This mirrors the fast mode already noted for Opus 4.7/4.8. As documented in `src/config.lib.mjs` (`isOpus48OrLater`), fast mode "is not exposed through Claude Code today," so no wiring is required for R4 — it is recorded here so the nuance is explicitly closed rather than silently assumed.

## Current Claude Model Coverage (post-change)

| Alias(es)                               | Resolves to                 | Notes                               |
| --------------------------------------- | --------------------------- | ----------------------------------- |
| `opus`, `opus-5`, `claude-opus-5`       | `claude-opus-5`             | **New default** (Issue #2096)       |
| `opus-4-8`, `claude-opus-4-8`           | `claude-opus-4-8`           | Retained for backward compatibility |
| `opus-4-7` … `opus-4-5`                 | corresponding IDs           | Retained                            |
| `sonnet`, `sonnet-5`, `claude-sonnet-5` | `claude-sonnet-5`           | Default sonnet (Issue #2003)        |
| `sonnet-4-6`, `claude-sonnet-4-6`       | `claude-sonnet-4-6`         | Retained                            |
| `haiku`, `haiku-4-5`                    | `claude-haiku-4-5-20251001` | Retained                            |
| `haiku-3-5`, `haiku-3`                  | legacy IDs                  | Retained                            |
| `fable`, `fable-5`, `claude-fable-5`    | `claude-fable-5`            | Supported (Issue #1875)             |
| `mythos-5`, `claude-mythos-5`           | `claude-mythos-5`           | Supported (Issue #1875)             |
| `opusplan`                              | opusplan mode               | Opus plans, Sonnet executes         |

## Solution Plan (per requirement) & existing components used

The codebase already has a well-factored, single-source-of-truth model layer (issues #1221/#1329/#1620/#1832/#1875/#2003/#1473). The change reuses those existing components rather than adding new machinery:

**R1 (add Opus 5) + R2 (default remap) — `src/models/index.mjs`**

- Change `claudeModels.opus` from `claude-opus-4-8` → `claude-opus-5`.
- Add short alias `opus-5` and full-ID identity `claude-opus-5` (the `CLAUDE_MODELS` map inherits it via the `claudeModels` spread).
- Add `claude-opus-5` and `opus-5` to `MODELS_SUPPORTING_1M_CONTEXT` so `[1m]` works.
- Add `defaultFallbackModels.claude['claude-opus-5'] = 'opus-4-8'` (Opus 5 falls back to the prior Opus generation, mirroring the existing chain).
- `defaultModels.claude` stays `'opus'` and `primaryModelNames.claude` still lists `opus`, so the default automatically follows the remapped alias — that is what makes Opus 5 the default for `/claude` and `/solve`.

**R1/R3 (capabilities) — `src/config.lib.mjs`**

- Add a narrow `isOpus5` classifier and wire it into `supportsXHighEffortLevel`. This was the **single real code gap**: `supportsXHighEffortLevel` used the private `isOpus47` predicate, which matches `opus-4-7`/`opus-4-8` but **not** the explicit `opus-5`/`claude-opus-5` aliases. Without this, `--model opus-5 --think xhigh` would have silently downgraded.
- Everything else already handles Opus 5 correctly because the existing `*OrLater` helpers already match `opus-5`:
  - `supportsEffortLevel` / `supportsMaxEffortLevel` → via `isOpus47OrLater` (includes `opus-5`).
  - `getMaxOutputTokensForModel` returns 128K → via `isOpus46OrLater` (includes `opus-5`).
  - `getClaudeEnv` `adaptiveThinkingOnly` (no `MAX_THINKING_TOKENS`) → via `isOpus47OrLater` (includes `opus-5`).

**R1 (escalation) — `src/solve.escalate.lib.mjs`**

- Add `opus-5` and `claude-opus-5` to `TIER_ALIASES` → `opus` tier, so `--escalate-from`/`--escalate-to` accept the new aliases.

**R4 (docs/help) — `src/solve.config.lib.mjs` + `docs/`**

- Update the `--fallback-model` and `--show-thinking` option descriptions so Opus 5 appears in the fallback chain and adaptive-thinking notes.
- Update `docs/CONFIGURATION.md` and `docs/FEATURES.md` where the default `opus` alias version was referenced.

**R3 (regression safety) — tests**

- New `tests/test-opus-5-model-support.mjs` (comprehensive: alias resolution, explicit `opus-5`/`claude-opus-5`, `[1m]`, `isOpus5`, effort levels incl. `xhigh`/`max`, 128K output, adaptive-thinking-only env, default fallback, escalate tier, backward compat).
- Update pre-existing tests whose assertions assumed bare `opus` = Opus 4.8 (they now expect `claude-opus-5`), while preserving explicit `opus-4-8`/`opus-4-7`/`opus-4-6` assertions for backward-compatibility coverage.

**R9 — single PR + release trigger**

- All changes land in PR #2097. A `.changeset/` entry is added so the automated release picks up the change.

## Why a dedicated `isOpus5` classifier

`isOpus47` (the private predicate behind `supportsXHighEffortLevel`) matches `opus-4-7`/`opus-4-8` but not the explicit `opus-5`/`claude-opus-5` strings. The bare `opus` alias happened to be handled because `isOpus47` special-cases `'opus'`, but a user passing `--model opus-5` or `--model claude-opus-5` explicitly would not have received `xhigh`. Adding a narrow `isOpus5` predicate — mirroring the existing `isSonnet5` from issue #2003 — keeps each model's behavior exact without over-broadening the shared `*OrLater` helpers.

## Verification

- New and updated model-support tests pass (`test-opus-5-model-support.mjs`, `test-opus-46/48-model-support.mjs`, `test-sonnet-5/46-model-support.mjs`, `test-fable-5-model-support.mjs`, `test-codex-support.mjs`, `model-info.test.mjs`).
- Full default suite (`npm test`) passes with no regressions.

## Data Files

The `data/` subfolder contains the raw source material collected for this analysis:

- `issue-2096.json` — the GitHub issue (title, body, labels, author, timestamps).
- `issue-2096-comments.json` — issue comments.
- `pr-2097.json` — the pull request metadata.
- `models-dev-anthropic.json` — the full [models.dev](https://models.dev/api.json) registry snapshot used to confirm Opus 5's context/output/pricing/thinking specs (and its parity with Opus 4.8).
