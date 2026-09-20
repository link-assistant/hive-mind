# Issue #1539: Wrong calculation of context and tokens usage

## Problem Statement

The budget stats report shows impossible context window usage percentages (e.g., 250% or 383%) for models whose usage data comes only from the result JSON (not from JSONL per-request tracking). This happens because cumulative token totals (summed across all requests) are incorrectly used as a "context window" metric, which is inherently per-request.

## Observed Symptoms

From the reported log (PR link-assistant/agent#233):

```
Claude Haiku 4.5:
- Context window: 500.1K / 200K input tokens (250%)

Total: 70.5K + 429.6K cached input tokens, 7.0K output tokens, $0.165163 cost
```

- 500.1K = 70.5K (inputTokens + cacheCreationTokens) + 429.6K (cacheReadTokens)
- This is a **cumulative total across all requests**, not a per-request value
- A 200K context model cannot use 250% of its context in a single request

## Root Cause Analysis

### Data flow

1. **JSONL parsing** (`claude.lib.mjs:calculateSessionTokens`): Reads per-request usage entries from the session JSONL file. For each entry, tracks `peakContextByModel[model]` = max per-request context (input + cache_creation + cache_read for a single API call).

2. **Result JSON merge** (`mergeResultModelUsage`): When Claude Code finishes, it emits a success event with `modelUsage` containing cumulative per-model totals. For sub-agent models (like Haiku used by Claude Code internally for Explore agents), their messages don't appear in the main session JSONL file, so their usage data comes **only** from this result JSON.

3. **Peak context assignment** (`claude.lib.mjs:601`): After merging, sets `usage.peakContextUsage = peakContextByModel[modelId] || 0`. For result-JSON-only models, `peakContextByModel[modelId]` is undefined, so `peakContextUsage = 0`.

4. **Fallback in display** (`claude.budget-stats.lib.mjs`): When `peakContextUsage === 0`, the code falls back to `cumulativeContext = inputTokens + cacheCreationTokens + cacheReadTokens`. This cumulative value spans ALL requests, and can exceed the model's context limit.

### The bug

The fallback `cumulativeContext` was intended as a best-effort approximation when peak data isn't available, but it's fundamentally wrong because:

- **Context window is per-request**: A model's context limit applies to each individual API request, not to the sum of all requests
- **cacheReadTokens inflate the total**: Cache reads are counted per-request but the cumulative total across many requests can be many times larger than the context window
- **Percentages >100% are impossible**: No model can use more than its context window in a single request

### Affected code locations

All three places compute the same wrong fallback:

1. `displayBudgetStats()` line 183: `cumulativeContext = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens`
2. `buildBudgetStatsString()` line 369: same calculation
3. `formatSubSessionsList()` line 279: same calculation for sub-sessions
4. `displayBudgetStats()` line 165: same calculation for multi-sub-session case

## Fix

When `peakContextUsage` is 0 (unknown), skip the context window display for that model entirely. The cumulative total is already shown on the "Total:" line, which correctly separates non-cached and cached input tokens. Showing cumulative data as "context window" usage is misleading.

For sub-sessions, the same logic applies: when `peakContextUsage` is 0, skip the context window part but still show output token usage if available.

## Timeline

1. Issue #1501 (earlier): Introduced `peakContextUsage` tracking per-request from JSONL
2. Issue #1508 (earlier): Added multi-model support, result JSON merging; the fallback to cumulative was added for models not in JSONL
3. Issue #1526 (earlier): Reformatted to single-line format; the fallback calculation remained
4. Issue #1539 (this): User noticed the 250% impossible percentage; root cause is the cumulative fallback

## Evidence

- Full log: `solution-draft-log-pr-1775568693185.txt` (in this directory)
- Existing test `test-budget-stats-issue-1508.mjs` line 304 explicitly expected `765.5K / 200K input tokens (383%)` — confirming the bug was coded into the test as "expected" behavior
