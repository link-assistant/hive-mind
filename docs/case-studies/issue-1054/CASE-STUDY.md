# Case Study: --auto-continue-on-limit-reset Feature Not Working

## Issue Reference

- **Issue**: https://github.com/link-assistant/hive-mind/issues/1054
- **Incident Report**: https://github.com/Jhon-Crow/YandexMusicBetaModeRust/pull/4#issuecomment-3703850597

## Summary

The `--auto-continue-on-limit-reset` flag does not work as expected. When a Claude usage limit is reached during execution, the system posts a "Usage Limit Reached" comment to the PR, but the automatic wait-and-resume mechanism never triggers.

## Timeline of Events

1. **2026-01-01T15:46:29Z**: User runs solve command with `--auto-continue-on-limit-reset` flag
2. **2026-01-01T15:56:33Z**: Claude reaches usage limit while working on the PR
3. **2026-01-01T15:56:40Z**: System detects the usage limit
   - Logs show: "⏳ Usage Limit Reached!"
   - Logs show: "The limit will reset at: 6:00 PM"
   - Logs show: "📄 Attaching logs to Pull Request (auto-continue mode)..."
4. **Process terminates without waiting or resuming**

## Root Cause Analysis

### The Bug Location

The bug is in `src/solve.mjs` in the control flow after handling the usage limit scenario.

### Code Flow Analysis

```
Line 876:  limitReached = toolResult.limitReached;  // Set to TRUE
Line 884:  if (limitReached) {
Line 886:    shouldAutoContinueOnReset = argv.autoContinueOnLimitReset;  // TRUE
Line 889:    if (!shouldAutoContinueOnReset) { ... }  // SKIPPED (auto-continue enabled)
Line 967:    else { /* attaches logs in auto-continue mode */ }  // EXECUTED
Line 1035:  } // End of limitReached block
Line 1038:  if (!success) {  // TRUE - because is_error=true when limit reached
Line 1088:    await safeExit(1);  // EXITS HERE!
}
Line 1100:  await showSessionSummary();  // NEVER REACHED!
Line 1101:    -> calls autoContinueWhenLimitResets()  // NEVER CALLED!
```

### The Problem

When the usage limit is reached:

1. The Claude CLI returns with `is_error: true` (as seen in the logs)
2. This sets `success = false` (line 871: `const { success } = toolResult;`)
3. The code at lines 968-1035 correctly detects auto-continue is enabled and attaches logs
4. **BUT** then control falls through to line 1038 `if (!success)`
5. This causes `safeExit(1)` at line 1088 to be called
6. The process exits **before** reaching `showSessionSummary()` at line 1100
7. `autoContinueWhenLimitResets()` is never called because it's called from within `showSessionSummary()`

### Evidence from Logs

The log file `session-with-limit-9186deea.log` ends with:

```
[2026-01-01T15:56:40.991Z] [INFO]
📄 Attaching logs to Pull Request (auto-continue mode)...
```

The log shows the system correctly detected "auto-continue mode" but then terminated without:

- Showing the session summary
- Waiting for the limit to reset
- Resuming the session

## Proposed Solution

### Option 1: Check for auto-continue before failure exit (Recommended)

Modify the failure handling at line 1038 to NOT exit if auto-continue is enabled and limit was reached:

```javascript
if (!success) {
  // If limit reached with auto-continue enabled, don't exit - continue to showSessionSummary
  if (limitReached && argv.autoContinueOnLimitReset) {
    // Skip failure exit - the showSessionSummary will handle auto-continue
  } else {
    // ... existing failure handling ...
    await safeExit(1, `${argv.tool.toUpperCase()} execution failed`);
  }
}
```

### Option 2: Call autoContinueWhenLimitResets from within the limit handling block

Move the auto-continue logic into the existing limit handling block (lines 968-1035) instead of relying on `showSessionSummary`:

```javascript
if (limitReached) {
  if (!shouldAutoContinueOnReset) {
    // ... existing failure handling ...
  } else {
    // Attach logs
    // ... existing code ...

    // Call auto-continue directly here
    await autoContinueWhenLimitResets(issueUrl, sessionId, argv, shouldAttachLogs);
    // Note: autoContinueWhenLimitResets should exit or loop, not return
  }
}
```

### Option 3: Restructure control flow

Separate "limit reached" from "execution failed" as distinct conditions:

```javascript
const isLimitReached = toolResult.limitReached;
const isExecutionFailed = !toolResult.success && !isLimitReached;

if (isLimitReached) {
  // Handle limit scenarios (with or without auto-continue)
}

if (isExecutionFailed) {
  // Handle actual failures that aren't limit-related
  await safeExit(1, `${argv.tool.toUpperCase()} execution failed`);
}

// Continue to showSessionSummary for limit cases
```

## Impact Assessment

- **Severity**: High - The feature is completely non-functional
- **User Impact**: Users relying on `--auto-continue-on-limit-reset` receive no automatic resumption
- **Workaround**: Users must manually wait for the limit to reset and then manually resume using the provided session ID

## Attached Files

- `session-with-limit-9186deea.log` - Full log of the session that hit the usage limit
- `gist-1-initial-run.log` - Log from successful initial run (for comparison)

## References

- Original incident comment: https://github.com/Jhon-Crow/YandexMusicBetaModeRust/pull/4#issuecomment-3703850597
- Log gist: https://gist.github.com/konard/8a6310cdf519aeb642a5e34defa0b81b
- Code location: `src/solve.mjs:1038-1088`
