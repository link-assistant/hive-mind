# Case Study: Issue #1292 - `/merge` Command Not Working

## Executive Summary

The `/merge` command in the hive-telegram-bot fails silently when updating Telegram messages due to unescaped special characters (specifically `-` hyphen) in repository names when using MarkdownV2 formatting.

**Issue:** [#1292 - `/merge` command is not working](https://github.com/link-assistant/hive-mind/issues/1292)

**Root Cause:** Repository owner and name values (`link-assistant/hive-mind`) contain hyphens that are not escaped when constructing MarkdownV2-formatted Telegram messages.

**Impact:** Users receive no feedback after the initial "Starting merge process..." message, making the bot appear stuck.

## Timeline of Events

1. **User Action:** User sends `/merge https://github.com/link-assistant/hive-mind` command
2. **Initial Response:** Bot displays "Found 2 PRs with 'ready' label. Starting merge process..."
3. **PR Processing:** Bot attempts to process PR #1241 and #1257
4. **PRs Skipped:** Both PRs have merge conflicts (state: DIRTY)
5. **Message Update Failure:** When trying to update the Telegram message with progress, Telegram API returns `400: Bad Request: can't parse entities: Character '-' is reserved`
6. **Silent Failure:** Error is logged but no feedback is shown to user
7. **Message Stuck:** User sees the initial message without any updates

## Root Cause Analysis

### The Bug

In `telegram-merge-queue.lib.mjs`, the `formatProgressMessage()` and `formatFinalMessage()` methods use repository owner and name directly without escaping:

```javascript
// Line 442-443 in formatProgressMessage()
let message = `*Merge Queue*\n`;
message += `${this.owner}/${this.repo}\n\n`; // BUG: Not escaped!

// Line 517-518 in formatFinalMessage()
let message = `${statusEmoji} *Merge Queue ${statusText}*\n`;
message += `${this.owner}/${this.repo}\n\n`; // BUG: Not escaped!
```

### Why This Fails

Repository names like `link-assistant` and `hive-mind` contain hyphens (`-`). In Telegram MarkdownV2 format, the following characters must be escaped with a preceding backslash:

```
_ * [ ] ( ) ~ ` > # + - = | { } . !
```

When the message is sent with `parse_mode: 'MarkdownV2'`, Telegram's parser encounters the unescaped `-` and fails with:

```
400: Bad Request: can't parse entities: Character '-' is reserved and must be escaped with the preceding '\'
```

### Code Flow

1. `registerMergeCommand()` in `telegram-merge-command.lib.mjs` registers callbacks:
   - `onProgress` - calls `processor.formatProgressMessage()` and sends to Telegram
   - `onComplete` - calls `processor.formatFinalMessage()` and sends to Telegram

2. When `editMessageText()` is called with the unescaped message, Telegram API rejects it

3. The error is caught but only logged (lines 237-239):

   ```javascript
   } catch (err) {
     if (!err.message?.includes('message is not modified')) {
       VERBOSE && console.log(`[VERBOSE] /merge: Error updating message: ${err.message}`);
     }
   }
   ```

4. The user never sees any update because subsequent calls also fail

### Existing Escape Function

The codebase already has an `escapeMarkdown()` function in `MergeQueueProcessor`:

```javascript
// Line 549-551 in telegram-merge-queue.lib.mjs
escapeMarkdown(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}
```

And `escapeMarkdownV2()` in `telegram-merge-command.lib.mjs`:

```javascript
// Line 45-47
function escapeMarkdownV2(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}
```

These functions are correctly defined but **not used** for the repository owner/name.

## Evidence

### Log Analysis

```
[VERBOSE] /merge-queue: Skipped PR #1241: PR has merge conflicts
[VERBOSE] /merge: Error updating message: 400: Bad Request: can't parse entities: Character '-' is reserved and must be escaped with the preceding '\'
```

The error occurs immediately after processing a PR, when the bot tries to update the progress message.

### Affected Code Locations

| File                           | Line | Issue                                                                 |
| ------------------------------ | ---- | --------------------------------------------------------------------- |
| `telegram-merge-queue.lib.mjs` | 443  | `${this.owner}/${this.repo}` not escaped in `formatProgressMessage()` |
| `telegram-merge-queue.lib.mjs` | 518  | `${this.owner}/${this.repo}` not escaped in `formatFinalMessage()`    |

## Proposed Solutions

### Solution 1: Fix Escaping in Format Methods (Recommended)

Update both format methods to escape owner and repo names:

```javascript
// In formatProgressMessage() - line 442-443
formatProgressMessage() {
  const update = this.getProgressUpdate();

  let message = `*Merge Queue*\n`;
  message += `${this.escapeMarkdown(this.owner)}/${this.escapeMarkdown(this.repo)}\n\n`;
  // ... rest of the method
}

