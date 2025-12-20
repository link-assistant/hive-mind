# Case Study: Issue #678 - PR Creation Failures Investigation

## Overview

This case study documents the investigation and resolution of PR creation failures in the hive-mind solve command. The investigation revealed two distinct root causes affecting different usage modes.

## Documents in This Case Study

### Analysis Documents

1. **[ROOT-CAUSE-ANALYSIS.md](./ROOT-CAUSE-ANALYSIS.md)** - Initial analysis identifying two distinct problems
2. **[DEEP-ANALYSIS-REAL-ROOT-CAUSE.md](./DEEP-ANALYSIS-REAL-ROOT-CAUSE.md)** - Deep dive into why GitHub rejects PRs with "no commits between branches"
3. **[FORK-MODE-FIX-ANALYSIS.md](./FORK-MODE-FIX-ANALYSIS.md)** - Detailed analysis of fork mode Compare API issue

### Evidence

4. **[log1.txt](./log1.txt)** - First failure log (v0.29.5, non-fork mode, first attempt)
5. **[log2.txt](./log2.txt)** - Second failure log (v0.29.5, non-fork mode, rerun with --auto-continue)
6. **[log3.txt](./log3.txt)** - Third failure log (v0.29.7, fork mode with Compare API 404 errors)

### Solution

7. **[PR_DESCRIPTION.md](./PR_DESCRIPTION.md)** - Original PR description documenting the fixes

## Problem Summary

### Problem 1: Identical Content When Reusing Branches (v0.29.5)

**Symptom**: PR creation fails with "No commits between branches" error when using `--auto-continue` to reuse existing branches.

**Root Cause**: When reusing a branch, the code appends task information to CLAUDE.md. If the task info is identical to what's already there, the file content doesn't actually change. Git creates a commit (with a new SHA) but the tree (content) remains identical. GitHub's PR creation checks tree differences, not commit differences, so it rejects the PR.

**Evidence**:
- [log1.txt](./log1.txt) - First run creates commit 8ee8459
- [log2.txt](./log2.txt) - Second run creates commit 9d8c4fc, but push shows "No commits between branches"

**Solution (v0.29.8)**: Add timestamp to CLAUDE.md content when appending to ensure uniqueness.

```javascript
// Add timestamp to ensure uniqueness when appending
finalContent = `${trimmedExisting}\n\n---\n\n${taskInfo}\n\nRun timestamp: ${timestamp}`;
```

### Problem 2: Fork Mode Compare API 404 Errors (v0.29.7 Regression)

**Symptom**: In fork mode, after successfully pushing to the fork, the Compare API check fails with 404 errors for 5 consecutive attempts over 30+ seconds.

**Root Cause**: The Compare API check (added in v0.29.7 to handle GitHub sync delays) was calling the API with the wrong head reference format for fork mode:

- ❌ Used: `repos/xlabtg/anti-corruption/compare/main...issue-6-01d3f376c347`
- Problem: Branch `issue-6-01d3f376c347` only exists in `konard/anti-corruption` (fork), not in `xlabtg/anti-corruption` (upstream)
- ✅ Should use: `repos/xlabtg/anti-corruption/compare/main...konard:issue-6-01d3f376c347`

**Evidence**:
- [log3.txt](./log3.txt) - Shows v0.29.7 failing with 404 errors in fork mode

**Solution (v0.29.9)**: Construct correct head reference based on mode.

```javascript
let headRef;
if (argv.fork && forkedRepo) {
  const forkUser = forkedRepo.split('/')[0];
  headRef = `${forkUser}:${branchName}`;  // Fork mode: "konard:branch"
} else {
  headRef = branchName;  // Non-fork mode: "branch"
}
```

## Timeline of Fixes

- **v0.29.5**: Original version, basic PR creation
- **v0.29.7**: Added Compare API check with exponential backoff (introduced fork mode regression)
- **v0.29.8**: Added timestamp to CLAUDE.md to fix identical content issue
- **v0.29.9**: Fixed fork mode Compare API head reference format

## Key Insights

### 1. GitHub Checks Trees, Not Commits

When creating a PR, GitHub doesn't just check if different commits exist on the branch. It checks if the **content** (git tree) differs from the base branch. This is why creating a new commit with identical content fails.

### 2. GitHub API Format Differences

The Compare API has different formats for same-repo and cross-repo (fork) comparisons:
- Same repo: `repos/owner/repo/compare/base...head`
- Fork: `repos/upstream-owner/upstream-repo/compare/base...fork-owner:head`

This format must match what `gh pr create` uses internally.

### 3. CLAUDE.md Persistence Issue

CLAUDE.md is intended to be temporary (created at session start, removed at end). However, when a session fails before cleanup, CLAUDE.md persists in the branch. When `--auto-continue` reuses that branch, appending the same content causes the "no commits" issue.

### 4. Why Logs Show Old Versions Failing

The user provided logs show:
- v0.29.5 failures: Timestamp fix not yet implemented
- v0.29.7 failures: Fork mode fix not yet implemented

The current code (v0.29.9) includes both fixes and should work correctly.

## Testing Recommendations

### Test Case 1: Non-fork Mode with Branch Reuse

```bash
# First run - create branch and intentionally fail PR creation
solve https://github.com/user/repo/issues/1 --auto-fork --auto-continue

# Interrupt or let fail

# Second run - should create PR successfully despite reusing branch
solve https://github.com/user/repo/issues/1 --auto-fork --auto-continue
```

**Expected**: PR creation succeeds. CLAUDE.md has timestamp making content unique.

### Test Case 2: Fork Mode PR Creation

```bash
# Run in fork mode (no write access to upstream)
solve https://github.com/upstream/repo/issues/1 --auto-fork --auto-continue
```

**Expected**:
- Push to fork succeeds
- Compare API uses `fork-user:branch` format
- Compare API check succeeds
- PR creation succeeds

## Related Code

- `src/solve.auto-pr.lib.mjs` - Contains both fixes
- Line ~145: Timestamp addition for CLAUDE.md
- Line ~500: Fork mode head reference construction

## Conclusion

Both issues have been resolved in v0.29.9:

1. ✅ Identical content issue fixed with timestamp (v0.29.8)
2. ✅ Fork mode Compare API fixed with correct head reference (v0.29.9)

The solution is complete and ready for testing. Users experiencing these issues should upgrade to v0.29.9.

## Links

- **Issue**: https://github.com/link-assistant/hive-mind/issues/678
- **Pull Request**: https://github.com/link-assistant/hive-mind/pull/680
- **Test Script**: [../../experiments/test-fork-compare-api-fix.mjs](../../experiments/test-fork-compare-api-fix.mjs)
