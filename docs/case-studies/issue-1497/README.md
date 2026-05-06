# Case Study: "Failed to send formatted message" on duplicate /solve command

**Issue:** [#1497](https://github.com/link-assistant/hive-mind/issues/1497)
**Date:** 2026-03-29
**Status:** Fixed
**Related:** [#1460](https://github.com/link-assistant/hive-mind/issues/1460) (same error class, different root cause)

## Summary

When a user sent a `/solve` command for a URL that was already being processed, the bot replied with "Failed to send formatted message" instead of the expected "This URL is being processed" duplicate detection message. The error occurred because the duplicate URL message contained `/solve_queue` with an unescaped underscore, which Telegram's legacy Markdown parser interpreted as the start of an italic entity.

## Timeline / Sequence of Events

1. User `@mbyk96` sends: `/solve https://github.com/MixaByk1996/elements-app/issues/14 --model opus`
2. Bot successfully processes the command, starts a solve session
3. Bot sends success message: "Solve command started successfully!" with session info
4. User sends the same URL again (second `/solve` attempt)
5. Bot detects the URL is already being processed (duplicate detection at `solveQueue.findByUrl()`)
6. Bot tries to send: `"This URL is being processed...\n\n...Use /solve_queue to check the queue status."` with `parse_mode: 'Markdown'`
7. Telegram API rejects the message: "can't parse entities: Can't find end of the entity starting at byte offset [N]"
8. Error propagates to `bot.catch()` global error handler
9. Error handler sends generic "Failed to send formatted message" to user
10. User is confused — no indication of what went wrong or that the URL was a duplicate

## Root Cause Analysis

### Direct cause: Unescaped underscore in `/solve_queue`

The duplicate URL detection message at line 1022 of `telegram-bot.mjs` contained:

```
💡 Use /solve_queue to check the queue status.
```

The `_` in `/solve_queue` is a valid Markdown italic entity start character. Telegram's legacy Markdown parser finds this `_` and searches for a closing `_` to complete the italic entity. Since there is no closing `_`, it returns:

```
400: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 125
```

### Contributing factors

1. **No `safeReply` helper**: The `/solve` and `/hive` command handlers used bare `ctx.reply()` with `parse_mode: 'Markdown'` without any try-catch. This meant any Markdown parsing failure immediately propagated to the global `bot.catch()` error handler.

2. **Multiple unescaped dynamic variables**: Several other `ctx.reply()` calls in the handlers embedded dynamic text (error messages from validators, queue reasons, etc.) without escaping, creating latent Markdown injection risks:
   - `modelError` from `validateModelInArgs()` — can contain `[1m]` (square brackets)
   - `branchError` from `validateBranchInArgs()` — can contain underscore branch names
   - `error.message` from yargs validation — can contain user-supplied option text
   - `check.rejectReason` — can contain system paths with underscores
   - `check.reason` — queue waiting reasons (generally safe but not guaranteed)
   - `extraction.error` — URL extraction error messages

3. **Issue #1460 Fix 3 was planned but never implemented**: The case study for issue #1460 proposed a `safeReply` helper with automatic Markdown-to-plain-text fallback, but it was not implemented at the time. This left the bot vulnerable to any future Markdown parsing failure.

### Why the first `/solve` succeeded but the second failed

The first `/solve` command went through the normal flow: validate -> start execution -> send success message. All text in that message was properly escaped.

The second `/solve` hit the **duplicate URL detection** path (line 1019-1024), which sends a different message — one that happened to contain the unescaped `/solve_queue` text. This path was not covered by the issue #1460 fixes.

## Telegram Markdown Parsing Rules (Reference)

From the [Telegram Bot API docs](https://core.telegram.org/bots/api#formatting-options):

> **Legacy Markdown** (`parse_mode: 'Markdown'`):
>
> - `_italic_` — underscore for italic
> - `*bold*` — asterisk for bold
> - `` `code` `` — backtick for inline code
> - `[link text](url)` — link syntax
> - To escape: use `\` before `_`, `*`, `` ` ``, `[`
> - Entities must not be nested
> - **This mode is deprecated** — MarkdownV2 or HTML is recommended

## Fixes Applied

### Fix 1: Escape underscore in `/solve_queue` text

```javascript
// Before (broken):
`💡 Use /solve_queue to check the queue status.`
// After (fixed):
`💡 Use /solve\\_queue to check the queue status.`;
```

### Fix 2: Add `safeReply()` helper with automatic fallback

A new `safeReply(ctx, text, options)` function that:

1. Tries to send the message with `parse_mode: 'Markdown'`
2. On Telegram parsing error: logs the exact failing message (for diagnostics), strips Markdown formatting, and retries as plain text
3. On other errors: re-throws (non-parsing errors are real bugs)

This implements the `safeReply` helper proposed in issue #1460 Fix 3.

### Fix 3: Escape all unescaped dynamic text

All dynamic variables embedded in Markdown messages are now escaped with `escapeMarkdown()`:

- `modelError`, `branchError`, `malformedErrors` — validation error messages
- `error.message` — yargs validation errors
- `check.rejectReason` — queue rejection reasons
- `check.reason` — queue waiting reasons
- `extraction.error` — URL extraction errors

### Fix 4: Replace all bare `ctx.reply()` with `safeReply()`

All `ctx.reply()` calls in the `/solve` and `/hive` command handlers that used `parse_mode: 'Markdown'` are now routed through `safeReply()`. This ensures that even if future code introduces unescaped text, the bot will gracefully fall back to plain text instead of showing the generic error.

## Tests

20 unit tests added in `tests/test-telegram-safe-reply-issue-1497.mjs`:

- Root cause verification (unescaped `/solve_queue` underscore causes parsing failure)
- Dynamic error message escaping (model, branch, yargs, reject reasons)
- Full message construction safety with special characters
- `safeReply` plain text fallback stripping behavior
- Regression tests for issue #1460 scenarios

## Lessons Learned

1. **Hardcoded text is not safe from Markdown**: Even constant strings like `/solve_queue` can break Telegram's Markdown parser if they contain special characters. All text sent with `parse_mode: 'Markdown'` must be audited for special characters.

2. **Defense in depth matters**: Having both escaping AND a fallback mechanism (`safeReply`) prevents user-visible errors even when individual escaping is missed.

3. **Planned fixes should be implemented immediately**: The `safeReply` helper was proposed during issue #1460 but not implemented. Had it been, issue #1497 would not have occurred.

4. **Consider migrating to HTML parse mode**: Telegram's legacy Markdown is deprecated and has unintuitive escaping rules. HTML mode is more predictable and has clearer entity boundaries.

## References

- [Telegram Bot API: Formatting Options](https://core.telegram.org/bots/api#formatting-options)
- [Issue #1460: /solve command rejected with "can't parse entities" error](https://github.com/link-assistant/hive-mind/issues/1460)
- [Issue #1460 Case Study](../issue-1460/README.md)
