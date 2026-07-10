## Summary

Fixes #2037.

When a requested codex model (`gpt-5.6-sol`) hits an OpenAI **capacity error**, the retry loop falls back to another model and the run completes — but the reporting, retry timing, and fallback target all needed work. This PR fixes:

1. **Unclear warning.** The comment rendered `⚠️ Warning: Main model gpt-5.5 does not match requested model gpt-5.6-sol`, which read like a defect rather than the automatic capacity fallback it was.
2. **Wasted 2-minute delay.** The retry loop waited the full transient-error backoff (~2 min) _before_ retrying on the already-switched model.
3. **Fallback jumped a whole generation.** `gpt-5.6-sol` fell back straight to `gpt-5.5` instead of the closest sibling.

Full root-cause analysis, timeline, and evidence log are in [`docs/case-studies/issue-2037/`](../tree/issue-2037-7f299aad57e8/docs/case-studies/issue-2037).

## Changes (incl. PR-review feedback [#4939806551](https://github.com/link-assistant/hive-mind/pull/2040#issuecomment-4939806551))

- **Closest-first, multi-level fallback chain** (`src/models/index.mjs`): codex now walks `gpt-5.6-sol → gpt-5.6-terra → gpt-5.6-luna → gpt-5.5 → gpt-5.4` (and `openai.*` equivalents). `resolveConfiguredFallbackModel` (`src/tool-retry.lib.mjs`) steps to the next-closest model on each successive capacity error; an explicit `--fallback-model` pin (`argv._fallbackModelExplicit`, `src/solve.config.lib.mjs`) is honoured exactly and never walked past.
- **Warning kept, but clearer** (`src/models/index.mjs`): a capacity fallback is _not_ what the user requested in full detail, so it stays a `⚠️ Warning`, reworded to explain the automatic fallback (`Requested model … was unavailable (at capacity); automatically fell back to …`).
- **Report fallback output-token share**: the warning now reports the percentage of output tokens produced by the fallback model (`computeOutputTokenSharePercent`, fed by the per-model `modelUsage` map passed through `src/github.lib.mjs`).
- **Fast retry after capacity switch**: `retryLimits.modelSwitchRetryDelayMs` (env `HIVE_MIND_MODEL_SWITCH_RETRY_DELAY_MS`, default **5s**). All six tools (`codex`, `claude`, `agent`, `opencode`, `qwen`, `gemini`) switch the fallback model _before_ computing the retry delay and use the fast delay on a capacity-driven switch.
- version bumped to `2.3.1`.

## Is this an actual bug / how often does it fall back?

The fallback only fires on a genuine `Selected model is at capacity. Please try a different model.` (`isCapacity`), never on ordinary overload/timeout errors (Issue #1949). Frequency tracks OpenAI's capacity for the newest `gpt-5.6-*` preview tier — intermittent, highest right after a launch. The reporting/timing/target defects, however, fired _every_ time a fallback occurred; those are the deterministic bugs fixed here.

## Tests

- `tests/model-info.test.mjs` — capacity-fallback warning (`⚠️` + "automatically fell back"), unchanged generic-warning case, and output-token-share case.
- `tests/test-codex-support.mjs` — fast (`<= 30s`) retry after a capacity switch, plus the closest-first codex chain.
- `tests/test-issue-1949-overload-no-model-switch.mjs` — overload errors still don't switch models, plus multi-level chain walking and explicit-pin (no-walk-past) coverage.

## Upstream note

The capacity error originates from OpenAI's Codex service and is transient/expected. No upstream report is warranted — the defects were entirely in hive-mind's reporting, retry timing, and fallback-target selection, all fixed here.
