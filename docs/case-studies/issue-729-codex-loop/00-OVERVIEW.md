# Case Study: Codex CLI Tool Infinite Loop (Issue #729)

## Executive Summary

During execution of issue #719 with the Codex CLI tool (via `--tool codex`), the system entered an infinite restart loop that ran for over 4.5 hours, producing 140 MB of logs (81,031 lines) before being manually interrupted. The loop was triggered by a combination of:

1. **Usage limit reached immediately** - Codex hit its usage limit and returned errors on every execution
2. **Feedback detection without change detection** - The system detected "feedback" (PR description edits) but didn't verify if the tool had made any progress
3. **No circuit breaker** - No mechanism existed to stop restarts when consecutive failures occurred

## Timeline

- **Start**: 2025-11-13 04:00:57 UTC
- **First usage limit hit**: 2025-11-13 04:01:49 UTC (within 1 minute of start)
- **Loop acceleration**: 2025-11-13 05:34:49 UTC (restarts every ~7 seconds)
- **Manual interruption**: 2025-11-13 08:34:55 UTC (CTRL+C)
- **Total Duration**: ~4 hours 34 minutes
- **Total Restarts**: 1,249
- **Total Usage Limit Hits**: 2,681 (ratio: 2.15 hits per restart)

## Impact Metrics

### Resource Consumption
- **Log file size**: 140 MB (100 MB part-00 + 40 MB part-01)
- **Line count**: 81,031 lines
- **Storage**: Logs stored at https://github.com/konard/hive-solve-2025-11-13T04-00-57-948Z

### Loop Characteristics
- **Early phase** (04:09 - 05:30): ~3-5 minute intervals between restarts
- **Acceleration phase** (05:34 onwards): ~7-8 second intervals between restarts
- **Restart frequency increase**: ~25x faster in final phase

## Root Causes

### Primary Cause: Immediate Usage Limit Without Circuit Breaker
The Codex tool hit its usage limit immediately on every execution:

```
[2025-11-13T04:01:49.329Z] {"type":"error","message":"You've hit your usage limit..."}
[2025-11-13T04:09:45.421Z] {"type":"error","message":"You've hit your usage limit..."}
[2025-11-13T04:14:51.914Z] {"type":"error","message":"You've hit your usage limit..."}
...2,681 times total
```

**Problem**: The system did not distinguish between:
- First-time usage limit (should wait/exit)
- Repeated consecutive usage limits (should stop immediately)

### Secondary Cause: False Positive Feedback Detection
The feedback detection system (`src/solve.feedback.lib.mjs:227-231`) triggered restarts based on:

```javascript
const prUpdatedAt = new Date(prDetails.updated_at);
if (prUpdatedAt > lastCommitTime) {
  feedbackLines.push('Pull request description was edited after last commit');
  feedbackDetected = true;
  feedbackSources.push('PR description edited');
}
```

**Pattern observed in logs**:
```
📢 FEEDBACK DETECTED!
   • New comments on the pull request: 2
   • Pull request description was edited after last commit
🔄 Restarting: Re-running CODEX to handle feedback...
```

**Problem**: This logic doesn't account for:
1. Whether the PR description was edited by the tool itself (self-triggering)
2. Whether any actual work was done since the last restart
3. Whether the tool made any changes to the repository

### Tertiary Cause: No Progress Validation
The system restarted whenever "feedback" was detected, without checking:
- Did the tool make any commits?
- Did the tool change any files?
- Is the working directory clean?
- How many consecutive failures occurred?

## Loop Acceleration Pattern

The loop showed a dramatic acceleration after 05:34 UTC:

### Early Phase (04:09 - 05:30)
- Restart interval: ~3-5 minutes
- Pattern: Tool executes, hits limit, checks for feedback, detects PR edit, restarts

### Rapid Phase (05:34 - 08:34)
- Restart interval: ~7-8 seconds
- Pattern: Same as early phase but much faster
- Possible cause: Codex returning errors faster, or cached GitHub API responses

**Example from rapid phase**:
```
[2025-11-13T05:34:49.254Z] 🔄 Restarting: Re-running CODEX...
[2025-11-13T05:34:49.945Z] {"type":"error","message":"You've hit your usage limit..."}
[2025-11-13T05:34:49.954Z] ✅ Codex command completed
[2025-11-13T05:34:49.955Z] ✅ CODEX execution completed: Checking for remaining changes...
[2025-11-13T05:34:53.375Z] 💬 New PR comments: 2
[2025-11-13T05:34:49.254Z] 📢 FEEDBACK DETECTED!
```

Total cycle time: ~7 seconds from restart to next restart detection.

## Proposed Solutions

### 1. Circuit Breaker for Consecutive Usage Limits

**Priority**: HIGH
**Implementation**: Add counter for consecutive usage limit errors

```javascript
// In solve.mjs or solve.execution.lib.mjs
let consecutiveUsageLimits = 0;
const MAX_CONSECUTIVE_USAGE_LIMITS = 3;

if (limitReached) {
  consecutiveUsageLimits++;

  if (consecutiveUsageLimits >= MAX_CONSECUTIVE_USAGE_LIMITS) {
    await log('\n❌ Usage limit reached ${consecutiveUsageLimits} times consecutively');
    await log('   Stopping to prevent infinite loop.');
    await log(`   Limit resets at: ${toolResult.limitResetTime}`);

    // Exit without restarting
    process.exit(1);
  }
} else {
  // Reset counter on successful execution
  consecutiveUsageLimits = 0;
}
```

