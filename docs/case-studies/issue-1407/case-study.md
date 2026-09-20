# Case Study: Issue #1407 — Cancel Button Not Hidden After /merge Cancellation

## Overview

**Issue:** [#1407](https://github.com/link-assistant/hive-mind/issues/1407)
**Title:** On cancel of /merge command `cancel` button should be hidden, the message should be updated that it is clear for the user that everything is finished
**Status:** Bug

## Problem Description

When the user clicks the "🛑 Cancel" button in Telegram during a `/merge` operation, two problems occur:

1. **The cancel button remains visible** in the Telegram message even though cancellation has been requested.
2. **The message "The current PR will finish processing"** appears (as a transient toast notification), which is confusing — the user cannot tell if the operation is truly finishing or if they need to wait more.
3. **During CI wait mode** (when a PR is waiting for CI checks to pass), the user clicks cancel but the queue is still waiting for CI - during this long wait the cancel button should be hidden immediately to clarify the state.
4. **On failed CI in the middle**: When CI fails during the queue (post-merge CI failure or health check failure), the onError callback is called which shows a dismiss button — but there's inconsistency in how these states are communicated.

## Timeline of Events (Sequence of States)

```
1. User runs /merge → Message appears with [🛑 Cancel] button
2. Queue starts processing PR #1
3. User clicks [🛑 Cancel] button
4. Bot sends toast: "Merge operation cancellation requested. The current PR will finish processing."
   ❌ PROBLEM: The [🛑 Cancel] button is still visible in the message
5. PR #1 finishes processing (may take many minutes if waiting for CI)
6. Queue loop checks isCancelled → true → status = CANCELLED
7. onComplete called → formatFinalMessage() → "🛑 Merge Queue Cancelled" shown (button removed)
```

**Gap:** Steps 4-7 can take a long time (hours if waiting for CI), during which the cancel button remains visible. The user doesn't know if cancellation was registered.

## Root Cause Analysis

### Code Location

**File:** `src/telegram-merge-command.lib.mjs`, lines 357-372

```javascript
bot.action(/^merge_cancel_(.+)$/, async ctx => {
  const repoKey = ctx.match[1];
  const operation = activeMergeOperations.get(repoKey);
  if (!operation || operation.processor.status !== MergeStatus.RUNNING) {
    await ctx.answerCbQuery('No active merge operation found.');
    return;
  }

  // Cancel the operation
  operation.processor.cancel();
  await ctx.answerCbQuery('Merge operation cancellation requested. The current PR will finish processing.');
  // ❌ BUG: No call to remove the cancel button from the message!
});
```

### Root Cause #1: Missing Button Removal on Cancel

When user clicks cancel:

- `operation.processor.cancel()` sets `isCancelled = true`
- `ctx.answerCbQuery(...)` shows a temporary popup toast
- **But nothing edits the message** to remove the cancel button

The `onComplete` callback eventually removes the button (via `editMessageText` without `reply_markup`), but this only happens after the current PR finishes processing.

### Root Cause #2: Cancellation Not Propagated to Long CI Waits

The `cancel()` method sets `isCancelled = true`, but the cancellation check only happens **between PRs** in the main loop:

```javascript
// telegram-merge-queue.lib.mjs, line 286-290
for (this.currentIndex = 0; this.currentIndex < this.items.length; this.currentIndex++) {
  if (this.isCancelled) {
    // ← Only checked between PRs
    this.status = MergeStatus.CANCELLED;
    break;
  }
  await this.processItem(item); // ← Can take hours if waiting for CI
}
```

During `processItem()`, the queue may be waiting for CI via `waitForCI()`. This function has its own internal loop and doesn't check `this.isCancelled`. As a result, even after the user clicks cancel, the queue could continue waiting for CI for hours before the cancellation takes effect.

### Root Cause #3: Confusing Message During Wait Mode

The cancel toast message says "The current PR will finish processing" which:

- Is technically accurate (cancellation happens BETWEEN PRs), but
- Doesn't communicate clearly that the queue is now in "cancelled/stopping" state
- The user may continue to see the active cancel button and think nothing happened

## Impact

- **User confusion**: User clicks cancel but sees no visual confirmation in the message
- **Poor UX**: Cancel button remains clickable even after cancellation registered
- **Long wait**: If waiting for CI (up to 7 hours timeout), user sees no change for potentially hours

## Fix Design

### Fix #1: Immediately hide cancel button when cancel is clicked

After registering the cancellation, edit the message to:

1. Remove the cancel button (or replace with a "🔄 Cancelling..." status indicator)
2. Update the message body to show "Cancelling..." status

```javascript
bot.action(/^merge_cancel_(.+)$/, async ctx => {
  // ...
  operation.processor.cancel();
  await ctx.answerCbQuery('Cancellation requested.');

  // Immediately hide the cancel button and show cancelling status
  try {
    const currentMessage = processor.formatProgressMessage();
    const cancellingNote = '\n\n🛑 _Cancelling\\.\\.\\. Current PR will finish, then queue will stop\\._';
    await ctx.editMessageText(currentMessage + cancellingNote, {
      parse_mode: 'MarkdownV2',
      // No reply_markup = button removed
    });
  } catch (err) {
    // If edit fails, at least try to remove just the button
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch {}
  }
});
```

### Fix #2: Pass cancellation awareness to CI wait functions

The `waitForCI` function should accept a cancellation check function and abort early if cancelled:

```javascript
// In waitForCI options:
isCancelled: () => this.isCancelled,

// Inside waitForCI loop:
if (options.isCancelled && options.isCancelled()) {
  return { success: false, status: 'cancelled', error: 'Operation was cancelled' };
}
```

### Fix #3: Update progress message to show "Cancelling" state

When `isCancelled === true` but status is still `RUNNING` (the current PR is still being processed), the progress message should indicate this state clearly.

## Evidence from Screenshots

The issue screenshots show:

1. The merge queue progress message with an active "🛑 Cancel" button
2. After clicking cancel, the button remains visible with "The current PR will finish processing" toast

## Related Issues

- **#1143**: Initial /merge command implementation
- **#1269**: Error handling and merge method specification
- **#1304**: CI race condition handling (empty checks = pending)
- **#1307**: Wait for target branch CI before starting queue
- **#1341**: Post-merge CI waiting and branch health checking

## Proposed Solutions

### Solution A (Implemented): Immediate button removal + status message update

**When user clicks cancel:**

1. Remove the cancel button immediately
2. Edit the message to show "🛑 Cancelling... Current operation will finish, then queue will stop."

**When cancellation completes:**

- The existing `onComplete` flow already shows the final "🛑 Merge Queue Cancelled" message correctly

### Solution B (Future enhancement): Early exit from CI wait loops

For long CI wait scenarios, add `isCancelled` checks inside the `waitForCI` loop to allow faster cancellation. This requires passing the cancellation state into the GitHub API functions.

## Fix Verification

Tests should verify:

1. When cancel is clicked, the button is immediately removed from the message
2. The message shows a "cancelling" status
3. The final message after cancellation shows correct status
4. No button remains visible after queue is in CANCELLED state
