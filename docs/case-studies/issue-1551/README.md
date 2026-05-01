# Case Study: Agent Queue Not Isolated from Claude Queue (Issue #1551)

## Overview

This case study documents a bug where `--tool agent` commands were shown at incorrect queue positions and unnecessarily blocked by the `claude` queue. Despite having separate queue arrays per tool (introduced in issue #1159), two code paths in `telegram-bot.mjs` still used the **total** queue count across all tools instead of tool-specific counts, breaking queue isolation.

## Timeline of Events

### Background

- **System Configuration:**
  - Telegram bot queue with separate `claude` and `agent` queues (since issue #1159)
  - Queue position shown to users when a command is enqueued
  - `canStart` check determines whether a command starts immediately or gets enqueued

### Incident (April 2026)

1. **User Request:** A user submitted `/solve https://github.com/1Anastasios1/Magic-Quintet/issues/1 --tool agent`

2. **Queue State at Time:** The `claude` queue had 2 pending items; the `agent` queue had 0 items.

3. **Expected Behavior:**
   - The `agent` command should either start immediately (if system resources allow) or show "position #1" in the `agent` queue
   - The `claude` queue should have no effect on the `agent` command's position

4. **Actual Behavior:** The bot displayed:
   ```
   Solve command queued (position #3)
   ```
   The agent command was placed at position #3 because it counted items from both the `claude` queue (2 items) and the `agent` queue (0 + 1 = 1), totaling 3.

### Expected vs Actual Behavior

| Aspect                 | Expected                                                             | Actual                                                               |
| ---------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Queue position display | `position #1` (agent queue)                                          | `position #3` (total across all queues)                              |
| Start decision         | Start immediately if agent queue is empty and system resources allow | Blocked because total `queueStats.queued > 0` (claude items counted) |
| Queue isolation        | Agent queue independent from claude queue                            | Agent queue cross-contaminated by claude queue count                 |

## Root Cause Analysis

### Root Cause 1: Start Decision Uses Total Queue Count

**Code location:** `src/telegram-bot.mjs:1028`

```javascript
if (check.canStart && queueStats.queued === 0) {
  // Start immediately
}
```

`queueStats.queued` is the total count across ALL tool queues (claude + agent). When the `claude` queue has items, this condition fails even for an `agent` command that could start immediately, forcing it into the queue unnecessarily.

**Fix:** Use tool-specific queue count: `queueStats.queuedByTool[solveTool] === 0`

### Root Cause 2: Queue Position Uses Total Count

**Code location:** `src/telegram-bot.mjs:1033`

```javascript
let queueMessage = `Solve command queued (position #${queueStats.queued + 1})`;
```

`queueStats.queued + 1` sums items from all tool queues, showing a misleadingly high position number for tools whose own queue is nearly empty.

**Fix:** Use tool-specific count: `(queueStats.queuedByTool[solveTool] || 0) + 1`

### Why This Wasn't Caught Earlier

Issue #1159 correctly separated the queue arrays, processing logic, limit checking, and consumer loop. However, the **enqueue entry point** in `telegram-bot.mjs` was not updated to use per-tool stats. The `getStats()` method already returns `queuedByTool`, but the bot code only used the aggregate `queued` field.

## Solution

1. Change start decision to check only the current tool's queue length
2. Change position display to show the position within the current tool's queue
3. Add tests verifying that items in one tool's queue don't affect the other tool's start decision or position display

## Related Issues

- Issue #1159: Original tool-specific queue implementation (claude vs agent isolation)
- Issue #1078: Parallel execution capability
- Issue #1267: Queue status display improvements

## Screenshot

See `telegram-queue-screenshot.png` for the original bug report showing position #3 for an agent command.
