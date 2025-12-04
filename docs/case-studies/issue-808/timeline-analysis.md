# Issue #808: Timeline and Root Cause Analysis

## Executive Summary

**Problem:** The solve tool retries 5 times on HTTP 404 errors when attempting to fork a repository, wasting time and API quota. The error message is also not user-friendly and doesn't help users understand the actual issue (likely insufficient permissions).

**Impact:**
- Wastes approximately 30 seconds on exponential backoff (2s + 4s + 8s + 16s = 30s)
- Consumes 5 GitHub API requests unnecessarily
- Provides poor user experience with cryptic error messages

## Timeline Reconstruction

Based on the log file (`original-log.txt`), here's the sequence of events:

### 1. Initial Setup (19:38:35 - 19:38:46)
- Tool started: solve v0.36.3
- Command: Attempting to solve `https://github.com/ideav/work-weave-logic/issues/3`
- Options: `--auto-fork --auto-continue --attach-logs --verbose --no-tool-check --prefix-fork-name-with-owner-name`
- Temp directory created: `/tmp/gh-issue-solver-1764704326500`

### 2. Repository Access Checks (19:38:46 - 19:38:42)
Lines 34-42:
```
[INFO] 🔍 Checking repository access for auto-fork...
[INFO]    Warning: Could not detect repository visibility, defaulting to public
[INFO] ⚠️  Auto-fork: Could not check permissions, enabling fork mode for public repository
[INFO] ✅ Repository access check: Skipped (fork mode enabled)
[INFO]    Auto-cleanup default: false (repository is public)
[INFO] 🔍 Auto-continue enabled: Checking for existing PRs for issue #3...
[INFO] 📝 No existing PRs found for issue #3 - creating new PR
[INFO] 📝 Issue mode: Working with issue #3
```

**Note:** The tool made assumptions about repository being public despite warning "Could not detect repository visibility"

### 3. Fork Detection (19:38:47 - 19:38:48)
Lines 49-51:
```
[INFO] 🔍 Detecting fork conflicts...
[INFO] ⚠️ Warning: Could not determine root repository
[INFO] 🔄 Creating fork...
```

**First API request**: Attempt to get root repository info - **likely received 404**

### 4. Fork Creation Attempts (19:38:48 - 19:39:22)

#### Attempt 1 (19:38:48 - 19:38:51) - 2s delay
Line 53-54:
```
[INFO] 🔍 Checking: If fork exists after failed creation attempt...
[INFO] ⏳ Retry: Attempt 1/5 failed, waiting 2s before retry...
[INFO]    Error: failed to fork: HTTP 404: Not Found (https://api.github.com/repos/ideav/work-weave-logic/forks)
```
**API requests**: 2 (fork creation + existence check)

#### Attempt 2 (19:38:51 - 19:38:56) - 4s delay
Line 56-57:
```
[INFO] 🔍 Checking: If fork exists after failed creation attempt...
[INFO] ⏳ Retry: Attempt 2/5 failed, waiting 4s before retry...
[INFO]    Error: failed to fork: HTTP 404: Not Found (https://api.github.com/repos/ideav/work-weave-logic/forks)
```
**API requests**: 2 (fork creation + existence check)

#### Attempt 3 (19:38:56 - 19:39:05) - 8s delay
Line 59-60:
```
[INFO] 🔍 Checking: If fork exists after failed creation attempt...
[INFO] ⏳ Retry: Attempt 3/5 failed, waiting 8s before retry...
[INFO]    Error: failed to fork: HTTP 404: Not Found (https://api.github.com/repos/ideav/work-weave-logic/forks)
```
**API requests**: 2 (fork creation + existence check)

#### Attempt 4 (19:39:05 - 19:39:21) - 16s delay
Line 62-63:
```
[INFO] 🔍 Checking: If fork exists after failed creation attempt...
[INFO] ⏳ Retry: Attempt 4/5 failed, waiting 16s before retry...
[INFO]    Error: failed to fork: HTTP 404: Not Found (https://api.github.com/repos/ideav/work-weave-logic/forks)
```
**API requests**: 2 (fork creation + existence check)

#### Attempt 5 (19:39:21 - 19:39:22) - Final attempt
Line 64-66:
```
[INFO] 🔍 Checking: If fork exists after failed creation attempt...
[INFO] ❌ Error: Failed to create fork after all retries
[INFO] failed to fork: HTTP 404: Not Found (https://api.github.com/repos/ideav/work-weave-logic/forks)
```
**API requests**: 2 (fork creation + existence check)

