# Case Study: Issue #1070 - Make Error Message More User Friendly

## Issue Summary

**Issue URL:** https://github.com/link-assistant/hive-mind/issues/1070
**Issue Title:** Make an error message more user friendly
**Reporter:** User experiencing Telegram bot error when using `/solve` command

## Problem Description

The user tried to execute:

```
/solve https://github.com/Andreymazo/Posutochka_Fastapi/issues
```

And received an unhelpful error message:

```
❌ An error occurred while processing your request.

Details: 400: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 56

💡 Troubleshooting:
• Try running the command again
• Check if all required parameters are correct
• If the issue persists, contact support with the error details above

🔍 Debug info: Update ID: 957679465
```

**User Complaint:**

> Currently that message is big, and seems to be not related to actual problem, and does not suggest actual fix - just adding specific issue id.

## Timeline/Sequence of Events

1. **User Input:** User sent `/solve https://github.com/Andreymazo/Posutochka_Fastapi/issues` to the Telegram bot
2. **Bot Processing:** Bot attempted to process the command
3. **Validation:** The command likely passed initial validation checks
4. **Error Occurred:** Telegram API returned: `400: Bad Request: can't parse entities`
5. **Error Handler Triggered:** Bot's global error handler (lines 1282-1352 in `src/telegram-bot.mjs`) caught the error
6. **Generic Error Response:** Bot sent a generic error message that didn't identify the actual problem

## Root Cause Analysis

### Actual Problem

The user provided a URL to the **issues list** page:

```
https://github.com/Andreymazo/Posutochka_Fastapi/issues
```

But the `/solve` command requires a URL to a **specific issue**:

```
https://github.com/Andreymazo/Posutochka_Fastapi/issues/123
```

### Why This Happened

1. **URL Validation Gap:** The URL validation in `validateGitHubUrl()` (lines 614-653) checks if the URL is a GitHub issue/PR URL, but the parsing logic in `parseGitHubUrl()` likely accepted the issues list page as valid.

2. **Secondary Error - Telegram Entity Parsing:** The actual "400: Bad Request: can't parse entities" error is a **secondary symptom**, not the root cause. This error occurred when the bot tried to send an error message containing special characters that weren't properly escaped for Telegram's Markdown parser.

### What is "400: Bad Request: can't parse entities"?

This is a **Telegram Bot API error**, not a GitHub API error. It occurs when:

- Using `parse_mode: 'Markdown'` or `parse_mode: 'MarkdownV2'` in Telegram messages
- The message text contains special characters that need escaping: `_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!`
- The bot tries to send a message with malformed Markdown entities

**Common Causes:**

1. Special characters in URLs not properly escaped
2. Mismatched or unclosed Markdown tags
3. Incomplete entity formatting

**Research Sources:**

- [Telegram Bot API Issue #265](https://github.com/tdlib/telegram-bot-api/issues/265)
- [Python Telegram Bot Issue #1967](https://github.com/python-telegram-bot/python-telegram-bot/issues/1967)
- [DEV Community: Send message as a Telegram bot](https://dev.to/mbelsky/send-message-as-a-telegram-bot-what-may-go-wrong-1adf)
- [Telegraf Issue #1242](https://github.com/telegraf/telegraf/issues/1242)

## Error Message Issues

The current error handler (lines 1314-1350 in `src/telegram-bot.mjs`) has several problems:

1. **Too Generic:** Doesn't help user understand what they did wrong
2. **Wrong Focus:** Shows Telegram API error instead of the user's actual mistake (wrong URL format)
3. **Unhelpful Suggestions:** "Try running the command again" won't help if the URL is wrong
4. **Too Verbose:** Takes up screen space without providing value
5. **Missing Context:** Doesn't mention the actual requirement (specific issue ID needed)

## Solution Approach

### 1. Better URL Validation (Primary Fix)

Improve the `parseGitHubUrl()` function to:

- Clearly reject `/issues` (issues list) and require `/issues/123` (specific issue)
- Provide a helpful error message before any API call is made

### 2. Improved Error Message (Secondary Fix)

Make the error handler more context-aware:

**For URL Validation Errors:**

```
❌ Invalid GitHub URL

The URL points to the issues list page, but you need to specify a single issue.

✅ Correct format:
/solve https://github.com/owner/repo/issues/123

❌ Your URL:
https://github.com/Andreymazo/Posutochka_Fastapi/issues
                                                      ^^^^^ missing issue number

💡 Find an issue number by clicking on a specific issue in the repository.
```

**For Telegram API Errors (Fallback):**

```
❌ Message formatting error

A technical error occurred while sending the response. This usually means the error message contained special characters.

🔍 Debug info: Update ID: 957679465

💡 Try using plain URLs without special characters, or contact support if this persists.
```

### 3. Escape Markdown Properly

The bot already has `escapeMarkdown()` and `escapeMarkdownV2()` functions (imported from `./telegram-markdown.lib.mjs`), but they're not being used consistently in error messages.

**Fix:** Use escapeMarkdown() for ALL dynamic content in error messages sent with `parse_mode: 'Markdown'`.

## Implementation Plan

1. ✅ **Research & Analysis:** Understand the error and root causes (COMPLETED)
2. **Improve URL Validation:**
   - Read `src/github.lib.mjs` to understand `parseGitHubUrl()`
   - Enhance validation to reject issues list URLs
   - Add helpful error messages with examples
3. **Improve Error Handler:**
   - Detect Telegram API errors vs application errors
   - Provide context-specific messages
   - Properly escape all dynamic content
4. **Testing:**
   - Test with `/solve https://github.com/owner/repo/issues` (should fail with helpful message)
   - Test with `/solve https://github.com/owner/repo/issues/123` (should work)
   - Test error messages contain no unescaped special characters
5. **Documentation:**
   - Update PR with findings
   - Include before/after comparison

## Key Files

- `src/telegram-bot.mjs` (lines 1282-1352): Global error handler
- `src/telegram-bot.mjs` (lines 614-653): `validateGitHubUrl()` function
- `src/github.lib.mjs`: GitHub URL parsing logic
- `src/telegram-markdown.lib.mjs`: Markdown escaping functions

## Expected Outcome

After implementing the solution:

1. **User gets immediate, clear feedback** when providing wrong URL format
2. **Error message explains exactly what's wrong** (missing issue number)
3. **Error message shows correct format** with example
4. **No more Telegram API parsing errors** due to proper escaping
5. **Reduced support burden** as users can self-correct

## Metrics for Success

- User understands the error immediately
- Error message is concise (fits on one mobile screen)
- Error message provides actionable fix
- No more "400: Bad Request: can't parse entities" errors for this scenario
