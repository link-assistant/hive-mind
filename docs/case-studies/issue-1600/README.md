# Issue #1600: Calculation Bugs Need to Be Fixed

## Summary

Multiple bugs in token/cost calculation display and formatting, identified across three PR comments:

1. [doublets-rs #48](https://github.com/linksplatform/doublets-rs/pull/48#issuecomment-4242565890)
2. [web-capture #55](https://github.com/link-assistant/web-capture/pull/55#issuecomment-4243452453)
3. [hive-mind #1621](https://github.com/link-assistant/hive-mind/pull/1621#issuecomment-4265646700)
4. [hive-mind #1615 Codex review example](https://github.com/link-assistant/hive-mind/pull/1615#issuecomment-4254674907)

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

### R7: Do not print unavailable token fields as zero

- **Source**: PR #1622 review comment citing hive-mind #1615 Codex logs
- **Problem**: Codex exposes `input_tokens`, `cached_input_tokens`, and `output_tokens`; it does not expose cache write tokens, so `0 cache write` was misleading
- **Solution**: Track token field availability from parser events and only print optional fields when they were observed or are non-zero

### R8: Keep cost/token output unified across supported tools

- **Source**: PR #1622 review request for Claude, Codex, and OpenCode/Agent consistency
- **Problem**: Similar cost/token formatting lived in separate copies and could drift across tools
- **Solution**: Extract shared GitHub cost comment formatting and feed it precise token availability from Codex and Agent parsers

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

### hive-mind #1615 Codex sample

Raw Codex verbose logs showed usage events with `input_tokens`, `cached_input_tokens`, and `output_tokens` only. No cache write field was observed. The fixed token line keeps the known fields and omits unavailable cache write data:

```
Token usage: 44,823 input, 3,031 output, 388,480 cache read
```

## Downloaded Raw Logs

The referenced log artifacts were downloaded locally under `docs/case-studies/issue-1600/logs/` for offline verification. The raw files are ignored because they total about 54 MB; the source manifest is tracked in `logs/README.md`.

- `doublets-rs-pr-48-claude-code.log` - 14,321,843 bytes
- `web-capture-pr-55-claude-code.log` - 1,941,786 bytes
- `hive-mind-pr-1621-claude-code.log` - 2,828,019 bytes
- `hive-mind-pr-1615-codex-initial.log` - 7,185,779 bytes
- `hive-mind-pr-1615-codex-auto-restart-1.log` - 11,870,428 bytes
- `hive-mind-pr-1615-codex-auto-merge-1.log` - 15,938,506 bytes

## Solution Approach

### Library: decimal.js-light

- **Package**: [decimal.js-light](https://www.npmjs.com/package/decimal.js-light) (lightweight version of decimal.js)
- **Purpose**: Arbitrary-precision decimal arithmetic to avoid IEEE 754 floating-point rounding
- **Usage**: All cost calculations (`calculateModelCost`, `calculateAgentPricing`, `buildCostInfoString`, `displayCostComparison`, `buildBudgetStatsString`)

### Files Modified

- `src/claude.budget-stats.lib.mjs` - Display formatting, cost comparison, budget stats
- `src/claude.lib.mjs` - Core cost calculation with Decimal
- `src/github-cost-info.lib.mjs` - Shared PR comment cost string builder
- `src/github.lib.mjs` - Uses the shared cost string builder
- `src/codex.lib.mjs` - Codex token field availability tracking
- `src/agent.lib.mjs` - Agent pricing calculation and token field availability tracking
- `tests/test-build-cost-info-string.mjs` - Production cost string formatter tests
- `tests/test-codex-support.mjs` - Codex parser token field availability tests
- `tests/test-agent-budget-stats-1526.mjs` - Agent parser zero cache write availability tests
- `tests/test-agent-token-usage.mjs` - Uses production parser and cost formatter in display pipeline tests
- `tests/test-issue-1600-comprehensive.mjs` - Comprehensive format and cost precision tests
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
