# Case Study: Issue #1486 — `<synthetic>` Model Extraction and Cost Calculation Discrepancy

## Problem

When the hive-mind solver ran on [link-foundation/meta-theory#22](https://github.com/link-foundation/meta-theory/pull/22), the generated PR comment showed:

1. **`<synthetic>` model in "Models used" section**: An internal Claude CLI inference router model called `<synthetic>` appeared as an "Additional model" in the PR comment, with a failed info lookup ("Model info not available").
2. **Large cost discrepancy**: Public pricing estimate ($15.26) vs Anthropic official cost ($2.34) — an 84.68% difference.

### Observed PR Comment Output

```
### 💰 Cost estimation:
- Public pricing estimate: $15.257240
- Calculated by Anthropic: $2.337934 USD
- Difference: $-12.919306 (-84.68%)

### 🤖 Models used:
- Tool: Anthropic Claude Code
- Requested: `opus`
- Main model: Claude Opus 4.6 (claude-opus-4-6)
- Additional models:
  * <synthetic> (<synthetic>)
```

## Timeline

- **2026-03-28T20:12:13Z**: Solve session started for link-foundation/meta-theory#22 (PR #22)
- **2026-03-28T20:42:40Z**: Session completed after 39 turns (~30 minutes)
- **2026-03-28T20:42:41Z**: Token usage summary displayed, showing `<synthetic>` model with 0 tokens
- **2026-03-28T20:42:42Z**: PR comment posted with incorrect model data

## Root Cause Analysis

### Problem 1: `<synthetic>` Model in Output

**Root cause**: Claude CLI's inference router emits JSONL entries with `model: "<synthetic>"` in the session data file (`~/.claude/projects/<project>/<session>.jsonl`). These entries have 0 input tokens and 0 output tokens — they represent internal routing/discovery events, not actual model usage.

**Code path**:

1. `calculateSessionTokens()` in `src/claude.lib.mjs` parses EVERY line in the JSONL file
2. It creates a `modelUsage` entry for `<synthetic>` (with 0 tokens, null cost)
3. `attachLogToGitHub()` in `src/github.lib.mjs` extracts `actualModelIds` from `modelUsage` keys — including `<synthetic>`
4. The model ID selection logic at line 426 prefers the source with MORE models — JSONL had 2 models (`claude-opus-4-6` + `<synthetic>`) vs result JSON's 1 (`claude-opus-4-6`), so JSONL wins
5. `getModelInfoForComment()` in `src/models/index.mjs` tries to fetch info for `<synthetic>` from models.dev API and fails
6. The `<synthetic>` model appears in the PR comment with "Model info not available"

**Prior art**: This same `<synthetic>` model was encountered in issue #789, where a typo in `--model oups` triggered internal routing. The fix in #789 added early model validation but did not filter `<synthetic>` from session data.

### Problem 2: Cost Discrepancy (Expected Behavior)

**Finding**: The cost discrepancy is NOT a bug — it's expected behavior showing the difference between public API list prices and actual Anthropic billing.

**Evidence**:

- JSONL session sums (39 turns): `input: 289, cache_creation: 581,659, cache_read: 20,999,543, output: 42,583`
- Result JSON (Anthropic billing): `input: 39, cache_creation: 89,964, cache_read: 3,172,578, output: 7,567`
- JSONL values are ~6-7x larger because they sum ALL API calls across all conversation turns
- Each turn re-sends the full context window, so cached tokens are counted per-call
- Public pricing: $15.20 = raw token counts × models.dev list prices
- Anthropic cost: $2.34 = actual billing with internal caching discounts (Claude Code subscription tier)

**Comparison with other sessions on the same PR**:
| Session | Public Price | Anthropic Cost | Difference |
|---------|-------------|----------------|------------|
| Session 1 (initial) | $4.61 | $3.06 | -33.65% |
| Session 2 (auto-restart) | $0.84 | $0.46 | -45.53% |
| Session 3 (this issue) | $15.26 | $2.34 | -84.68% |

Session 3 has a much higher difference because it used extensive prompt caching (20.9M cache read tokens across 39 turns), making the caching discount much more significant.

## Fix

### Changes Made

1. **`src/claude.lib.mjs` — `calculateSessionTokens()`**: Added a filter to skip JSONL entries where the model name matches `<synthetic>` or any `<...>` pattern (internal/synthetic models from Claude CLI's inference router).

2. **`src/github.lib.mjs` — `attachLogToGitHub()`**: Added a safety-net filter on `actualModelIds` to remove any `<...>` model IDs before passing them to `getModelInfoForComment()`.

### After Fix

The PR comment will show:

```
### 🤖 Models used:
- Tool: Anthropic Claude Code
- Requested: `opus`
- Model: Claude Opus 4.6 (claude-opus-4-6)
```

No `<synthetic>` model. Cost discrepancy remains (expected behavior — public vs. Anthropic pricing).

## Data Files

- `full-log.txt` — Complete solve session log (20,305 lines)
- `pr-comment-output.txt` — The problematic PR comment text
- `token-comparison.json` — Token count comparison between JSONL and result JSON

## Related Issues

- Issue #789 — First encounter with `<synthetic>` model (typo-triggered)
- Issue #1225 — Model extraction from session data
- Issue #1454 — Multi-model display from resultModelUsage
