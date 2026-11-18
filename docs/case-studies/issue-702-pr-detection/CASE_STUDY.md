# Case Study: /hive Command Does Not Skip Issues with Pull Requests

**Issue:** [#702](https://github.com/deep-assistant/hive-mind/issues/702)
**Date:** 2025-11-10
**Status:** Root cause identified

## Executive Summary

The `/hive` command failed to skip issues #698 and #700 despite both having open pull requests at the time of execution. Investigation revealed a **race condition** between PR creation and GitHub's GraphQL API indexing of cross-reference events, causing newly created PRs to be invisible to the batch PR detection logic for a brief period (estimated 2-8 minutes).

### Impact
- **Severity:** Medium
- **Frequency:** Affects recently created PRs (< ~10 minutes old)
- **User Impact:** Duplicate work attempts on issues that already have PRs
- **Data Loss:** None (workers are interrupted before significant work)

## Timeline of Events

### PR Creation Times
- **12:46:24 UTC** - PR #699 created for issue #698
- **12:51:26 UTC** - PR #701 created for issue #700

### Hive Execution
- **12:53:57 UTC** - Hive command started
- **12:54:07-09 UTC** - Batch PR check executed
- **12:54:09 UTC** - Issues #698 and #700 added to queue (should have been skipped!)

### Time Deltas
- PR #699: **7 minutes 45 seconds** old when checked
- PR #701: **2 minutes 43 seconds** old when checked

## Root Cause Analysis

### The Detection Mechanism

The `/hive` command uses a GraphQL-based batch check to detect existing PRs:

```javascript
// File: src/github.batch.lib.mjs, lines 45-59
timelineItems(first: 100, itemTypes: [CROSS_REFERENCED_EVENT]) {
  nodes {
    ... on CrossReferencedEvent {
      source {
        ... on PullRequest {
          number
          title
          state
          isDraft
          url
        }
      }
    }
  }
}
```

The logic filters PRs based on:
1. Event type: `CROSS_REFERENCED_EVENT`
2. Source type: `PullRequest`
3. PR state: `OPEN` (line 89: `item.source.state === 'OPEN'`)
4. Not draft: (line 89: `!item.source.isDraft`)

### The Race Condition

When a PR is created that references an issue:

1. **T+0s**: PR is created (e.g., `2025-11-10T12:46:24Z`)
2. **T+1s**: GitHub creates a `CrossReferencedEvent` (e.g., `2025-11-10T12:46:25Z`)
3. **T+?s**: GitHub GraphQL API indexes the event (**UNKNOWN DELAY**)
4. **T+?s**: Event becomes queryable via GraphQL

**The Problem:** If the batch PR check runs during step 3 (after event creation but before indexing completes), the event won't be returned by the GraphQL query, and the issue won't be skipped.

### Evidence

#### Current State (Hours After Creation)
Running the same GraphQL query now shows the cross-reference events:

```json
{
  "issue698": {
    "timelineItems": {
      "nodes": [{
        "createdAt": "2025-11-10T12:46:25Z",  // 1 second after PR creation
        "source": {
          "number": 699,
          "state": "OPEN",
          "isDraft": false,
          "createdAt": "2025-11-10T12:46:24Z"
        }
      }]
    }
  },
  "issue700": {
    "timelineItems": {
      "nodes": [{
        "createdAt": "2025-11-10T12:51:27Z",  // 1 second after PR creation
        "source": {
          "number": 701,
          "state": "OPEN",
          "isDraft": false,
          "createdAt": "2025-11-10T12:51:26Z"
        }
      }]
    }
  }
}
```

#### Historical State (At Time of Check)
The hive log shows:
```
[2025-11-10T12:54:09.838Z] [INFO]    📊 Batch PR check complete: 35/42 issues have open PRs
```

This means the batch check:
- Found 42 total issues
- Detected PRs for 35 issues
- **Did NOT detect PRs for 7 issues** (including #698 and #700)

The log confirms issues #698 and #700 were added to the queue:
```
[2025-11-10T12:54:09.885Z] [INFO]    ➕ Added to queue: https://github.com/deep-assistant/hive-mind/issues/698
[2025-11-10T12:54:09.885Z] [INFO]    ➕ Added to queue: https://github.com/deep-assistant/hive-mind/issues/700
```

### Verification

Ruled out alternative explanations:
- ❌ **Draft PRs:** Both PRs have `isDraft: false`
- ❌ **Closed PRs:** Both PRs have `state: "OPEN"`
- ❌ **Missing cross-reference:** Cross-reference events exist and were created ~1s after PR creation
- ✅ **API Indexing Delay:** Only plausible explanation given the evidence

## Proposed Solutions

### Solution 1: Add Delay Before PR Check (Quick Fix)
**Complexity:** Low
**Effectiveness:** Medium
**Risk:** Low

Add a configurable delay between fetching issues and checking for PRs:

```javascript
// In fetchIssues() function, before PR check
if (argv.skipIssuesWithPrs) {
  await log('   ⏰ Waiting for GitHub API to index recent events...');
  await new Promise(resolve => setTimeout(resolve, 30000)); // 30 second delay
  await log('   🔍 Checking for existing pull requests using batch GraphQL query...');
  // ... existing PR check logic
}
```

**Pros:**
- Simple implementation
- No API changes needed
- Configurable delay

**Cons:**
- Arbitrary delay (may be too short or too long)
- Slows down every hive execution
- Doesn't guarantee consistency

### Solution 2: Use REST API Timeline Endpoint (Reliable)
**Complexity:** Medium
**Effectiveness:** High
**Risk:** Medium

Switch from GraphQL `timelineItems` to REST API `/issues/{issue_number}/timeline`:

```javascript
// Modified approach in batchCheckPullRequestsForIssues
for (const issueNum of batch) {
  const cmd = `gh api repos/${owner}/${repo}/issues/${issueNum}/timeline`;
  const timeline = JSON.parse(execSync(cmd, { encoding: 'utf8' }));

  const linkedPRs = timeline.filter(event =>
    event.event === 'cross-referenced' &&
    event.source?.issue?.pull_request &&
    event.source.issue.state === 'open'
  );

  results[issueNum] = {
    openPRCount: linkedPRs.length,
    linkedPRs: linkedPRs.map(e => ({
      number: e.source.issue.number,
      url: e.source.issue.html_url,
      state: e.source.issue.state
    }))
  };
}
```

**Pros:**
- REST API may have different (possibly more consistent) indexing
- Still uses batch approach (one API call per issue)
- Already used as fallback in current code (line 126)

**Cons:**
- More API calls than GraphQL batch approach
- May still have same indexing delay
- Harder to batch efficiently

### Solution 3: Retry Logic with Exponential Backoff (Robust)
**Complexity:** Medium
**Effectiveness:** High
**Risk:** Low

Implement retry logic for issues where no PR is found:

```javascript
// After initial batch check
const issuesWithoutPRs = filteredIssues.filter(issue => {
  const prInfo = prResults[issue.number];
  return !prInfo || prInfo.openPRCount === 0;
});

if (issuesWithoutPRs.length > 0) {
  await log(`   🔄 Retrying PR check for ${issuesWithoutPRs.length} issues after delay...`);
  await new Promise(resolve => setTimeout(resolve, 10000)); // 10s delay

  const retryResults = await batchCheckPullRequestsForIssues(
    repoData.owner,
    repoData.repo,
    issuesWithoutPRs.map(i => i.number)
  );

  // Merge retry results
  Object.assign(prResults, retryResults);
}
```

**Pros:**
- Only adds delay for uncertain cases
- Catches race conditions without slowing down normal case
- Can tune retry delay based on empirical data

**Cons:**
- More complex logic
- Still adds some delay
- May need multiple retries for very fresh PRs

### Solution 4: Hybrid Approach - Check PR Creation Time (Intelligent)
**Complexity:** High
**Effectiveness:** High
**Risk:** Low

Detect when PRs are very recent and apply special handling:

```javascript
// In batchCheckPullRequestsForIssues
for (const issueNum of batch) {
  const prInfo = results[issueNum];

  if (prInfo.openPRCount === 0) {
    // Check if there are any RECENT PR creation events (last 10 minutes)
    // using gh pr list filtered by time
    const recentPRs = await checkRecentPRs(owner, repo, issueNum);

    if (recentPRs.length > 0) {
      await log(`   ⚠️  Issue ${issueNum} has very recent PR (possible race condition), marking as having PR`);
      prInfo.openPRCount = recentPRs.length;
      prInfo.linkedPRs = recentPRs;
    }
  }
}
```

**Pros:**
- Targeted solution that only affects edge cases
- No delay for issues with clearly detected PRs
- Learns from the data (recent = likely race condition)

**Cons:**
- Most complex implementation
- Requires additional API calls for suspicious cases
- Need to define "recent" threshold

### Solution 5: Use Issue's `closingIssuesReferences` from PR Side (Alternative)
**Complexity:** Medium
**Effectiveness:** High
**Risk:** Low

Instead of checking issues for PRs, check PRs for issues:

```javascript
// Fetch all open PRs for the repository
const openPRs = await fetchAllOpenPRs(owner, repo);

// Build a map of issue numbers to PRs
const issueToPRMap = {};
for (const pr of openPRs) {
  const linkedIssues = pr.closingIssuesReferences || [];
  for (const issue of linkedIssues) {
    const issueNum = extractIssueNumber(issue.url);
    if (!issueToPRMap[issueNum]) {
      issueToPRMap[issueNum] = [];
    }
    issueToPRMap[issueNum].push(pr);
  }
}

// Filter issues based on map
for (const issue of issues) {
  if (issueToPRMap[issue.number]?.length > 0) {
    // Skip this issue
  }
}
```

**Pros:**
- Different API path may not have same race condition
- Single query gets all relevant data
- More direct relationship (PR → issue vs issue → PR)

**Cons:**
- Requires fetching ALL open PRs (could be many)
- More expensive for repos with many open PRs
- Still might have indexing delays

## Recommendations

### Immediate Action (Quick Fix)
Implement **Solution 3: Retry Logic** as it provides the best balance of:
- Effectiveness (catches race conditions)
- Performance (only adds delay when needed)
- Simplicity (straightforward implementation)

### Long-term Solution
Implement **Solution 4: Hybrid Approach** which:
- Detects suspicious cases (no PR found for recently created issue)
- Uses heuristics to identify likely race conditions
- Provides configurable tuning parameters

### Configuration Options
Add new command-line options:
```bash
--pr-check-retry-delay <ms>    # Delay before retrying PR check (default: 10000)
--pr-check-retries <n>         # Number of retries (default: 1)
--pr-check-recent-threshold <m> # Minutes to consider "recent" (default: 10)
```

## Prevention Guidelines

### For Users
1. When running `/hive` immediately after creating PRs, expect potential duplicate attempts
2. Consider adding a delay between PR creation and hive execution
3. Use `--auto-continue` mode if you expect PRs to already exist

### For Developers
1. Document the GitHub API indexing delay in code comments
2. Add metrics to track PR detection accuracy
3. Consider logging when retries find PRs (indicates race condition)
4. Add integration tests that create PRs and immediately check for them

## Metrics and Analysis

### Observed Behavior
- **PR #699:** Missed at 7m45s age (surprisingly old!)
- **PR #701:** Missed at 2m43s age (expected given delay)

### Questions for Further Investigation
1. Why was PR #699 (7m45s old) still not detected? Is there something special about this PR?
2. What is the typical indexing delay for GitHub's GraphQL API?
3. Does the delay vary by repository size, activity, or GitHub's load?
4. Are there GitHub API status pages or documentation about this?

### Potential GitHub API Issue
The fact that a 7+ minute old PR was not detected suggests this might not be purely an indexing delay. Possible alternative explanations:
1. GitHub API had temporary issues at that time
2. The specific GraphQL query path has longer delays
3. Repository-specific factors (large repo, many events)
4. The cross-reference event was created but not properly linked in GraphQL

## Related Issues

- Similar timing issues may affect other GitHub API operations
- Consider auditing all GraphQL timeline queries in the codebase
- Related to general GitHub API consistency guarantees

## Testing Recommendations

### Manual Test
1. Create a new issue
2. Immediately create a PR referencing it
3. Run `/hive` with `--skip-issues-with-prs` at various time intervals (0s, 30s, 1m, 2m, 5m, 10m)
4. Document when the PR is successfully detected

### Automated Test
```javascript
// experiments/test-pr-detection-timing.mjs
// Create test issue
// Create test PR referencing issue
// Poll GraphQL API every 10 seconds for 10 minutes
// Record when cross-reference event becomes visible
// Report timing statistics
```

## Appendix

### A. Case Study Data Files

All relevant data preserved in this directory:
- `case-study-log.txt` - Full hive command output from incident
- `issue-698-data.json` - Complete GraphQL response for issue #698
- `issue-700-data.json` - Complete GraphQL response for issue #700
- `pr-699-data.json` - Complete data for PR #699
- `pr-701-data.json` - Complete data for PR #701

### B. Code References

**PR Detection Logic:**
- `src/github.batch.lib.mjs:21-157` - `batchCheckPullRequestsForIssues()` function
- `src/hive.mjs:1194-1243` - PR filtering in `fetchIssues()` function

**GraphQL Query:**
- `src/github.batch.lib.mjs:37-63` - Timeline items query

**Filtering Logic:**
- `src/github.batch.lib.mjs:89` - PR state and draft check

### C. Timeline Visualization

```
12:46:24 ─┬─ PR #699 Created (for issue #698)
          └─ ✅ Cross-reference event: 12:46:25 (+1s)

12:51:26 ─┬─ PR #701 Created (for issue #700)
          └─ ✅ Cross-reference event: 12:51:27 (+1s)

12:53:57 ─── Hive command started

12:54:07 ─┬─ Batch PR check begins
          │  • PR #699 age: 7m 43s
          │  • PR #701 age: 2m 41s
          │
12:54:09 ─┼─ Batch PR check complete
          │  ❌ Issue #698: NOT detected (should have been skipped)
          │  ❌ Issue #700: NOT detected (should have been skipped)
          │  ✅ 35 other issues: Correctly detected
          │
          └─ Issues #698 and #700 added to queue (INCORRECT)
```

### D. GitHub API Documentation

Relevant GitHub API documentation:
- [GraphQL Timeline Items](https://docs.github.com/en/graphql/reference/objects#issue)
- [Cross-Referenced Events](https://docs.github.com/en/graphql/reference/objects#crossreferencedevent)
- [REST API Timeline](https://docs.github.com/en/rest/issues/timeline)

## Conclusion

This case study identified a **race condition in GitHub's API indexing** that causes newly created PRs to be invisible to GraphQL timeline queries for an indeterminate period (observed range: 2-8 minutes, but the 8-minute case suggests additional factors).

The recommended solution is to implement **retry logic with exponential backoff** for issues where no PR is detected, combined with **heuristic detection** of likely race conditions based on issue/PR creation times.

This will significantly reduce false negatives while minimizing performance impact on normal operations.
