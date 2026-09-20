# Case Study: Issue #1062 - Message of `/solve` command response stuck at "Starting solve command..."

## Issue Summary

**Issue URL:** https://github.com/link-assistant/hive-mind/issues/1062
**PR URL:** https://github.com/Jhon-Crow/focus-desktop-simulator/pull/89 (referenced in issue)
**Date:** 2026-01-04

### Symptoms

- User runs `/solve` command in Telegram bot
- Telegram message displays "🚀 Starting solve command..." and stays that way
- The actual solve session starts successfully (as evidenced by the "AI Work Session Started" comment on the PR)
- User expects the message to update to "✅ Solve command started successfully!" with session info

## Timeline of Events

Based on the log file `solution-draft-log-2.txt`:

| Timestamp                | Event                                          |
| ------------------------ | ---------------------------------------------- |
| 2026-01-04T11:48:18.688Z | solve.mjs log file created                     |
| 2026-01-04T11:48:19.135Z | solve v0.54.0 started                          |
| 2026-01-04T11:48:24.188Z | Disk space and memory checks passed            |
| 2026-01-04T11:48:25.199Z | Continue mode activated for PR #89             |
| 2026-01-04T11:48:29.348Z | Repository cloned to temporary directory       |
| 2026-01-04T11:48:31.519Z | Branch checked out successfully                |
| 2026-01-04T11:48:31.527Z | **Work session started**                       |
| 2026-01-04T11:48:32.789Z | PR converted to draft mode                     |
| 2026-01-04T11:48:33.683Z | "AI Work Session Started" comment posted to PR |
| 2026-01-04T11:48:41.318Z | Claude execution began                         |
| 2026-01-04T11:55:22Z     | Fixes applied comment posted                   |
| 2026-01-04T11:56:06Z     | Solution draft log posted                      |

**Key Observation:** The session started at 11:48:31.527Z and the PR got the "Work Session Started" comment at 11:48:33.683Z. But the Telegram message never got updated from "🚀 Starting solve command..." to "✅ Solve command started successfully!".

## Code Analysis

### Two Execution Paths

The `/solve` command has TWO different execution paths:

#### Path 1: Immediate Execution (BUG IS HERE)

**Triggered when:** `check.canStart && queueStats.queued === 0`

```javascript
// telegram-bot.mjs:1083-1085
if (check.canStart && queueStats.queued === 0) {
  const startingMessage = await ctx.reply(`🚀 Starting solve command...\n\n${infoBlock}`, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
  await executeAndUpdateMessage(ctx, startingMessage, 'solve', args, infoBlock);
}
```

The `executeAndUpdateMessage` function (lines 674-691) has **NO try-catch block**:

```javascript
async function executeAndUpdateMessage(ctx, startingMessage, commandName, args, infoBlock) {
  const result = await executeStartScreen(commandName, args);

  if (result.warning) {
    await ctx.telegram.editMessageText(...);  // NO TRY-CATCH!
    return;
  }

  if (result.success) {
    // ...
    await ctx.telegram.editMessageText(...);  // NO TRY-CATCH!
  } else {
    // ...
    await ctx.telegram.editMessageText(...);  // NO TRY-CATCH!
  }
}
```

#### Path 2: Queued Execution (WORKS CORRECTLY)

**Triggered when:** `!(check.canStart && queueStats.queued === 0)`

The queue-based path in `telegram-solve-queue.lib.mjs` HAS proper error handling:

```javascript
// telegram-solve-queue.lib.mjs:678-690
try {
  if (result.warning) {
    await item.ctx.telegram.editMessageText(...);
  } else if (result.success) {
    await item.ctx.telegram.editMessageText(...);
  } else {
    await item.ctx.telegram.editMessageText(...);
  }
} catch {
  // Ignore message edit failures - but at least they're caught!
}
```

## Root Cause

**Primary Root Cause:** Missing error handling in `executeAndUpdateMessage` function.

When the Telegram API call to `editMessageText` fails (due to network issues, rate limiting, message too old to edit, etc.), the error is thrown but not caught. This causes:

1. The error propagates up uncaught
2. The message update never happens
3. The message stays stuck at "🚀 Starting solve command..."
4. The actual solve process continues running (independently in a screen session)

