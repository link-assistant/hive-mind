# Case Study: Issue 942 - Manual Resume Command on Usage Limit Reached

## Issue Summary

**Issue URL**: https://github.com/link-assistant/hive-mind/issues/942
**Date**: 2025-12-18
**Category**: Bug - User Experience Improvement

When the usage limit is reached and `--auto-continue-on-limit-reset` is NOT enabled, the console output does not provide a copyable manual resume command that users can execute after the limit resets.

## Timeline of Events

| Timestamp (UTC) | Event | Details |
|-----------------|-------|---------|
| 18:26:33 | Session started | Solve command initiated for PR #190 on eo2js repo |
| 18:26:40 | Repo cloned | `/tmp/gh-issue-solver-1766082400215` created |
| 18:26:53 | Claude execution started | Session ID: `4c549ec6-3204-4312-b8e2-5f04113b2f86` |
| 18:51:45 | Context compact triggered | 155,225 pre-tokens |
| 18:51:46 | Limit reached | Claude returned `rate_limit` error |
| 18:51:46 | Error detected | System detected usage limit error |
| 18:51:47 | Failure comment posted | PR received usage limit notification |
| 18:51:47 | Process exited | Exit code 1 |

## Root Cause Analysis

### Problem 1: No Console Resume Command

**Location**: `src/solve.mjs:875-929`

When the usage limit is reached and `--auto-continue-on-limit-reset` is NOT enabled:

1. The code logs: `❌ USAGE LIMIT REACHED!` and `The AI tool has reached its usage limit.`
2. If there's a PR, it posts a comment with the resume command
3. BUT there's **no resume command printed to the console**!

```javascript
// Line 875-876 - Current behavior (missing manual resume command in console)
await log('\n❌ USAGE LIMIT REACHED!');
await log('   The AI tool has reached its usage limit.');
// ... code for attaching logs to PR ...
await safeExit(1, 'Usage limit reached - use --auto-continue-on-limit-reset to wait for reset');
```

### Problem 2: Wrong Manual Resume Attempt

The user tried:
```bash
cd "/tmp/gh-issue-solver-1766082400215" && claude --resume 4c549ec6-3204-4312-b8e2-5f04113b2f86
```

This is **incorrect** because:
1. The temp directory might be in an inconsistent state
2. The `claude --resume` command doesn't have the necessary context
3. The proper command should be: `./solve.mjs "URL" --resume SESSION_ID`

### Problem 3: Missing Working Directory Information

When showing the resume command, the working directory path should also be mentioned so users can:
1. Navigate to the directory to inspect partial work
2. Know which directory NOT to delete before resuming

## Data Files

- `original-log.log` - Complete execution log (10,728 lines)
- Session ID: `4c549ec6-3204-4312-b8e2-5f04113b2f86`
- Working directory: `/tmp/gh-issue-solver-1766082400215`
- Total cost: $9.264664 USD
- Duration: ~25 minutes (1,489,478 ms)

## Implemented Solution

### Fix Overview

The fix adds a Claude resume command at the end of **every** session (success, failure, or usage limit reached) using the `(cd ... && claude --resume ...)` pattern. This allows users to:

1. Investigate sessions interactively in Claude Code
2. Resume from where they left off
3. See full context and history
4. Debug issues

### Console Output After Fix

**On Success:**
```
=== Session Summary ===
✅ Session ID: 4c549ec6-3204-4312-b8e2-5f04113b2f86
✅ Complete log file: /path/to/log.log

💡 To continue this session in Claude Code interactive mode:

   (cd "/tmp/gh-issue-solver-1766082400215" && claude --resume 4c549ec6-3204-4312-b8e2-5f04113b2f86)

ℹ️  Note: Temporary directory will be automatically cleaned up.
   To keep the directory for debugging or resuming, use --no-auto-cleanup
```

**On Usage Limit Reached:**
```
❌ USAGE LIMIT REACHED!
   The AI tool has reached its usage limit.

📁 Working directory: /tmp/gh-issue-solver-1766082400215
📌 Session ID: 4c549ec6-3204-4312-b8e2-5f04113b2f86
⏰ Limit resets at: 8:00 PM

💡 To continue this session in Claude Code interactive mode:

   (cd "/tmp/gh-issue-solver-1766082400215" && claude --resume 4c549ec6-3204-4312-b8e2-5f04113b2f86)

🔄 To resume via solve.mjs after the limit resets, run:
   node src/solve.mjs "https://github.com/..." --resume 4c549ec6-3204-4312-b8e2-5f04113b2f86

💡 Or enable auto-continue-on-limit-reset to wait automatically:
   node src/solve.mjs "https://github.com/..." --resume 4c549ec6-3204-4312-b8e2-5f04113b2f86 --auto-continue-on-limit-reset
```

**On Failure:**
```
💡 To continue this session in Claude Code interactive mode:

   (cd "/tmp/gh-issue-solver-1766082400215" && claude --resume 4c549ec6-3204-4312-b8e2-5f04113b2f86)
```

## Implementation Details

**Files modified**:
- `src/solve.mjs` - Added claude resume command in limit-reached and failure scenarios
- `src/solve.results.lib.mjs` - Modified `showSessionSummary()` to always show claude resume command

## References

- Issue log gist: https://gist.github.com/konard/42170afecbca1d16cf477a3af32cfc2b
- PR comment: https://github.com/objectionary/eo2js/pull/190#issuecomment-3671738917
- Related file: `src/usage-limit.lib.mjs` - Contains `formatUsageLimitMessage()` which already has similar logic but is not being used in solve.mjs
