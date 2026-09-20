# Case Study: Queue Issues (#1267)

## Overview

Issue [#1267](https://github.com/link-assistant/hive-mind/issues/1267) reported several queue-related bugs that appeared after the configurable queue thresholds feature was implemented in [PR #1254](https://github.com/link-assistant/hive-mind/pull/1254) (issue [#1253](https://github.com/link-assistant/hive-mind/issues/1253)).

## Timeline

| Date       | Event                                                          |
| ---------- | -------------------------------------------------------------- |
| 2026-02-11 | PR #1254 merged: configurable queue thresholds with strategies |
| 2026-02-11 | Version 1.21.0 released                                        |
| 2026-02-13 | Issue #1267 filed: 4 queue display/behavior bugs reported      |
| 2026-02-13 | PR #1268 created with fixes                                    |

## Bugs Found

### Bug 1: Disk rejection not blocking queue placement

**Symptom**: When disk usage exceeds 90% with `reject` strategy, the `/solve` command still places items in the queue with a generic "Waiting in queue" message instead of rejecting them outright.

**Root Cause**: In `telegram-bot.mjs`, the `/solve` command handler checked `canStartCommand()` but only used the result's `canStart` field. The `rejected` and `rejectReason` fields (added in PR #1254) were never checked. When `rejected: true`, `canStart` is `false`, so the code fell through to the `else` branch which enqueued the item.

Additionally, `updateAllWaitingItems()` in `telegram-solve-queue.lib.mjs` used `itemCheck.reason || 'Waiting in queue'` as the waiting reason. When the check returns `rejected: true`, the `reason` field is `undefined` (rejection uses `rejectReason`), causing the fallback to "Waiting in queue".

**Fix**:

1. Added explicit `check.rejected` handling before the enqueue branch in the `/solve` command handler
2. Updated `updateAllWaitingItems()` to use `rejectReason` when available

**Classification**: Logic gap - the rejection feature was implemented in the queue system but not integrated into the command handler.

### Bug 2: Missing "used" label on progress bars

**Symptom**: Progress bars for CPU, RAM, Disk, and Claude usage showed just the percentage (e.g., `25%`) without a "used" label, making it less clear what the number represents.

**Root Cause**: In `limits.lib.mjs:formatUsageMessage()`, each progress bar line used a `warning` variable that was either `' ⚠️'` (at/above threshold) or `''` (empty string, below threshold). The empty string provided no context.

**Fix**: Changed the below-threshold suffix from empty string to `' used'`, so bars show `25% used` when below threshold and `95% ⚠️` when at/above threshold.

**Classification**: UX regression - the "used" label was present in earlier versions but lost during refactoring.

### Bug 3: Queue display not showing per-queue breakdown

**Symptom**: The `/limits` command showed a single "Solve Queue" line with combined counts:

```
Solve Queue
Pending: 6, Processing: 0
Claude processes: 0
```

**Expected**: Per-queue breakdown:

```
Queues
claude (pending: 6, processing: 0)
agent (pending: 2, processing: 0)
```

**Root Cause**: `formatStatus()` method in `telegram-solve-queue.lib.mjs` used a combined format that didn't take advantage of the per-tool queue separation introduced in issue #1159.

**Fix**: Rewrote `formatStatus()` to iterate over all known queues and show each one with its pending and processing counts.

### Bug 4: Queue items not grouped by tool, using raw seconds

**Symptom**: The `/solve_queue` command showed items in a flat list with raw seconds for wait time:

```
• url1 [claude] (waiting, 20603s)
```

**Expected**: Grouped by queue with human-readable time:

```
claude (pending: 6, processing: 0)
  • url1 (waiting, 5h 43m 23s)
```

**Root Cause**: `formatDetailedStatus()` combined all items into a single list and used `Math.floor(item.waitTime / 1000)` for display.

**Fix**:

1. Added `formatDuration(ms)` utility function to format milliseconds as `Xd Xh Xm Xs`
2. Rewrote `formatDetailedStatus()` to group items by tool queue, show first 5 per queue, and use human-readable time

## Root Cause Analysis

The core issue was **incomplete integration** between the queue strategy system (PR #1254) and the Telegram command handlers. The queue system correctly supported `reject`, `enqueue`, and `dequeue-one-at-a-time` strategies, but the `/solve` command handler was not updated to check for rejection before enqueueing.

The display issues (bugs 2-4) were **UX regressions** from incremental refactoring. As the queue system evolved through issues #1078, #1133, #1155, #1159, and #1253, the display formatting did not keep pace with the underlying data model changes.

## Prevention

1. **Integration tests**: When adding new return fields to a function (like `rejected`/`rejectReason`), all callers should be updated and tested
2. **Display tests**: Tests should verify the actual display format, not just data structure correctness
3. **Code review checklist**: PRs that add new strategies/modes should include updates to all display/command handlers that consume the strategy results

## Files Changed

| File                                       | Changes                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `src/telegram-bot.mjs`                     | Added rejection handling in `/solve` command, updated `/limits` queue display                                    |
| `src/telegram-solve-queue.lib.mjs`         | Added `formatDuration()`, rewrote `formatStatus()` and `formatDetailedStatus()`, fixed `updateAllWaitingItems()` |
| `src/telegram-solve-queue-command.lib.mjs` | Updated `/solve_queue` command output                                                                            |
| `src/limits.lib.mjs`                       | Added "used" label on progress bars below threshold                                                              |
| `tests/solve-queue.test.mjs`               | Updated format tests, added new tests for all changes                                                            |
| `tests/test-solve-queue-command.mjs`       | Updated format assertions                                                                                        |
