# Issue #1250: Fix `--tool agent` Pricing Display

## Problem Statement

When using `--tool agent` with free models from OpenCode Zen (like `kimi-k2.5-free`), the pricing display showed:

```
Provider: OpenCode Zen
Public pricing estimate: $0.00 (Free model)
Calculated by OpenCode Zen: $0.00 (Free model)
Token usage: 0 input, 0 output
```

The issues were:

1. **Public pricing estimate shows $0.00** - Should show actual market price based on the base model (e.g., `kimi-k2.5`)
2. **Token usage shows 0 input, 0 output** - Token counting appeared broken

## Root Cause Analysis

### Issue 1: Public Pricing Estimate of $0.00

The `calculateAgentPricing` function fetched model info from models.dev API. When looking up `kimi-k2.5-free`:

- The model was found in OpenCode Zen provider
- The model has `cost: {"input": 0, "output": 0, "cache_read": 0}` (free pricing)
- This resulted in `isFreeModel: true` and `totalCostUSD: 0`

The actual market price for this model should be based on the base model `kimi-k2.5` from Moonshot AI, which has pricing `$0.6/1M input, $3/1M output`.

### Issue 2: Token Usage of 0

Investigation of the logs showed that `step_finish` events with token data ARE present in the agent output. The token parsing function `parseAgentTokenUsage` correctly parses NDJSON format.

**Root cause identified**: The issue was in how `fullOutput` was collected during streaming. When the agent sends data quickly, NDJSON lines can be concatenated without newline separators between them. For example:

```
{"type":"step_finish",...}{"type":"step_finish",...}
```

Instead of:

```
{"type":"step_finish",...}
{"type":"step_finish",...}
```

When `JSON.parse` encounters two JSON objects concatenated together, it fails to parse. The `parseAgentTokenUsage` function was running on `fullOutput` after streaming completed, missing tokens from lines that were concatenated.

## Solution

### Fix 1: Base Model Pricing Lookup

Added `getBaseModelForPricing` helper function that:

1. Maps free model names to their base paid equivalents (e.g., `kimi-k2.5-free` -> `kimi-k2.5`)
2. Handles the `-free` suffix pattern generically
3. Returns both the base model name and a flag indicating it's a free variant

Modified `calculateAgentPricing` to:

1. First fetch the free model info to get the model name
2. If the model has zero pricing, fetch the base model for actual pricing
3. Calculate public pricing estimate using the base model's cost
4. Return `baseModelName` for transparency in display

### Fix 2: Enhanced Cost Display

Modified `buildCostInfoString` to:

1. Show base model reference when pricing comes from a base model
2. Format: `Public pricing estimate: $X.YZ (based on Moonshot AI kimi-k2.5 prices)`
3. Distinguish between truly free models (no paid equivalent) and free access to paid models

### Fix 3: Streaming Token Accumulation (Token Usage Bug)

The fix accumulates token usage **during streaming** instead of trying to re-parse `fullOutput` afterward:

1. Added `streamingTokenUsage` object to track tokens as events arrive
2. Added `accumulateTokenUsage` helper function called when parsing each JSON line
3. Process `step_finish` events in real-time during both stdout and stderr streaming
4. Use `streamingTokenUsage` instead of `parseAgentTokenUsage(fullOutput)` for final result

This approach is more reliable because:

- Each JSON line is parsed individually as it arrives
- Avoids the concatenation issue where lines lack newline separators
- Follows the same pattern as Issue #1201's streaming error detection fix

## Expected Output After Fix

```
Model: Kimi K2.5 Free
Provider: OpenCode Zen
Public pricing estimate: $3.60 (based on Moonshot AI kimi-k2.5 prices)
Calculated by OpenCode Zen: $0.00 (Free model)
Token usage: 15,438 input, 107 output
```

## Files Changed

- `src/agent.lib.mjs` - Added `getBaseModelForPricing`, enhanced `calculateAgentPricing`, and streaming token accumulation
- `src/github.lib.mjs` - Enhanced `buildCostInfoString` to show base model reference
- `tests/test-build-cost-info-string.mjs` - Added tests for base model pricing
- `tests/test-agent-token-usage.mjs` - Added comprehensive tests for token parsing and streaming accumulation

## Testing

All unit tests pass:

- 42 tests for `buildCostInfoString` (Issue #1015 & #1250)
- 16 tests for agent token usage parsing (Issue #1250)

Tests specifically for Issue #1250:

- Base model pricing for kimi-k2.5-free
- Regular free model pricing when base model has no pricing
- Base model reference with original provider
- Base model pricing with cache tokens
- No base model reference when not applicable
- Streaming token accumulation correctly sums all step_finish events
- Concatenated JSON without newlines (demonstrates the bug)
- Real-world agent output format parsing

## References

- Original issue: https://github.com/link-assistant/hive-mind/issues/1250
- Related comments:
  - https://github.com/link-assistant/hive-mind/pull/1247#issuecomment-3874199375
  - https://github.com/veb86/zcadvelecAI/pull/741#issuecomment-3887131244
- models.dev API: https://models.dev/api.json
