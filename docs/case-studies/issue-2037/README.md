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

This warning was **unclear**: it read like an unexplained defect rather than the
intended, capacity-driven fallback it actually was. Per the PR review the message
stays a warning (the user did not get the model they requested in full detail) but
is reworded to explain the automatic fallback and to report the share of output
tokens produced on the fallback model. Separately, the retry loop waited a full
**2 minutes** of transient-error backoff _before_ retrying on the freshly switched
model, even though the switch itself makes the old backoff irrelevant. Finally, the
default fallback for `gpt-5.6-sol` jumped straight to `gpt-5.5`; it now steps to the
next model by **intelligence/size tier** (`gpt-5.6-sol → gpt-5.6-terra → gpt-5.5 →
gpt-5.4 → gpt-5.2`, skipping the smaller `gpt-5.6-luna` sibling) and, before any
fallback, retries the originally-requested model up to 5 times with exponential
backoff.

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

## 3. Requirements extracted from the issue (and PR review)

From the issue:

1. The misleading fallback warning must be addressed.
2. The 2-minute wait before retrying on the switched model is wasted time — a
   capacity-driven model switch should retry quickly (the new model is likely
   available now).
3. Apply the fixes across the entire codebase — every tool that performs a
   capacity fallback (codex, claude, agent, opencode, qwen, gemini), not just codex.

From the PR review ([comment 4939806551](https://github.com/link-assistant/hive-mind/pull/2040#issuecomment-4939806551)):

4. Fall back from `gpt-5.6-sol` to the **closest** model first (`gpt-5.6-terra` or
   similar), and only after that down to `gpt-5.5`. The default fallback for a
   `5.6` model must not jump straight to the previous generation.
5. The comment should **still be a warning** — a capacity fallback is not what the
   user requested in full detail — but a clear one.
6. Report in what **percentage of output tokens** the fallback model was active, so
   user expectations are managed clearly.

From the follow-up PR review
([comment 4940…](https://github.com/link-assistant/hive-mind/pull/2040)):

7. Order fallbacks by **level of intelligence or size of the model, not
   generation**. `gpt-5.6-sol` should step to `gpt-5.6-terra`, then `gpt-5.5`,
   `gpt-5.4`, `gpt-5.2` — and it must **not** jump to the smaller `gpt-5.6-luna`
   variant (luna is a smaller model, so it is skipped in the sol chain and instead
   falls back directly to `gpt-5.5`).
8. **Retry the originally-requested model up to 5 times** with exponential backoff
   _before_ doing any fallback, so a brief capacity blip does not lose the requested
   model. Apply this to **all models and tools**, with priority for all claude and
   codex models.

### Is this an actual bug, and how often does the fallback fire?

The fallback path is a genuine, load-dependent event: it only triggers when OpenAI
returns `Selected model is at capacity. Please try a different model.` for the
requested model (see `classifyRetryableError`, `isCapacity === true`). It is **not**
triggered by ordinary transient overload/timeout errors — those keep the requested
model (Issue #1949). Frequency therefore tracks OpenAI's capacity for the newest
`gpt-5.6-*` preview tier and is expected to be intermittent and highest right after
a new model launches. The reporting/timing defects, by contrast, fired **every**
time a capacity fallback occurred — those are the deterministic bugs fixed here.

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

### Fix 1 — clearer capacity-fallback warning (kept as a warning) with output-token share

`buildModelInfoString` / `getModelInfoForComment` accept `fallbackModel` and
`modelUsage` parameters. When the actual model does not match the requested model
**but does match the configured fallback**, the comment shows a warning that
explains the automatic capacity fallback (per the PR review, this stays a `⚠️`
warning because the user did not get their requested model in full detail):

> ⚠️ **Warning**: Requested model `gpt-5.6-sol` was unavailable (at capacity); automatically fell back to `gpt-5.6-terra` (fallback model produced 100% of output tokens)

The output-token share is computed from the per-model `modelUsage` map
(`computeOutputTokenSharePercent`) and is omitted when no per-model token data is
available. The generic `⚠️ Warning` ("does not match requested") is still emitted
when the actual model matches _neither_ the requested model nor its configured
fallback. `src/github.lib.mjs` passes `argv.fallbackModel` and the per-model
`modelUsage` through to the comment builder.

### Fix 1b — intelligence-tier, multi-level fallback chain

`defaultFallbackModels.codex` (`src/models/index.mjs`) now forms a chain ordered by
**intelligence/size tier** rather than generation:
`gpt-5.6-sol → gpt-5.6-terra → gpt-5.5 → gpt-5.4 → gpt-5.2` (and the `openai.*`
prefixed equivalents). The smaller `gpt-5.6-luna` variant is **skipped** in the sol
chain — luna is a lower-capability model, so jumping to it would be a downgrade past
the more capable `gpt-5.5`; luna instead falls back directly to `gpt-5.5`.
`resolveConfiguredFallbackModel` (`src/tool-retry.lib.mjs`) walks this chain: on each
successive capacity error it resolves the next hop from the _current_ model, so
repeated errors step through the whole chain instead of getting stuck on the first
fallback. An explicit `--fallback-model` pin (`argv._fallbackModelExplicit`, set in
`src/solve.config.lib.mjs`) is honoured exactly and never walked past.

### Fix 1c — retry the requested model 5× before any fallback

Added `retryLimits.capacityRetriesBeforeFallback` (env
`HIVE_MIND_CAPACITY_RETRIES_BEFORE_FALLBACK`, default **5**),
`initialCapacityRetryDelayMs` (default **15s**) and `maxCapacityRetryDelayMs`
(default **4 min**) in `src/config.lib.mjs`. A new shared helper
`prepareRetryAfterError` (`src/tool-retry.lib.mjs`) is called by every tool: on a
capacity error it first retries the **same** originally-requested model up to
`capacityRetriesBeforeFallback` times with exponential backoff
(`initialCapacityRetryDelayMs … maxCapacityRetryDelayMs`), tracked via
`argv._capacityRetryCount`. Only after that budget is exhausted does it call
`maybeSwitchToFallbackModel` and switch to the next model in the chain, resetting the
counter so every model in the chain gets its own 5-retry budget. This applies to all
six tools (codex, claude, agent, opencode, qwen, gemini).

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

- `tests/model-info.test.mjs` — capacity-fallback warning case (actual == configured
  fallback → `⚠️` + "automatically fell back"), the unchanged generic-warning case
  (actual matches neither), and the output-token-share case (`modelUsage` →
  "N% of output tokens").
- `tests/test-codex-support.mjs` — asserts the requested model is retried
  `capacityRetriesBeforeFallback` times before switching, then a fast delay
  (`modelSwitchRetryDelayMs`) on the switch, plus the intelligence-tier codex
  fallback chain (`gpt-5.6-sol → terra → gpt-5.5 → gpt-5.4 → gpt-5.2`).
- `tests/test-issue-1949-overload-no-model-switch.mjs` — regression guard that
  overload errors do **not** trigger a model switch, plus multi-level chain walking,
  explicit-pin (no-walk-past) coverage, and the `prepareRetryAfterError`
  same-model-retry-then-switch behavior.

## 8. Upstream note

The capacity error itself (`Selected model is at capacity. Please try a different
model.`) originates from OpenAI's Codex service and is transient/expected. No
upstream bug report is warranted — the correct handling (fall back to another
model) already works; the defects were entirely in hive-mind's reporting and
retry timing, both fixed here.
