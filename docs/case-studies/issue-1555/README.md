# Issue #1555: Queued tasks not rejected when disk space passes limit

## Summary

Tasks already in the Telegram solve queue were not immediately rejected when disk space exceeded the configured threshold. Instead, they stayed in a "waiting" state indefinitely, confusing users since the only resolution was a server restart (which loses the queue anyway).

## Timeline

1. User submits `/solve` commands while disk space is normal - tasks enqueue successfully
2. Disk space usage exceeds 90% threshold (default `HIVE_MIND_DISK_THRESHOLD`)
3. New `/solve` commands are correctly rejected at submission time (telegram-bot.mjs:1023)
4. **Bug**: Previously queued tasks remain in "waiting" state showing disk-full reason but never rejected
5. Queue consumer loop keeps polling but can never start these items
6. Users see misleading "Waiting" status instead of clear rejection
7. Server restart is required, which loses the queue anyway

## Root Cause

The disk threshold uses the `'reject'` strategy (since issue #1253), which is designed to immediately reject commands. However, the rejection logic was only implemented at **submission time** in `telegram-bot.mjs`, not in the **consumer loop** in `telegram-solve-queue.lib.mjs`.

### Submission path (working correctly)

```
telegram-bot.mjs:1016  →  canStartCommand()
telegram-bot.mjs:1023  →  if (check.rejected) → reject immediately
```

### Consumer path (bug)

```
runConsumer()
  → findStartableItems()
    → canStartCommand() returns { rejected: true, canStart: false }
    → item NOT in startableItems (correct)
    → item stays in queue (BUG - should be rejected)
  → updateAllWaitingItems()
    → shows rejectReason as waitingReason (cosmetic only)
    → item still stays in queue (BUG)
```

### Key code locations

| File                               | Line                      | Role                                             |
| ---------------------------------- | ------------------------- | ------------------------------------------------ |
| `src/queue-config.lib.mjs`         | 246                       | Disk threshold default: 90%, strategy: 'reject'  |
| `src/telegram-bot.mjs`             | 1023                      | Rejects new commands at submission (working)     |
| `src/telegram-solve-queue.lib.mjs` | `findStartableItems()`    | Consumer loop - did NOT reject queued items      |
| `src/telegram-solve-queue.lib.mjs` | `updateAllWaitingItems()` | Waiting update - showed reason but didn't reject |

## Solution

### Changes in `src/telegram-solve-queue.lib.mjs`

1. **`findStartableItems()`**: When `canStartCommand()` returns `rejected: true`, call new `rejectAllItemsInQueue()` to immediately reject all items in that tool's queue.

2. **`updateAllWaitingItems()`**: Before iterating individual items, check if the tool's threshold triggers rejection. If so, reject all items at once via `rejectAllItemsInQueue()`.

3. **New `rejectAllItemsInQueue()` method**: Centralized helper that removes all items from a tool queue, marks them as failed with the rejection reason, tracks them in stats, and notifies users via Telegram message update.

### Design decisions

- Items are marked as `FAILED` (not a new `REJECTED` status) to reuse existing tracking infrastructure
- Users receive the same rejection message format as new-command rejection for consistency
- The `rejectAllItemsInQueue` helper is shared between `findStartableItems` and `updateAllWaitingItems` to avoid duplication
- The fix applies to ALL reject-strategy thresholds (disk, RAM, CPU, API limits), not just disk

## Tests

6 new tests added to `tests/solve-queue.test.mjs`:

1. `rejectAllItemsInQueue` rejects all items and updates stats
2. `rejectAllItemsInQueue` handles empty queue gracefully
3. `findStartableItems` rejects queued items when `canStartCommand` returns rejected
4. `findStartableItems` only rejects tool queues affected by rejection
5. `updateAllWaitingItems` rejects items when reject strategy threshold exceeded
6. `updateAllWaitingItems` keeps items when not rejected (enqueue strategy)

## Related issues

- #1253: Configurable threshold strategies (reject, enqueue, dequeue-one-at-a-time)
- #1267: Display rejection reasons for waiting items
- #1078: Queue consumer logic and message updates
