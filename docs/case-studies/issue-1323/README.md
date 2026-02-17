# Case Study: Issue #1323 - Incorrect --auto-restart-until-mergeable iteration counter and duplicate comments

## Summary

This case study documents the investigation into two related bugs in the `--auto-restart-until-mergeable` feature:

1. **Incorrect iteration counter**: The iteration number shown in comments (e.g., "iteration 25") doesn't reflect the actual count of AI tool restarts
2. **Duplicate "Ready to merge" comments**: Multiple identical status comments are posted to the same PR

## Evidence Collected

The following logs were downloaded and analyzed:

| File                         | Source   | Description                                   |
| ---------------------------- | -------- | --------------------------------------------- |
| `logs/pr1316-initial.txt`    | PR #1316 | Initial solution draft                        |
| `logs/pr1316-iteration2.txt` | PR #1316 | Shows "iteration 2" but was the first restart |
| `logs/pr195-iteration25.txt` | PR #195  | Shows "iteration 25" from check cycle counter |
| `logs/pr195-iteration1.txt`  | PR #195  | Concurrent process showing "iteration 1"      |

## Timeline of Events (PR #195)

### Process 1 (started at 12:29:20.959Z)

1. **12:29:20** - `solve.mjs` started with issue #194
2. **12:29:40** - PR #195 created
3. **12:35:13** - Claude execution completed
4. **12:35:14** - Auto-restart-until-mergeable mode began
5. **12:35:14 - 13:00:42** - Check cycles #1-#25 waiting for CI
6. **13:00:43** - Check #25: CI failure detected, restart triggered
7. **13:07:51** - Claude completed, all CI passing
8. **~13:09:04** - "Ready to merge" comment posted (timestamp from GitHub API)

### Process 2 (started at 12:50:48.072Z)

1. **12:50:48** - User manually started second `solve.mjs` with PR #195 URL
2. **12:51:00** - Converted PR back to draft, started AI work session
3. **13:08:08** - Claude completed, all CI passing
4. **~13:09:21** - "Ready to merge" comment posted (timestamp from GitHub API)

## Root Cause Analysis

### Issue 1: Incorrect Iteration Counter

**Location**: `src/solve.auto-merge.lib.mjs`, line 604

```javascript
const customTitle = `🔄 Auto-restart-until-mergeable Log (iteration ${iteration})`;
```

**Problem**: The `iteration` variable is the **check cycle counter**, not the **restart counter**.

- Check cycles: How many times the loop has checked for blockers (line 281: `iteration++`)
- Restarts: How many times the AI tool was actually executed

In the example logs:

- "iteration 25" meant 25 check cycles, but only **1 actual AI restart** occurred
- Most check cycles just waited for CI without triggering restarts

**Expected behavior**: The iteration number should count actual AI tool executions, not check cycles.

### Issue 2: Duplicate "Ready to merge" Comments

**Location**: `src/solve.auto-merge.lib.mjs`, lines 348-353

```javascript
// Post success comment
try {
  const commentBody = `## ✅ Ready to merge\n\n...`;
  await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${commentBody}`;
} catch {
  // Don't fail if comment posting fails
}
```

**Problem**: There are two sources of duplicate comments:

1. **Parallel processes**: When two `solve.mjs` processes run on the same PR simultaneously, both can reach the "PR is mergeable" state and post comments independently. This is a user workflow issue (running multiple processes), but we should prevent duplicate comments.

2. **No deduplication check**: Before posting a "Ready to merge" comment, the code doesn't check if one was already posted.

## Proposed Solutions

### Fix 1: Add Restart Counter for Iteration Display

Add a separate `restartCount` variable to track actual AI tool executions:

```javascript
let iteration = 0;
let restartCount = 0; // NEW: track actual restarts
let lastCheckTime = new Date();

while (true) {
  iteration++; // Check cycle counter
  // ... existing check logic ...

  if (shouldRestart) {
    restartCount++; // INCREMENT on actual restart
    // ...

    // Use restartCount for log titles
    const customTitle = `🔄 Auto-restart-until-mergeable Log (iteration ${restartCount})`;
  }
}
```

### Fix 2: Prevent Duplicate Status Comments

Before posting any status comment, check if a recent identical comment already exists:

```javascript
const checkForExistingComment = async (owner, repo, prNumber, commentPattern) => {
  try {
    const result = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --jq 'map(select(.body | contains("${commentPattern}"))) | length'`;
    if (result.code === 0) {
      const count = parseInt(result.stdout.toString().trim(), 10);
      return count > 0;
    }
  } catch {
    // If check fails, allow posting to avoid silent failures
  }
  return false;
};

// Before posting "Ready to merge":
const hasExistingReadyComment = await checkForExistingComment(owner, repo, prNumber, '✅ Ready to merge');
if (!hasExistingReadyComment) {
  await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${commentBody}`;
}
```

### Fix 3: Add Process Lock for PR Operations (Optional Enhancement)

To prevent parallel process conflicts, implement a lock mechanism using PR labels or comments:

```javascript
// At start of auto-restart mode
const lockLabel = `hive-mind-lock-${process.pid}`;
await $`gh pr edit ${prNumber} --add-label ${lockLabel}`;

// Check for other locks
const existingLocks = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/labels --jq 'map(select(.name | startswith("hive-mind-lock-"))) | length'`;
if (parseInt(existingLocks.stdout.toString().trim(), 10) > 1) {
  console.log('Another process is already working on this PR');
  await $`gh pr edit ${prNumber} --remove-label ${lockLabel}`;
  process.exit(0);
}
```

## Impact Assessment

| Area               | Severity | User Impact                                               |
| ------------------ | -------- | --------------------------------------------------------- |
| Iteration counter  | Low      | Confusing logs, but no functional impact                  |
| Duplicate comments | Medium   | Clutters PR, can cause confusion about status             |
| Parallel processes | Low      | User-initiated behavior, but should be handled gracefully |

## Files to Modify

1. `src/solve.auto-merge.lib.mjs` - Main auto-restart logic
   - Add `restartCount` variable
   - Add deduplication check before posting comments
   - Update log titles to use `restartCount`

2. `src/solve.watch.lib.mjs` - Watch mode (already has `autoRestartCount`)
   - Verify consistency with auto-merge module

## Testing Recommendations

1. Unit test for restart counter: Simulate multiple check cycles with only some triggering restarts
2. Integration test for duplicate detection: Verify comments aren't duplicated
3. Manual test: Run two processes on same PR, verify graceful handling

## Related Issues/PRs

- Issue #1323: Original bug report
- PR #1316: Example showing "iteration 2" when it was first restart
- PR #195 (agent repo): Example showing "iteration 25" for 25 check cycles

## Appendix: Comment Comparison

### PR #1316 Comments

- `#issuecomment-3909826207`: Shows "iteration 2" (was actually first restart)

### PR #195 (agent) Comments

- `#issuecomment-3914617295`: Shows "iteration 25" (25 check cycles, 1 actual restart)
- `#issuecomment-3914618507`: Shows "iteration 1" (from second parallel process)
- `#issuecomment-3914621859`: First "Ready to merge" at 13:09:04
- `#issuecomment-3914623202`: Duplicate "Ready to merge" at 13:09:21 (17 seconds later)
