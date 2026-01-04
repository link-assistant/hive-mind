# Root Cause Analysis: Issue #944

## Executive Summary

Issue #944 requested the implementation of `--tokens-budget-stats` option for the Claude tool to display token usage statistics. While the feature was already implemented in version 0.54.0, a critical bug prevented it from working when used via the `hive-telegram-bot` command with override configurations.

**Root Cause**: Type mismatch in `lino.parse()` return values - the method can return non-string objects, but the code assumed all values were strings and called `.trim()` on them.

**Impact**: `TypeError: line.trim is not a function` crash when attempting to use `--tokens-budget-stats` flag in telegram bot override configurations.

**Fix**: Changed from `lino.parse()` to `lino.parseStringValues()` which explicitly filters and returns only string values.

## Feature Status Analysis

### Already Implemented Components

1. **Configuration Option** (✅ Complete)
   - Defined in `src/solve.config.lib.mjs:269`
   - Defined in `src/hive.config.lib.mjs:259`
   - Type: boolean (default: false)
   - Description: "[EXPERIMENTAL] Show detailed token budget statistics including context window usage and ratios. Only supported for --tool claude."

2. **Display Module** (✅ Complete)
   - File: `src/claude.budget-stats.lib.mjs`
   - Function: `displayBudgetStats(usage, log)`
   - Features:
     - Shows context window usage (absolute values)
     - Shows context window usage (percentage/ratio)
     - Shows output token usage (absolute values and ratio)
     - Shows total session tokens
     - Displays "not available" message when model limits are missing

3. **Integration** (✅ Complete)
   - File: `src/claude.lib.mjs:1290`
   - Condition: `if (argv.tokensBudgetStats && usage.modelInfo?.limit)`
   - Calls: `displayBudgetStats(usage, log)`

4. **Model Information Fetching** (✅ Complete)
   - Function: `fetchModelInfo(modelId)` in `src/claude.lib.mjs:508`
   - API: `https://models.dev/api.json`
   - Returns model data including:
     - `limit.context`: Maximum context window size in tokens
     - `limit.output`: Maximum output tokens
     - `cost`: Pricing information
     - Other model metadata

### The Bug

**Location**: `src/telegram-bot.mjs:162`

**Problematic Code**:
```javascript
const hiveOverrides = resolvedHiveOverrides
  ? lino
      .parse(resolvedHiveOverrides)  // ❌ Returns mixed types
      .map(line => line.trim())       // ❌ Fails on non-strings
      .filter(line => line)
  : [];
```

**Why It Failed**:
1. `lino.parse()` method (from `src/lino.lib.mjs:18-40`) can return values of type `value.id || value`
2. When `value` is an object (not a string), `value.id` might be undefined, causing `value` itself to be returned
3. Calling `.trim()` on a non-string object throws `TypeError: line.trim is not a function`

**Evidence from lino.lib.mjs**:
```javascript
parse(input) {
  // ...
  for (const value of link.values) {
    const val = value.id || value;  // ← Can return object if value.id is undefined
    values.push(val);
  }
  // ...
}
```

### The Fix

**New Code**:
```javascript
const hiveOverrides = resolvedHiveOverrides
  ? lino
      .parseStringValues(resolvedHiveOverrides)  // ✅ Returns only strings
      .map(line => line.trim())                   // ✅ Safe to call .trim()
      .filter(line => line)
  : [];
```

**Why It Works**:
1. `lino.parseStringValues()` method (from `src/lino.lib.mjs:71-97`) explicitly filters for string types
2. Type guard: `if (typeof linkStr === 'string')` ensures only strings are returned
3. Safe to call `.trim()` on guaranteed string values

**Evidence from lino.lib.mjs**:
```javascript
parseStringValues(input) {
  // ...
  for (const value of link.values) {
    const linkStr = value.id || value;
    if (typeof linkStr === 'string') {  // ← Explicit type check
      links.push(linkStr);
    }
  }
  // ...
}
```

## Technical Details

