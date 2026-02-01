# Case Study: Invalid solve-overrides - Unknown arguments: getkeep-file, getkeepFile (Issue #1209)

## Overview

This case study documents a configuration validation failure where `TELEGRAM_SOLVE_OVERRIDES` containing `--getkeep-file` was rejected at telegram bot startup. The investigation revealed both a user typo and a systemic architectural problem: solve command options must be manually duplicated across multiple configuration files, and the hive command doesn't forward all solve options to solve subprocess.

## Timeline of Events

### Incident (February 2026)

1. **User Configuration:** A user configured `hive-telegram-bot` with the following overrides:

   ```yaml
   TELEGRAM_SOLVE_OVERRIDES:
     --attach-logs
     --verbose
     --no-tool-check
     --auto-resume-on-limit-reset
     --tokens-budget-stats
     --getkeep-file
   TELEGRAM_HIVE_OVERRIDES:
     --all-issues
     --once
     --skip-issues-with-prs
     --attach-logs
     --verbose
     --no-tool-check
     --auto-resume-on-limit-reset
     --tokens-budget-stats
     --getkeep-file
   ```

2. **Error at Startup:**

   ```
   Validating solve overrides...
   ❌ Invalid solve-overrides: Unknown arguments: getkeep-file, getkeepFile
      Overrides: --attach-logs --verbose --no-tool-check --auto-resume-on-limit-reset --tokens-budget-stats --getkeep-file
   ```

3. **Bot failed to start** due to `process.exit(1)` in the validation block.

## Root Cause Analysis

### Primary Root Cause: User Typo

The user typed `--getkeep-file` instead of `--gitkeep-file`. The correct option name is `--gitkeep-file` (as in "git keep"), defined in `src/solve.config.lib.mjs:136`.

The error message shows both `getkeep-file` (kebab-case) and `getkeepFile` (camelCase) because yargs automatically converts kebab-case to camelCase and reports both as unknown.

### Secondary Root Cause: Architectural Gap in Option Forwarding

Beyond the typo, the issue description highlights a systemic problem:

> "We need ensure all options we have in solve are supported as TELEGRAM_SOLVE_OVERRIDES, and also all these options should be passable through TELEGRAM_HIVE_OVERRIDES to solve command."

**Problem 1: `TELEGRAM_SOLVE_OVERRIDES` validation works correctly.** The telegram bot validates solve overrides against `createSolveYargsConfig()` (telegram-bot.mjs:184), which includes all solve options. If the user had typed `--gitkeep-file` correctly, it would have passed validation.

**Problem 2: `TELEGRAM_HIVE_OVERRIDES` cannot include solve-only options.** The hive overrides are validated against `createHiveYargsConfig()` (telegram-bot.mjs:224), which does NOT include solve-only options like `--gitkeep-file`, `--claude-file`, `--auto-gitkeep-file`, etc. So even correctly spelled, `--gitkeep-file` would fail in `TELEGRAM_HIVE_OVERRIDES`.

**Problem 3: hive.mjs manually maps options to solve args.** In `src/hive.mjs:749-777`, each option passed from hive to solve is individually coded:

```javascript
const args = [issueUrl, '--model', argv.model];
if (argv.tool) args.push('--tool', argv.tool);
if (argv.fork) args.push('--fork');
// ... 27 more individual mappings
```

This means:
- Adding a new solve option requires updating 3-4 files
- Several existing solve options are never forwarded from hive
- Some options defined in hive.config aren't forwarded to solve (e.g., `--prompt-general-purpose-sub-agent`, `--tokens-budget-stats`, `--prompt-check-sibling-pull-requests`, `--prompt-architecture-care`)

**Problem 4: hive passes `--target-branch` but solve expects `--base-branch`.** In `hive.mjs:755`, hive passes `--target-branch` to solve, but solve's yargs config only defines `--base-branch` (solve.config.lib.mjs:270). With strict mode enabled, this would cause a validation error in solve.

### Options Gap Summary

**25 solve options NOT defined in hive config** (including `gitkeep-file`, `claude-file`, `auto-gitkeep-file`, `auto-close-pull-request-on-fail`, `enable-workspaces`, `playwright-mcp-auto-cleanup`, `auto-gh-configuration-repair`, `prompt-subagents-via-agent-commander`, and others).

**4 options defined in both configs but NOT forwarded** from hive to solve: `prompt-general-purpose-sub-agent`, `tokens-budget-stats`, `prompt-check-sibling-pull-requests`, `prompt-architecture-care`.

## Solution

### Approach: Add Missing Options to Hive Config and Forward Them

The solution adds solve-passthrough options to `hive.config.lib.mjs` and ensures they are forwarded in the `hive.mjs` args builder. This includes:

1. **Adding missing solve options to `hive.config.lib.mjs`** that make sense to pass through from hive to solve (e.g., `--gitkeep-file`, `--claude-file`, `--auto-gitkeep-file`, `--tokens-budget-stats`, etc.)

2. **Adding missing option forwarding in `hive.mjs`** args builder for options that were defined in hive config but not passed through to solve

3. **Fixing `--target-branch` to `--base-branch` mapping** in `hive.mjs` so hive correctly passes the target branch to solve

### Files Modified

- `src/hive.config.lib.mjs` - Added missing solve-passthrough options
- `src/hive.mjs` - Added forwarding for missing options, fixed target-branch mapping

## Lessons Learned

1. **Manual option duplication is error-prone.** When solve adds a new option, it must be manually added to hive.config, hive.mjs args builder, and option-suggestions. This leads to gaps and inconsistencies.

2. **Strict mode validation catches issues early** but requires all options to be properly defined across all entry points.

3. **The error message could be more helpful.** When a user types `--getkeep-file`, the system should suggest `--gitkeep-file` (which it would via the `enhanceErrorMessage()` function, but the startup validation in telegram-bot.mjs doesn't use this enhancement).

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/1209
- Solve config: `src/solve.config.lib.mjs`
- Hive config: `src/hive.config.lib.mjs`
- Telegram bot override validation: `src/telegram-bot.mjs:166-244`
- Hive args builder: `src/hive.mjs:749-777`
- Option suggestions: `src/option-suggestions.lib.mjs`
