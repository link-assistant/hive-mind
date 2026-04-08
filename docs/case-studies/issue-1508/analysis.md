# Case Study: Issue #1508 - Fix context, token and cost estimation calculation accuracy

## Problem Statement

When multiple models are used in a single Claude Code session (e.g., Opus for main tasks + Haiku for sub-agent operations), the token usage and cost estimation had two issues:

1. **Token and context usage was not split by model** - The budget stats displayed in PR comments showed aggregated numbers without per-model breakdown
2. **Cost estimation discrepancy between our calculation and Anthropic's** - Our public pricing estimate was significantly lower than Anthropic's official cost

## Data Source

PR #1507 comment ([link](https://github.com/link-assistant/hive-mind/pull/1507#issuecomment-4158663420)):

- Public pricing estimate: $1.592512
- Calculated by Anthropic: $2.364240 USD
- Difference: $0.771728 (+48.46%)
- Models used: Claude Opus 4.6 (primary) + Claude Haiku 4.5 (sub-agent)

Session gist: https://gist.github.com/konard/a079c610a912cdbf6ae5b9ac107ddea7

## Root Cause Analysis

### Data Sources for Token Tracking

There are three independent sources of token data in the system:

| Source            | Location                                   | Completeness                                                          |
| ----------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| **JSONL file**    | `~/.claude/projects/<dir>/<session>.jsonl` | Only contains entries visible in the stream (misses sub-agent models) |
| **Stream events** | Real-time `type=assistant` events          | Same as JSONL — only main model                                       |
| **Result JSON**   | `type=result` event's `modelUsage` field   | **Complete** — per-model breakdown from Anthropic                     |

### Issue 1: Missing Sub-Agent Model Tokens in JSONL

When Claude Code uses sub-agents (e.g., Haiku for file operations, planning), those API calls are internal to the Claude Code CLI. The JSONL file only records the main model's entries that appear in the stream output. The sub-agent model entries are **not** written to the JSONL file.

**Evidence from the session log:**

JSONL-based calculation (only Opus):

- Input: 46 tokens, Cache write: 60,756, Cache read: 2,147,714, Output: 5,548
- Cost: $1.592512

Result JSON `modelUsage` (both models):

- **Opus**: input=58, output=20,546, cacheRead=2,276,830, cacheCreate=87,556, cost=$2.1996
- **Haiku**: input=1,649, output=5,411, cacheRead=712,034, cacheCreate=51,802, cost=$0.1647

### Issue 2: Cost Discrepancy Explained

The 48.46% cost difference ($0.771728) is fully explained by:

1. **Missing Haiku cost**: $0.1647 (not counted at all)
2. **Opus token under-count**: JSONL had fewer tokens than the authoritative result JSON
   - JSONL Opus cost: $1.5925 vs Result JSON Opus cost: $2.1996 (difference: $0.6071)
   - This is because the JSONL misses some Opus entries (possibly internal retries or multi-block responses not captured)

Total discrepancy: $0.1647 + $0.6071 = $0.7718 ≈ $0.7717 (matches observed difference)

### Issue 3: Sub-Sessions Not Split by Model

The `buildBudgetStatsString` function displayed global sub-sessions (compactification boundaries) under **each** model heading in multi-model mode. Since sub-sessions are session-wide (not model-specific), this was misleading and duplicative.

## Solution

### 1. Merge `resultModelUsage` into JSONL-based calculations

Modified `calculateSessionTokens()` to accept an optional `resultModelUsage` parameter. When provided:

- Models not in JSONL are added from resultModelUsage (solves missing sub-agent models)
- Models in JSONL but with lower token counts are updated from resultModelUsage (solves under-counting)
- Per-model costUSD from resultModelUsage is preserved as a fallback

### 2. Split budget stats by model

Modified `buildBudgetStatsString()` to:

- Show per-model token totals (input, cached, output) separately
- Show per-model cost when available
- Display sub-sessions once globally (not duplicated per model) for multi-model sessions

### 3. Add verbose diagnostics

Added verbose logging to indicate when data was sourced from result JSON vs JSONL, enabling easier debugging of future discrepancies.

## Impact

After this fix:

- The public pricing estimate will include all models' costs, significantly reducing the discrepancy with Anthropic's official cost
- PR comments will show per-model token and cost breakdown
- Sub-sessions are displayed correctly without duplication in multi-model scenarios
- Remaining discrepancies (if any) will be due to pricing differences between models.dev API and Anthropic's internal pricing

## Related Issues

- Issue #1454: resultModelUsage support (model display only)
- Issue #1491: Sub-session tracking
- Issue #1501: Peak context usage and JSONL deduplication
- anthropics/claude-code#6805: JSONL duplicate entries (upstream)
