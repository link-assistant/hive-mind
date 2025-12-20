# Technical Analysis: Codex Loop Root Causes

## Code Paths Involved

### 1. Feedback Detection Logic

**File**: `src/solve.feedback.lib.mjs`
**Lines**: 220-232

```javascript
// 2. Check for edited descriptions
try {
  // Check PR description edit time
  const prDetailsResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}`;
  if (prDetailsResult.code === 0) {
    const prDetails = JSON.parse(prDetailsResult.stdout.toString());
    const prUpdatedAt = new Date(prDetails.updated_at);
    if (prUpdatedAt > lastCommitTime) {
      feedbackLines.push('Pull request description was edited after last commit');
      feedbackDetected = true;
      feedbackSources.push('PR description edited');
    }
  }
```

**Problem**: This comparison `prUpdatedAt > lastCommitTime` is purely temporal - it doesn't verify:
- Whether the description content actually changed
- Who made the change (human vs tool)
- Whether the change is meaningful

**Why It Triggers False Positives**:
- PR `updated_at` changes for many reasons: comments, labels, reviews, etc.
- Even if the body didn't change, `updated_at` can update
- The tool itself may update PR metadata, creating a self-triggering loop

### 2. Usage Limit Detection

**File**: `src/codex.lib.mjs`
**Lines**: 321-426

```javascript
let limitResetTime = null;

// ... inside error handling ...

const limitInfo = detectUsageLimit(lastMessage);
if (limitInfo.isUsageLimit) {
  limitReached = true;
  limitResetTime = limitInfo.resetTime;

  // Format and display user-friendly message
  const messageLines = formatUsageLimitMessage({
    tool: 'Codex',
    resetTime: limitInfo.resetTime,
    sessionId,
    resumeCommand: argv.url ? `${process.argv[0]} ${process.argv[1]} ${argv.url} --resume ${sessionId}` : null
  });

  for (const line of messageLines) {
    await log(line, { level: 'warning' });
  }
}
```

**What Works**:
- ✅ Correctly detects usage limit from Codex error message
- ✅ Extracts reset time
- ✅ Logs helpful information
- ✅ Sets `limitReached = true`

**What's Missing**:
- ❌ No tracking of consecutive limit hits
- ❌ No automatic exit when limit is persistent
- ❌ No enforcement of `--auto-continue-on-limit-reset` requirement

### 3. Auto-Restart Decision

**File**: `src/solve.mjs` and `src/solve.watch.lib.mjs`
**Relevant sections**: Multiple locations

The auto-restart logic is triggered in several places:

#### A. Uncommitted Changes Check (solve.mjs ~854)
```javascript
const shouldAutoCommit = argv['auto-commit-uncommitted-changes'] || limitReached;
const autoRestartEnabled = argv['autoRestartOnUncommittedChanges'] !== false;
const shouldRestart = await checkForUncommittedChanges(tempDir, owner, repo, branchName, $, log, shouldAutoCommit, autoRestartEnabled);
```

**Analysis**: When usage limit is hit with no uncommitted changes (tool did nothing), this returns `false`.

#### B. Watch Mode Activation (solve.mjs ~866-880)
```javascript
// Start watch mode if enabled OR if we need to handle uncommitted changes
if (argv.verbose) {
  await log('');
  await log('🔍 Auto-restart debug:', { verbose: true });
  await log(`   shouldRestart (auto-detected): ${shouldRestart}`, { verbose: true });
  // ... more debug logs ...
}

// If uncommitted changes detected and auto-commit is disabled, enter temporary watch mode
const temporaryWatchMode = shouldRestart && !argv.watch;
```

**Analysis**: In our case, `shouldRestart` is false (no uncommitted changes), so watch mode isn't triggered by this path.

#### C. Watch Mode Loop (solve.watch.lib.mjs)

**File**: `src/solve.watch.lib.mjs`
**The actual restart loop**

```javascript
// Simplified version of the watch loop
while (keepWatching) {
  // Check for feedback
  const { feedbackDetected } = await detectAndCountFeedback({ /* ... */ });

  if (feedbackDetected) {
    await log('📢 FEEDBACK DETECTED!');
    // ... display feedback sources ...
    await log('🔄 Restarting: Re-running CODEX to handle feedback...');

    // RESTART THE TOOL
    toolResult = await executeCodex({ /* ... */ });

    // Check if it succeeded
    if (toolResult.limitReached) {
      // This is where we should exit, but we don't!
      limitReached = true;
    }

    // Loop continues...
  }

  // Wait and check again
  await new Promise(resolve => setTimeout(resolve, checkInterval));
}
```

**Critical Issues**:
1. **No exit condition when `limitReached` is true repeatedly**
2. **No progress validation before restart**
3. **No counter for consecutive failures**
4. **Feedback detection always returns true (due to PR updated_at)**

## The Infinite Loop Chain

Here's the exact sequence that creates the infinite loop:

```
1. Tool starts → Codex executes
2. Codex hits usage limit immediately (< 1 second)
3. Codex returns with limitReached = true, but no error thrown
4. solve.mjs checks for uncommitted changes → None (tool did nothing)
5. shouldRestart = false (correctly, since no changes)
6. BUT: watch mode is ALREADY ACTIVE from --auto-continue flag
7. Watch mode checks for feedback via detectAndCountFeedback()
8. Feedback detection checks PR updated_at > lastCommitTime
9. PR was updated by tool itself (or previous run) → TRUE
10. feedbackDetected = true → Restart triggered
11. Go to step 1 → INFINITE LOOP
```

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────┐
│ Start: solve.mjs with --auto-continue               │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│ executeCodex() → Hits usage limit                   │
│ Returns: { success: true*, limitReached: true }     │
│ * exit code 0 despite error                         │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│ checkForUncommittedChanges()                        │
│ Result: shouldRestart = false (no changes)          │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│ Watch mode loop (from --auto-continue)              │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│ detectAndCountFeedback()                            │
│ - Checks PR updated_at > lastCommitTime             │
│ - Result: feedbackDetected = TRUE                   │
│ - Reason: PR description "edited" (timestamp)       │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│ Restart Decision                                    │
│ ❌ No check: Did tool make progress?                │
│ ❌ No check: Consecutive failures?                  │
│ ❌ No check: Usage limit without --auto-cont-limit? │
│ ✅ Decision: RESTART!                               │
└────────────────┬────────────────────────────────────┘
                 │
                 └──────────┐
                            │
                            ▼
                     ┌──────────────┐
                     │ LOOP BACK    │
                     │ to start     │
                     └──────────────┘
```

