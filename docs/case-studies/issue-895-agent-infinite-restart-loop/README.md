# Case Study: `--tool agent` Infinite Restart Loop Due to PR Description Edit Detection (Issue #895)

**Date**: 2025-12-09
**Issue**: [#895](https://github.com/link-assistant/hive-mind/issues/895)
**Related PR**: [#893](https://github.com/link-assistant/hive-mind/pull/893) (the PR that was stuck in the loop)
**Status**: Analysis Complete - Root Cause Identified

---

## Executive Summary

When using `solve` with `--tool agent` flag, the tool entered an infinite restart loop. The agent would complete its work successfully and update the PR description, but the feedback detection mechanism would then detect the PR description as "edited after last commit", triggering a restart. This creates a self-perpetuating cycle: agent completes work -> updates PR description -> feedback detected -> restart -> agent sees all work is done -> updates PR description again -> loop continues.

---

## Problem Statement

### Symptom
The solve command with `--tool agent` flag got stuck in an infinite restart loop:
- Agent execution completed successfully with all todos marked as "completed"
- After completion, solve tool detected "Pull request description was edited after last commit"
- This triggered a restart of the agent
- The cycle repeated indefinitely until manually interrupted (CTRL+C)

### Command Executed
```bash
/home/hive/.nvm/versions/node/v20.19.6/bin/node /home/hive/.bun/bin/solve https://github.com/link-assistant/hive-mind/issues/892 --tool agent --attach-logs --verbose --no-tool-check
```

### Expected Behavior
- Agent should complete its work
- Agent should update PR description with final summary
- Solve tool should recognize that the PR description edit was made BY the agent (not external feedback)
- Tool should exit successfully without restarting

---

## Timeline of Events

### Execution Started
| Time | Event |
|------|-------|
| 19:19:29 | solve v0.38.1 started |
| 19:19:42 | Branch `issue-892-cd9b9839e813` created |
| 19:19:50 | PR #893 created |
| 19:19:56 | Initial feedback detected: "Pull request description was edited after last commit" |
| 19:19:57 | First agent execution started |

### Infinite Loop Pattern
| Time | Event |
|------|-------|
| 19:25:52 | Agent completed work, 0 new comments |
| **19:25:54** | **FEEDBACK DETECTED: "Pull request description was edited after last commit"** |
| 19:25:54 | Restart #1 triggered |
| 19:30:07 | Agent completed work, 0 new comments |
| **19:30:10** | **FEEDBACK DETECTED: "Pull request description was edited after last commit"** |
| 19:30:10 | Restart #2 triggered |
| 19:37:22 | Agent completed work, 0 new comments |
| **19:37:25** | **FEEDBACK DETECTED: "Pull request description was edited after last commit"** |
| 19:37:25 | Restart #3 triggered |
| 19:42:20 | Agent completed work, 0 new comments |
| **19:42:23** | **FEEDBACK DETECTED: "Pull request description was edited after last commit"** |
| 19:42:23 | Restart #4 triggered |
| 19:44:02 | Agent completed work, 0 new comments |
| **19:44:04** | **FEEDBACK DETECTED: "Pull request description was edited after last commit"** |
| 19:44:04 | Restart #5 triggered |
| 19:47:48 | Agent completed work, 0 new comments |
| **19:47:50** | **FEEDBACK DETECTED: "Pull request description was edited after last commit"** |
| 19:47:50 | Restart #6 triggered |
| **19:47:51** | **User interrupted with CTRL+C** |

**Total Duration**: ~28 minutes
**Restart Count**: 6 restarts before manual interruption
**Total Agent Executions**: 7 (including the initial run)

---

## Root Cause Analysis

### Root Cause: Self-Triggering Feedback Detection

**Location**: `src/solve.feedback.lib.mjs`, lines 221-231

**The Problematic Code**:
```javascript
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

**What Happens**:
1. Agent completes its work successfully
2. Agent may update the PR description (via `gh pr edit`) as part of finalizing its work
3. This updates the PR's `updated_at` timestamp via the GitHub API
4. After agent execution, solve checks for feedback
5. The PR's `updated_at` is now AFTER `lastCommitTime`
6. This triggers "Pull request description was edited after last commit"
7. Solve restarts the agent to "handle the feedback"
8. Agent sees all work is complete, may update PR again or just acknowledge
9. PR's `updated_at` is still after `lastCommitTime` (no new commits were made)
10. Loop continues indefinitely

### Why This Is a Bug

The PR description edit detection is designed to detect **external human feedback** - when a user edits the PR description to add requirements or clarifications. However, it cannot distinguish between:

1. **External edits**: A human edited the PR description (should trigger restart)
2. **Self-edits**: The agent itself updated the PR description (should NOT trigger restart)

Since the agent typically updates the PR description as part of its workflow (adding solution summaries, marking work complete, etc.), this creates a self-perpetuating loop.

---

## Technical Analysis

### Data Flow
```
Agent Execution
    |
    +-> Agent updates PR description
    |       |
    |       +-> GitHub API updates PR's `updated_at` timestamp
    |
    +-> Agent exits successfully
    |
    v
Feedback Detection (solve.feedback.lib.mjs)
    |
    +-> Fetches PR details via GitHub API
    |
    +-> Compares PR's `updated_at` with `lastCommitTime`
    |
    +-> PR was updated after last commit!
    |       |
    |       +-> Sets `feedbackDetected = true`
    |       +-> Adds "Pull request description was edited after last commit" to feedbackLines
    |
    v
Restart Decision
    |
    +-> feedbackDetected is true
    |
    +-> Triggers restart with same parameters
    |
    v
[Loop continues]
```

### Key Observation from Log

Looking at the log, we can see the pattern clearly:
- At each restart, there are **0 new PR comments** and **0 new issue comments**
- The ONLY feedback source is "Pull request description was edited after last commit"
- The agent successfully completes all its todos before each restart

This confirms that the loop is NOT caused by actual feedback, but by the agent's own activity modifying the PR's `updated_at` timestamp.

---

## Proposed Solutions

### Solution 1: Track Agent's PR Edits (Recommended)

Before the agent execution, record the PR's `updated_at` timestamp. After agent execution, compare to see if the agent itself made the edit.

```javascript
// Before agent execution
const prBeforeAgent = await getPrDetails(owner, repo, prNumber);
const prUpdatedAtBefore = new Date(prBeforeAgent.updated_at);

// ... agent execution ...

// In feedback detection
if (prUpdatedAt > lastCommitTime) {
  // Check if this was the agent's own edit
  if (prUpdatedAt > prUpdatedAtBefore) {
    // The agent likely updated this - don't treat as external feedback
    if (argv.verbose) {
      await log('Note: PR description was updated during agent execution (likely by agent itself)', { verbose: true });
    }
    // Don't set feedbackDetected for this
  } else {
    // This was an external edit before agent ran
    feedbackLines.push('Pull request description was edited after last commit');
    feedbackDetected = true;
    feedbackSources.push('PR description edited');
  }
}
```

**Pros**:
- Accurately distinguishes between self-edits and external edits
- No false positives

**Cons**:
- Requires tracking state across agent execution

### Solution 2: Use Commit Time as Anchor, Not PR Updated Time

Instead of checking `updated_at > lastCommitTime`, check for actual content changes or use a different detection mechanism:

```javascript
// Option A: Check if body content actually changed
const currentBody = prDetails.body || '';
const previousBody = await getLastKnownPrBody(prNumber); // Need to track this
if (currentBody !== previousBody && prUpdatedAt > lastCommitTime) {
  feedbackLines.push('Pull request description was edited after last commit');
  feedbackDetected = true;
}

// Option B: Only detect edits made by OTHER users
const prUpdatedBy = prDetails.user?.login; // This may not reflect editor
if (prUpdatedAt > lastCommitTime && prUpdatedBy !== currentUser) {
  feedbackLines.push('Pull request description was edited after last commit');
  feedbackDetected = true;
}
```

**Pros**:
- More accurate detection of actual feedback

**Cons**:
- GitHub API doesn't provide "last edited by" information easily
- Requires storing previous state

### Solution 3: Add Work-Start Timestamp Filter (Simplest)

Similar to how comments are filtered out if made after work started, apply the same logic to PR description edits:

```javascript
// In feedback detection
if (prUpdatedAt > lastCommitTime) {
  // If we have a work start time, filter out edits made during this session
  if (workStartTime && prUpdatedAt > new Date(workStartTime)) {
    if (argv.verbose) {
      await log('Note: PR description update during current work session - ignoring', { verbose: true });
    }
  } else {
    feedbackLines.push('Pull request description was edited after last commit');
    feedbackDetected = true;
    feedbackSources.push('PR description edited');
  }
}
```

**Pros**:
- Simple implementation
- Uses existing `workStartTime` parameter
- Consistent with comment filtering logic

**Cons**:
- May miss legitimate external edits made during long-running agent sessions (edge case)

### Solution 4: Add Max Restart Limit

As a safety measure regardless of detection improvements:

```javascript
const MAX_RESTARTS_ON_PR_EDIT = 1; // Only restart once for PR edits
let prEditRestarts = 0;

// In restart logic
if (feedbackSources.includes('PR description edited')) {
  prEditRestarts++;
  if (prEditRestarts >= MAX_RESTARTS_ON_PR_EDIT) {
    await log('Note: Reached max restarts for PR description edits. Stopping.');
    break;
  }
}
```

**Pros**:
- Prevents infinite loops as a safety net
- Simple to implement

**Cons**:
- May limit legitimate restart scenarios
- Doesn't fix the root cause

---

## Recommended Solution

**Implement Solution 3 (Work-Start Timestamp Filter) as the primary fix**, combined with **Solution 4 (Max Restart Limit) as a safety net**.

Rationale:
1. Solution 3 is consistent with existing logic for filtering comments
2. It's simple to implement and understand
3. Solution 4 provides a safety net for any edge cases

The combination addresses the immediate issue while providing protection against similar problems.

---

## Comparison with Issue #882

| Aspect | Issue #882 | Issue #895 |
|--------|-----------|-----------|
| **Symptom** | Infinite loop | Infinite restart loop |
| **Root Cause** | Model mismatch (Claude CLI receiving agent model) | PR description edit detection triggering false feedback |
| **API Errors** | Yes (404 model not found) | No (all operations successful) |
| **Trigger** | Watch mode tool dispatch bug | Feedback detection mechanism |
| **Loop Type** | Retry loop (errors) | Restart loop (false positive feedback) |
| **Agent Status** | Failed to execute properly | Executed successfully each time |

**Key Difference**: Issue #882 was about errors causing retries. Issue #895 is about **successful** execution causing restarts due to false feedback detection.

---

## Affected Files

| File | Description |
|------|-------------|
| `src/solve.feedback.lib.mjs` | Lines 221-231: PR description edit detection logic |
| `src/solve.watch.lib.mjs` | Restart logic based on feedback detection |

---

## Log Files

- `original-solve-log.txt` - Complete solve session log (26,512 lines) showing the infinite restart loop

---

## Implementation Status

- [x] Solution 3: Add work-start timestamp filter for PR description edits
- [ ] Solution 4: Add max restart limit for PR description edit triggers (future improvement)
- [x] Tests for the new behavior
- [x] Documentation update

---

## Implementation Details

### Fix Applied in `src/solve.feedback.lib.mjs`

The fix adds a check to see if the PR/issue description edit occurred during the current work session. If so, it's considered the agent's own edit and is not treated as external feedback.

**Code Change (lines 220-270)**:
```javascript
// 2. Check for edited descriptions
// Issue #895: Filter out edits made during current work session to prevent
// infinite restart loops. When the agent updates the PR description as part of
// its work, this should not trigger a restart. Only external edits (before work
// started) should be considered feedback.
try {
  // Check PR description edit time
  const prDetailsResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}`;
  if (prDetailsResult.code === 0) {
    const prDetails = JSON.parse(prDetailsResult.stdout.toString());
    const prUpdatedAt = new Date(prDetails.updated_at);
    if (prUpdatedAt > lastCommitTime) {
      // Issue #895: Check if the edit happened during current work session
      // If the PR was updated after work started, it's likely the agent's own edit
      if (workStartTime && prUpdatedAt > new Date(workStartTime)) {
        if (argv.verbose) {
          await log('   Note: PR description updated during current work session (likely by agent itself) - ignoring', { verbose: true });
        }
        // Don't treat this as external feedback
      } else {
        // The PR was updated after last commit but before work started - external feedback
        feedbackLines.push('Pull request description was edited after last commit');
        feedbackDetected = true;
        feedbackSources.push('PR description edited');
      }
    }
  }
  // ... similar logic for issue description edits
}
```

### Test File: `experiments/test-issue-895-feedback-filter.mjs`

A comprehensive test script was created to verify the fix handles all scenarios:

1. **PR edited after commit but before work started (external feedback)** - Should trigger restart
2. **PR edited after work started (agent self-edit)** - Should NOT trigger restart
3. **PR edited before commit (no feedback)** - Should NOT trigger restart
4. **No workStartTime provided (legacy behavior)** - Should treat all post-commit edits as feedback
5. **Issue edited after work started (agent self-edit)** - Should NOT trigger restart

All tests pass.

---

**Generated**: 2025-12-09
**Updated**: 2025-12-09
**Author**: Claude Code (AI Issue Solver)
