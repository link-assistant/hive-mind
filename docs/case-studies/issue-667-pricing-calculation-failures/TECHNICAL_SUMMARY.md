# Technical Summary: Pricing Calculation Failures

## Quick Reference

**Issue**: Pricing information shows "unknown" in PR comments despite being calculated correctly

**Affected**: PR comment generation when using `--attach-logs` flag

**Root Cause**: Session variable scope mismatch between main execution and auto-restart iterations

## The Problem in 30 Seconds

When solve command runs and triggers auto-restart (due to uncommitted changes):

1. **First session** runs → captures `sessionId=ABC`, `anthropicCost=$0.96`
2. **Auto-restart** runs → creates NEW `sessionId=XYZ`, `anthropicCost=$0.85`
3. **Log upload** uses OLD `sessionId=ABC` → can't find correct data → shows "unknown"

## Key Code Locations

### Where Anthropic Cost is Captured
**File**: `src/claude.lib.mjs:931`
```javascript
if (data.total_cost_usd !== undefined && data.total_cost_usd !== null) {
  anthropicTotalCostUSD = data.total_cost_usd;
}
```

### Where It's Returned
**File**: `src/claude.lib.mjs:1248`
```javascript
return {
  success: true,
  sessionId,
  anthropicTotalCostUSD  // ✅ Returned here
};
```

### Where It's Used in Main Flow
**File**: `src/solve.mjs:797`
```javascript
const { success, sessionId, anthropicTotalCostUSD } = toolResult;  // ✅ First session only
```

### Where It's Passed to Upload
**File**: `src/solve.mjs:933`
```javascript
await attachLogToGitHub({
  sessionId,              // ❌ OLD session ID
  anthropicTotalCostUSD   // ❌ OLD cost or undefined
});
```

### Where Auto-restart Runs
**File**: `src/solve.watch.lib.mjs:360`
```javascript
toolResult = await executeClaude({ ... });  // ✅ NEW session data created
// ❌ But NOT returned to main solve.mjs
```

### Where Public Pricing is Calculated
**File**: `github.lib.mjs:467`
```javascript
const tokenUsage = await calculateSessionTokens(sessionId, tempDir);
// ❌ Uses OLD sessionId, reads wrong file or fails
```

## The Fix (One-Line Summary)

**Return the latest session data from `watchForFeedback` and use it for log upload.**

## Detailed Fix

### Change 1: Return Data from Watch Mode

**File**: `src/solve.watch.lib.mjs`

```javascript
export const watchForFeedback = async (params) => {
  // Add at top of function
  let latestSessionId = null;
  let latestAnthropicCost = null;

  while (true) {
    // ... existing code ...

    if (shouldRestart) {
      toolResult = await executeClaude(...);

      // ADD THIS: Capture latest session data
      if (toolResult.success && toolResult.sessionId) {
        latestSessionId = toolResult.sessionId;
        latestAnthropicCost = toolResult.anthropicTotalCostUSD;
      }
    }
  }

  // ADD THIS: Return latest session data
  return {
    latestSessionId,
    latestAnthropicCost
  };
};
```

### Change 2: Use Returned Data in Main Flow

**File**: `src/solve.mjs`

**Before** (line ~871):
```javascript
await startWatchMode({
  issueUrl,
  owner,
  repo,
  issueNumber,
  prNumber,
  prBranch,
  branchName,
  tempDir,
  argv: {
    ...argv,
    watch: argv.watch || shouldRestart,
    temporaryWatch: temporaryWatchMode
  }
});
```

**After**:
```javascript
const watchResult = await startWatchMode({
  issueUrl,
  owner,
  repo,
  issueNumber,
  prNumber,
  prBranch,
  branchName,
  tempDir,
  argv: {
    ...argv,
    watch: argv.watch || shouldRestart,
    temporaryWatch: temporaryWatchMode
  }
});

// ADD THIS: Update session data with latest from watch mode
if (watchResult && watchResult.latestSessionId) {
  sessionId = watchResult.latestSessionId;
  anthropicTotalCostUSD = watchResult.latestAnthropicCost;
  await log(`   Updated session data from watch mode: ${sessionId}`, { verbose: true });
}
```

**Before** (line ~918):
```javascript
if (temporaryWatchMode) {
  // ... push changes ...

  if (shouldAttachLogs && prNumber) {
    await log('📎 Uploading working session logs to Pull Request...');
    const logUploadSuccess = await attachLogToGitHub({
      logFile: getLogFile(),
      targetType: 'pr',
      targetNumber: prNumber,
      owner,
      repo,
      $,
      log,
      sanitizeLogContent,
      verbose: argv.verbose,
      sessionId,  // ❌ OLD
      tempDir: argv.tempDir || process.cwd(),
      anthropicTotalCostUSD  // ❌ OLD
    });
  }
}
```

**After** (no change needed - already uses the updated variables from above):
```javascript
// Variables sessionId and anthropicTotalCostUSD are now updated
// from the watchResult above, so this will use correct values
```

## Why This Works

1. **Captures Latest Data**: Each auto-restart iteration updates `latestSessionId` and `latestAnthropicCost`
2. **Returns to Main Flow**: Watch mode function returns this data
3. **Updates Variables**: Main flow overwrites old session data with new
4. **Upload Uses Correct Data**: Log upload now has the right session ID and cost

## Test Verification

After applying the fix, verify:

```bash
# Run solve with auto-restart scenario
./solve.mjs "https://github.com/owner/repo/issues/123" --attach-logs

# Check PR comment shows both values:
# ✅ Public pricing estimate: $X.XXXXXX USD
# ✅ Calculated by Anthropic: $Y.YYYYYY USD
# ✅ Difference: $Z.ZZZZZZ (±XX.XX%)
```

## Code Review Checklist

- [ ] `solve.watch.lib.mjs` returns `{ latestSessionId, latestAnthropicCost }`
- [ ] `solve.mjs` captures the return value from `startWatchMode`
- [ ] `solve.mjs` updates `sessionId` and `anthropicTotalCostUSD` variables
- [ ] Log upload uses updated variables
- [ ] Tested with no auto-restart (should still work)
- [ ] Tested with single auto-restart
- [ ] Tested with multiple auto-restarts

## Alternative: Simple Validation

If the above fix is complex, at minimum add validation:

```javascript
// In github.lib.mjs:attachLogToGitHub, before calculating costs
if (sessionId && tempDir && !errorMessage) {
  // Verify session file exists
  const sessionFile = path.join(homeDir, '.claude', 'projects',
                                projectDirName, `${sessionId}.jsonl`);
  try {
    await fs.access(sessionFile);
    // File exists, proceed with calculation
  } catch {
    await log(`  ⚠️  Session file not found for ${sessionId}, skipping cost calculation`,
              { verbose: true });
    // Don't try to calculate - it will fail
    return null;
  }
}
```

This at least prevents showing "unknown" when we know we can't calculate it.
