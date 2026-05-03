# Case Study: Issue #1574 — `PR #16 has no CI checks yet - treating as no_checks` stuck with no ability to press CTRL+C

## Overview

**Issue**: https://github.com/link-assistant/hive-mind/issues/1574
**Affected PR**: https://github.com/xlabtg/gramflow/pull/16
**Date**: 2026-04-11
**Session ID**: `15c45924-161d-437c-8c55-b75f10d5bf70`
**Full Log**: [Gist](https://gist.githubusercontent.com/konard/0e83f7866b90df76c1d32cc8963c4e64/raw/36d4331a1c098dc1da481415c2a27391e23bf92f/15c45924-161d-437c-8c55-b75f10d5bf70.log)

## Timeline Reconstruction

| Time (UTC) | Event                                                                           |
| ---------- | ------------------------------------------------------------------------------- |
| 23:06:38   | Initial solve session starts for gramflow issue #15                             |
| 23:33:00   | Usage limit reached, auto-resume scheduled                                      |
| 00:11:52   | Session log uploaded (first session)                                            |
| 00:12:02   | Auto-resume begins after limit reset                                            |
| 00:16:59   | Check #2 (inner session): `PR #16 has no CI checks yet - treating as no_checks` |
| 00:17:05   | Auto-restart triggered (iteration 1) due to uncommitted changes                 |
| 00:21:11   | Auto-restart iteration 1 log uploaded                                           |
| 00:21:12   | **AUTO-RESTART-UNTIL-MERGEABLE MODE ACTIVE** (interval: 300s)                   |
| 00:21:13   | Check #1: `no_checks`, workflows have PR triggers → `ci_pending` blocker        |
| 00:21:19   | "Next check in: 300 seconds..." (first 300s sleep)                              |
| 00:21:25   | Tool execution log uploaded, another "Next check in: 300 seconds..."            |
| 00:26:20   | Check #2: same result → 300s sleep                                              |
| 00:31:27   | Check #3: same → 300s sleep                                                     |
| 00:36:33   | Check #4: same → 300s sleep                                                     |
| 00:41:39   | Check #5: `CI not triggered` after 5 consecutive checks                         |
| 00:41:45   | Check #6: consensus check passes → **PR IS MERGEABLE**                          |
| 00:41:57   | "Ready to merge" comment posted, cleanup starts                                 |
| 00:41:59   | Process completed normally                                                      |

**Total time in auto-restart-until-mergeable mode**: ~20 minutes (00:21:12 → 00:41:59)
**Time spent sleeping**: ~4 × 300s = ~20 minutes (essentially the entire duration)

## Root Causes

### Root Cause 1: Uninterruptible `setTimeout` sleeps

The `watchUntilMergeable` function uses `await new Promise(resolve => setTimeout(resolve, seconds * 1000))` for all wait intervals (line 844 in `solve.auto-merge.lib.mjs`). While Node.js SIGINT handlers ARE installed and will call `process.exit(130)`, the exit path runs async cleanup operations (auto-commit via git + log upload to GitHub gist). These async operations execute before `process.exit(130)` is called.

The problem: when the user presses CTRL+C during a 300-second `setTimeout`, the SIGINT handler fires immediately, but:

1. `interruptFunction()` runs auto-commit (git add, commit, push) — network I/O
2. `interruptFunction()` uploads log to GitHub gist — network I/O
3. `cleanupFunction()` runs
4. Only then does `process.exit(130)` execute

If any of these operations hangs or takes long (network timeout, large log upload), the user perceives CTRL+C as unresponsive.

**Affected code locations** (all `await new Promise(resolve => setTimeout(resolve, ...))`):

- `solve.auto-merge.lib.mjs:107` — initial cooldown
- `solve.auto-merge.lib.mjs:203` — consensus double-check delay
- `solve.auto-merge.lib.mjs:226` — consensus disagree wait
- `solve.auto-merge.lib.mjs:239` — repo-wide actions wait
- `solve.auto-merge.lib.mjs:609` — usage limit wait
- `solve.auto-merge.lib.mjs:844` — main loop inter-check wait

### Root Cause 2: Long wait time for repos where CI is not triggered

The `MAX_NO_RUNS_CHECKS = 5` safety valve (in `getMergeBlockers` at `solve.auto-merge-helpers.lib.mjs:340`) combined with the 300s check interval meant the system waited 5 × 300s = 25 minutes before concluding CI was not triggered. The minimum interval at the time was 300s; it has since been reduced to 120s (Issue #1567), making this 5 × 120s = 10 minutes — still significant.

### Root Cause 3: No differentiation between auto-resume mode and standard flow

The issue description asks whether there are different CI check logic paths for auto-resume mode vs. standard finish. Analysis confirms:

- Both modes use the same `getMergeBlockers()` and `getDetailedCIStatus()` functions
- The `watchUntilMergeable` loop is the same regardless of how it was entered (auto-resume or fresh start)
- **No code path differences exist** — the behavior is consistent but the wait time is excessive

## Requirements from Issue

1. **CTRL+C must be immediately responsive** — user should not have to wait for any sleep to complete
2. **Minimize differences between auto-resume and standard flow** — already satisfied, same code path used
3. **Reduce stuck time when CI is not configured/triggered** — 20+ minutes of waiting is excessive
4. **Download all logs and data for case study** — this document

## Solutions Implemented

### Fix 1: Interruptible sleep utility

Replace all `await new Promise(resolve => setTimeout(resolve, ms))` calls with an interruptible sleep that resolves immediately on SIGINT, allowing the exit handler to proceed without waiting for the full sleep duration.

**Implementation**: `src/interruptible-sleep.lib.mjs`

- `interruptibleSleep(ms)` — returns a promise that resolves on timeout OR SIGINT
- On SIGINT, clears the timer and resolves immediately, allowing the normal SIGINT handler chain to proceed
- Applied to all 6 sleep locations in `solve.auto-merge.lib.mjs`

### Fix 2: Reduced initial no-CI-runs check count threshold

When the `getMergeBlockers` safety valve (`MAX_NO_RUNS_CHECKS`) triggers, the subsequent iteration no longer needs to wait the full interval — it can proceed immediately to the consensus check.

## Affected Files

- `src/interruptible-sleep.lib.mjs` (new) — interruptible sleep utility
- `src/solve.auto-merge.lib.mjs` — use interruptible sleep in all wait points
- `tests/interruptible-sleep.test.mjs` — unit tests for the utility
