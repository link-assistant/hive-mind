# Case Study: /solve command rejected with "can't parse entities" error

**Issue:** [#1460](https://github.com/link-assistant/hive-mind/issues/1460)
**Date:** 2026-03-21
**Status:** Fixed

## Summary

Users running `/solve` command with URLs containing underscores (e.g., `space_db_private`) experienced a confusing error message about "message formatting" that provided no actionable information. The command failed silently without executing, and retrying didn't help.

## Timeline / Sequence of Events

1. User sends: `/solve https://github.com/xlab2016/space_db_private/issues/17 --interactive-mode`
2. Bot processes the command, validates URL, builds a status message
3. Bot calls `ctx.reply()` with `parse_mode: 'Markdown'` to send the starting message
4. Telegram API rejects the message: `400: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 133`
5. Error propagates to `bot.catch()` global error handler
6. Error handler sends a generic "message formatting error occurred" message
7. User retries without `--interactive-mode` flag - same error at same byte offset
8. User is stuck with no way to use the command

## Root Cause Analysis

### Primary Root Cause: Unescaped special characters in Telegram Markdown messages

The bot sends messages using Telegram's legacy Markdown parser (`parse_mode: 'Markdown'`). In this mode, characters like `_`, `*`, `` ` ``, and `[` have special meaning:

- `_text_` = italic
- `*text*` = bold
- `[text](url)` = link

**Three sources of unescaped content were identified:**

#### 1. `buildUserMention()` - Display name not escaped (critical)

In `src/buildUserMention.lib.mjs`, the Markdown mode returns:
```javascript
return `[${displayName}](${link})`;
```

If the user's Telegram username contains underscores (e.g., `@my_cool_bot`), the display name `@my_cool_bot` is NOT escaped, creating an unmatched italic entity within the link text.

#### 2. `userOptionsText` - Command options not escaped

In `src/telegram-bot.mjs`, user-provided options were inserted directly:
```javascript
const userOptionsText = userArgs.slice(1).join(' ') || 'none';
let infoBlock = `...🛠 Options: ${userOptionsText}`;
```

Options like `--some_flag` would have unescaped underscores.

#### 3. `solveOverrides`/`hiveOverrides` - Server config not escaped

Locked options from server configuration were also not escaped:
```javascript
if (solveOverrides.length > 0) infoBlock += `\n🔒 Locked options: ${solveOverrides.join(' ')}`;
```

### Secondary Root Cause: Unhelpful error message

The error handler showed:
```
❌ A message formatting error occurred.

💡 This usually means there was a problem with special characters in the response.
Please try your command again with a different URL or contact support.
```

This message:
- Suggests the URL is the problem ("try with a different URL") when the URL escaping was actually correct
- Only shows debug info when VERBOSE mode is enabled
- Doesn't show the actual Telegram API error to the user
- Doesn't visualize what characters were problematic

### Why byte offset 133 was the same in both attempts

Both attempts (with and without `--interactive-mode`) produced the same byte offset because:
- The error was in the portion of the message **before** the options text
- The same user mention and URL appear in both cases
- The unescaped character (likely in the user's display name or a quirk of URL underscore escaping at a specific position) was at the same location

## Telegram Markdown Parsing Rules

From the [Telegram Bot API docs](https://core.telegram.org/bots/api#formatting-options):

> To escape characters `_`, `*`, `` ` ``, `[` use the character `\` before them.
> Escaping inside entities is not allowed, i.e. entity must be closed first.

The legacy Markdown mode is officially deprecated in favor of MarkdownV2, but remains widely used.

## Fixes Applied

### Fix 1: Escape display name in `buildUserMention` (Markdown mode)
```javascript
// Before:
return `[${displayName}](${link})`;

// After:
const escapedMarkdownName = displayName.replace(/_/g, '\\_').replace(/\*/g, '\\*');
return `[${escapedMarkdownName}](${link})`;
```

### Fix 2: Escape user options and server overrides
```javascript
const userOptionsText = escapeMarkdown(userArgs.slice(1).join(' ') || 'none');
// ...
if (solveOverrides.length > 0) infoBlock += `\n🔒 Locked options: ${escapeMarkdown(solveOverrides.join(' '))}`;
```

### Fix 3: Add `safeReply` helper with automatic fallback
When Markdown parsing fails, automatically retry by stripping formatting and sending as plain text:
```javascript
async function safeReply(ctx, text, options = {}) {
  try {
    return await ctx.reply(text, { parse_mode: 'Markdown', ...options });
  } catch (error) {
    if (isParsingError) {
      const plainText = stripMarkdown(text);
      return await ctx.reply(plainText, { ...options, parse_mode: undefined });
    }
    throw error;
  }
}
```

### Fix 4: Improve error messages with detailed debug output
- Always show the Telegram API error message (not just in VERBOSE mode)
- Show user input with special characters visualized
- Report hidden character count
- Send parsing error messages as plain text to avoid double failure

## Prevention Recommendations

1. **Consider migrating to MarkdownV2** - The legacy Markdown parser is deprecated and has quirky escaping rules. MarkdownV2 is more predictable.
2. **Consider using HTML parse mode** - HTML is even more predictable and doesn't require escaping common characters like `_` in URLs.
3. **Always escape user-generated content** - Any text that comes from users (names, URLs, options) should be escaped before inclusion in Markdown messages.
4. **Use `safeReply` for all user-facing messages** - The fallback mechanism ensures users always get a response even if formatting fails.

## References

- [Telegram Bot API: Formatting Options](https://core.telegram.org/bots/api#formatting-options)
- [python-telegram-bot #1967: Can't parse entities at byte offset](https://github.com/python-telegram-bot/python-telegram-bot/issues/1967)
- [TelegramBots #121: Exception on sending message with underline character](https://github.com/rubenlagus/TelegramBots/issues/121)