### 5. Final Failure (19:39:22)
Line 69-70:
```
[ERROR] ❌ Repository setup failed
[INFO] 📁 Full log file: /home/hive/solve-2025-12-02T19-38-35-038Z.log
```

## Root Cause Analysis

### Issue 1: Retrying on 404 Errors

**Location:** `src/solve.repository.lib.mjs:321-474`

The fork creation logic (lines 321-474) performs exponential backoff retries for ALL fork creation failures, including 404 errors:

```javascript
for (let attempt = 1; attempt <= maxForkRetries; attempt++) {
  // Try to create fork
  let forkResult;
  if (argv.prefixForkNameWithOwnerName) {
    forkResult = await $`gh repo fork ${owner}/${repo} --fork-name ${owner}-${repo} --clone=false 2>&1`;
  } else {
    forkResult = await $`gh repo fork ${owner}/${repo} --clone=false 2>&1`;
  }

  // ... code processes result

  if (forkResult.code !== 0) {
    // Check various conditions (empty repo, etc.)
    // ...

    // ALL OTHER ERRORS - including 404 - retry
    if (attempt < maxForkRetries) {
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await log(`Retry: Attempt ${attempt}/${maxForkRetries} failed, waiting ${delay/1000}s before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

**Problem:** HTTP 404 indicates the repository doesn't exist or the user doesn't have access. This is NOT a transient error that will be resolved by retrying.

### Issue 2: Poor Error Messages

The final error message (line 466-471) only shows:
```
Error: failed to fork: HTTP 404: Not Found (https://api.github.com/repos/ideav/work-weave-logic/forks)
```

**Problems:**
1. Doesn't explain what 404 means in this context
2. Doesn't suggest the user might lack permissions
3. Doesn't guide the user on how to diagnose or fix the issue

### Issue 3: Excessive API Requests

**Total API requests made:**
1. Initial fork conflict detection (line 218): 1 request (get root repository) - likely 404
2. 5 fork creation attempts: 5 requests
3. 5 fork existence checks after each failed attempt: 5 requests

**Total:** At least 11 requests, all likely receiving 404 responses

**Actual need:** Only 1 request would have been sufficient to determine the repository is inaccessible.

### Issue 4: Misleading Early Assumptions

Lines 35-36:
```
Warning: Could not detect repository visibility, defaulting to public
⚠️  Auto-fork: Could not check permissions, enabling fork mode for public repository
```

The tool assumes the repository is public when it can't detect visibility, but the inability to detect visibility is often a sign the repository doesn't exist or the user doesn't have access.

## Why 404 Happens

HTTP 404 from GitHub API typically indicates one of these scenarios:

1. **Repository doesn't exist** - The repository was deleted or the URL is incorrect
2. **Insufficient permissions** - The user doesn't have access to view the repository
   - Repository is private and user is not a collaborator
   - Repository is in an organization the user can't access
   - User's GitHub token lacks required scopes

In this case, since the tool was given a specific issue URL, #2 is most likely.

## Proposed Solutions

### Solution 1: Do Not Retry on 404 (Required)

**Implementation:**
- Detect HTTP 404 errors specifically
- Exit immediately with helpful error message
- Do not waste time on retries

**Code change location:** `src/solve.repository.lib.mjs:321-474`

### Solution 2: User-Friendly Error Messages (Required)

**Implementation:**
- When 404 is received, display clear explanation:
  - Repository might not exist
  - User might lack permissions
  - Suggest checking GitHub access
  - Suggest verifying the repository URL

**Code change location:** `src/solve.repository.lib.mjs:462-473`

### Solution 3: Reduce API Requests (Required)

**Implementation:**
- Skip fork existence check if fork creation returns 404
- Early exit on 404 from root repository check
- Avoid making redundant requests after clear failure

**Code change location:** `src/solve.repository.lib.mjs:218, 452-460`

### Solution 4: Improve Early Detection (Recommended)

**Implementation:**
- When repository visibility check fails, don't assume public
- Add explicit permission check before attempting fork
- Provide early warning if repository appears inaccessible

**Code change location:** `src/solve.validation.lib.mjs` (likely location for validation)

## Test Scenarios

To verify the fix works:

1. **404 on non-existent repository** - Should fail immediately with helpful message
2. **404 on private repository without access** - Should suggest permission issues
3. **Actual transient errors** (5xx) - Should still retry as expected
4. **Empty repository (403)** - Should maintain existing auto-fix behavior
5. **Valid repository** - Should work as before

## Success Metrics

- Time saved: ~30 seconds per failed fork attempt
- API requests saved: 10 requests per failed fork attempt
- User experience: Clear guidance on how to resolve the issue