### Links Notation Format

The system uses "Links Notation" (lino) to parse configuration values. This is a custom format managed by the `links-notation` npm package (loaded via `use-m`).

**Parser Methods**:
- `parse()`: Returns all values (mixed types: strings, objects, numbers)
- `parseStringValues()`: Returns only string values (type-safe)
- `parseNumericIds()`: Returns only numeric IDs

**Usage Pattern**:
```
TELEGRAM_HIVE_OVERRIDES:
  --all-issues
  --once
  --tokens-budget-stats
```

### Models.dev API Integration

The system fetches model limits from `https://models.dev/api.json`:

**API Structure**:
```json
{
  "anthropic": {
    "id": "anthropic",
    "name": "Anthropic",
    "models": {
      "claude-opus-4-0": {
        "limit": {
          "context": 200000,
          "output": 32000
        },
        "cost": {
          "input": 15,
          "output": 75,
          "cache_read": 1.5,
          "cache_write": 18.75
        }
      }
    }
  }
}
```

**Current Coverage** (as of 2026-01-04):
- 21 Claude models in Anthropic provider
- All models include `limit.context` and `limit.output` fields
- Pricing information available for all models

### Token Budget Statistics Display

When `--tokens-budget-stats` is enabled, the system displays:

1. **Context Window Stats**:
   - Used: Total input tokens (input + cache_creation + cache_read)
   - Limit: From models.dev API (`limit.context`)
   - Ratio: Used/Limit as decimal and percentage

2. **Output Token Stats**:
   - Used: Total output tokens
   - Limit: From models.dev API (`limit.output`)
   - Ratio: Used/Limit as decimal and percentage

3. **Total Session Tokens**:
   - Sum of: inputTokens + cacheCreationTokens + outputTokens

**Example Output**:
```
📊 Token Budget Statistics:
  Context window:
    Used: 35,000 tokens
    Limit: 200,000 tokens
    Ratio: 0.1750 (17.50%)
  Output tokens:
    Used: 5,000 tokens
    Limit: 32,000 tokens
    Ratio: 0.1562 (15.62%)
  Total session tokens: 40,000
```

## Testing Considerations

### Test Scenarios

1. **Override Parsing with --tokens-budget-stats**:
   - Input: LINO format with `--tokens-budget-stats` flag
   - Expected: Array of strings including `--tokens-budget-stats`
   - Validates: `parseStringValues()` correctly extracts string values

2. **Budget Stats Display**:
   - Input: Model with limit information from models.dev
   - Expected: Formatted statistics with ratios and percentages
   - Validates: Calculation logic and formatting

3. **Missing Model Limits**:
   - Input: Model not found in models.dev API
   - Expected: Warning message "Budget stats not available"
   - Validates: Graceful degradation

4. **Edge Cases**:
   - Empty override configurations
   - Non-string values in LINO format
   - Network failures when fetching models.dev API

## Related Code

### Files Modified
- `src/telegram-bot.mjs` (lines 151-164)

### Files Analyzed
- `src/claude.budget-stats.lib.mjs` (display logic)
- `src/claude.lib.mjs` (integration point)
- `src/solve.config.lib.mjs` (option definition)
- `src/hive.config.lib.mjs` (option definition)
- `src/lino.lib.mjs` (parsing logic)

### External Dependencies
- `links-notation` npm package (via use-m)
- `https://models.dev/api.json` (model limits data)

## Conclusion

The `--tokens-budget-stats` feature was already fully implemented and functional for direct command-line usage. The bug only manifested when using the feature through the telegram bot's override configuration system due to improper handling of LINO parser return types.

The fix is minimal (2 lines changed) but critical - using the type-safe `parseStringValues()` method instead of the generic `parse()` method ensures string type consistency throughout the parsing pipeline.

This issue highlights the importance of:
1. Using type-safe methods when available
2. Testing integration points (CLI vs bot vs config files)
3. Understanding library behavior (what types does it return?)
4. Clear documentation of method contracts