// In formatFinalMessage() - line 517-518
formatFinalMessage() {
  const report = this.getFinalReport();
  // ...
  let message = `${statusEmoji} *Merge Queue ${statusText}*\n`;
  message += `${this.escapeMarkdown(this.owner)}/${this.escapeMarkdown(this.repo)}\n\n`;
  // ... rest of the method
}
```

### Solution 2: Use HTML Instead of MarkdownV2

HTML formatting is less error-prone as it doesn't require escaping as many characters:

```javascript
// Instead of MarkdownV2:
await ctx.telegram.editMessageText(chatId, messageId, undefined, message, {
  parse_mode: 'HTML',
});

// Message formatting would change to:
// *Bold* becomes <b>Bold</b>
// `code` becomes <code>code</code>
```

### Solution 3: Use @telegraf/entity Package

Use the official Telegraf escaping library:

```javascript
import { escapers } from '@telegraf/entity';

// Escape text for MarkdownV2
const safeText = escapers.MarkdownV2(text);
```

## Recommended Fix

Apply Solution 1 as it requires minimal changes and uses existing code:

```diff
--- a/src/telegram-merge-queue.lib.mjs
+++ b/src/telegram-merge-queue.lib.mjs
@@ -440,7 +440,7 @@
     const update = this.getProgressUpdate();

     let message = `*Merge Queue*\n`;
-    message += `${this.owner}/${this.repo}\n\n`;
+    message += `${this.escapeMarkdown(this.owner)}/${this.escapeMarkdown(this.repo)}\n\n`;

     // Progress bar in code block for better style
@@ -515,7 +515,7 @@
     }

     let message = `${statusEmoji} *Merge Queue ${statusText}*\n`;
-    message += `${this.owner}/${this.repo}\n\n`;
+    message += `${this.escapeMarkdown(this.owner)}/${this.escapeMarkdown(this.repo)}\n\n`;

     // Final progress bar in code block
```

## Testing Recommendations

1. Test with repository names containing hyphens: `owner-name/repo-name`
2. Test with repository names containing other special characters: `user.name/repo_name`
3. Test with repository names containing underscores, periods, etc.
4. Verify all messages update correctly throughout the merge queue process

## Related Research

### Telegram MarkdownV2 Specification

From the [Telegram Bot API documentation](https://core.telegram.org/bots/api#markdownv2-style):

> In all other places characters `_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!` must be escaped with the preceding character `\`.

### Related Issues and Discussions

- [Telegraf Issue #1242: What are all the "special characters" that need to be escaped](https://github.com/telegraf/telegraf/issues/1242)
- [Symfony Issue #42697: Escaping special characters with MarkdownV2](https://github.com/symfony/symfony/issues/42697)
- [@telegraf/entity escaper implementation](https://github.com/telegraf/entity/blob/master/escapers.ts)

### Known Libraries for MarkdownV2 Escaping

| Library              | Language              | Link                                                      |
| -------------------- | --------------------- | --------------------------------------------------------- |
| @telegraf/entity     | JavaScript/TypeScript | [npm](https://www.npmjs.com/package/@telegraf/entity)     |
| telegram-markdown-v2 | JavaScript            | [npm](https://www.npmjs.com/package/telegram-markdown-v2) |
| telegram-escape      | Rust                  | [crates.io](https://crates.io/crates/telegram-escape)     |

## Files Referenced

- `src/telegram-merge-queue.lib.mjs` - Contains the bug
- `src/telegram-merge-command.lib.mjs` - Registers the command handler
- `src/github-merge.lib.mjs` - GitHub API operations

## Conclusion

This is a straightforward bug where dynamic content (repository owner/name) is not being escaped before inclusion in a MarkdownV2-formatted message. The fix is simple: apply the existing `escapeMarkdown()` function to the owner and repo values in both format methods.

The bug was likely introduced because repository names were assumed to be "safe" identifiers, when in reality GitHub allows many special characters including hyphens, underscores, and periods in repository names.
