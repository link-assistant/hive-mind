# Case Study: Issue #1107 - Auto-restart Session Logging

## Issue Summary

Each auto-restart session should have its own comment with logs and price estimation, instead of having one combined log at the end.

## Timeline of Events (PR #586 - Bad Example)

| Time     | Event                   | Comment/Log                           |
| -------- | ----------------------- | ------------------------------------- |
| 02:58:09 | Initial session ends    | "Solution Draft Log" with $0.997 cost |
| 02:58:17 | Auto-restart 1/3 starts | Comment posted (no log)               |
| 02:58:34 | Auto-restart 2/3 starts | Comment posted (no log)               |
| 03:03:41 | Auto-restart 3/3 starts | Comment posted (no log)               |
| 03:06:15 | Final session ends      | "Solution Draft Log" with $0.689 cost |

**Problem**: Only 2 "Solution Draft Log" comments were posted for 4 sessions (1 initial + 3 restarts).

## Timeline of Events (PR #587 - Better Example)

| Time     | Event                   | Comment/Log                           |
| -------- | ----------------------- | ------------------------------------- |
| 03:05:04 | Initial session ends    | "Solution Draft Log" with $2.862 cost |
| 03:05:12 | Auto-restart 1/3 starts | Comment posted (no log)               |
| 03:08:53 | Final session ends      | "Solution Draft Log" with $1.147 cost |

**Better**: 2 sessions, 2 log comments. But auto-restart comment still doesn't include its own log.

## Root Cause Analysis

### Problem Location

1. **solve.watch.lib.mjs** (lines 224-256):
   - Posts auto-restart notification comment correctly
   - Does NOT attach a log for the previous session
   - Only captures session data for latest session

2. **solve.results.lib.mjs** (lines 530-550):
   - Attaches log only at the end of the entire workflow
   - Called only once per solve.mjs invocation
   - Not called after each auto-restart iteration

3. **github.lib.mjs** (lines 359-708):
   - `attachLogToGitHub()` function works correctly
   - Uses "Solution Draft Log" as default title
   - Supports custom titles via `customTitle` parameter

### Why This Happens

The workflow is:

```
solve.mjs starts
  -> initial session runs
  -> session ends with success
  -> verifyResults() attaches log (1st log)
  -> startWatchMode() with temporaryWatch=true
    -> watchForFeedback() loop
      -> iteration 1: posts "Auto-restart 1/3" comment, runs tool
      -> iteration 2: posts "Auto-restart 2/3" comment, runs tool
      -> iteration 3: posts "Auto-restart 3/3" comment, runs tool
      -> loop exits (max iterations or changes committed)
  -> back in solve.mjs: attaches log (2nd log, covers all restarts)
```

The **missing step** is attaching a log after each auto-restart session completes.

## Solution Design

### Changes Required

1. **solve.watch.lib.mjs**:
   - After each tool execution completes in auto-restart mode, attach the session log
   - Use custom title format: "Auto-restart X/3 Log" instead of "Solution Draft Log"
   - Include session cost in the comment

2. **github.lib.mjs**:
   - Already supports `customTitle` parameter - no changes needed

3. **solve.mjs**:
   - When attaching final log after temporary watch mode, use appropriate title
   - Track session number for proper labeling

### Implementation Plan

1. Import `attachLogToGitHub` and related functions in `solve.watch.lib.mjs`
2. After successful tool execution in auto-restart mode, call `attachLogToGitHub` with:
   - `customTitle`: `"Auto-restart X/Y Log"` where X is current iteration, Y is max
   - Pass session pricing data from tool result
3. Verify max auto-restart iterations is 3 (already confirmed)

## Files Downloaded

- `logs/pr586-session1.txt` - Initial session log (322KB)
- `logs/pr586-session2.txt` - Final session log (708KB)
- `logs/pr587-session1.txt` - Initial session log (808KB)
- `logs/pr587-session2.txt` - Final session log (1065KB)

## Verification

Auto-restart limit is already 3 by default:

- `solve.watch.lib.mjs` line 82: `const maxAutoRestartIterations = argv.autoRestartMaxIterations || 3`
- Command line option: `--auto-restart-max-iterations` (default: 3)
