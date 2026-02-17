# Case Study: Issue #1318 - Fix `hive-telegram-bot --version` Version Display

## Issue Summary

When running `hive-telegram-bot --version`, users saw dotenvx warnings before the version output:

```
[MISSING_ENV_FILE] missing .env file (/home/hive/.env)
[MISSING_ENV_FILE] https://github.com/dotenvx/dotenvx/issues/484
unknown
```

The expected behavior was a clean version output without warnings, and the `.env` file should be optional.

## Root Cause Analysis

The issue had two root causes:

### 1. No Early Exit for --version

Unlike `solve.mjs` and `hive.mjs`, which handle `--version` early (before loading dotenvx), `telegram-bot.mjs` loaded dotenvx first. This caused dotenvx to emit warnings before the version could be displayed.

**solve.mjs pattern (correct):**

```javascript
// Early exit for --version
const earlyArgs = process.argv.slice(2);
if (earlyArgs.includes('--version')) {
  const { getVersion } = await import('./version.lib.mjs');
  console.log(await getVersion());
  process.exit(0);
}
// Heavy dependencies loaded AFTER early exit check
const dotenvxModule = await use('@dotenvx/dotenvx');
```

**telegram-bot.mjs (before fix):**

```javascript
// dotenvx loaded FIRST, emitting warnings
const dotenvxModule = await use('@dotenvx/dotenvx');
dotenvx.config({ quiet: true });
// yargs handles --version later
```

### 2. `quiet: true` Doesn't Suppress MISSING_ENV_FILE

The `quiet: true` option only suppresses informational messages, not error-level messages like `MISSING_ENV_FILE`. According to [dotenvx documentation](https://dotenvx.com/docs/advanced/config-ignore), the `ignore` option must be used to suppress specific errors.

## Solution

Three changes were made:

### 1. Added Early --version Handling (telegram-bot.mjs)

Added early exit for `--version` flag before loading any heavy dependencies:

```javascript
// Early exit for --version to avoid loading dotenvx and other heavy dependencies
if (process.argv.includes('--version')) {
  const v = await import('./version.lib.mjs').then(m => m.getVersion()).catch(() => 'unknown');
  console.log(v);
  process.exit(v === 'unknown' ? 1 : 0);
}
```

### 2. Added `ignore` Option to dotenvx.config()

Added `ignore: ['MISSING_ENV_FILE']` to make `.env` file optional:

```javascript
dotenvx.config({ quiet: true, ignore: ['MISSING_ENV_FILE'] });
```

### 3. Added Version Caching in RAM (version.lib.mjs)

Added a cache for the version to ensure it remains immutable after first read. This allows accurate tracking of the running version even if package.json is updated while the process is still running:

```javascript
// Cache for version (immutable after first read)
// This ensures the version remains consistent even if package.json changes during runtime
let cachedVersion = null;

export async function getVersion() {
  // Return cached version if already computed (immutable after first read)
  if (cachedVersion !== null) {
    return cachedVersion;
  }
  // ... read from package.json and cache the result
}
```

## Testing

Added `tests/test-telegram-bot-version.mjs` with 8 test cases:

1. `--version` returns valid version number
2. Output does not contain `MISSING_ENV_FILE` warning
3. Output does not contain dotenvx error URLs
4. Output does not contain `[ERROR]` markers
5. Output is not "unknown"
6. Output is a single line
7. Works with non-existent HOME directory
8. Exits with code 0

## Verification

Before fix:

```
$ hive-telegram-bot --version
[MISSING_ENV_FILE] missing .env file (/home/hive/.env)
[MISSING_ENV_FILE] https://github.com/dotenvx/dotenvx/issues/484
1.23.12
```

After fix:

```
$ hive-telegram-bot --version
1.23.12.d84d6409
```

## References

- [Issue #1318](https://github.com/link-assistant/hive-mind/issues/1318)
- [dotenvx Issue #484](https://github.com/dotenvx/dotenvx/issues/484) - MISSING_ENV_FILE error documentation
- [dotenvx `ignore` option documentation](https://dotenvx.com/docs/advanced/config-ignore)
- [dotenvx `quiet` option documentation](https://dotenvx.com/docs/advanced/config-quiet)

## Files Changed

- `src/telegram-bot.mjs` - Added early --version handling and ignore option
- `src/version.lib.mjs` - Added version caching in RAM (immutable after first read)
- `tests/test-telegram-bot-version.mjs` - Added tests for version output
- `docs/case-studies/issue-1318/` - Case study documentation
