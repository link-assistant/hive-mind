# Case Study: Issue #1304 - `--auto-restart-until-mergable` didn't work

## Executive Summary

**Issue:** [#1304 - `--auto-restart-until-mergable` didn't work](https://github.com/link-assistant/hive-mind/issues/1304)

**Root Cause:** The CI status check function in `github-merge.lib.mjs` incorrectly reports "success" when there are **no check runs** (empty array). This happens because `[].every(fn)` returns `true` in JavaScript (vacuous truth), so an empty `allChecks` array passes all checks. The `--auto-restart-until-mergable` mode checked CI status just 13 seconds after pushing a commit, before CI checks were even created by GitHub Actions.

**Impact:**

1. The auto-restart mode incorrectly posted "Ready to merge" when CI actually had a failing check
2. Users are misled into thinking PRs are ready to merge when checks haven't completed
3. The entire purpose of `--auto-restart-until-mergable` is defeated

**Fix Status:** Solution implemented and ready.

---

## Timeline / Sequence of Events

Based on the logs and GitHub API data:

| Timestamp (UTC) | Event                       | Details                                                |
| --------------- | --------------------------- | ------------------------------------------------------ |
| 13:31:20        | Last code commit            | Fix for issue #1296 pushed                             |
| 13:32:15        | CLAUDE.md revert commit     | Cleanup commit pushed                                  |
| 13:32:17        | PR verification             | hive-mind confirms PR #1298 exists                     |
| 13:32:23        | Log upload                  | Solution draft log posted to PR                        |
| **13:32:28**    | **"Ready to merge" posted** | **hive-mind claims all CI checks passed**              |
| 13:32:33        | Instant checks completed    | Skipped checks (Instant Release, Helm, Docker)         |
| 13:32:35        | CI detection starts         | detect-changes, Check for Manual Version Changes start |
| 13:32:49        | Changesets check starts     | "Check for Changesets" begins                          |
| 13:33:04        | **Changesets check FAILS**  | **"Check for Changesets" conclusion: failure**         |
| 13:33:34        | Other checks complete       | lint (success), Release checks (skipped)               |

**Critical Finding:** The "Ready to merge" comment was posted at 13:32:28, but the "Check for Changesets" check didn't even START until 13:32:49 - a full 21 seconds AFTER the merge readiness was declared.

---

## Root Cause Analysis

### The Bug: Vacuous Truth in CI Status Check

In `src/github-merge.lib.mjs`, the `checkPRCIStatus()` function (lines 312-383):

```javascript
// Line 344
const allPassed = !hasPending && allChecks.every(c => c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === 'neutral');
```

When `allChecks` is an empty array:

- `hasPending = [].some(...)` = `false` (no pending checks because no checks exist)
- `allPassed = !false && [].every(...)` = `true && true` = **`true`**
- `hasFailed = [].some(...)` = `false` (no failures because no checks exist)

Result: `status = 'success'` when there are zero checks!

### Why This Happened

1. **GitHub Actions delay**: After a commit is pushed, GitHub takes 7-20+ seconds to create check runs
2. **Race condition**: The auto-restart-until-mergable mode checked CI status too soon (13 seconds after push)
3. **No wait logic**: The code doesn't wait for CI checks to be created before evaluating status
4. **JavaScript quirk**: `[].every(fn)` always returns `true` (vacuous truth in logic)

### Evidence from GitHub API

Check run timestamps for commit `2994eba`:

- `detect-changes` started at 13:32:35 (7 seconds AFTER "Ready to merge")
- `Check for Changesets` started at 13:32:49 (21 seconds AFTER "Ready to merge")

At the time hive-mind checked CI status (13:32:28), the GitHub API returned **zero check runs**.

---

## Research: Similar Issues and Industry Solutions

### GitHub Community Discussions

1. [Stuck in "Expected — Waiting for status to be reported"](https://github.com/orgs/community/discussions/26698) - Common issue when CI hasn't started yet
2. [github actions + status checks - stuck on pending](https://github.com/orgs/community/discussions/44086) - Same race condition pattern
3. [GitHub API "combined status" is always Pending](https://github.com/orgs/community/discussions/58407) - API returns pending/no data before checks start

### Existing Solutions

1. **[Wait For Github Status Check Action](https://github.com/marketplace/actions/wait-for-github-status-check)** - Polls until status appears or timeout
2. **[Wait for commit statuses](https://github.com/marketplace/actions/wait-for-commit-statuses)** - Has `waitForAny: true` to wait for at least one check to appear
3. **`gh run watch` behavior** - GitHub CLI notes that "the run may not yet have started due to a noticeable delay"

### Key Insight from GitHub CLI Manual

> When running `gh run watch` immediately after an event like pushing a commit, the run may not yet have started due to a noticeable delay, so it's typically best to wait a few seconds and try again.

This confirms the race condition is a known issue even within GitHub's own tooling.

---

## Proposed Solutions

### Solution 1: Treat Empty Checks as "Pending" (Recommended)

Modify `checkPRCIStatus()` to return `pending` when no checks exist yet:

```javascript
// If no checks exist yet, treat as pending (CI hasn't started)
if (allChecks.length === 0) {
  return {
    status: 'pending',
    checks: [],
    allPassed: false,
    hasPending: true,
  };
}
```

**Pros:**

- Simple, minimal change
- Correct semantic: no data = waiting for data
- Auto-restart will wait and check again later

**Cons:**

- May delay merge readiness if repo truly has no CI

### Solution 2: Wait for Checks to Appear (More Robust)

Add a "wait for CI to start" phase with configurable timeout:

```javascript
const waitForChecksToAppear = async (owner, repo, sha, timeoutMs = 60000, pollIntervalMs = 5000) => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const checks = await getCheckRuns(owner, repo, sha);
    if (checks.length > 0) return true;
    await sleep(pollIntervalMs);
  }
  return false; // Timeout - no checks appeared
};
```

**Pros:**

- Handles delayed CI start gracefully
- Configurable timeout prevents infinite waiting
- More explicit about what we're waiting for

**Cons:**

- Adds delay to every CI check (5+ seconds minimum)
- More complex implementation

### Solution 3: Check Repository CI Configuration

Query repository settings to determine expected checks:

```javascript
// Check if repo has any workflow files or required status checks
const hasWorkflows = await checkForWorkflowFiles(owner, repo);
const requiredChecks = await getRequiredStatusChecks(owner, repo, branch);

if (hasWorkflows || requiredChecks.length > 0) {
  // Wait for checks to appear
} else {
  // Repo has no CI, safe to proceed
}
```

**Pros:**

- Handles both CI and non-CI repositories correctly
- No false positives for repos without CI

**Cons:**

- More API calls
- Additional complexity
- May miss dynamically created checks

### Recommended Approach: Combination of Solutions 1 & 2

1. **First**, treat empty checks as `pending` (Solution 1)
2. **In auto-restart mode**, wait for at least one check to appear or timeout (Solution 2)
3. Add verbose logging to help diagnose similar issues

---

## Related Issues and References

### hive-mind Issues

- [Issue #1219](https://github.com/link-assistant/hive-mind/issues/1219) - Exit condition improvements for auto-merge
- [Issue #1226](https://github.com/link-assistant/hive-mind/issues/1226) - Auto-merge permission checking
- [Issue #1290](https://github.com/link-assistant/hive-mind/issues/1290) - Skip fallback when agent completed successfully

### External References

- [GitHub Docs: About status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks)
- [GitHub Docs: Troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)
- [GitHub Docs: Using the REST API to interact with checks](https://docs.github.com/rest/guides/getting-started-with-the-checks-api)
- [Ken Muse: Creating GitHub Checks](https://www.kenmuse.com/blog/creating-github-checks/)

---

## Screenshot Analysis

The screenshot in the issue shows:

- PR #1298 "Fix false positive error detection for step_finish with reason stop"
- Comment: "✅ Ready to merge" with "All CI checks have passed"
- GitHub UI showing: **"Some checks were not successful"** with 1 failing, 17 skipped, 3 successful
- The failing check: **"Checks and release / Check for Changesets"**

This visual evidence confirms the bug: hive-mind claimed CI passed when it actually failed.

---

## Implementation Plan

1. **Modify `checkPRCIStatus()`** in `src/github-merge.lib.mjs`:
   - Return `pending` status when `allChecks.length === 0`
   - Add verbose logging for empty checks scenario

2. **Add wait-for-checks logic** in `getMergeBlockers()`:
   - Optional wait for at least one check to appear
   - Configurable via `--wait-for-ci-start-timeout` option

3. **Add tests** for edge cases:
   - Empty checks array
   - Checks appear after delay
   - Timeout scenarios

4. **Update documentation**:
   - Document the fix in CHANGELOG
   - Add troubleshooting note to CONFIGURATION.md

---

## Files to Modify

| File                           | Changes                                                  |
| ------------------------------ | -------------------------------------------------------- |
| `src/github-merge.lib.mjs`     | Fix `checkPRCIStatus()` to treat empty checks as pending |
| `src/solve.auto-merge.lib.mjs` | Add optional wait-for-checks logic                       |
| `tests/test-ci-status.mjs`     | Add test cases for empty checks                          |
| `CHANGELOG.md`                 | Document the fix                                         |
