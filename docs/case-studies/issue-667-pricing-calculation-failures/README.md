# Case Study: Pricing Calculation Failures at PR Generation

## Issue Reference
- **Issue**: [#667 - Make a detailed case study on why pricing calculation does not work at Pull Request generation of solve command](https://github.com/link-assistant/hive-mind/issues/667)
- **Pull Request**: [#668](https://github.com/link-assistant/hive-mind/pull/668)
- **Referenced PR with failures**: [konard/hh-job-application-automation#49](https://github.com/konard/hh-job-application-automation/pull/49)

## Executive Summary

The pricing calculation system in the solve command exhibits two distinct failure modes when creating PR comments with cost estimates:

1. **Missing Anthropic Cost Data** (First run): Public pricing estimate works, but Anthropic's official cost is reported as "unknown"
2. **Missing Public Pricing Data** (Auto-restart runs): Anthropic's official cost is captured, but public pricing estimate is reported as "unknown"

These failures occur due to timing issues and variable scope problems in the log upload process, particularly during auto-restart scenarios.

## Evidence from PR #49

### First Run (2025-11-04T04:53:41Z)
**PR Comment**:
```
💰 **Cost estimation:**
- Public pricing estimate: $1.615948 USD ✅
- Calculated by Anthropic: unknown ❌
- Difference: unknown
```

**Actual Log Data** (from gist):
```
[2025-11-04T04:53:32.287Z] [INFO] 💰 Anthropic official cost captured: $0.964416
[2025-11-04T04:53:32.663Z] [INFO]       Public pricing estimate: $1.615948 USD
[2025-11-04T04:53:32.665Z] [INFO]       Calculated by Anthropic: $0.964416 USD
[2025-11-04T04:53:32.665Z] [INFO]       Difference:              $-0.651532 (-40.32%)
```

### Second Run / Auto-restart 1/3 (2025-11-04T04:57:44Z)
**PR Comment**:
```
💰 **Cost estimation:**
- Public pricing estimate: unknown ❌
- Calculated by Anthropic: $0.964416 USD ✅
- Difference: unknown
```

**Actual Log Data**:
- Both calculations succeeded internally
- Terminal output showed both values correctly
- Only PR comment generation received incorrect data

## Root Cause Analysis

### 1. Code Flow for Pricing Calculation

The pricing calculation involves multiple components:

#### A. Session Token Calculation (`claude.lib.mjs:619`)
```javascript
export const calculateSessionTokens = async (sessionId, tempDir) => {
  // Reads session JSONL file
  // Fetches model pricing from models.dev
  // Calculates per-model costs
  // Returns { totalCostUSD, modelUsage, ... }
}
```

#### B. Anthropic Official Cost Capture (`claude.lib.mjs:931`)
```javascript
if (data.type === 'result') {
  if (data.total_cost_usd !== undefined && data.total_cost_usd !== null) {
    anthropicTotalCostUSD = data.total_cost_usd;
    await log(`💰 Anthropic official cost captured: $${anthropicTotalCostUSD.toFixed(6)}`);
  }
}
```

#### C. Return from executeClaudeCommand (`claude.lib.mjs:1242`)
```javascript
return {
  success: true,
  sessionId,
  limitReached,
  messageCount,
  toolUseCount,
  anthropicTotalCostUSD // Pass Anthropic's official total cost
};
```

### 2. The First Failure Mode: Missing Anthropic Cost in Initial Run

**Location**: `solve.mjs:797` → `solve.mjs:933`

**Problem**: When the main solve.mjs execution completes successfully and has uncommitted changes, it triggers auto-restart. The initial `executeClaudeCommand` call returns `anthropicTotalCostUSD`, which is extracted at line 797:

```javascript
const { success, sessionId, anthropicTotalCostUSD } = toolResult;
```

However, this variable is scoped to the main function. When the code reaches line 918 (after watch mode completes), it uploads logs with:

```javascript
const logUploadSuccess = await attachLogToGitHub({
  ...
  sessionId,  // This is from the FIRST session
  tempDir: argv.tempDir || process.cwd(),
  anthropicTotalCostUSD  // This is from the FIRST session
});
```

**Issue**: If the first session had issues capturing `anthropicTotalCostUSD` (e.g., timing issue, stream parsing problem), this `undefined` or `null` value is passed to `attachLogToGitHub`, resulting in "Calculated by Anthropic: unknown" in the PR comment.

### 3. The Second Failure Mode: Missing Public Pricing in Auto-restart

**Location**: `solve.watch.lib.mjs:360` → missing return path

**Problem**: During auto-restart, the watch mode calls `executeClaude` again and gets a NEW `toolResult`:

```javascript
toolResult = await executeClaude({
  ...
});
```

This new `toolResult` contains a fresh `anthropicTotalCostUSD` and `sessionId`. However, this data is NOT propagated back to the main `solve.mjs` context.

**The Data Flow Problem**:

1. **First session completes** → `anthropicTotalCostUSD = $0.964416` (captured)
2. **Auto-restart triggered** → Watch mode starts
3. **Watch mode runs Claude again** → NEW `anthropicTotalCostUSD` and `sessionId` created
4. **Watch mode completes** → Returns to solve.mjs
5. **Log upload happens** → Uses OLD `sessionId` from first run, not the new one

**Code Location** (`github.lib.mjs:462-481`):
```javascript
// Calculate token usage if sessionId and tempDir are provided
let totalCostUSD = null;
if (sessionId && tempDir && !errorMessage) {
  try {
    const { calculateSessionTokens } = await import('./claude.lib.mjs');
    const tokenUsage = await calculateSessionTokens(sessionId, tempDir);
    if (tokenUsage) {
      if (tokenUsage.totalCostUSD !== null && tokenUsage.totalCostUSD !== undefined) {
        totalCostUSD = tokenUsage.totalCostUSD;
      }
    }
  } catch (tokenError) {
    // Don't fail the entire upload if token calculation fails
    if (verbose) {
      await log(`  ⚠️  Could not calculate token cost: ${tokenError.message}`, { verbose: true });
    }
  }
}
```

**What Happens**:
- `sessionId` from first run is used
- `calculateSessionTokens` tries to read the FIRST session's JSONL file
- But the SECOND session (auto-restart) has created a NEW JSONL file with a different session ID
- The calculation fails or returns `null` for `totalCostUSD`
- Result: "Public pricing estimate: unknown" in PR comment

### 4. Session File Path Mismatch

The session files are stored as:
```
~/.claude/projects/<project-dir>/<session-id>.jsonl
```

Where `<project-dir>` is derived from `tempDir.replace(/\//g, '-')`.

**Example**:
- First session: `~/.claude/projects/-tmp-gh-issue-solver-1234/session-abc.jsonl`
- Auto-restart session: `~/.claude/projects/-tmp-gh-issue-solver-1234/session-xyz.jsonl`

When `attachLogToGitHub` is called with the OLD `sessionId` but trying to calculate costs for the NEW session's work, it reads the wrong file or the file doesn't contain the complete data.

## Technical Details

### Pricing Calculation Architecture

The system uses a dual-pricing approach:

1. **Public Pricing** (via models.dev API):
   - Fetches model pricing info from https://models.dev/api.json
   - Calculates cost based on token usage from session JSONL file
   - Formula: `(tokens / 1000000) * price_per_million`
   - Components: input, cache_write, cache_read, output

2. **Anthropic Official Pricing** (via Claude CLI):
   - Captured from Claude CLI JSON stream output
   - Field: `data.total_cost_usd` in result type
   - Represents Anthropic's actual billing calculation

### Cost Comparison Logic

Both values are meant to be displayed together for comparison (`github.lib.mjs:514-526`):

```javascript
if (anthropicTotalCostUSD !== null && anthropicTotalCostUSD !== undefined) {
  costInfo += `\n- Calculated by Anthropic: $${anthropicTotalCostUSD.toFixed(6)} USD`;
  if (totalCostUSD !== null) {
    const difference = anthropicTotalCostUSD - totalCostUSD;
    const percentDiff = totalCostUSD > 0 ? ((difference / totalCostUSD) * 100) : 0;
    costInfo += `\n- Difference: $${difference.toFixed(6)} (${percentDiff > 0 ? '+' : ''}${percentDiff.toFixed(2)}%)`;
  }
}
```

## Impact Analysis

### User Experience Impact
- **Confusion**: Users see "unknown" for pricing, making it hard to estimate costs
- **Trust**: Discrepancy between terminal output (showing both values) and PR comment (showing unknown) reduces confidence
- **Decision Making**: Cannot compare public pricing vs Anthropic official pricing

### Data Accuracy
- The terminal output DOES show correct values
- Only the PR comment generation has incorrect data
- Logs contain correct information but are in large gist files

### Frequency
- Occurs on EVERY auto-restart scenario
- First run may or may not have the issue depending on timing
- Likely affects a significant portion of PR-generating solve commands

## Files Analyzed

### Primary Files
- `/tmp/gh-issue-solver-1762234422910/src/solve.mjs` - Main orchestration
- `/tmp/gh-issue-solver-1762234422910/src/claude.lib.mjs` - Claude execution and pricing
- `/tmp/gh-issue-solver-1762234422910/src/github.lib.mjs` - GitHub log attachment
- `/tmp/gh-issue-solver-1762234422910/src/solve.watch.lib.mjs` - Watch/auto-restart mode

### Supporting Files
- `/tmp/gh-issue-solver-1762234422910/experiments/test-token-calculation.mjs` - Token testing
- `/tmp/gh-issue-solver-1762234422910/experiments/test-per-model-usage-calculation.mjs` - Model cost testing

### Log Files
- `pr49-run1-log.txt` - First run showing Anthropic cost captured but not passed
- `pr49-run2-log.txt` - Auto-restart showing public pricing not calculated

## Proposed Solutions

### Solution 1: Return Updated Session Data from Watch Mode (Recommended)

**Approach**: Modify `watchForFeedback` in `solve.watch.lib.mjs` to return the latest `sessionId` and `anthropicTotalCostUSD` from any auto-restart iterations.

**Changes Required**:

1. **In `solve.watch.lib.mjs`** - Modify return value:
```javascript
export const watchForFeedback = async (params) => {
  // ... existing code ...
  let latestSessionId = null;
  let latestAnthropicCost = null;

  while (true) {
    // ... existing iteration code ...

    if (shouldRestart) {
      // ... execute tool ...
      toolResult = await executeClaude(...);

      // Capture latest session data
      if (toolResult.success) {
        latestSessionId = toolResult.sessionId;
        latestAnthropicCost = toolResult.anthropicTotalCostUSD;
      }
    }
  }

  // Return latest session data
  return {
    latestSessionId,
    latestAnthropicCost
  };
};
```

2. **In `solve.mjs`** - Capture returned data:
```javascript
const watchResult = await startWatchMode({ ... });

// Update with latest session data if available
if (watchResult && watchResult.latestSessionId) {
  sessionId = watchResult.latestSessionId;
  anthropicTotalCostUSD = watchResult.latestAnthropicCost;
}

// Now upload logs with correct session data
if (temporaryWatchMode && shouldAttachLogs && prNumber) {
  await attachLogToGitHub({
    sessionId,  // Now uses latest session ID
    anthropicTotalCostUSD  // Now uses latest Anthropic cost
    ...
  });
}
```

**Pros**:
- Fixes both failure modes
- Minimal code changes
- Maintains backward compatibility
- Properly represents the final state after auto-restart

**Cons**:
- Requires changes in two files
- Need to handle multiple session cost aggregation if needed

### Solution 2: Calculate Both Costs at Upload Time

**Approach**: Always recalculate both costs from the current session data at log upload time.

**Changes Required**:

In `github.lib.mjs:attachLogToGitHub`, always call `calculateSessionTokens` regardless of parameters, and handle the anthropicTotalCostUSD from current session state.

**Pros**:
- Self-contained fix
- No variable passing needed
- Always uses fresh data

**Cons**:
- Requires session JSONL file to exist
- May calculate costs twice (once in claude.lib.mjs, once in github.lib.mjs)
- Loses Anthropic official cost if session file doesn't contain it

### Solution 3: Track All Session IDs and Aggregate Costs

**Approach**: Maintain an array of all session IDs and their costs throughout the execution, then aggregate them at upload time.

**Pros**:
- Complete historical record
- Accurate total cost across all sessions

**Cons**:
- Complex implementation
- Requires significant refactoring
- May be overkill for the problem

## Recommended Implementation Plan

### Phase 1: Immediate Fix (Solution 1)
1. Modify `solve.watch.lib.mjs` to return latest session data
2. Update `solve.mjs` to use returned session data
3. Test with auto-restart scenarios
4. Verify both pricing values appear in PR comments

### Phase 2: Validation
1. Add unit tests for pricing calculation
2. Add integration tests for auto-restart scenarios
3. Verify session file handling

### Phase 3: Enhancement
1. Add logging for which session data is being used
2. Add validation that sessionId matches what's expected
3. Consider aggregating costs if multiple sessions occur

## Testing Strategy

### Test Cases

1. **Normal PR creation (no auto-restart)**
   - Verify both pricing values are captured
   - Verify PR comment shows both values

2. **PR creation with auto-restart (single iteration)**
   - Verify latest session data is used
   - Verify PR comment shows costs from final session

3. **PR creation with multiple auto-restarts**
   - Verify each iteration's session is tracked
   - Verify final PR comment uses last session's data

4. **Error scenarios**
   - Session file missing
   - models.dev API unavailable
   - Anthropic cost not in result stream

### Validation Criteria

- ✅ Both "Public pricing estimate" and "Calculated by Anthropic" show values (not "unknown")
- ✅ Values match what's in the terminal output
- ✅ Difference calculation is accurate
- ✅ Works for both single and multi-session executions

## Related Issues

- Session management in watch mode
- Cost aggregation across multiple sessions
- Session file lifecycle and cleanup

## References

- PR with evidence: https://github.com/konard/hh-job-application-automation/pull/49
- First run log: https://gist.github.com/konard/8331451c838de261a44040aa1b84a9ae
- Auto-restart log: https://gist.github.com/konard/d9e10c55fc04277065604a4219a07702
- Models.dev API: https://models.dev/api.json
