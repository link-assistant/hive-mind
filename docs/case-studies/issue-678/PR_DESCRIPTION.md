# Fix PR Creation Failures in Fork Mode and Auto-Continue

## 🎯 Summary

This PR completely resolves issue #678 by addressing **both** the original issue and the fork mode regression that was discovered during investigation.

## 📋 Issue Reference

Fixes #678

## 🐛 Problems Identified

### Problem 1: Identical Content When Reusing Branches (v0.29.5)

When using `--auto-continue` mode with existing branches:
1. Checkout existing branch
2. Append task information to CLAUDE.md
3. Create commit and push
4. **PR creation fails**: "No commits between branches"

**Root Cause**: Task information appended to CLAUDE.md was deterministic (same content each run), causing GitHub to see no meaningful changes.

### Problem 2: GitHub Sync Delays (v0.29.7 attempted fix)

Added Compare API check with retry logic to handle GitHub's backend sync delays. This fixed non-fork mode but **broke fork mode**.

### Problem 3: Fork Mode 404 Errors (v0.29.7 regression)

In fork mode, Compare API check failed with 404 errors:
```
Compare API error: {"message":"Not Found","status":"404"}
```

**Root Cause**: Compare API was called with incorrect head reference:
- Used: `repos/upstream/repo/compare/main...branch-name`
- Problem: Branch only exists in fork, not upstream
- Result: GitHub returns 404 error

## ✅ Solutions Implemented

### Solution 1: Add Timestamp to CLAUDE.md (v0.29.8 - commit ecfd412)

```javascript
const timestamp = new Date().toISOString();
finalContent = `${trimmedExisting}\n\n---\n\n${taskInfo}\n\nRun timestamp: ${timestamp}`;
```

This ensures each run creates genuinely unique content, even when appending to existing files.

### Solution 2: Fix Fork Mode Compare API (v0.29.9 - this PR)

```javascript
// Construct correct head reference based on mode
let headRef;
if (argv.fork && forkedRepo) {
  const forkUser = forkedRepo.split('/')[0];
  headRef = `${forkUser}:${branchName}`;  // e.g., "konard:issue-678-abc"
} else {
  headRef = branchName;  // e.g., "issue-678-abc"
}
const compareResult = await $({ silent: true })`gh api repos/${owner}/${repo}/compare/${targetBranchForCompare}...${headRef} --jq '.ahead_by' 2>&1`;
```

This matches the format used in `gh pr create` and correctly references branches in forks.

## 📚 Technical Details

### Compare API Format

**Non-fork mode:**
```
repos/owner/repo/compare/main...feature-branch
```
Branch exists in same repository ✅

**Fork mode (before fix):**
```
repos/upstream/repo/compare/main...branch-name
```
Branch doesn't exist in upstream ❌ 404 error

**Fork mode (after fix):**
```
repos/upstream/repo/compare/main...forkUser:branch-name
```
GitHub understands cross-repo format ✅ Works correctly

### Log Evidence

**Non-fork mode failure (v0.29.5):**
```
[INFO] ✅ Commit created: Successfully
[INFO] Push output: 8ee8459..9d8c4fc issue-1-b53fe3666f91 -> issue-1-b53fe3666f91
[ERROR] ❌ PR CREATION FAILED
[INFO] GraphQL: No commits between master and issue-1-b53fe3666f91
```

**Fork mode failure (v0.29.7):**
```
[INFO] 🍴 Fork mode: ENABLED
[INFO] * [new branch] issue-6-01d3f376c347 -> issue-6-01d3f376c347
[INFO] Compare API error (attempt 1/5): {"message":"Not Found","status":"404"}
[ERROR] ❌ GITHUB SYNC TIMEOUT: Compare API not ready after retries
```

## 🧪 Testing

### Created Test Scripts

1. **`experiments/test-fork-compare-api-fix.mjs`** - Validates head reference construction
   - ✅ Non-fork mode: Uses simple branch name
   - ✅ Fork mode: Uses `forkUser:branch` format
   - ✅ Matches gh pr create format

2. **`experiments/FORK-MODE-FIX-ANALYSIS.md`** - Comprehensive analysis document

All tests pass successfully.

## 🔍 Impact Analysis

### What This Fixes

✅ **PR creation in non-fork mode** with `--auto-continue`
✅ **PR creation in fork mode** with `--auto-fork`
✅ **Branch reuse** when retrying failed PR attempts
✅ **GitHub sync delay handling** for all modes
✅ **Consistency** between Compare API and PR creation

### What Remains Unchanged

✅ **First-time branch creation** - Works as before
✅ **Normal PR workflows** - No behavioral changes
✅ **Error messages** - Still helpful and clear
✅ **Performance** - Same retry timing

### No Side Effects

✅ CLAUDE.md is temporary (removed after session)
✅ Timestamp doesn't affect repository cleanliness
✅ Fork mode logic isolated from non-fork mode
✅ Backward compatible with all existing workflows

## 📊 Version Timeline

- **v0.29.5**: Original version, basic PR creation
- **v0.29.7** (commit 37a3857): Added Compare API check, broke fork mode
- **v0.29.8** (commit ecfd412): Added timestamp fix for identical content
- **v0.29.9** (this PR): Fixed fork mode Compare API

## ✨ Result

Users can now reliably use all solve command modes:
- ✅ Direct repository access
- ✅ Fork mode with `--auto-fork`
- ✅ Branch reuse with `--auto-continue`
- ✅ Combined fork + auto-continue workflows

The solve command now handles:
- GitHub's backend sync delays (exponential backoff retry)
- Content uniqueness when reusing branches (timestamp)
- Correct API references for fork mode (forkUser:branch format)

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
