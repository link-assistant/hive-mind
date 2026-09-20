# Case Study: Issue #1534 — `--isolation screen` didn't work

## Summary

When a user sent `/solve URL --isolation screen` in Telegram, the `--isolation screen` argument
was treated as a solve command option rather than an execution isolation directive. The `solve`
command (which has no `--isolation` option) rejected it with "Unknown argument: isolation", but
the Telegram bot falsely reported success because `start-screen` (the wrapper) exited successfully
after creating the screen session — before `solve` inside the session had a chance to fail.

## Timeline

| Date       | Event                                                                                 |
| ---------- | ------------------------------------------------------------------------------------- |
| 2025-12-30 | `--isolation` mode introduced as bot startup flag (PR #390, issue #380)               |
| 2026-04-06 | User sent `/solve URL --isolation screen` in Telegram expecting per-command isolation |
| 2026-04-06 | Bug reported (issue #1534): `solve` rejected `--isolation` as unknown argument        |
| 2026-04-06 | Fix implemented: extract `--isolation` from user args before validation               |

## Root Cause

### Two distinct failures

**Failure 1: `--isolation` was not a per-command option**

The `--isolation` flag was only supported as a **Telegram bot startup flag** (`hive-telegram-bot --isolation screen`),
which sets a global `ISOLATION_BACKEND` for all commands. When users passed `--isolation screen`
directly in a `/solve` message, the bot treated it as a solve argument and forwarded it through
the entire chain:

```
User: /solve URL --isolation screen
  → parseCommandArgs → ['URL', '--isolation', 'screen']
  → mergeArgsWithOverrides → ['URL', '--isolation', 'screen', '--attach-logs', ...]
  → executeStartScreen('solve', args)
    → start-screen solve URL --isolation screen --attach-logs ...
      → screen session: solve URL --isolation screen ...
        → solve rejects: "Unknown argument: isolation"
```

**Failure 2: False positive success report**

The Telegram bot reported "✅ Solve command started successfully!" even though `solve` failed.
This happened because `start-screen` creates a GNU screen session and exits immediately with
code 0 — it does not wait for the inner `solve` command to complete or report errors. The actual
failure only becomes visible when attaching to the screen session.

```
Telegram shows: ✅ Solve command started successfully!
Screen session:  ❌ Unknown argument: isolation
```

### Why validation didn't catch it

The Telegram bot validates user args against solve's yargs config (which uses `.strict()` mode).
In theory, `--isolation` should have been rejected. However, yargs' strict mode behavior depends
on how parsing is invoked. The `createSolveYargsConfig` sets up a `.fail()` handler that throws,
and the telegram bot chains its own `.fail()` handler on top. Whether the error was properly
caught and reported to the user, or silently swallowed, depends on the yargs version's `.fail()`
chaining behavior — a fragile pattern that should not be relied upon for security-critical validation.

## Fix

### Approach: Extract `--isolation` before validation

Added `extractIsolationFromArgs()` function that:

1. Scans user args for `--isolation <backend>` or `--isolation=<backend>`
2. Extracts the backend value and returns filtered args (without `--isolation`)
3. Validates the backend value (must be: screen, tmux, or docker)
4. Passes the per-command isolation to `executeAndUpdateMessage()` which uses it
   to dynamically choose between the isolation runner (`$` CLI) and `start-screen`

This approach:

- Per-command `--isolation` takes precedence over bot-level `ISOLATION_BACKEND`
- The isolation runner is dynamically imported when needed (not required at bot startup)
- Works for both `/solve` and `/hive` commands
- Works for both direct execution and queue execution paths
- `--isolation` is stripped from args before solve/hive validation, preventing "Unknown argument" errors

### Files changed

- `src/telegram-bot.mjs` — Added `extractIsolationFromArgs()`, updated `executeAndUpdateMessage()`,
  `handleSolveCommand()`, `handleHiveCommand()`, and queue execution callback
- `tests/test-extract-isolation-from-args.mjs` — 21 tests for the extraction function

## Logs

### Original failure (from issue report)

```
[VERBOSE] Found start-screen at: /workspace/.bun/bin/start-screen
[VERBOSE] Executing: /workspace/.bun/bin/start-screen solve https://github.com/link-assistant/calculator/pull/131 --isolation screen --attach-logs --verbose --no-tool-check --auto-accept-invite --tokens-budget-stats
[VERBOSE] Session solve-link-assistant-calculator-131 tracked in memory (mode: screen)
```

Inside the screen session:

```
❓ Unknown argument: isolation

Use /help to see available options
```

### Expected behavior after fix

When `/solve URL --isolation screen` is sent:

1. `--isolation screen` is extracted from user args
2. Args without `--isolation` are validated against solve's yargs config
3. The `$` CLI (from start-command) is used for execution instead of `start-screen`
4. Command runs: `$ --isolated screen --detached --session <uuid> -- solve URL [other-args]`

## Related

- [PR #390](https://github.com/link-assistant/hive-mind/pull/390) — Original `--isolation` mode implementation
- [Issue #380](https://github.com/link-assistant/hive-mind/issues/380) — Original `--isolation` feature request
- [link-foundation/start](https://github.com/link-foundation/start) — `$` CLI used for isolated execution
