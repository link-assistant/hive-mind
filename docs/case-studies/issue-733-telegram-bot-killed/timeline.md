# Timeline: Issue #733 - Telegram Bot Killed

## Historical Context

### 2025-10-16: Issue #583 Reported
**Event**: User reports stderr pollution with non-blocking errors
**Issue**: https://github.com/deep-assistant/hive-mind/issues/583
**Error**: `YError: Not enough arguments provided. Expected 1 but received 0.`
**Location**: `hive` command worker processes
**Impact**: Confusing error messages that didn't block execution

### 2025-10-30: PR #585 Merged
**Event**: Fix for issue #583 merged to main branch
**PR**: https://github.com/deep-assistant/hive-mind/pull/585
**Changes**:
1. Modified `src/solve.config.lib.mjs` to suppress stderr during yargs parsing (lines 239-269)
2. Added `process.stderr.write` override to capture and suppress YError messages
3. Fixed git command stderr output with `2>/dev/null` redirection
4. Added comprehensive documentation about command-stream stderr handling

**Key Implementation** (solve.config.lib.mjs:244-254):
```javascript
// Temporarily override stderr.write to capture output
process.stderr.write = function(chunk, encoding, callback) {
  stderrBuffer.push(chunk.toString());
  if (typeof encoding === 'function') {
    encoding();
  } else if (typeof callback === 'function') {
    callback();
  }
  return true;
};
```

### Unknown Date: telegram-bot.mjs Not Updated
**Issue**: The fix in PR #585 was applied to `solve.config.lib.mjs` but NOT to `telegram-bot.mjs`
**Location**: `src/telegram-bot.mjs:873-892`
**Problem**: telegram-bot.mjs calls `testYargs.parse(args)` without stderr suppression
**Result**: YError messages still appear in telegram bot logs

### 2025-11-14: Issue #733 Reported
**Event**: Telegram bot killed after multiple YError occurrences
**Issue**: https://github.com/deep-assistant/hive-mind/issues/733
**Symptoms**:
- Multiple YError messages in logs
- 4 consecutive errors for different GitHub URLs
- Process eventually killed

## Detailed Event Sequence (Issue #733)

### Event 1: First YError
**Time**: Unknown (from logs)
**Action**: `/solve` command processed
**URL**: `https://github.com/link-foundation/test-anywhere/issues/17`
**Result**:
```
[VERBOSE] /solve passed all checks, executing...
YError: Not enough arguments provided. Expected 1 but received 0.
    at file:///.../@deep-assistant/hive-mind/src/telegram-bot.mjs:875:46
```
**Impact**: Error printed to stderr, but execution continued

### Event 2: Second YError
**URL**: `https://github.com/link-foundation/lino-arguments/pull/2`
**Result**: Identical YError stack trace
**Impact**: Error printed to stderr, execution continued

### Event 3: Third YError
**URL**: `https://github.com/deep-assistant/hive-mind/pull/732`
**Result**: Identical YError stack trace
**Impact**: Error printed to stderr, execution continued

### Event 4: Fourth YError
**URL**: `https://github.com/deep-assistant/web-capture/pull/18`
**Result**: Identical YError stack trace
**Impact**: Error printed to stderr, but this was the last attempt

### Event 5: Process Killed
**Result**:
```
Killed
hive@6000267-wh74803:~$
```
**Possible Causes**:
1. **OOM Killer**: Memory exhaustion from repeated errors
2. **Manual Intervention**: Admin killed the process
3. **Crash Loop**: System detected repeated failures and terminated
4. **External Monitor**: Watchdog process detected unhealthy state

## Code Flow Analysis

### Normal Flow (After PR #585 in solve.config.lib.mjs)
```
1. User runs solve command
2. parseArguments() called
3. stderr.write temporarily overridden (line 245)
4. createYargsConfig(yargs()).parse(rawArgs) called (line 257)
5. YError thrown but captured in stderrBuffer
6. stderr.write restored (line 260)
7. Error NOT printed to user's stderr
8. Execution continues normally
```

### Broken Flow (telegram-bot.mjs)
```
1. User sends /solve via Telegram
2. validateGitHubUrl() passes (line 863)
3. mergeArgsWithOverrides() creates args array (line 870)
4. createSolveYargsConfig(yargs()) called (line 875)
5. testYargs.exitProcess(false) set (line 881)
6. testYargs.fail() configured to throw (lines 882-886)
7. testYargs.parse(args) called (line 888)
8. ⚠️  NO stderr suppression active
9. YError printed directly to stderr
10. Error caught and replied to user (line 890)
11. Function returns, but stderr already polluted
```

## Key Differences

### solve.config.lib.mjs (FIXED)
- ✅ Overrides `process.stderr.write` before parsing
- ✅ Captures YError in buffer
- ✅ Restores stderr after parsing
- ✅ Clean stderr output in verbose mode

### telegram-bot.mjs (BROKEN)
- ❌ Does NOT override `process.stderr.write`
- ❌ YError written directly to stderr
- ❌ No cleanup or suppression
- ❌ Polluted stderr output

## Timeline Summary

```
2025-10-16: Issue #583 opened (YError in hive workers)
            ↓
2025-10-30: PR #585 merged (fix for solve.config.lib.mjs)
            ↓
     ???  : telegram-bot.mjs not updated (missed in PR)
            ↓
2025-11-14: Issue #733 opened (YError in telegram-bot)
            ↓
2025-11-14: Case study created (this document)
```

## Root Cause Summary

**Primary Cause**: Incomplete application of PR #585 fix
**Secondary Cause**: No shared utility function for yargs parsing with stderr suppression
**Contributing Factor**: Code duplication between solve.config.lib.mjs and telegram-bot.mjs

## Next Steps

1. ✅ Document the issue (this timeline)
2. ⏳ Apply same stderr suppression technique to telegram-bot.mjs
3. ⏳ Consider extracting shared yargs parsing logic
4. ⏳ Add tests to prevent regression
5. ⏳ Update documentation about yargs stderr handling
