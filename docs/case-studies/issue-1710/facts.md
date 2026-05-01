# Issue #1710 — Captured facts from the PR #1707 run

These are the **exact** numbers Anthropic returned for the run that produced
the cost summary the issue quotes. They come straight from the `result` event
in `data/solution-draft-log-pr-1707.txt` (line ~66725) and from the issue
comment `data/comment-4335847447.json`.

## 1. Anthropic-reported per-model usage (result event)

```json
{
  "modelUsage": {
    "claude-opus-4-7": {
      "inputTokens":               690,
      "outputTokens":           79 567,
      "cacheReadInputTokens": 42 679 751,
      "cacheCreationInputTokens": 341 517,
      "webSearchRequests":           0,
      "costUSD":           25.466981749999988,
      "contextWindow":     1 000 000,
      "maxOutputTokens":      64 000
    },
    "claude-haiku-4-5-20251001": {
      "inputTokens":           77 969,
      "outputTokens":           4 176,
      "cacheReadInputTokens":       0,
      "cacheCreationInputTokens": 57 580,
      "webSearchRequests":          4,
      "costUSD":               0.210824,
      "contextWindow":     200 000,
      "maxOutputTokens":     32 000
    }
  }
}
```

`anthropic_total_cost_usd` reported by the result event: **$25.677806**.

## 2. Solver-side derived numbers

- `peakContextByModel["claude-opus-4-7"]` = **278 218** tokens (single largest
  request's `input + cache_creation + cache_read`). See solver log line 66765:
  `📊 Peak single-request context: 278 218 tokens`.
- `peakContextByModel["claude-haiku-4-5-20251001"]` = **0** (Haiku is
  invoked exclusively as a sub-agent; never appears as `assistant` model in
  the JSONL stream that drives `peakContextByModel`).
- Public-pricing per-model totals (computed in `calculateModelCost`):
  - Opus: $0.003450 (input) + $2.134481 (5m cache write) + $21.339876
    (cache read) + $1.989175 (output) = **$25.466982**.
  - Haiku: $0.077969 (input) + $0.071975 (5m cache write) + $0.020880
    (output) = **$0.170824**.
  - Grand total: **$25.637806**.

## 3. Reconciling the four anomalies

### 3.1 Cost difference

| Source                                  | $              |
| --------------------------------------- | -------------- |
| Public pricing (sum of breakdown above) | 25.637806      |
| Anthropic result `total_cost_usd`       | 25.677806      |
| Difference                              | **+ 0.040000** |

`webSearchRequests` × $0.01/req
([Anthropic pricing — Web search tool](https://platform.claude.com/docs/en/about-claude/pricing#web-search-tool))
= 4 × $0.01 = **$0.04**. ✅ This perfectly explains the $0.04 / +0.16 % delta.

### 3.2 Haiku sub-session has no input line

- `peakContextUsage` for Haiku = 0 (sub-agent traffic).
- `formatContextOutputLine` (`claude.budget-stats.lib.mjs:327-339`) only emits
  the input phrase when `peakContext > 0`.
- At `claude.budget-stats.lib.mjs:461-465` an output-only fallback line is
  emitted when `peakContext === 0 && callCount <= 1`.

Result: Haiku is rendered as `4.2K / 64K (7%) output tokens` only.

### 3.3 Opus 278.2K vs 342.2K + 42.7M

- `278 218` — **peak** per-request context window fill for Opus.
- `342 207` — **cumulative** non-cached (`inputTokens 690 + cacheCreationInputTokens 341 517`).
- `42 679 751` — **cumulative** cache reads.

These compare different things; the format does not say so.

### 3.4 Haiku Total has no `(X + Y cached)`

For this specific run `cacheReadInputTokens` is `0`, so the
`if (cachedTokens > 0)` branch in
`buildBudgetStatsString` (`claude.budget-stats.lib.mjs:471-475`) collapses to
the short form on purpose. But:

- `cacheCreationInputTokens = 57 580` is silently folded into the displayed
  `135.5K` (= `77 969 + 57 580`). Cache writes are **not** standard input
  tokens — they are billed at 1.25× / 2× and they are a different category in
  the breakdown above.
- Once cache _reads_ eventually occur for Haiku in another run, the format
  _will_ change form between runs, which is itself confusing.

### 3.5 Reproducer fixture

Use the figures above as the input to `buildBudgetStatsString` to reproduce
the comment text. A small fixture lives in `tests/test-issue-1600-budget-stats.mjs`
and can be extended with the values in this file to lock the case study to
real data.
