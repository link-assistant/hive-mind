# Case Study: Issue #1102 - Allow Issues List URLs for /hive Command

## Summary

When using the `/hive` command with a URL like `https://github.com/VisageDvachevsky/StoryGraph/issues`, the Telegram bot returns an error:

```
❌ An error occurred while processing your request.

Details: 400: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 61
```

This error has **two root causes**:

1. The `/hive` command does not accept `issues_list` URLs even though it should work with any repository URL
2. The error message contains unescaped special characters from user input that break Telegram's Markdown parser

## Timeline of Events

| Timestamp     | Event                                                                           |
| ------------- | ------------------------------------------------------------------------------- |
| User Action   | User sends `/hive https://github.com/VisageDvachevsky/StoryGraph/issues`        |
| URL Parsing   | `parseGitHubUrl()` correctly identifies URL type as `issues_list`               |
| Validation    | `validateGitHubUrl()` rejects URL because `issues_list` is not in allowed types |
| Error Message | Error message is constructed with URL that may contain invisible chars          |
| Telegram API  | Bot attempts to send error message with `parse_mode: 'Markdown'`                |
| API Error     | Telegram returns "400: Bad Request: can't parse entities"                       |
| Error Handler | Global error handler (`bot.catch`) catches the error                            |
| User Sees     | Generic error message instead of helpful validation error                       |

## Root Cause Analysis

### Root Cause 1: URL Type Not Allowed

The `/hive` command is configured to accept only these URL types:

```javascript
allowedTypes: ['repo', 'organization', 'user'];
```

However, `https://github.com/owner/repo/issues` is parsed as type `issues_list`, which is not in the allowed list.

**Why this is wrong**: The `/hive` command processes repositories and their issues. A URL pointing to the issues list page is semantically equivalent to a repository URL for the purposes of `/hive`. Users naturally copy the issues page URL when they want to process a repository's issues.

### Root Cause 2: Markdown Parsing Error

When validation fails, the error message includes the original URL from user input:

```javascript
error = `URL points to the issues list page, but you need a specific issue
...
Example: \`${baseUrl}/issues/1\``;
```

This error message:

1. Contains backtick code blocks that need to be properly paired
2. May contain invisible Unicode characters (Zero-Width Space, BOM, etc.) from copy-paste
3. Is sent with `parse_mode: 'Markdown'` which triggers Telegram's parser

The invisible characters break Telegram's Markdown parser, causing the "can't find end of entity" error.

### Evidence

1. **URL Parsing Test** (`experiments/issue-1102/test-url-parsing.mjs`):
   - `https://github.com/VisageDvachevsky/StoryGraph/issues` → type: `issues_list`
   - This type is correctly not in `/hive` allowed types, causing validation failure

2. **Error Message Analysis** (`experiments/issue-1102/test-exact-error.mjs`):
   - Error message contains 4 backticks (properly paired)
   - Byte offset 61 points to text area after emoji
   - Issue likely caused by invisible chars in URL, not backtick pairing

3. **Invisible Character Test** (`experiments/issue-1102/test-invisible-chars.mjs`):
   - Zero-Width Space (U+200B) can be silently included in URLs
   - These characters pass URL parsing but break Markdown

## Proposed Solution

### Fix 1: Allow `issues_list` URLs for `/hive` Command

Add `issues_list` to the allowed URL types for `/hive`:

```javascript
// Before
allowedTypes: ['repo', 'organization', 'user'];

// After
allowedTypes: ['repo', 'organization', 'user', 'issues_list'];
```

When an `issues_list` URL is received, extract the base repository URL for processing.

### Fix 2: Clean Non-Printable Characters from User Input

Apply `cleanNonPrintableChars()` to user input before processing:

```javascript
// In parseCommandArgs or before validation
const cleanedUrl = cleanNonPrintableChars(args[0]);
```

This function already exists in `telegram-markdown.lib.mjs` and removes:

- Zero-width characters (U+200B-U+200D, U+FEFF)
- Control characters
- Soft hyphens

### Fix 3: Escape URLs in Error Messages

When including URLs in error messages, escape them properly:

```javascript
// Use escapeMarkdown for URLs in error messages
error = `URL: ${escapeMarkdown(url)}`;
```

## Implementation

The fix involves:

1. **Update `validateGitHubUrl` function** in `telegram-bot.mjs`:
   - Add `issues_list` to allowed types for `/hive`
   - Handle `issues_list` URLs by extracting base repo URL

2. **Sanitize user input** in `parseCommandArgs` or before validation:
   - Use `cleanNonPrintableChars()` on URLs from user input

3. **Improve error messages**:
   - Escape special characters in URLs using `escapeMarkdown()`
   - Provide correct guidance for `/hive` command (not suggesting issue URLs)

## Related Files

- `src/telegram-bot.mjs` - Main bot implementation
- `src/github.lib.mjs` - `parseGitHubUrl()` function
- `src/telegram-markdown.lib.mjs` - `escapeMarkdown()`, `cleanNonPrintableChars()`

## References

- Original Issue: https://github.com/link-assistant/hive-mind/issues/1102
- Error Screenshot: `./error-screenshot.png`
- Telegram Bot API Markdown documentation
- Similar issue pattern seen in telegram-bot error handling (line 1328)

## Experiments

Test scripts created in `experiments/issue-1102/`:

1. `test-url-parsing.mjs` - Tests URL parsing for different GitHub URL formats
2. `test-error-message.mjs` - Analyzes the exact error message construction
3. `test-invisible-chars.mjs` - Tests for invisible Unicode characters

## Conclusion

The issue is caused by a combination of:

1. Restrictive URL validation that doesn't accept valid user input patterns
2. Lack of input sanitization for invisible Unicode characters
3. Insufficient escaping when including user input in Markdown messages

The fix improves user experience by accepting common URL patterns and properly handling edge cases in user input.