**Why the queued path doesn't have this issue:** The queued path wraps all `editMessageText` calls in try-catch blocks (lines 678-690 of `telegram-solve-queue.lib.mjs`).

## Additional Issues Found

1. **Silently swallowed errors in queue path:** The queue path catches errors but only logs them with `this.log()` (which requires verbose mode). In production, edit failures are completely silent.

2. **No retry mechanism:** Neither path attempts to retry failed message updates.

3. **No logging in immediate path:** If `editMessageText` fails in the immediate path, there's no logging to help debug what went wrong.

4. **CRITICAL BUG: messageInfo cleared before use in queue path:** In `telegram-solve-queue.lib.mjs`, the code calls `item.setStarted(sessionName)` which sets `messageInfo = null` BEFORE trying to read `messageInfo` to update the message. This meant the final success message update in the queue path NEVER happened because `chatId` and `messageId` were always `undefined`.

## Evidence from Screenshots

### Screenshot 1 (image1.png)

Shows the GitHub PR with:

- "AI Work Session Started" comment at 2026-01-04T11:48:31.527Z
- "Fixes Applied" comment at later time
- Evidence that the solve process ran successfully

### Screenshot 2 (image2.png)

Shows the Telegram bot conversation with:

- User "Jo Jo" running `/solve https://github.com/Jhon-Crow/focus-desktop-simulator/pull/89`
- Bot responding with "🚀 Starting solve command..."
- Message never updated to success status

## Proposed Solution

### Fix 1: Add try-catch to executeAndUpdateMessage

Wrap all `editMessageText` calls in try-catch blocks with proper logging:

```javascript
async function executeAndUpdateMessage(ctx, startingMessage, commandName, args, infoBlock) {
  const result = await executeStartScreen(commandName, args);

  try {
    if (result.warning) {
      await ctx.telegram.editMessageText(...);
      return;
    }

    if (result.success) {
      await ctx.telegram.editMessageText(...);
    } else {
      await ctx.telegram.editMessageText(...);
    }
  } catch (error) {
    console.error(`Failed to update Telegram message after ${commandName} execution:`, error.message);
    // Optionally: attempt retry or alternative notification
  }
}
```

### Fix 2: Add logging to queue path

Change the silent catch to include logging:

```javascript
} catch (error) {
  console.error(`[solve-queue] Failed to update message: ${error.message}`);
}
```

### Fix 3 (Optional): Add retry mechanism

Implement a simple retry mechanism for transient failures:

```javascript
async function editMessageWithRetry(ctx, chatId, messageId, text, options, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await ctx.telegram.editMessageText(chatId, messageId, undefined, text, options);
      return true;
    } catch (error) {
      console.error(`Message edit attempt ${attempt}/${maxRetries} failed:`, error.message);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  return false;
}
```

## Files to Modify

1. **`src/telegram-bot.mjs`** - `executeAndUpdateMessage` function (lines 674-691)
2. **`src/telegram-solve-queue.lib.mjs`** - `executeItem` method (lines 688-690)

## Implemented Fixes

### Fix 1: Add try-catch to executeAndUpdateMessage (telegram-bot.mjs)

Added a `safeEditMessage` helper function that wraps `editMessageText` calls in try-catch blocks with proper logging. This ensures that if the Telegram API fails, the error is caught and logged rather than propagating and leaving the message stuck.

### Fix 2: Save messageInfo before setStarted (telegram-solve-queue.lib.mjs)

Fixed the critical bug where `messageInfo` was being cleared by `setStarted()` before the code tried to use it. Now we save `messageInfo` to a local variable before calling `setStarted()`, then use the saved value for the message update.

### Fix 3: Add proper error logging (telegram-solve-queue.lib.mjs)

Changed the silent `catch {}` blocks to `catch (error) {}` with `console.error()` logging so that message edit failures are visible in the logs for debugging.

## Test Files Added

- `tests/test-telegram-message-edit-error-handling.mjs` - Unit tests for the error handling fixes

## Attachments

- `image1.png` - GitHub PR screenshot showing successful session start
- `image2.png` - Telegram screenshot showing stuck message
- `solution-draft-log-1.txt` - First solve session log (successful)
- `solution-draft-log-2.txt` - Second solve session log (the one with the bug)