### 2. Progress Validation Before Restart

**Priority**: HIGH
**Implementation**: Check if tool made any progress before restarting

```javascript
// In solve.watch.lib.mjs or auto-restart logic
async function hasToolMadeProgress(tempDir, branchName, $) {
  // Check if any commits were made in this execution
  const commitCountBefore = await getCommitCount(branchName, $);
  // ... (save this at start of execution)
  const commitCountAfter = await getCommitCount(branchName, $);

  // Check if working directory has changes
  const gitStatus = await $`git status --porcelain`;
  const hasChanges = gitStatus.stdout.trim().length > 0;

  return (commitCountAfter > commitCountBefore) || hasChanges;
}

// Only restart if tool made progress OR first failure
if (!hasToolMadeProgress && previouslyFailed) {
  await log('\n⚠️  No progress detected and previous execution failed');
  await log('   Not restarting to prevent infinite loop');
  return false; // Don't restart
}
```

### 3. Smarter Feedback Detection

**Priority**: MEDIUM
**Implementation**: Filter out self-generated feedback

```javascript
// In src/solve.feedback.lib.mjs
// Track PR description changes more carefully
let prDescriptionAtStart = null;

// At execution start:
const prDetailsResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}`;
if (prDetailsResult.code === 0) {
  const prDetails = JSON.parse(prDetailsResult.stdout.toString());
  prDescriptionAtStart = prDetails.body;
  prUpdatedAtStart = new Date(prDetails.updated_at);
}

// When checking for feedback:
if (prDetailsResult.code === 0) {
  const prDetails = JSON.parse(prDetailsResult.stdout.toString());
  const prUpdatedAt = new Date(prDetails.updated_at);
  const prDescriptionNow = prDetails.body;

  // Only count as feedback if:
  // 1. Updated after last commit AND
  // 2. Description actually changed (not just timestamp update)
  if (prUpdatedAt > lastCommitTime && prDescriptionNow !== prDescriptionAtStart) {
    feedbackLines.push('Pull request description was edited after last commit');
    feedbackDetected = true;
    feedbackSources.push('PR description edited');
  }
}
```

### 4. Restart Limit with Backoff

**Priority**: MEDIUM
**Implementation**: Limit total restarts with exponential backoff

```javascript
let restartCount = 0;
const MAX_RESTARTS = 50;
const BACKOFF_AFTER = 10;

if (shouldRestart) {
  restartCount++;

  if (restartCount >= MAX_RESTARTS) {
    await log(`\n❌ Maximum restart limit reached (${MAX_RESTARTS})`);
    await log('   Please check logs and investigate the issue');
    process.exit(1);
  }

  // Exponential backoff after N restarts
  if (restartCount > BACKOFF_AFTER) {
    const backoffSeconds = Math.min(300, Math.pow(2, restartCount - BACKOFF_AFTER));
    await log(`\n⏳ Backing off for ${backoffSeconds} seconds before restart #${restartCount}...`);
    await new Promise(resolve => setTimeout(resolve, backoffSeconds * 1000));
  }
}
```

### 5. Auto-Continue Limit Awareness

**Priority**: HIGH
**Implementation**: Respect `--auto-continue-on-limit-reset` flag for usage limits

The code already has partial support for this (src/solve.auto-continue.lib.mjs), but it needs to:
- Stop auto-restart when usage limit is hit without `--auto-continue-on-limit-reset`
- Use the limit reset time for smarter wait logic
- Exit cleanly instead of infinite retries

```javascript
// In auto-restart logic
if (limitReached && !argv.autoContinueOnLimitReset) {
  await log('\n⏳ Usage limit reached');
  await log('   Auto-restart disabled for usage limits unless --auto-continue-on-limit-reset is set');
  await log(`   Limit resets at: ${global.limitResetTime}`);
  process.exit(1);
}
```

## Testing Plan

### Test Case 1: Immediate Usage Limit
**Setup**: Use Codex with exhausted quota
**Expected**: Should stop after 3 consecutive usage limit errors, not loop

### Test Case 2: PR Description Edit During Run
**Setup**: Edit PR description while tool is running
**Expected**: Should restart only if tool made progress OR description content changed

### Test Case 3: Maximum Restart Limit
**Setup**: Force 50 restarts with mock conditions
**Expected**: Should exit with error after 50 restarts

### Test Case 4: Auto-Continue-On-Limit-Reset Flag
**Setup**: Run with `--auto-continue-on-limit-reset` and usage limit hit
**Expected**: Should wait until limit reset time, then resume

## Prevention Checklist

- [ ] Implement circuit breaker for consecutive usage limits
- [ ] Add progress validation before auto-restart
- [ ] Improve feedback detection to avoid self-triggering
- [ ] Add maximum restart limit (50-100)
- [ ] Implement exponential backoff for restarts
- [ ] Add metrics/logging for restart patterns
- [ ] Document behavior in CONTRIBUTING.md
- [ ] Add integration tests for restart scenarios

## Related Issues

- **Issue #719**: Original issue about usage limit handling (what was being worked on)
- **PR #722**: Pull request where the loop occurred
- **Issue #729**: This issue (documenting the loop problem)

## References

- Full logs: https://github.com/konard/hive-solve-2025-11-13T04-00-57-948Z
- Source code: `src/solve.feedback.lib.mjs`, `src/solve.watch.lib.mjs`, `src/solve.mjs`
- Related docs: `docs/codex-limitations.md`
