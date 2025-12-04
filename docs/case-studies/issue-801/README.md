# Case Study: CI Timeout in telegram-bot.mjs --dry-run (Issue #801)

## Summary

The CI pipeline failed with exit code 124 (timeout) when running the `hive-telegram-bot --dry-run` test in the "Test global command installation" step. The test was timing out after 10 seconds.

## Timeline

- **2025-12-03T23:29:01Z**: CI run #19912262064 started after merging PR #797
- **2025-12-03T23:30:10.631Z**: `hive-telegram-bot --dry-run` test started
- **2025-12-03T23:30:12.617Z**: MISSING_ENV_FILE warnings appeared (~2 seconds into test)
- **2025-12-03T23:30:20.637Z**: Timeout exit code 124 (~10 seconds after start)

## Root Cause Analysis

### Investigation Process

1. **Downloaded CI logs** from the failed run
2. **Analyzed timestamps** to understand the execution flow
3. **Traced the code path** in `telegram-bot.mjs`
4. **Compared with local execution** (which worked without issues)
5. **Identified the difference** between CI and local environments

### Key Findings

The issue was caused by the sequence of events in the CI test:

1. **First invocation** (`hive-telegram-bot --help` without token):
   - Loaded dotenvx, yargs, and other lightweight modules
   - Failed at BOT_TOKEN check and exited immediately
   - **Never loaded the `telegraf` module**

2. **Second invocation** (`hive-telegram-bot --dry-run --token test_token`):
   - Loaded dotenvx (~2 seconds) - this matched the timestamps
   - Then tried to load `telegraf` module for the **first time** via `use-m`
   - The `use-m` library fetches modules from unpkg.com CDN
   - This network fetch was taking too long in the CI environment

### Why It Worked Locally

- Local environment had cached modules from previous runs
- Network latency to unpkg.com was lower
- The `telegraf` module might have been pre-warmed from other commands

### The Bug

The `telegram-bot.mjs` file loaded heavy dependencies (Sentry, Telegraf) **before** checking if `--dry-run` mode was enabled:

```javascript
// OLD CODE STRUCTURE:
// 1. Load lightweight deps (dotenvx, yargs, etc.)
// 2. Parse yargs config
// 3. Check BOT_TOKEN
// 4. Initialize Sentry          <-- ~1 second
// 5. Load telegraf via use-m    <-- 3-8 seconds on cold start!
// 6. Create Telegraf bot
// 7. ...more config...
// 8. Check for --dry-run        <-- Too late! Heavy deps already loaded
```

## Solution

### Changes Made

1. **Increased CI timeout** from 10s to 30s for the `hive-telegram-bot --dry-run` test
   - File: `.github/workflows/main.yml`
   - This provides a safety margin for slow network conditions

2. **Moved dry-run check earlier** in the startup sequence
   - File: `src/telegram-bot.mjs`
   - Heavy dependencies (Sentry, Telegraf) are now loaded **after** the dry-run check
   - This skips ~3-8 seconds of module loading in dry-run mode

### New Code Structure

```javascript
// NEW CODE STRUCTURE:
// 1. Load lightweight deps (dotenvx, yargs, etc.)
// 2. Parse yargs config
// 3. Check BOT_TOKEN
// 4. Parse overrides and config
// 5. Validate overrides
// 6. Check for --dry-run        <-- Now happens BEFORE heavy deps!
//    - If dry-run: exit early
// 7. Initialize Sentry          <-- Only loaded if NOT dry-run
// 8. Load telegraf via use-m    <-- Only loaded if NOT dry-run
// 9. Create Telegraf bot
```

### Performance Improvement

| Mode | Before | After |
|------|--------|-------|
| `--dry-run` | ~10-15 seconds (timeout!) | ~6-7 seconds |
| Normal | ~10-12 seconds | ~10-12 seconds (unchanged) |

## Files Changed

- `.github/workflows/main.yml` - Increased timeout from 10s to 30s
- `src/telegram-bot.mjs` - Restructured startup sequence for faster dry-run mode

## Lessons Learned

1. **Cold start performance matters** in CI environments where modules aren't cached
2. **Network-dependent imports** (like `use-m` fetching from CDN) can be unpredictably slow
3. **Early exit paths** (like `--dry-run`) should avoid loading unnecessary dependencies
4. **CI timeouts** should account for worst-case network latency, not just local performance

## CI Logs

The original CI logs are preserved in:
- `ci-logs/run-19912262064-full.log` - Full run logs
- `ci-logs/run-19912262064-failed.log` - Failed step logs
- `ci-logs/job-57083420891-test-execution.log` - Specific job logs

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/801
- Failed CI Run: https://github.com/link-assistant/hive-mind/actions/runs/19912262064
- PR with fix: https://github.com/link-assistant/hive-mind/pull/802
