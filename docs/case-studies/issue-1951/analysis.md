# Issue 1951 Cost Calculation Case Study

## Evidence Collected

- Issue metadata: `raw-data/issue-1951.json`
- Issue comments: `raw-data/issue-1951-comments.json`
- Prepared PR metadata and comments: `raw-data/pr-1954.json`, `raw-data/pr-1954-conversation-comments.json`, `raw-data/pr-1954-review-comments.json`, `raw-data/pr-1954-reviews.json`
- Linked upstream PR comment: `raw-data/link-foundation-box-pr-107-comment-4751491904.json`
- Full solution draft trace: `raw-data/solution-draft-log-pr-1781871549849.txt`

The large trace is intentionally stored here because issue #1951 was about reconciling the generated solution-draft summary with the raw usage events that produced it.

## Timeline

- `2026-06-19T10:30:54Z`: the linked `link-foundation/box` run starts.
- `2026-06-19T12:18:56Z`: Claude Code emits a final result event with `total_cost_usd: 2.2701295`.
- `2026-06-19T12:19:02Z`: Hive Mind prints its public-pricing breakdown for the same result usage and reports `$2.003767`.
- `2026-06-19T12:19:02Z`: the final solution-draft summary reports `Calculated by Anthropic: $7.540569`.
- `2026-06-19T12:22:35Z`: issue #1951 is opened to investigate the mismatch.

## Reproduced Mismatch

The final result event in the trace reports this usage for Claude Opus 4.8:

```text
input_tokens: 3846
cache_creation_input_tokens: 71030
cache_creation.ephemeral_5m_input_tokens: 0
cache_creation.ephemeral_1h_input_tokens: 71030
cache_read_input_tokens: 2311299
output_tokens: 15398
total_cost_usd: 2.2701295
```

Hive Mind already captured the TTL-specific cache creation fields in `accumulateModelUsage`, but `calculateModelCost` priced every cache creation token with `cost.cache_write`. The `models.dev` entry for `claude-opus-4-8` exposes `cache_write: 6.25`, which is the 5-minute prompt-cache write price, and does not expose a separate 1-hour field.

That reproduced the local public-pricing total from the trace:

```text
(3846 * 5 + 71030 * 6.25 + 2311299 * 0.5 + 15398 * 25) / 1000000
= 2.003767
```

Using the 1-hour write price for the explicitly tagged 1-hour cache writes matches the Claude result event:

```text
(3846 * 5 + 71030 * 10 + 2311299 * 0.5 + 15398 * 25) / 1000000
= 2.2701295
```

The difference is exactly the 1-hour cache-write premium that Hive Mind was not applying:

```text
71030 * (10 - 6.25) / 1000000
= 0.2663625
```

## External Pricing Facts Checked

Official Anthropic documentation currently lists Claude Opus 4.8 pricing as:

- Input: `$5 / MTok`
- 5-minute cache write: `$6.25 / MTok`
- 1-hour cache write: `$10 / MTok`
- Cache hit: `$0.50 / MTok`
- Output: `$25 / MTok`

Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching

The same documentation describes prompt-cache billing multipliers:

- 5-minute cache writes cost `1.25x` the base input token price.
- 1-hour cache writes cost `2x` the base input token price.
- Cache reads cost `0.1x` the base input token price.

Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching

Claude Code cost tracking documentation also says `total_cost_usd` is a client-side estimate and that multiple `query()` calls must be accumulated manually by the caller when a broader total is needed. That explains why the final solution-draft summary can show a larger aggregate value than the single final result event, but it does not explain the per-result `$2.003767` vs `$2.2701295` mismatch. The reproducible bug was the cache TTL pricing in Hive Mind's public-pricing calculation.

Source: https://code.claude.com/docs/en/agent-sdk/cost-tracking

## Root Cause

`src/claude.cost.lib.mjs` treated all `cacheCreationTokens` as 5-minute cache writes:

```text
cacheCreationTokens * cost.cache_write / 1000000
```

For logs that include `usage.cache_creation.ephemeral_1h_input_tokens`, that is incorrect. A 1-hour prompt-cache write costs `2x` the base input token price. The issue trace used 1-hour cache writes exclusively, so the local public-pricing estimate was underreported by `$0.2663625`.

## Fix

- `calculateModelCost` now splits cache creation into 5-minute and 1-hour buckets when TTL-specific usage fields are present.
- 5-minute writes keep the existing `cost.cache_write_5m ?? cost.cache_write` rate.
- 1-hour writes use `cost.cache_write_1h` when model metadata provides it. Otherwise they derive the documented price from `cost.input * 2`.
- If no TTL split is present, aggregate cache-write behavior remains unchanged for backward compatibility.
- The verbose cost display now itemizes `Cache write (5m)` and `Cache write (1h)` when the split is available.

## Verification

Regression test:

```bash
node tests/test-issue-1951-cache-ttl-cost.mjs
```

The first test uses the exact issue trace usage and fails with the old `$2.003767` implementation. It passes only when the 1-hour cache write tokens are priced at `$10 / MTok`, producing `$2.270130`.

Related regression checks also passed:

```bash
node tests/test-issue-1710-format-fixes.mjs
node tests/test-issue-1710-budget-trace.mjs
node tests/test-issue-1886-cost-accumulation.mjs
node tests/test-display-cost-comparison.mjs
node tests/test-build-cost-info-string.mjs
```

## Residual Notes

- Claude's `total_cost_usd` remains a client-side estimate rather than authoritative billing.
- Result-event-only records that do not include `cache_creation.ephemeral_*_input_tokens` still use the old aggregate cache-write fallback because there is no reliable TTL split to price differently.
