# Case Study: Issue #1472 - Interactive Mode Not Activated/Signaled

## Summary

The user ran `/solve` with `--interactive-mode` option via Telegram bot and expected either:

1. A clear signal that interactive mode was activated and working, or
2. A warning that the option is invalid/unrecognized

Neither happened. The Telegram bot response showed the option as plain text without any semantic confirmation.

## Timeline Reconstruction

### Case 1: trees-rs/issues/8 (PR #9)

| Time     | Event                                                                                |
| -------- | ------------------------------------------------------------------------------------ |
| 09:13:40 | solve v1.35.9 started with `--model opus --interactive-mode`                         |
| 09:13:45 | System checks passed                                                                 |
| 09:13:49 | Branch `issue-8-c1619bfb477b` created, initial commit pushed                         |
| 09:13:59 | Draft PR #9 created                                                                  |
| 09:14:10 | `🔌 Interactive mode: Creating handler for real-time PR comments` (verbose log only) |
| 09:14:10 | "▶️ Streaming output:" logged - Claude CLI started                                   |
| 13:57:58 | ~4h44m later: User pressed CTRL+C                                                    |
| 13:57:58 | First system.init event received from Claude (session `7f20332f`)                    |
| 13:57:58 | Interactive mode tried to post comment, got HTTP 400                                 |
| 13:58:01 | Process terminated                                                                   |

### Case 2: xlab2016/space_db_private/issues/23 (PR #24)

| Time     | Event                                          |
| -------- | ---------------------------------------------- |
| 09:42:04 | solve started with `--interactive-mode`        |
| 09:42:41 | Interactive mode handler created               |
| 13:59:45 | ~4h17m later: User pressed CTRL+C              |
| 13:59:45 | Same pattern: init event + failed comment post |

## Root Causes Identified

### Root Cause 1: No user-facing confirmation of interactive mode activation

The `validateInteractiveModeConfig()` function exists in `interactive-mode.lib.mjs` (line 1258) and
provides clear user-facing log messages like:

- `🔌 Interactive mode: ENABLED (experimental)`
- `⚠️ --interactive-mode is only supported for --tool claude`

However, **this function is never called** in the main solve flow (`solve.mjs`). It is only:

- Exported from the module
- Tested in `tests/test-interactive-mode.mjs`
- But never imported or called in `solve.mjs` or any other main flow file

The only interactive mode log that runs is in `claude.lib.mjs:854-858`, which is a verbose-only message
that only appears deep in the log file, not at the option summary stage.

### Root Cause 2: Telegram bot response doesn't distinguish recognized vs unknown options

The Telegram bot at `telegram-bot.mjs:996-998` simply echoes back the raw user options string:

```javascript
const userOptionsRaw = userArgs.slice(1).join(' ');
if (userOptionsRaw) infoBlock += `\n\n🛠 Options: ${escapeMarkdown(userOptionsRaw)}`;
```

There is no semantic analysis of which options were recognized and what they will do.

### Root Cause 3: Execution stuck (related to Issue #1475)

Both sessions were stuck for ~4.5 hours with no output from Claude CLI. This appears to be a separate
issue tracked in #1475 where the solve command execution gets stuck.

## Proposed Solutions

### Fix 1: Call validateInteractiveModeConfig in solve.mjs

Add a call to `validateInteractiveModeConfig()` in the solve.mjs startup sequence, after argument
parsing and tool validation. This will:

- Log `🔌 Interactive mode: ENABLED (experimental)` when active
- Warn if tool is not supported for interactive mode
- Provide clear feedback in the log file

### Fix 2: Add interactive mode confirmation to Telegram bot response

Enhance the Telegram bot success message to include a specific indicator when interactive mode
is enabled, e.g., `🔌 Interactive mode: ENABLED`.

## Log Files

- `trees-rs-issue-8-solve-log.log` - Full log from linksplatform/trees-rs solve session
- `space-db-private-solve-log.log` - Full log from xlab2016/space_db_private solve session
