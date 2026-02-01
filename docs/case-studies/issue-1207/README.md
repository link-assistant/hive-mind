# Case Study: Issue #1207 - Messages from User Not Recognized in hive-telegram-bot

## Summary

A user reported that their `/solve` commands were not being recognized by the Telegram bot, while commands from other users in the same group chat worked correctly. Investigation revealed that the bot received the message (confirmed by verbose logs), but Telegraf's entity-based `bot.command()` handler did not trigger. The root cause is that Telegraf's `bot.command()` relies on Telegram `bot_command` entities at offset 0 in the message, and when these entities are missing or malformed (which can happen with certain Telegram clients or edge cases), commands are silently skipped.

## Timeline of Events

| Timestamp   | Event                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| User Action | User "Avers" sends `/solve https://github.com/avers52/VAD-DOT/issues/1 --model opus` in group chat                 |
| Bot Log     | `[VERBOSE] Message:` shows the message IS received with `isOld: false`, `isForwarded: false`, `isAuthorized: true` |
| Bot Log     | `[VERBOSE] /solve command received` does NOT appear in logs                                                        |
| Expected    | Bot should parse command, validate URL, and start solving                                                          |
| Observed    | Messages from this user are not recognized; only 1 of 54 users affected                                            |

## Evidence

### Server Logs Analysis

From the bot's verbose logs (posted in [issue comment](https://github.com/link-assistant/hive-mind/issues/1207#issuecomment-3831634171)):

1. **Message IS received by the bot** - the `bot.on('message')` middleware fires and logs the complete message
2. **All filters pass** - `isOld: false`, `isForwarded: false`, `isAuthorized: true`
3. **Command handler does NOT fire** - `[VERBOSE] /solve command received` is absent from logs
4. **Bot IS a group admin** - confirmed by maintainer, so privacy mode is not the issue

### Key Observation

The verbose message middleware (`bot.on('message')`) at line 1194 runs AFTER `bot.command()` handlers in Telegraf's middleware chain. In Telegraf, `bot.command()` calls `next()` if the command doesn't match, allowing subsequent middleware to run. The fact that `bot.on('message')` fires but `/solve command received` does not means Telegraf's entity-based command matching failed.

### Screenshot Analysis

The issue screenshot shows two instances of the `/solve` command from user "Avers" with no bot response, while GitHub link previews display normally.

## Root Cause Analysis

### Primary Root Cause: Telegraf Entity-Based Command Matching Failure

Telegraf's `bot.command()` uses this logic to match commands (from `composer.ts`):

```javascript
const { entities } = ctx.message;
const cmdEntity = entities?.[0];
if (cmdEntity?.type !== 'bot_command') return next();
if (cmdEntity.offset > 0) return next();
```

The command handler only fires when:

1. `entities[0]` exists
2. `entities[0].type === 'bot_command'`
3. `entities[0].offset === 0`

If ANY of these conditions fail, the command is silently skipped via `next()`. This can happen when:

- The message has no `bot_command` entity (certain Telegram clients may not add it)
- The first entity is not `bot_command` (e.g., a `url` or `text_link` entity appears first)
- The entity offset is not 0 (invisible characters or formatting before the command)

### Why Only 1 of 54 Users Is Affected

This is consistent with a client-side entity generation issue. Different Telegram clients (Android, iOS, Desktop, Web, third-party) may generate different entity arrays for the same text. If one user's client generates entities differently (e.g., URL entity before bot_command entity, or missing bot_command entirely), only that user's commands would be affected.

### Missing Diagnostic Information

The verbose logging did not include entity values, making it impossible to confirm the exact entity issue from the existing logs. The entities field was listed in `Object.keys(msg)` but the actual entity objects were not logged.

### Previously Fixed Related Issues

| PR                                                           | Issue                                 | Root Cause                                                                   |
| ------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------- |
| [#493](https://github.com/link-assistant/hive-mind/pull/493) | Messages not received                 | `isForwardedOrReply` false positives from empty JS objects `{}` being truthy |
| [#496](https://github.com/link-assistant/hive-mind/pull/496) | Messages not received in forum topics | Forum topic messages treated as replies due to `reply_to_message` field      |
| [#494](https://github.com/link-assistant/hive-mind/pull/494) | No diagnostics                        | Added `--verbose` flag and privacy mode diagnostic experiment                |

## Solutions Implemented

### Solution 1: Text-Based Fallback Command Matching (Code Fix)

Added a `bot.on('message')` handler registered AFTER all `bot.command()` handlers that uses text pattern matching (`/^\/(\w+)(?:@(\S+))?\s*/`) as a fallback. When Telegraf's entity-based `bot.command()` skips a message, this fallback catches it by matching the text directly.

Key design decisions:

- Runs only when `bot.command()` doesn't match (registered after, only receives `next()` calls)
- Validates bot username mention (if `/solve@BotName` is used)
- Logs a warning with entity details when triggered, for ongoing diagnostics
- Reuses extracted named handler functions (`handleSolveCommand`, `handleHiveCommand`)

### Solution 2: Entity Logging for Diagnostics (Code Fix)

Added entity logging to the verbose message listener:

```javascript
if (msg.entities) {
  console.log('[VERBOSE] Entities:', JSON.stringify(msg.entities));
}
```

This will show the exact entity array in future verbose logs, making it possible to confirm entity-related issues without speculation.

### Solution 3: Named Handler Functions (Refactor)

Extracted `/solve` and `/hive` command handlers from anonymous functions into named functions (`handleSolveCommand`, `handleHiveCommand`). This enables:

- Reuse by the text-based fallback handler
- Better stack traces in error reporting
- Easier testing

### Solution 4: Message Recognition Tests (Code)

Added 34 unit tests for the message filtering pipeline to verify correct behavior of `isOldMessage`, `isForwardedOrReply`, `isGroupChat`, and `isChatAuthorized`.

## External References

- [Telegraf Source: composer.ts - command matching logic](https://github.com/telegraf/telegraf/blob/v4/src/composer.ts)
- [Telegraf Issue #898 - Context.command does not support regex matching](https://github.com/telegraf/telegraf/issues/898)
- [Telegram Bot API - Message Entities](https://core.telegram.org/bots/api#messageentity)
- [Telegram Bot Privacy Mode Documentation](https://core.telegram.org/bots/features#privacy-mode)
- [Telegraf Issue #1335 - Bot can't receive messages in groups](https://github.com/telegraf/telegraf/issues/1335)

## Recommendations

1. **Monitor fallback handler warnings** - If the text-based fallback triggers, the warning log will show which entities were present, helping identify the exact client-side issue
2. **Consider reporting upstream** - If entity data confirms a Telegraf or Telegram API issue, file a bug report with the specific entity array
3. **Keep verbose mode enabled** in production for a period to collect diagnostic data
4. **Consider adding a `/diagnose` command** that checks bot permissions and reports entity information for the user's message
