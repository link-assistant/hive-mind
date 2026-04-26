# Case Study: Issue #1094 - Hive Command Skips Issues Without Linked PRs

## Executive Summary

The `/hive` command incorrectly reports that all 31 open issues in the `VisageDvachevsky/StoryGraph` repository have pull requests, when in fact most issues have no directly linked PRs that solve/fix them.

## Timeline of Events

1. **2026-01-10T16:50:30.923Z**: User executes `/hive https://github.com/VisageDvachevsky/StoryGraph/`
2. **2026-01-10T16:50:44.237Z**: System fetches 31 open issues
3. **2026-01-10T16:50:50.528Z**: System runs batch GraphQL query to check for cross-referenced PRs
4. **2026-01-10T16:50:50.529Z**: System reports "31/31 issues have open PRs"
5. **2026-01-10T16:50:50.537Z**: All issues skipped, no work performed

## Root Cause Analysis

### The Bug

The `batchCheckPullRequestsForIssues` function in `src/github.batch.lib.mjs` uses GitHub's `CROSS_REFERENCED_EVENT` timeline items to detect if an issue has a linked PR. However, this approach has a critical flaw:

**A cross-reference event is created whenever a PR body/title/commit mentions an issue number, regardless of whether the PR actually solves the issue.**

### Evidence

Looking at issue #370 (`[BUG] Edit Dialogue Flow - сигнал не подключен`):

```json
{
  "timelineItems": {
    "nodes": [
      {
        "source": {
          "number": 369,
          "title": "Graph Mode UI Audit - создано 28 детальных issues",
          "state": "OPEN"
        }
      }
    ]
  }
}
```

PR #369 body contains:

```markdown
| #370 | Edit Dialogue Flow сигнал не подключен | Сигнал не конвертируется... |
```

This **mentions** issue #370 (as a problem that was **created** during the audit), but does NOT solve it. The only issue PR #369 actually fixes is #368 (via "Fixes #368" at the end).

### The False Positive Pattern

PR #369 is an "audit PR" that:

1. Analyzed the codebase for UI issues
2. Created 28 new GitHub issues documenting problems found
3. Mentioned each new issue number in a table in its PR description

Because of these mentions, GitHub creates `CROSS_REFERENCED_EVENT` entries linking PR #369 to issues #370-#397. The hive command sees these events and assumes each issue has a solution PR.

## Data Analysis

### Open Issues (31 total)

| Issue     | Title                        | Has Actual Solution PR?            |
| --------- | ---------------------------- | ---------------------------------- |
| #321      | minor problems               | Yes (PR #322)                      |
| #336      | Connection creation may fail | No                                 |
| #368      | много проблем                | Yes (PR #369 fixes this one)       |
| #370-#397 | Various bugs from audit      | **No** (only mentioned, not fixed) |

### Cross-Reference Analysis

- **28 issues** (#370-#397) are cross-referenced by PR #369
- Only **1 of those** (#368) is actually fixed by PR #369
- **27 issues** are false positives - mentioned but not solved

## Solution Approaches

### Option 1: Check for "Fixes/Closes/Resolves" Keywords (Recommended)

GitHub only auto-closes issues when PRs use specific keywords:

- `fixes #123`
- `closes #123`
- `resolves #123`

We can enhance the detection to verify the PR body contains these keywords followed by the specific issue number.

**Pros:**

- Semantic accuracy - only counts PRs that intend to solve the issue
- Aligns with GitHub's own auto-close behavior
- Minimal API calls needed (PR body already available)

**Cons:**

- May miss PRs that solve issues without using keywords
- Requires parsing PR body text

### Option 2: Use `closingIssuesReferences` GraphQL Field

GitHub's GraphQL API provides a `closingIssuesReferences` field on PullRequest objects that returns only issues that would be auto-closed when the PR merges.

```graphql
pullRequest(number: 369) {
  closingIssuesReferences(first: 50) {
    nodes {
      number
    }
  }
}
```

**Pros:**

- Uses GitHub's own semantic understanding
- Most accurate detection of "solution PRs"
- No text parsing required

**Cons:**

- Requires reverse lookup (check each PR, not each issue)
- More complex query structure

### Option 3: Hybrid Approach

Query both cross-referenced events AND verify with closing keywords:

1. Get cross-referenced PRs (current approach)
2. For each PR, check if it "closes" the specific issue via body text or `closingIssuesReferences`

## Recommendation

Implement **Option 1** with a fallback to **Option 2** for accuracy:

1. In the GraphQL query, add PR body text
2. Check if PR body contains `fixes #N`, `closes #N`, or `resolves #N` (case-insensitive)
3. Only count as "has solution PR" if keywords match the specific issue number

## Files to Modify

1. `src/github.batch.lib.mjs` - Update `batchCheckPullRequestsForIssues` function
2. Add tests for the new detection logic

## Test Cases

1. **True Positive**: Issue #368 linked to PR #369 with "Fixes #368" - should be detected
2. **False Positive Fixed**: Issue #370 mentioned in PR #369 table - should NOT be detected
3. **Edge Case**: PR body with "Related to #123" - should NOT be detected
4. **Edge Case**: PR body with "Closes #123 and #456" - both should be detected

## Impact Assessment

- **Current behavior**: 31/31 issues skipped (all false positives except ~3)
- **Expected behavior**: Only ~3-4 issues skipped (actual solution PRs)
- **Result**: ~27-28 issues would correctly be processed by `/hive`

## References

- Original Issue: https://github.com/link-assistant/hive-mind/issues/1094
- Execution Log: `docs/case-studies/issue-1094/hive-execution-log.log`
- StoryGraph Issues: `docs/case-studies/issue-1094/storygraph-open-issues.json`
- StoryGraph PRs: `docs/case-studies/issue-1094/storygraph-open-prs.json`
