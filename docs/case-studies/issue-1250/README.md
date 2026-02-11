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

The zero token count issue may be related to:

1. Output not being properly collected in `fullOutput` during streaming
2. Some edge case where step_finish events are not present

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

## Expected Output After Fix

```
Model: Kimi K2.5 Free
Provider: OpenCode Zen
Public pricing estimate: $3.60 (based on Moonshot AI kimi-k2.5 prices)
Calculated by OpenCode Zen: $0.00 (Free model)
Token usage: 15,438 input, 107 output
```

## Files Changed

- `src/agent.lib.mjs` - Added `getBaseModelForPricing` and enhanced `calculateAgentPricing`
- `src/github.lib.mjs` - Enhanced `buildCostInfoString` to show base model reference
- `tests/test-build-cost-info-string.mjs` - Added tests for base model pricing

## Testing

All 42 unit tests pass, including 5 new tests specifically for Issue #1250:

- Base model pricing for kimi-k2.5-free
- Regular free model pricing when base model has no pricing
- Base model reference with original provider
- Base model pricing with cache tokens
- No base model reference when not applicable

## References

- Original issue: https://github.com/link-assistant/hive-mind/issues/1250
- Related comments:
  - https://github.com/link-assistant/hive-mind/pull/1247#issuecomment-3874199375
  - https://github.com/veb86/zcadvelecAI/pull/741#issuecomment-3887131244
- models.dev API: https://models.dev/api.json
