## Summary

Fixes #2037.

When a requested codex model (`gpt-5.6-sol`) hit an OpenAI **capacity error**, the retry loop correctly fell back to the configured fallback model (`gpt-5.5`) and the run completed successfully — but two things went wrong afterwards:

1. **Misleading warning.** The PR/issue comment rendered `⚠️ Warning: Main model gpt-5.5 does not match requested model gpt-5.6-sol`, even though this mismatch was the _intended, designed_ fallback behaviour.
2. **Wasted 2-minute delay.** The retry loop waited the full transient-error backoff (~2 min, confirmed in the log) _before_ retrying on the already-switched model, even though a model switch makes the old backoff irrelevant.

Full root-cause analysis, timeline, and the evidence log are in [`docs/case-studies/issue-2037/`](../tree/issue-2037-7f299aad57e8/docs/case-studies/issue-2037).

## How to reproduce

Run a codex-tool solve while the requested model is at capacity (OpenAI returns `Selected model is at capacity. Please try a different model.`). The run falls back to `gpt-5.5`, then the comment shows the misleading `⚠️ Warning` and the retry stalls ~2 min before continuing. See the captured run: `docs/case-studies/issue-2037/logs/solution-draft-log-pr116.txt` (lines 2071/2156/2157).

## Changes

- **`src/models/index.mjs`** — `buildModelInfoString` / `getModelInfoForComment` accept a `fallbackModel` param. When the actual model doesn't match the requested one **but matches the configured fallback**, the comment shows an informational note (`ℹ️ Requested model … was unavailable; automatically fell back to …`) instead of a warning. The `⚠️ Warning` still fires when the actual model matches _neither_.
- **`src/github.lib.mjs`** — passes `argv.fallbackModel` through to the comment builder.
- **`src/config.lib.mjs`** — new `retryLimits.modelSwitchRetryDelayMs` (env `HIVE_MIND_MODEL_SWITCH_RETRY_DELAY_MS`, default **5s**).
- **`src/codex.lib.mjs`, `claude.lib.mjs`, `agent.lib.mjs`, `opencode.lib.mjs`, `qwen.lib.mjs`, `gemini.lib.mjs`** — switch the fallback model _before_ computing the retry delay, and use the fast delay when a capacity-driven switch occurred. Applied across **all six tools** (issue requirement: fix everywhere).
- **version** bumped to `2.3.1`.

## Tests

- `tests/model-info.test.mjs` — new info-note case (actual == configured fallback → `ℹ️`, no `⚠️`) and unchanged-warning case (actual matches neither → `⚠️`).
- `tests/test-codex-support.mjs` — capacity-error retry now asserts a single fast delay (`<= 30_000ms`) after the switch.
- `tests/test-issue-1949-overload-no-model-switch.mjs` — regression guard confirming ordinary overload errors do **not** trigger a model switch (still passes; `maybeSwitchToFallbackModel` only switches on `isCapacity`).

Full default suite: 317 files run, all green (one subprocess-timing flake that passes in isolation).

## Upstream note

The capacity error originates from OpenAI's Codex service and is transient/expected; the existing fallback handling already does the right thing. No upstream report is warranted — the defects were entirely in hive-mind's reporting and retry timing, both fixed here.
