# Case Study: Issue #1232 — `/solve-queue` command not found

## Summary

The bot suggested `/solve-queue` when a duplicate URL was detected in the queue, but the command did not exist. Entering `/solve-queue` caused the bot to misinterpret it as `/solve` with argument `-queue`, resulting in "First argument must be a GitHub URL" error. The correct `/solve_queue` command was never registered.

## Timeline / Sequence of Events

1. **User submits duplicate URL**: User sends `/solve https://github.com/DeepYV/Healora/issues/1 --model opus`
2. **Bot detects duplicate**: Bot responds with "This URL is already in the queue" and suggests: `💡 Use /solve-queue to check the queue status.`
3. **User enters suggested command**: User types `/solve-queue`
4. **Telegram parses command incorrectly**: Telegram Bot API parses `/solve-queue` as command `solve` with argument `-queue` (hyphens are invalid in Telegram command names)
5. **Bot runs `/solve` handler**: The `/solve` handler validates `-queue` as a URL, fails, and returns: "First argument must be a GitHub URL"
6. **User tries `/solve_queue`**: No handler exists for this command either — Telegraf silently ignores it

## Root Cause Analysis

### Root Cause 1: Telegram Bot API command naming restriction

**Constraint**: The [Telegram Bot API](https://core.telegram.org/bots/features) only supports "Latin letters, numbers and underscores" in command names (up to 32 characters). Hyphens (`-`) are **not valid** command name characters.

When a user types `/solve-queue`, Telegram's message entity parser treats it as:

- Command entity: `solve` (stops at the hyphen)
- Remaining text: `-queue` (treated as argument)

This means `/solve-queue` can **never** work as a Telegram bot command, regardless of how the bot's command handler is configured.

**Evidence**: Telegram's [BotCommand](https://core.telegram.org/bots/api#botcommand) specification states command text must be "1-32 characters. Can contain only lowercase English letters, digits and underscores."

### Root Cause 2: Missing `/solve_queue` command handler

The `SolveQueue` class in `telegram-solve-queue.lib.mjs` already had methods for formatting queue status:

- `formatStatus()` (line 1087) — short status
- `formatDetailedStatus()` (line 1107) — detailed status with per-tool breakdown

However, no Telegram bot command was registered to expose this functionality to users.

**Code location (before fix):** `src/telegram-bot.mjs:1026`

```javascript
// The hint text incorrectly suggested /solve-queue (with hyphen)
await ctx.reply(`... 💡 Use /solve-queue to check the queue status.`, ...);
```

### Root Cause 3: Inconsistent naming convention in log messages

Internal log messages in `telegram-solve-queue.lib.mjs` also used `/solve-queue` with a hyphen, which is inconsistent with Telegram's naming convention and could cause confusion during debugging.

**Code locations:** `src/telegram-solve-queue.lib.mjs` lines 96, 98, 108, 337

## Impact

- Users were directed to a non-functional command after encountering a duplicate URL
- The suggested command (`/solve-queue`) would trigger an unrelated error message from the `/solve` handler
- Users had no way to check queue status via a dedicated command

## Solution

### Fix 1: Register `/solve_queue` command handler

Created `src/telegram-solve-queue-command.lib.mjs` — a new module that registers the `/solve_queue` command following the same pattern as other externalized commands (`/accept_invites`, `/merge`, `/top`).

The command handler:

- Uses the existing `formatDetailedStatus()` method from `SolveQueue`
- Shows pending, processing, completed, and failed items
- Shows per-tool queue breakdown (claude, opencode, etc.)
- Shows running Claude process count
- Follows standard permission checks (group chat, authorized, not old/forwarded)

Command regex: `/^solve[_-]?queue$/i` — matches `solve_queue`, `solvequeue`, and `solve-queue` (case-insensitive)

### Fix 2: Update hint text from `/solve-queue` to `/solve_queue`

Changed the duplicate URL detection message to use the valid command name.

**File:** `src/telegram-bot.mjs:1026`

### Fix 3: Add `/solve_queue` to help text

Added the command to the `/help` output so users can discover it.

### Fix 4: Add `/solve_queue` to text-based fallback handlers

Added `solve_queue` and `solvequeue` to the text-based command fallback (issue #1207), ensuring the command works even when entity-based matching fails.

### Fix 5: Fix log messages to use `/solve_queue`

Updated all `[VERBOSE] /solve-queue` log messages in `telegram-solve-queue.lib.mjs` to use `/solve_queue` for consistency.

## Files Changed

- `src/telegram-solve-queue-command.lib.mjs` — **New**: `/solve_queue` command handler module
- `src/telegram-bot.mjs` — Fixed hint text, registered command, added to help text and fallback handlers
- `src/telegram-solve-queue.lib.mjs` — Fixed log messages from `/solve-queue` to `/solve_queue`
- `tests/test-solve-queue-command.mjs` — **New**: 19 tests for the command handler
- `package.json` — Added new test to the test script

## Testing

19 new tests covering:

- Command registration and regex matching (8 tests)
- Permission checks: non-group chat, unauthorized, old messages, forwarded messages (4 tests)
- Queue status output: empty queue, Claude process count, queue with items (3 tests)
- Hint text regression: ensures `/solve-queue` is not used in user-facing text (4 tests)

## References

- [Telegram Bot Features — Commands](https://core.telegram.org/bots/features) — "Commands can use Latin letters, numbers and underscores"
- [Telegram Bot API — BotCommand](https://core.telegram.org/bots/api#botcommand) — "1-32 characters. Can contain only lowercase English letters, digits and underscores"
- Issue #1232: https://github.com/link-assistant/hive-mind/issues/1232
- Issue #1207: Text-based fallback for command matching
- Issue #1080: Duplicate URL detection in queue

## Lessons Learned

1. **Telegram Bot API command names only support underscores, not hyphens** — This is a fundamental constraint that should be documented in the project's contributing guidelines
2. **User-facing suggestions should always be tested end-to-end** — The `/solve-queue` suggestion was added without verifying the command actually existed
3. **Existing internal methods (like `formatDetailedStatus`) may go unexposed** — Useful functionality existed in the queue library but was never wired to a user-facing command
