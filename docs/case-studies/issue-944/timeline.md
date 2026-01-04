# Timeline: Issue #944 - --tokens-budget-stats Support

## Event Sequence

### 2025-12-20T20:31:29Z
**Issue Created** by @konard
- Requested implementation of `--tokens-budget-stats` option for `--tool claude`
- Requirements:
  - Show token budget statistics (context window usage in absolute values and ratios)
  - Get maximum input/output tokens from model.dev API
  - Show how much was used in a working session
  - Option should be disabled by default
  - Create comprehensive case study in `./docs/case-studies/issue-{id}` folder

### 2026-01-04T01:33:24Z
**First Test Attempt** (Version 0.54.0)
- User attempted to run `hive-telegram-bot` WITHOUT `--tokens-budget-stats`
- Configuration included:
  - TELEGRAM_HIVE_OVERRIDES with standard flags
  - TELEGRAM_SOLVE_OVERRIDES with standard flags
- Result: **SUCCESS** - Bot started successfully
- Bot was manually stopped with Ctrl+C at Process ID: 87001

### 2026-01-04T01:33:24Z (after restart)
**Second Test Attempt with --tokens-budget-stats**
- User added `--tokens-budget-stats` to both:
  - TELEGRAM_HIVE_OVERRIDES
  - TELEGRAM_SOLVE_OVERRIDES
- Result: **FAILURE**
- Error:
  ```
  TypeError: line.trim is not a function
      at file:///home/hive/.bun/install/global/node_modules/@link-assistant/hive-mind/src/telegram-bot.mjs:162:25
      at Array.map (<anonymous>)
      at file:///home/hive/.bun/install/global/node_modules/@link-assistant/hive-mind/src/telegram-bot.mjs:162:8
  ```

### 2026-01-04T01:34:46Z
**Issue Comment** by @konard
- Reported that in version 0.54.0, `--tokens-budget-stats` is not fully supported
- Included full error logs
- Reiterated request for comprehensive case study

### 2026-01-04 (Current Fix)
**Root Cause Identified**
- `lino.parse()` method can return non-string values (objects)
- Code at telegram-bot.mjs:162 assumes all values are strings
- Calling `.trim()` on an object throws TypeError

**Solution Implemented**
- Changed from `lino.parse()` to `lino.parseStringValues()`
- `parseStringValues()` explicitly filters and returns only string values
- This ensures `.trim()` is only called on strings
