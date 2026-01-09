# Case Study: Issue #1086 - Some options overrides are not supported or not displayed for /hive command

## Issue Summary

**Issue URL**: https://github.com/link-assistant/hive-mind/issues/1086
**Type**: Bug
**Status**: Open
**Date Reported**: 2026-01-09

## Problem Statement

When configuring the Telegram bot with `TELEGRAM_HIVE_OVERRIDES`, some options (specifically `--auto-resume-on-limit-reset` and `--tokens-budget-stats`) are not displayed in the bot's startup output, despite being included in the configuration.

## Evidence from Issue Report

### Configuration Provided

```yaml
TELEGRAM_HIVE_OVERRIDES: --all-issues
  --once
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
  --auto-resume-on-limit-reset?  --tokens-budget-stats
```

### Bot Output (Showing Missing Options)

```
Hive overrides (lino): (
  --all-issues
  --once
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
)
```

**Expected**: 8 options should be displayed
**Actual**: Only 6 options are displayed

## Root Cause Analysis

### Discovery

Through experimental reproduction, I identified that the issue stems from how the LINO (Links Notation) parser handles options placed on the same line.

### The Parsing Chain

1. **Configuration Input** → `lenv-reader.lib.mjs` parses the YAML-like LINO format
2. **Environment Variable** → Stored as `TELEGRAM_HIVE_OVERRIDES` in `process.env`
3. **Override Extraction** → `telegram-bot.mjs` uses `lino.parseStringValues()` to extract individual options
4. **Display** → Options are logged and used for validation

### The Bug

When two or more options are placed on the same line (with space separation), the LINO parser interprets them as a **nested tuple/link**:

**Input:**

```
TELEGRAM_HIVE_OVERRIDES:
  ...
  --auto-resume-on-limit-reset?  --tokens-budget-stats
```

**LINO Parser Output:**

```
"TELEGRAM_HIVE_OVERRIDES": "(\n  ...\n  (--auto-resume-on-limit-reset? --tokens-budget-stats)\n)"
```

Note: The last two options are wrapped in **parentheses**, creating a nested structure.

### Why Options Are Lost

The `parseStringValues()` function in `lino.lib.mjs` only extracts the `id` property of each value:

```javascript
if (link.values && link.values.length > 0) {
  for (const value of link.values) {
    const linkStr = value.id || value; // Only gets the 'id', not nested values
    if (typeof linkStr === 'string') {
      links.push(linkStr);
    }
  }
}
```

When a value is a nested link (has its own `values` array instead of just an `id`), the nested values are silently dropped.

## Technical Details

### Reproduction Steps

1. Create a configuration with options on the same line:

```yaml
TELEGRAM_HIVE_OVERRIDES: --option1
  --option2  --option3
```

2. Parse with lenv-reader
3. Extract with `lino.parseStringValues()`
4. Observe that `--option2` and `--option3` are lost

### Expected vs Actual Parsing

| Input Structure           | Expected Output                   | Actual Output                    |
| ------------------------- | --------------------------------- | -------------------------------- |
| Options on separate lines | All options extracted             | All options extracted            |
| Options on same line      | All options extracted (flattened) | Only top-level options extracted |

## Timeline of Events

1. **Configuration Creation**: User creates configuration with options, accidentally putting two options on same line
2. **Bot Startup**: Bot loads configuration via `loadLenvConfig()`
3. **Parsing**: LINO parser creates nested structure for same-line options
4. **Extraction**: `parseStringValues()` extracts only top-level values
5. **Validation**: Validation passes (it validates the full config, not individual values)
6. **Display**: Only 6 options displayed instead of 8
7. **Issue Report**: User notices missing options and reports issue

## Proposed Solutions

### Solution 1: Flatten Nested Values in parseStringValues() (Recommended)

Modify `lino.lib.mjs` to recursively extract all string values from nested structures:

```javascript
parseStringValues(input) {
  if (!input) return [];

  const parsed = this.parser.parse(input);
  if (!parsed || parsed.length === 0) return [];

  const extractValues = (link) => {
    const results = [];

    if (link.id && typeof link.id === 'string') {
      results.push(link.id);
    }

    if (link.values && link.values.length > 0) {
      for (const value of link.values) {
        if (typeof value === 'string') {
          results.push(value);
        } else if (value && typeof value === 'object') {
          results.push(...extractValues(value));
        }
      }
    }

    return results;
  };

  return extractValues(parsed[0]);
}
```

### Solution 2: Input Validation with User Warning

Add a warning when the configuration contains options on the same line:

```javascript
// In telegram-bot.mjs
if (resolvedHiveOverrides.includes('  ')) {
  console.warn('⚠️  Warning: Multiple options detected on same line. Each option should be on a separate line.');
}
```

### Solution 3: Preprocessing in lenv-reader

Normalize input before parsing to ensure each option is on its own line.

## Recommendation

**Solution 1 is recommended** because:

1. It handles edge cases gracefully
2. It's backward compatible
3. It doesn't require users to change their configuration
4. It aligns with user expectations (options should work regardless of line arrangement)

## Impact Assessment

- **Severity**: Medium - Options are silently ignored
- **Affected Components**: `lino.lib.mjs`, potentially affects all LINO-based configurations
- **User Impact**: Configuration options may not take effect

## Files to Modify

1. `src/lino.lib.mjs` - Update `parseStringValues()` to handle nested values
2. `experiments/test-lino-parsing-issue-1086.mjs` - Test for the fix (already created)
3. `tests/` - Add unit tests for the fix

## Additional Notes

The `?` character after `--auto-resume-on-limit-reset` in the issue report appears to be unintentional (possibly a rendering artifact or typo). However, this doesn't affect the root cause - the issue is the same-line placement of options.
