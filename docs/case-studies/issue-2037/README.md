# Case Study — Issue #2037

> ⚠️ Warning: Main model `gpt-5.5` does not match requested model `gpt-5.6-sol`

- **Issue:** [link-assistant/hive-mind#2037](https://github.com/link-assistant/hive-mind/issues/2037)
- **Pull request:** [#2040](https://github.com/link-assistant/hive-mind/pull/2040)
- **Referenced run:** RattusRex/Kral PR #116, comment 4938709552
- **Primary evidence:** [`logs/solution-draft-log-pr116.txt`](./logs/solution-draft-log-pr116.txt) (full solution-draft log of the referenced run)

## 1. Summary

A solve run requested the default codex model `gpt-5.6-sol`. OpenAI returned a
capacity error, the retry loop automatically switched to the configured fallback
`gpt-5.5`, and the run completed successfully on the fallback. The PR/issue
comment then rendered:

> ⚠️ **Warning**: Main model `gpt-5.5` does not match requested model `gpt-5.6-sol`

This warning is **misleading**: the mismatch was the intended, designed behaviour
(a capacity-driven fallback), not an error. Separately, the retry loop waited a
full **2 minutes** of transient-error backoff _before_ retrying on the freshly
switched model, even though the switch itself makes the old backoff irrelevant.

## 2. Timeline of events (reconstructed from the log)

| Time (UTC)          | Event                                                                                                             | Log line      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------- |
| 19:04:08            | Run starts, requested/resolved model `gpt-5.6-sol`                                                                | 387, 396, 405 |
| 19:04:10            | Codex session configured with `gpt-5.6-sol`                                                                       | 570           |
| 19:05:44            | OpenAI SSE `response.completed` with `error.message=Selected model is at capacity. Please try a different model.` | 2071          |
| 19:05:44            | `Turn error: Selected model is at capacity...` → `turn.failed`                                                    | 2074, 2090    |
| 19:05:44            | `🔀 Switching to fallback model: gpt-5.6-sol -> gpt-5.5`                                                          | 2156          |
| 19:05:44 → 19:07:44 | **~2 minute** transient backoff wait (`⏳ 1 min remaining...`)                                                    | 2157          |
| 19:07:44            | `🔄 Retrying now...` — retry attempt 1/10 on `gpt-5.5`                                                            | retry block   |
| (later)             | Run completes successfully; comment shows the misleading `⚠️ Warning`                                             | —             |

## 3. Requirements extracted from the issue

1. The `⚠️ Warning` must not fire when the actual model equals the _configured
   fallback_ of the requested model — that is expected behaviour, so it should be
   an informational note, not a warning.
2. The 2-minute wait before retrying on the switched model is wasted time — a
   capacity-driven model switch should retry quickly (the new model is likely
   available now).
3. Apply the fixes across the entire codebase — every tool that performs a
   capacity fallback (codex, claude, agent, opencode, qwen, gemini), not just codex.

## 4. Root cause analysis

### Problem A — misleading warning

`buildModelInfoString` (in `src/models/index.mjs`) compared the actual main model
to the requested model and, on any mismatch, emitted an unconditional
`⚠️ Warning`. It had no knowledge of the _configured fallback_, so a designed
fallback looked identical to an unexpected mismatch.

### Problem B — wasted backoff before retry on switched model

In every tool's retry loop, the retry `delay` was computed from the transient
backoff schedule **before** `maybeSwitchToFallbackModel` was called, and the same
`delay` was used regardless of whether a model switch occurred. A capacity switch
therefore still incurred the full transient backoff (2 min here) even though the
switch was meant to unblock the run immediately.

## 5. Fixes implemented (this PR)

### Fix 1 — informational fallback note instead of warning

`buildModelInfoString` / `getModelInfoForComment` now accept a `fallbackModel`
parameter. When the actual model does not match the requested model **but does
match the configured fallback**, the comment shows:

> ℹ️ Requested model `gpt-5.6-sol` was unavailable; automatically fell back to `gpt-5.5`

The `⚠️ Warning` is still emitted when the actual model matches _neither_ the
requested model nor its configured fallback (a genuinely unexpected mismatch).
`src/github.lib.mjs` passes `argv.fallbackModel` through to the comment builder.

### Fix 2 — fast retry after a capacity-driven model switch

Added `retryLimits.modelSwitchRetryDelayMs` (env
`HIVE_MIND_MODEL_SWITCH_RETRY_DELAY_MS`, default **5s**) in `src/config.lib.mjs`.
In each tool's retry loop, `maybeSwitchToFallbackModel` is now called _before_
computing the delay, and when it reports `switched === true` the loop uses the
short `modelSwitchRetryDelayMs` instead of the full transient backoff.

Applied to all six tools:

- `src/codex.lib.mjs` (both retry branches)
- `src/claude.lib.mjs` (both retry branches)
- `src/agent.lib.mjs`
- `src/opencode.lib.mjs`
- `src/qwen.lib.mjs`
- `src/gemini.lib.mjs`

`maybeSwitchToFallbackModel` only switches on `classification.isCapacity`, so this
fast path never triggers for ordinary overload/timeout retries (verified by the
existing Issue #1949 no-model-switch test suite).

## 6. Existing components reused

- `maybeSwitchToFallbackModel` / `classifyRetryableError` (`src/tool-retry.lib.mjs`) —
  the switch decision and `isCapacity` classification already existed; no new
  detection logic was needed.
- `retryLimits` config pattern (`src/config.lib.mjs`) — the new delay follows the
  existing `parseIntWithDefault` env-override convention.
- `buildModelInfoString` (`src/models/index.mjs`) — extended in place rather than
  adding a parallel code path.

## 7. Tests

- `tests/model-info.test.mjs` — informational-note case (actual == configured
  fallback → `ℹ️`, no `⚠️`) and the unchanged-warning case (actual matches
  neither → `⚠️`).
- `tests/test-codex-support.mjs` — capacity-error retry now asserts a single fast
  delay (`<= 30_000ms`) after the model switch.
- `tests/test-issue-1949-overload-no-model-switch.mjs` — regression guard that
  overload errors do **not** trigger a model switch (still passes).

## 8. Upstream note

The capacity error itself (`Selected model is at capacity. Please try a different
model.`) originates from OpenAI's Codex service and is transient/expected. No
upstream bug report is warranted — the correct handling (fall back to another
model) already works; the defects were entirely in hive-mind's reporting and
retry timing, both fixed here.