## Why The Loop Accelerated

### Initial Phase (3-5 min intervals)
During the early phase, Codex sessions may have taken longer due to:
- Initial connection setup
- Longer timeout periods before returning usage limit error
- More verbose logging and checks

### Rapid Phase (7-8 sec intervals)
The loop accelerated because:
1. **Cached GitHub API responses**: Faster feedback detection
2. **Faster Codex failures**: Tool learned to fail quickly
3. **No file operations**: No disk I/O delays
4. **Optimized error path**: Error handling is faster than success path

### Measured Timings from Logs

**Rapid phase breakdown** (from log line 8033 onwards):
```
00.0s: Start Codex execution
00.5s: Codex returns usage limit error
00.5s: Session marked as complete
01.0s: Start feedback detection
02.0s: Fetch PR details from GitHub API
03.0s: Fetch comments from GitHub API
04.0s: Feedback analysis complete
04.5s: Log feedback detected message
05.0s: Start next Codex execution
```

Total cycle: ~7-8 seconds

## GitHub API Call Pattern

### Per Restart Cycle

The feedback detection makes these API calls:

1. `gh api user` - Get current user
2. `gh api repos/${owner}/${repo}/pulls/${prNumber}` - Get PR details
3. `gh api repos/${owner}/${repo}/pulls/${prNumber}/commits` - Get commits (fallback)
4. `gh api repos/${owner}/${repo}/pulls/${prNumber}/comments` - Get review comments
5. `gh api repos/${owner}/${repo}/issues/${prNumber}/comments` - Get conversation comments
6. `gh api repos/${owner}/${repo}/issues/${issueNumber}/comments` - Get issue comments
7. `gh api repos/${owner}/${repo}` - Get repo info
8. `gh api repos/${owner}/${repo}/commits` - Get default branch commits
9. `gh api repos/${owner}/${repo}/commits/.../check-runs` - Get PR checks
10. `gh api repos/${owner}/${repo}/pulls/${prNumber}/reviews` - Get reviews

**Total**: ~10 API calls per restart

**For 1,249 restarts**: ~12,490 API calls over 4.5 hours = ~46 calls per minute

**Note**: GitHub rate limit for authenticated requests is 5,000/hour, so we stayed under the limit but consumed significant quota.

## Memory and Resource Impact

### Log File Growth
- **Rate (rapid phase)**: ~466 KB/minute
- **Total size**: 140 MB in 4.5 hours
- **Line rate**: ~300 lines/minute during rapid phase

### Process Resources
From log snapshots:
```
Memory: MemFree: 881052 kB → 514300 kB (dropped ~360 MB during execution)
Load: 0.25 → 0.21 (system load actually decreased, not CPU bound)
```

**Analysis**: Not CPU or memory intensive - mostly waiting on I/O and API calls.

## Comparison: What SHOULD Have Happened

### Correct Flow with Circuit Breaker

```
1. Tool starts → Codex executes
2. Codex hits usage limit immediately
3. limitReached = true, consecutiveUsageLimits++
4. Check: consecutiveUsageLimits >= 3?
   → YES: Log error, suggest --auto-continue-limit, EXIT
   → NO: Continue
5. Check: --auto-continue-limit set?
   → YES: Wait until limit reset time, then resume
   → NO: Log message about limit, EXIT
```

### Correct Flow with Progress Validation

```
1. Watch mode checks for feedback
2. feedbackDetected = true (PR updated)
3. Check: Has tool made any progress since last check?
   - Git status shows changes?
   - New commits made?
   - Files modified?
4. If NO progress AND previous run failed:
   → Don't restart (log warning and wait longer)
5. If YES progress OR first failure:
   → Restart is OK
```

## Security and Resource Implications

### API Rate Limiting
- Used ~25% of hourly GitHub API quota
- Risk of hitting rate limits in multi-user scenarios
- No exponential backoff implemented

### Log Storage
- 140 MB for one run is excessive
- Could fill disk in multi-run scenarios
- No log rotation or size limits

### Process Management
- Process ran unattended for 4.5 hours
- No health checks or monitoring alerts
- Manual intervention required to stop

## Recommendations

See `00-OVERVIEW.md` section "Proposed Solutions" for detailed implementation recommendations.

### Priority 1 (Critical)
1. Add circuit breaker for consecutive usage limits (3-strike rule)
2. Respect `--auto-continue-limit` flag for usage limit scenarios
3. Add progress validation before auto-restart

### Priority 2 (High)
4. Improve feedback detection to avoid false positives
5. Add maximum restart limit (50-100)
6. Implement exponential backoff

### Priority 3 (Medium)
7. Add metrics and monitoring
8. Implement log size limits
9. Add health check endpoints
10. Document behavior and flags clearly
