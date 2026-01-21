# Case Study: DecimalError Invalid Argument in `--tool agent`

**Issue:** [#1112](https://github.com/link-assistant/hive-mind/issues/1112)
**Agent Issue:** [link-assistant/agent#119](https://github.com/link-assistant/agent/issues/119)
**Date:** 2026-01-11
**Status:** Fix Applied (verbose propagation), Agent Issue Created

## Summary

When using `--tool agent` with certain AI models, an error `[DecimalError] Invalid argument: [object Object]` occurs, causing the agent session to terminate unexpectedly.

## Error Details

```json
{
  "type": "error",
  "timestamp": 1768117505190,
  "sessionID": "ses_453fc239effeodwAgOXB0q2qX8",
  "error": {
    "name": "UnknownError",
    "data": {
      "message": "Error: [DecimalError] Invalid argument: [object Object]"
    }
  }
}
```

## Timeline of Events

1. **2026-01-11T07:44:22.885Z** - Solve command initiated with `--tool agent` using `opencode/grok-code` model
2. **2026-01-11T07:44:52.234Z** - Agent execution started
3. **2026-01-11T07:44:55.566Z** - First step started (`step_start` event)
4. **2026-01-11T07:45:05.140Z** - `todowrite` tool called with 25 todos
5. **2026-01-11T07:45:05.168Z** - Tool completed successfully with metadata
6. **2026-01-11T07:45:05.190Z** - **Error occurred**: `[DecimalError] Invalid argument: [object Object]`

## Root Cause Analysis

### Primary Issue: Malformed Usage Data from Provider

The error originates in the `Session.getUsage()` function in `link-assistant/agent` when calculating token costs. The function receives usage data from the AI provider and attempts to create `Decimal` objects for cost calculation.

**Location:** `js/src/session/index.ts` lines 326-388

```typescript
const tokens = {
  input: adjustedInputTokens,
  output: input.usage.outputTokens ?? 0,
  reasoning: input.usage?.reasoningTokens ?? 0,
  cache: {
    write: (input.metadata?.['anthropic']?.['cacheCreationInputTokens'] ?? input.metadata?.['bedrock']?.['usage']?.['cacheWriteInputTokens'] ?? 0) as number,
    read: cachedInputTokens,
  },
};

// Cost calculation using Decimal
return {
  cost: new Decimal(0).add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000)),
  // ... more calculations
};
```

### Secondary Issue: Missing Input Validation

Unlike the upstream OpenCode implementation, the `link-assistant/agent` fork is missing the `safe()` wrapper function that sanitizes numeric inputs:

**OpenCode (upstream) has:**

```typescript
const safe = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return value;
};

const tokens = {
  input: safe(adjustedInputTokens),
  output: safe(input.usage.outputTokens ?? 0),
  // ...
};
```

**link-assistant/agent is missing this protection.**

### Root Cause: Provider Returns Object Instead of Number

When certain providers (like OpenCode Zen with `grok-code` model) return usage metadata, they may include:

1. An object where a number is expected
2. `undefined` or `null` values
3. Non-finite numbers like `NaN` or `Infinity`

The `decimal.js` library throws `[DecimalError] Invalid argument: [object Object]` when it receives an object instead of a valid numeric type.

## Evidence

### Related Issues

- [sst/opencode#6161](https://github.com/sst/opencode/issues/6161) - Same error pattern, resolved by upgrading
- [recharts/recharts#1738](https://github.com/recharts/recharts/issues/1738) - DecimalError with NaN
- [prisma/prisma#28674](https://github.com/prisma/prisma/issues/28674) - DecimalError with objects

### Key Observations

1. Error occurs during the `finish-step` event when usage data is processed
2. The `todowrite` tool itself completed successfully - error happened in usage calculation after
3. The `grok-code` model from OpenCode Zen has $0 cost (free tier), which may cause unusual metadata handling

## Solutions

### Immediate Fix: Add Input Validation (Recommended)

Add the `safe()` wrapper function to sanitize all numeric inputs before passing to Decimal:

```typescript
const safe = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0;
};
```

Apply to all token values:

```typescript
const tokens = {
  input: safe(adjustedInputTokens),
  output: safe(input.usage.outputTokens),
  reasoning: safe(input.usage?.reasoningTokens),
  cache: {
    write: safe(input.metadata?.['anthropic']?.['cacheCreationInputTokens'] ?? input.metadata?.['bedrock']?.['usage']?.['cacheWriteInputTokens']),
    read: safe(cachedInputTokens),
  },
};
```

### Secondary Fix: Try-Catch Wrapper

Wrap the cost calculation in a try-catch to prevent crash:

```typescript
try {
  return {
    cost: new Decimal(0)
      .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
      // ...
      .toNumber(),
    tokens,
  };
} catch (e) {
  log.error(() => ({ message: 'Cost calculation failed', error: e, tokens, costInfo }));
  return {
    cost: 0,
    tokens,
  };
}
```

### Workaround: Use Different Model

Until fixed, users can work around by:

1. Using a different provider/model that returns properly formatted usage data
2. Running with models that have known-good metadata handling (e.g., Anthropic Claude models)

## Verbose Mode Propagation

The issue also highlighted that when `--verbose` is enabled for `solve`, the verbosity should propagate to `--tool agent` to provide more debugging information for future investigations.

**Status:** Fixed in this PR. Added `--verbose` flag propagation in `src/agent.lib.mjs`.

## Files Modified

1. `link-assistant/hive-mind/src/agent.lib.mjs` - Propagate `--verbose` flag to agent tool (done)
2. `link-assistant/agent/js/src/session/index.ts` - Add `safe()` function (tracked in agent#119)

## References

- [decimal.js Documentation](https://mikemcl.github.io/decimal.js/)
- [OpenCode Source - Session Index](https://github.com/sst/opencode/blob/main/packages/opencode/src/session/index.ts)
- [Original Log Comment](https://github.com/veb86/GristWidgets/pull/2#issuecomment-3734192313)
