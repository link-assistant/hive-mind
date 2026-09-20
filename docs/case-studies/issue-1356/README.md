# Case Study: Issue #1356 - Auto-restart spams PR with comments when usage limit is reached

## Summary

When running `solve` with `--auto-restart-until-mergeable`, the bot posts repeated "Auto-restart triggered" comments to the PR even after the AI tool's API usage limit is reached. Each restart cycle detects the same CI failures (since the AI couldn't fix them due to the limit), posts a new comment, attempts another tool execution that immediately fails, and loops — flooding the PR with noise while no useful progress is made.

## Evidence Collected

### Codebase Analysis

| File                               | Lines     | Findings                                                                                    |
| ---------------------------------- | --------- | ------------------------------------------------------------------------------------------- |
| `src/solve.auto-merge.lib.mjs`     | 587-660   | Main auto-restart loop — posts comment BEFORE tool execution, does NOT check `limitReached` |
| `src/solve.restart-shared.lib.mjs` | 354-360   | `isApiError()` checks `toolResult.result` which is never set by tool executors              |
| `src/claude.lib.mjs`               | 1210-1277 | `executeClaude()` returns `limitReached: true` when usage limit detected                    |
| `src/usage-limit.lib.mjs`          | 28-71     | `isUsageLimitError()` — comprehensive pattern matching for limit errors                     |
| `src/solve.watch.lib.mjs`          | 297-298   | Watch mode tracks `toolResult.limitReached` in log uploads but doesn't exit                 |

### Related Issues and PRs

| Reference   | Description                                                            |
| ----------- | ---------------------------------------------------------------------- |
| Issue #1323 | Fixed duplicate "Ready to merge" comments and iteration counter        |
| Issue #1314 | Comprehensive CI/CD status handling (billing limits, cancelled checks) |
| Issue #1290 | False usage limit detection prevention                                 |
| PR #1328    | Fix incorrect iteration counter and duplicate comments                 |
| PR #1291    | Fix false usage limit detection and upload failure logs                |

### Online Research

Claude Code operates under a dual-layer usage framework:

- **5-hour rolling window** controlling burst activity
- **7-day weekly ceiling** capping total active compute hours

When limits are reached, Claude Code returns error messages like "hit your usage limit", "session limit reached", or "resets 5am". These are already detectable via `isUsageLimitError()` in `usage-limit.lib.mjs`.

Sources:

- [Claude API Rate Limits Documentation](https://platform.claude.com/docs/en/api/rate-limits)
- [Claude Code Limits Guide](https://www.truefoundry.com/blog/claude-code-limits-explained)
- [Claude Code Issue #27336 — Rate limit errors](https://github.com/anthropics/claude-code/issues/27336)

## Timeline / Sequence of Events (Reconstructed)

This is the sequence of events during a typical occurrence of this bug:

1. **User starts solve** with `--auto-restart-until-mergeable --model=opus --think=high`
2. **Initial AI session** runs, makes changes, pushes commits
3. **CI checks start** — some may fail due to code issues
4. **Auto-restart loop** detects CI failures → sets `shouldRestart = true`
5. **Comment posted** to PR: "🔄 Auto-restart triggered — Reason: CI failures detected"
6. **Tool execution starts** (`executeToolIteration()`)
7. **Usage limit reached** — Claude returns error message containing "hit your usage limit"
8. **`executeClaude()` returns** `{ success: false, limitReached: true, limitResetTime: "5:00 AM" }`
9. **`watchUntilMergeable()` checks** `!toolResult.success` → enters failure handling
10. **`isApiError(toolResult)` returns `false`** because `toolResult.result` is `undefined`
11. **Generic failure path**: resets error counters, logs "Will retry in next check"
12. **Wait interval** (60 seconds by default)
13. **Next iteration**: CI still fails (nothing was fixed) → `shouldRestart = true` again
14. **Another comment posted**: "🔄 Auto-restart triggered" (spam!)
15. **Tool execution fails immediately** (limit still active)
16. **Loop repeats** steps 9-15 indefinitely until limit resets or user intervenes

## Root Cause Analysis

### Root Cause 1: No usage limit check after tool execution

**Location**: `src/solve.auto-merge.lib.mjs`, lines 634-655

After `executeToolIteration()` returns, the code checks for API errors via `isApiError()` but does **not** check for `toolResult.limitReached`. The `isApiError()` function also has a secondary bug: it checks `toolResult.result` which is **never populated** by any of the tool executors (`executeClaude`, `executeOpenCode`, `executeCodex`, `executeAgent`).

When a usage limit is hit:

- `toolResult.success` = `false`
- `toolResult.limitReached` = `true`
- `toolResult.limitResetTime` = `"5:00 AM"` (or similar)
- `toolResult.result` = `undefined` (not set by executors)

Since `isApiError()` always returns `false`, the code falls to the generic failure path, resets backoff counters, and continues the loop.

### Root Cause 2: Comment posted before tool execution

**Location**: `src/solve.auto-merge.lib.mjs`, lines 598-612

The "Auto-restart triggered" comment is posted to the PR **before** `executeToolIteration()` is called. This means even if the tool immediately fails due to a usage limit, the spam comment has already been posted.

### Root Cause 3: No deduplication for auto-restart comments

The `checkForExistingComment()` function is used to deduplicate "Ready to merge" comments (issue #1323), but is **not** applied to "Auto-restart triggered" comments. However, this is a secondary issue — the primary fix should prevent the loop from continuing on usage limits.

## Proposed Solutions

### Solution 1: Check `toolResult.limitReached` after tool execution (Primary Fix)

After `executeToolIteration()` returns in `watchUntilMergeable()`, add an explicit check:

```javascript
if (!toolResult.success) {
  // NEW: Check for usage limit errors FIRST (most specific)
  if (toolResult.limitReached) {
    await log(formatAligned('⏳', 'USAGE LIMIT REACHED', ''));
    await log(formatAligned('', 'Reset time:', toolResult.limitResetTime || 'Unknown', 2));

    // Post a single notification comment and exit the loop
    // ... post comment with limit info ...

    return { success: false, reason: 'usage_limit', ... };
  }

  // Existing API error check...
  if (isApiError(toolResult)) { ... }
}
```

This prevents the loop from continuing when no progress can be made.

### Solution 2: Move comment posting after successful tool start (Secondary Improvement)

Move the "Auto-restart triggered" PR comment to after the tool execution completes, or at least gate it on whether the previous iteration hit a usage limit:

```javascript
if (shouldRestart && !previousIterationHitLimit) {
  // Post comment only if we can actually make progress
  await $`gh pr comment ...`;
}
```

### Solution 3: Add deduplication for auto-restart comments (Defense in Depth)

Apply the existing `checkForExistingComment()` mechanism to prevent identical consecutive "Auto-restart triggered" comments:

```javascript
const restartSignature = '## 🔄 Auto-restart triggered';
const hasExisting = await checkForExistingComment(owner, repo, prNumber, restartSignature, verbose);
if (!hasExisting) {
  await $`gh pr comment ...`;
}
```

## Impact Assessment

| Area              | Severity | User Impact                                                              |
| ----------------- | -------- | ------------------------------------------------------------------------ |
| PR comment spam   | **High** | PRs become noisy, hard to follow; triggers excessive email notifications |
| Wasted API calls  | Medium   | Unnecessary GitHub API calls for comment posting and CI checks           |
| Misleading status | Medium   | Comments suggest work is being done when it's not                        |
| Resource waste    | Low      | CPU/network spent on failed tool executions                              |

## Files Modified

1. `src/solve.auto-merge.lib.mjs` — Add usage limit detection, comment deduplication, and exit on limit
2. `src/solve.restart-shared.lib.mjs` — Add `isUsageLimitReached()` helper alongside `isApiError()`
3. `tests/test-auto-restart-usage-limit-1356.mjs` — Unit tests for the new behavior

## Related External Issues

- Claude Code API rate limits: [Claude API Rate Limits](https://platform.claude.com/docs/en/api/rate-limits)
- Claude Code CLI rate limit bug: [anthropics/claude-code#27336](https://github.com/anthropics/claude-code/issues/27336)
