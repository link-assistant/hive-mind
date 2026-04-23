# Case Study: Issue #1656 - Support GPT-5.5 and make it the Codex default

- Issue: [link-assistant/hive-mind#1656](https://github.com/link-assistant/hive-mind/issues/1656)
- Prepared PR: [link-assistant/hive-mind#1657](https://github.com/link-assistant/hive-mind/pull/1657)

## Summary

Issue #1656 asked for two things at once:

1. Add support for the newly announced `gpt-5.5` model to the Codex tool path.
2. Make `gpt-5.5` the default model for `--tool codex`.

The straightforward change would have been to replace every `gpt-5.4` default with
`gpt-5.5`. That would satisfy the issue text, but it would also break current
installations whose local Codex CLI catalog has not received the GPT-5.5 rollout yet.

The evidence on April 23, 2026 was mixed:

- OpenAI's release post announced GPT-5.5 is rolling out to Codex on April 23, 2026.
- The local Codex CLI 0.123.0 model catalog in this workspace still exposed only
  `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`, and `gpt-5.2`.
- OpenAI's current API docs still label GPT-5.4 as the latest model guide and do not
  yet expose a dedicated GPT-5.5 model page.

That mismatch is the actual engineering problem. The repository was using a static
Codex model map and a static `gpt-5.4` default, so it could neither accept `gpt-5.5`
nor safely prefer it during a staggered rollout.

## Requirements Extracted

Issue #1656 requires:

1. Support `gpt-5.5` in the Codex model map and validation path.
2. Make GPT-5.5 the default model for the Codex tool.
3. Double-check `--think off`, `low`, `medium`, `high`, `xhigh`, and `max`.
4. Preserve research and analysis in `docs/case-studies/issue-1656`.
5. Use current online facts, not only stale hardcoded repo state.

## Data Inventory

Saved source data:

- `source-data/github/issue-1656.json`
- `source-data/github/issue-1656-comments.json`
- `source-data/github/pr-1657.json`
- `source-data/codex/codex-model-catalog-0.123.0.json`

The local catalog is especially important because it shows what the installed Codex CLI
currently exposes in practice, which is different from the product announcement timing.

## Online Research

Official OpenAI sources used:

- OpenAI product release: https://openai.com/index/introducing-gpt-5-5/
- GPT-5.4 model page: https://developers.openai.com/api/docs/models/gpt-5.4
- Reasoning guide: https://developers.openai.com/api/docs/guides/reasoning

Key facts:

- OpenAI announced GPT-5.5 on April 23, 2026 and said it is rolling out to ChatGPT
  and Codex immediately, with API availability coming soon.
- The GPT-5.5 release page says Codex gets GPT-5.5 with a 400K context window.
- The GPT-5.4 model page documents `reasoning.effort` support for `none` (default),
  `low`, `medium`, `high`, and `xhigh`.
- The reasoning guide says supported reasoning values are model-dependent and may
  include `none`, `minimal`, `low`, `medium`, `high`, and `xhigh`, and explicitly
  notes that `gpt-5.4` defaults to `none`.

Inference from sources:

- Because GPT-5.5 is a newer Codex rollout than GPT-5.4, and the current GPT-5.4
  reasoning surface already supports `none` through `xhigh`, the existing Hive Mind
  Codex mapping remains appropriate: `off -> none`, `low -> low`, `medium -> medium`,
  `high -> high`, `xhigh -> xhigh`, and `max -> xhigh`.
- `max` is still an internal Hive Mind alias, not a raw Codex reasoning level.

## Root Cause

There were two root causes:

1. The repo had stale static Codex defaults and aliases:
   - `defaultModels.codex` was pinned to `gpt-5.4`.
   - `gpt-5.5` was not accepted by the Codex model map or validation map.
2. Default selection had no rollout-awareness:
   - the code assumed the preferred default was always immediately available in the
     installed Codex CLI;
   - the local Codex catalog still did not list `gpt-5.5`, so a blind default switch
     would have broken current environments.

## Solution Options

1. Hardcode `gpt-5.5` everywhere and remove `gpt-5.4` as default immediately.
   Rejected because the local Codex catalog still lacks GPT-5.5, so validation would
   fail during rollout lag.
2. Keep `gpt-5.4` as the default until Codex CLI catalogs catch up.
   Rejected because it does not satisfy the issue requirement to move the default now.
3. Preferred: make `gpt-5.5` the preferred default, add explicit `gpt-5.5` support,
   and resolve the runtime default against the installed Codex model catalog with a
   fallback to `gpt-5.4`.
   Implemented in PR #1657.

## Implemented Fix

PR #1657 does the following:

1. Adds `gpt-5.5` to the Codex model map and validation map.
2. Sets the preferred Codex default to `gpt-5.5`.
3. Adds `resolveRuntimeDefaultModel()` for rollout-safe defaults.
4. Uses the local `codex debug models` catalog to keep `gpt-5.5` when available and
   fall back to `gpt-5.4` when the installed Codex CLI has not received the rollout.
5. Updates Codex-focused tests so the regression is reproducible.
6. Updates README Codex examples from `gpt-5.4` to `gpt-5.5`.

## Verification

Focused checks:

```bash
node tests/test-codex-support.mjs
node tests/model-info.test.mjs
```

Broader local suite:

```bash
npm test
```

The focused tests verify:

- `gpt-5.5` resolves as a valid Codex model;
- the preferred Codex default is now `gpt-5.5`;
- runtime default resolution falls back to `gpt-5.4` if the local catalog does not
  expose GPT-5.5 yet;
- all expected `--think` levels still map correctly for the Codex reasoning-effort
  surface.
