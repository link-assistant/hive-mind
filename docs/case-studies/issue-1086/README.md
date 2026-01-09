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

The configuration has two issues:

1. **Typo**: `--auto-resume-on-limit-reset?` contains an invalid character `?`
2. **Format error**: Two options are placed on the same line (`--auto-resume-on-limit-reset?  --tokens-budget-stats`)

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

```javascript
{
  "id": "TELEGRAM_HIVE_OVERRIDES",
  "values": [
    { "id": "--all-issues", "values": [] },
    // ... other options ...
    {
      "id": null,  // <-- No id for nested tuple!
      "values": [
        { "id": "--auto-resume-on-limit-reset?", "values": [] },
        { "id": "--tokens-budget-stats", "values": [] }
      ]
    }
  ]
}
```

The `lenv-reader.lib.mjs` code was extracting `v.id` for each value. When `v.id` is `null` (nested tuple), the value is converted to `"[object Object]"` and formatted incorrectly.

## Solution Approach

Based on user feedback, the correct approach is to **reject invalid input with clear error messages** rather than silently parsing or dropping values.

### Implemented Changes

1. **Reject same-line options**: When the LINO parser creates nested structures (mixed direct values and nested tuples), throw an error with a clear message showing the problematic values.

2. **Reject invalid characters**: When an option-like value (starting with `-`) contains invalid characters like `?`, `@`, `!`, etc., throw an error with the problematic value.

3. **Preserve valid behavior**: Valid configurations continue to work:
   - Explicit parenthesized lists: `VAR: ( 1 2 3 )`
   - Options with `=` values: `--model=opus`
   - Hyphenated options: `--auto-resume-on-limit-reset`
   - Non-option values (tokens, chat IDs) are not validated for special characters

### Example Error Messages

**Same-line options:**

```
Invalid LINO format in "TELEGRAM_HIVE_OVERRIDES": Multiple values on the same line are not supported.
Found: "--auto-resume-on-limit-reset? --tokens-budget-stats"
Each value must be on its own line with proper indentation.
```

**Invalid character:**

```
Invalid LINO format in "TELEGRAM_HIVE_OVERRIDES": Unrecognized character "?" in option.
Found: "--auto-resume-on-limit-reset?"
Options should only contain letters, numbers, hyphens, underscores, and equals signs.
```

## Testing

### Unit Tests Added

1. **test-lino.mjs**: 28 tests for LINO parsing functionality
   - Export tests
   - parse() method tests
   - parseNumericIds() method tests
   - parseStringValues() method tests
   - format() method tests
   - Round-trip tests
   - Edge case tests

2. **test-lenv-reader.mjs**: Extended with 8 validation tests
   - Reject same-line options
   - Reject invalid characters (?, @)
   - Accept valid options with =
   - Accept valid hyphenated options
   - Non-option values bypass validation
   - Accept explicit parenthesized lists
   - Error message includes problematic value

### Running Tests

```bash
# Run all tests
npm test && node tests/test-lenv-reader.mjs && node tests/test-lino.mjs

# Run specific test file
node tests/test-lino.mjs
node tests/test-lenv-reader.mjs
```

## Conclusion

The issue was caused by invalid user input (typo `?` and same-line options). The fix adds validation to detect and reject such errors early with helpful error messages, helping users identify and correct configuration problems.

This is preferred over silently parsing invalid input because:

1. It helps users discover typos immediately
2. It prevents treating `--option-with-value` as two separate options
3. Clear error messages guide users to the correct format
