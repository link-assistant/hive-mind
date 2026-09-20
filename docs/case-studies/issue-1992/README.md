# Issue 1992 Case Study: Codex Upcoming Model Support

## Summary

Issue 1992 asks hive-mind to support all current OpenAI models available through
Codex CLI and all upcoming OpenAI Codex models referenced by the GPT-5.6 preview
announcement, using `openai/codex` as the reference implementation.

The fix keeps `gpt-5.5` as the Codex default, adds validation support for the
current hidden Codex CLI model entry, accepts the GPT-5.6 preview family in both
plain and Bedrock-prefixed forms, and documents the source data used for the
decision.

## Requirements

- Read the GitHub issue, issue comments, and existing PR state.
- Collect research artifacts under `docs/case-studies/issue-1992`.
- Support the local Codex CLI catalog as reported by `codex debug models`.
- Cross-check model IDs against `openai/codex`.
- Support the GPT-5.6 preview family announced by OpenAI.
- Preserve the documented Codex default unless a newer local catalog requires a
  runtime fallback.
- Add a reproducing automated test for the missing model support.

## Findings

- Local `codex-cli 0.142.2` exposes visible models `gpt-5.5`, `gpt-5.4`,
  `gpt-5.4-mini`, and `gpt-5.3-codex-spark`.
- The local Codex CLI catalog also includes hidden model `codex-auto-review`.
- The current Codex manual recommends `gpt-5.5` for most tasks, with
  `gpt-5.4-mini` for lighter tasks and `gpt-5.3-codex-spark` as a research
  preview.
- Upstream `openai/codex` models include `gpt-5.5`, `gpt-5.4`,
  `gpt-5.4-mini`, deprecated `gpt-5.3-codex`, deprecated `gpt-5.2`, and hidden
  `codex-auto-review`.
- The OpenAI GPT-5.6 preview article announces Sol, Terra, and Luna for API and
  Codex preview availability.
- Upstream `openai/codex` Bedrock provider constants provide the concrete
  GPT-5.6 model IDs: `openai.gpt-5.6-sol`, `openai.gpt-5.6-terra`, and
  `openai.gpt-5.6-luna`.

## Root Cause

Codex model validation used a finite allowlist. The allowlist already had the
stable GPT-5.5/GPT-5.4 entries, but it did not include:

- the hidden current CLI catalog model `codex-auto-review`
- upcoming plain GPT-5.6 preview IDs
- upstream Bedrock-prefixed GPT-5.5/GPT-5.4/GPT-5.6 IDs

Runtime default fallback ordering also skipped the GPT-5.6 preview family, so a
future local catalog without `gpt-5.5` would fall backward to older models
instead of choosing the first available newer preview model.

## Decision

- Keep `gpt-5.5` as `defaultModels.codex` because both local Codex and the
  official Codex manual still recommend it.
- Add `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna` as accepted Codex model
  IDs.
- Add `openai.gpt-5.5`, `openai.gpt-5.4`, `openai.gpt-5.6-sol`,
  `openai.gpt-5.6-terra`, and `openai.gpt-5.6-luna` as accepted Codex model IDs.
- Add `codex-auto-review` as a valid hidden model, but keep it out of
  `primaryModelNames.codex` so normal CLI help does not promote an internal
  review model.
- Add default fallback mappings from GPT-5.6 preview models to GPT-5.5, and from
  provider-prefixed GPT-5.6 models to `openai.gpt-5.5`.
- Prefer a future available GPT-5.6 preview model over older GPT-5.4 fallback
  models only when the preferred default `gpt-5.5` is unavailable.

## Alternatives Considered

- Make `gpt-5.6-sol` the default immediately. Rejected because the current Codex
  manual and local CLI catalog still make `gpt-5.5` the recommended default.
- Accept arbitrary `openai.gpt-*` IDs. Rejected because the existing validation
  intentionally catches model typos before launching a session.
- Remove deprecated Codex models from the allowlist. Rejected because existing
  code already preserves deprecated model IDs for backward compatibility and the
  issue asked to add support, not remove it.

## Verification

- Added regression coverage to `tests/test-codex-support.mjs` for current,
  hidden, upcoming, and Bedrock-prefixed Codex model IDs.
- The new test failed before the implementation because the allowlist and
  fallback chain did not include those IDs.
- Post-fix verification is recorded in the pull request description.

## Source Data

- `data/issue-1992.json`
- `data/issue-1992-comments.json`
- `data/pr-1993.json`
- `data/codex-debug-models-summary.json`
- `data/openai-codex-models-summary.json`
- `data/openai-codex-manual-model-selection.md`
- `data/openai-previewing-gpt-5-6-sol-notes.md`
- `data/openai-codex-bedrock-provider-info-snippet.rs`
- `data/openai-codex-bedrock-provider-test-snippet.rs`
