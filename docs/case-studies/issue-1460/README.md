# Case Study: /solve command rejected with "can't parse entities" error

**Issue:** [#1460](https://github.com/link-assistant/hive-mind/issues/1460)
**Date:** 2026-03-21
**Status:** Under investigation (defensive fixes applied, root cause not yet confirmed)

## Summary

A user running `/solve https://github.com/xlab2016/space_db_private/issues/17` experienced `400: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 133`. The command failed without executing, and retrying (with and without `--interactive-mode`) produced the same error at the same byte offset.

## Timeline / Sequence of Events

1. User "S 19" sends: `/solve https://github.com/xlab2016/space_db_private/issues/17 --interactive-mode`
2. Bot processes the command, validates URL, builds a status message
3. Bot calls `ctx.reply()` with `parse_mode: 'Markdown'` to send the starting message
4. Telegram API rejects the message at byte offset 133
5. Error propagates to `bot.catch()` global error handler
6. Error handler sends a generic "message formatting error occurred" message
7. User retries without `--interactive-mode` flag — same error at same byte offset 133
8. User is stuck with no way to use the command

## Root Cause Analysis

### What we know

1. **The URL was already escaped.** At v1.35.1, `escapeMarkdown(normalizedUrl)` was already applied to the URL in the message. The underscores in `space_db_private` were being escaped to `space\_db\_private`. URL underscores are NOT the root cause.

2. **Byte offset 133 is the same in both attempts.** The only difference between the two commands is the options text (`--interactive-mode` vs `none`), which appears AFTER the common prefix. This means the error is in the portion of the message before the options text (user mention or URL).

3. **The user's display name is "S 19"** (visible in screenshots). We do not know their Telegram `@username` or user ID from the screenshots alone.

4. **`buildUserMention` for Markdown mode did NOT escape underscores** in display names or `@username`. If the user had a username containing underscores (e.g., `@s_19`), the Markdown link text `[@s_19](url)` would contain unescaped `_`, which Telegram's parser could interpret as an italic entity start — causing "can't find end of entity".

### What we don't know

- The user's actual Telegram `@username` (not visible in screenshots)
- The user's Telegram user ID (needed to calculate exact byte offsets)
- The bot's `solveOverrides` configuration at the time of the error
- Whether the `@username` or display name contained special characters

### Hypotheses (ranked by likelihood)

1. **User's `@username` contains underscores** — The unescaped `_` inside `[@username](url)` link text is the most likely cause. This is a real bug in `buildUserMention` that was not caught because most users don't have underscores in their usernames.

2. **Non-printable characters in user's display name** — Zero-width characters or unusual Unicode in the user's Telegram name could shift byte offsets and confuse the parser.

3. **Interaction between escaped underscores and Telegram's parser** — The `\_` escaping in the URL text may behave unexpectedly in certain contexts of Telegram's legacy Markdown parser.

### Why it worked for everyone else

Most users' Telegram usernames and display names don't contain `_` or `*`. The URL escaping was already in place. The combination of a user with special characters in their identity + a URL with underscores may be what triggered this specific failure.

## Telegram Markdown Parsing Rules

From the [Telegram Bot API docs](https://core.telegram.org/bots/api#formatting-options):

> To escape characters `_`, `*`, `` ` ``, `[` use the character `\` before them.
> Escaping inside entities is not allowed, i.e. entity must be closed first.
> Entities must not be nested. Use parse mode MarkdownV2 instead.

The legacy Markdown mode is officially deprecated in favor of MarkdownV2.

## Fixes Applied

### Fix 1: Escape display name in `buildUserMention` (Markdown mode)

Escapes `_` and `*` in display names to prevent unescaped Markdown entities inside link text. This is a correctness fix regardless of whether it was the root cause of this specific incident.

### Fix 2: Escape user options and server overrides (defensive)

While current options don't contain `_` or `*`, this prevents future options from causing issues.

### Fix 3: Add `safeReply` helper with automatic fallback

When Telegram rejects Markdown, logs the exact failing message (for root cause analysis) and retries as plain text. This ensures the command still works even if formatting fails.

### Fix 4: Add diagnostic logging

- `safeReply` logs the exact message text that failed (byte length and content)
- Error handler logs the user's Telegram identity (id, username, first_name, last_name)
- Error handler shows input with special characters visualized
- Parsing error messages are always sent as plain text to avoid double failure

## Next Steps

1. **Wait for the error to recur** — With the new logging, we'll capture the exact message text, user identity, and byte offsets needed to confirm the root cause.
2. **Consider migrating to MarkdownV2 or HTML** — The legacy Markdown parser is deprecated and has quirky escaping rules.

## References

- [Telegram Bot API: Formatting Options](https://core.telegram.org/bots/api#formatting-options)
- [python-telegram-bot #1967: Can't parse entities at byte offset](https://github.com/python-telegram-bot/python-telegram-bot/issues/1967)
- [telegraf #1242: What are all the special characters that need to be escaped](https://github.com/telegraf/telegraf/issues/1242)
