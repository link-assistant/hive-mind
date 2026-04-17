# Issue #1600: Calculation Bugs Need to Be Fixed

## Summary

Multiple bugs in token/cost calculation display and formatting, identified across three PR comments:

1. [doublets-rs #48](https://github.com/linksplatform/doublets-rs/pull/48#issuecomment-4242565890)
2. [web-capture #55](https://github.com/link-assistant/web-capture/pull/55#issuecomment-4243452453)
3. [hive-mind #1621](https://github.com/link-assistant/hive-mind/pull/1621#issuecomment-4265646700)

## Requirements Extracted

### R1: Remove "Context window:" prefix repetition

- **Source**: doublets-rs #48 comment
- **Problem**: "Context window:" prefix is redundant in multi-session and sub-agent format
- **Solution**: Remove the prefix, unify format between main model and sub-agent displays

### R2: Fix output token display for Haiku sub-agent sessions

- **Source**: doublets-rs #48 (`7 / 64K (0%) output tokens`, `4 / 64K (0%) output tokens`)
- **Source**: web-capture #55 (`282 / 64K (0%) output tokens`)
- **Problem**: Sub-agent models with single sessions showed no detalization line at all when peakContext was 0
- **Solution**: Show output-only detalization line for sub-agent single sessions even without peak context data

### R3: Add session segment count to model title

- **Source**: doublets-rs #48
- **Problem**: No indication of how many session segments exist for the main model
- **Solution**: Add `(N session segments)` to the model name header when multiple sub-sessions exist

### R4: Unify code for sub-agent session display

- **Source**: doublets-rs #48, web-capture #55, hive-mind #1621
- **Problem**: Haiku and Sonnet sub-agent sessions lacked detalization that other models had
- **Solution**: Show bullet-marked list for single session, numbered list for multiple sessions, consistently across all models

### R5: Fix floating-point precision in cost calculations

- **Source**: hive-mind #1621 (`$-0.000000 (-0.00%)` difference when actual difference exists)
- **Problem**: JavaScript floating-point arithmetic causes rounding errors in cost calculations
- **Solution**: Use [decimal.js-light](https://www.npmjs.com/package/decimal.js-light) for all token pricing and cost calculations

### R6: Fix cost difference display precision

- **Source**: hive-mind #1621 (Public: $4.145262, Anthropic: $4.145261, Difference: $-0.000000)
- **Problem**: Difference between $4.145262 and $4.145261 shows as $-0.000000 due to floating-point subtraction
- **Solution**: Use Decimal arithmetic for difference calculation so $0.000001 differences are visible

## Data from Referenced Comments

### doublets-rs #48 (3 session segments, 2 Haiku sub-agent calls)

```
Claude Opus 4.6:
1. Context window: 166.5K / 1M (17%) input tokens, 41.4K / 128K (32%) output tokens
2. Context window: 167.0K / 1M (17%) input tokens, 47.2K / 128K (37%) output tokens
3. Context window: 59.4K / 1M (6%) input tokens, 9.3K / 128K (7%) output tokens

Total: (521.3K + 44.8M cached) input tokens, 126.0K output tokens, $28.812422 cost

Claude Haiku 4.5: (2 sub-agent calls)
Sub-agent calls:
1. 68.0K / 200K (34%) input tokens, 7 / 64K (0%) output tokens
2. 41.9K / 200K (21%) input tokens, 4 / 64K (0%) output tokens

Total: (93.8K + 1.7M cached) input tokens, 14.5K output tokens, $0.364350 cost

Claude Sonnet 4.6:
Total: (72.2K + 2.8M cached) input tokens, 18.6K / 64K (29%) output tokens, $1.380428 cost
```

### web-capture #55 (single session, Haiku and Sonnet sub-agents)

```
Claude Opus 4.6:
- Context window: 106.3K / 1M (11%) input tokens, 19.7K / 128K (15%) output tokens

Total: (98.0K + 4.6M cached) input tokens, 19.7K output tokens, $3.419780 cost

Claude Sonnet 4.6:
Total: (25.6K + 49.0K cached) input tokens, 1.8K / 64K (3%) output tokens, $0.137594 cost

Claude Haiku 4.5:
Total: (21.4K + 20.7K cached) input tokens, 282 / 64K (0%) output tokens, $0.030241 cost
```

**Bug**: Sonnet and Haiku show no per-session detalization line (only Total line).

### hive-mind #1621 (single session, Haiku sub-agent)

```
Cost estimation:
- Public pricing estimate: $4.145262
- Calculated by Anthropic: $4.145261
- Difference: $-0.000000 (-0.00%)

Claude Opus 4.6:
- Context window: 101.9K / 1M (10%) input tokens, 26.7K / 128K (21%) output tokens

Total: (105.3K + 5.2M cached) input tokens, 26.7K output tokens, $3.907074 cost

Claude Haiku 4.5:
Total: (108.0K + 790.1K cached) input tokens, 5.6K / 64K (9%) output tokens, $0.238188 cost
```

**Bugs**:

1. Difference shows `$-0.000000` when actual difference is `$-0.000001`
2. Haiku shows no per-session detalization line

## Solution Approach

### Library: decimal.js-light

- **Package**: [decimal.js-light](https://www.npmjs.com/package/decimal.js-light) (lightweight version of decimal.js)
- **Purpose**: Arbitrary-precision decimal arithmetic to avoid IEEE 754 floating-point rounding
- **Usage**: All cost calculations (`calculateModelCost`, `calculateAgentPricing`, `buildCostInfoString`, `displayCostComparison`, `buildBudgetStatsString`)

### Files Modified

- `src/claude.budget-stats.lib.mjs` - Display formatting, cost comparison, budget stats
- `src/claude.lib.mjs` - Core cost calculation with Decimal
- `src/github.lib.mjs` - PR comment cost string builder
- `src/agent.lib.mjs` - Agent pricing calculation
- `tests/test-build-cost-info-string.mjs` - Updated test copy
- `tests/test-issue-1600-budget-stats.mjs` - New test file
- `package.json` - Added decimal.js-light dependency

## Expected Output After Fix

### doublets-rs #48 format (fixed)

```
Claude Opus 4.6: (3 session segments)
1. 166.5K / 1M (17%) input tokens, 41.4K / 128K (32%) output tokens
2. 167.0K / 1M (17%) input tokens, 47.2K / 128K (37%) output tokens
3. 59.4K / 1M (6%) input tokens, 9.3K / 128K (7%) output tokens

Total: (521.3K + 44.8M cached) input tokens, 126.0K output tokens, $28.812422 cost

Claude Haiku 4.5: (2 sub-agent calls)
Sub-agent calls:
1. 68.0K / 200K (34%) input tokens, 7 / 64K (0%) output tokens
2. 41.9K / 200K (21%) input tokens, 4 / 64K (0%) output tokens

Total: (93.8K + 1.7M cached) input tokens, 14.5K output tokens, $0.364350 cost

Claude Sonnet 4.6:
- 18.6K / 64K (29%) output tokens

Total: (72.2K + 2.8M cached) input tokens, 18.6K output tokens, $1.380428 cost
```

### hive-mind #1621 format (fixed)

```
Cost estimation:
- Public pricing estimate: $4.145262
- Calculated by Anthropic: $4.145261
- Difference: $-0.000001 (-0.00%)

Claude Haiku 4.5:
- 5.6K / 64K (9%) output tokens

Total: (108.0K + 790.1K cached) input tokens, 5.6K output tokens, $0.238188 cost
```
