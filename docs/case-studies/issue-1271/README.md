# Case Study: Two Releases Were Not Properly Merged (Issue #1271)

## Summary

When multiple pull requests with changesets are merged close together, the release notes generation incorrectly:

1. Merges all change descriptions into a single undifferentiated list
2. Only links to ONE related pull request instead of ALL related pull requests

## Timeline of Events

### Sequence of Merges (2026-02-13)

| Time (UTC) | Event                              | Commit SHA |
| ---------- | ---------------------------------- | ---------- |
| 09:00:56   | PR #1270 merged (merge queue fix)  | `af4ac411` |
| 09:02:32   | PR #1268 merged (queue issues fix) | `91d190d7` |
| 09:02:35   | Release workflow triggered         | `91d190d7` |
| 09:07:02   | Release v1.21.4 published          | -          |

### The Problem Visualized

**Expected Release Notes:**

```markdown
## PR #1268: Fix queue issues: rejection, display, and formatting

- Fix disk rejection not blocking queue placement when threshold exceeded
- Restore "used" label on progress bars when below threshold
- Show per-queue breakdown in /limits command
- Group queue items by tool and use human-readable time in /solve_queue

## PR #1270: fix: improve merge queue error handling and debugging (Issue #1269)

- Always log errors (not just in verbose mode) for critical merge queue failures
- Always notify users via Telegram when merge queue fails unexpectedly
- Add timeout wrapper (60s) for onStatusUpdate callback to prevent infinite blocking
- Add error handling for CI check failures in waitForCI loop
- Add comprehensive case study documentation in docs/case-studies/issue-1269/

Related Pull Requests: #1268, #1270
```

**Actual Release Notes (v1.21.4):**

```markdown
Fix queue issues: rejection, display, and formatting

- Fix disk rejection not blocking queue placement when threshold exceeded
- Restore "used" label on progress bars when below threshold
- Show per-queue breakdown in /limits command
- Group queue items by tool and use human-readable time in /solve_queue

- aa42f3a: fix: improve merge queue error handling and debugging (Issue #1269)
- Always log errors (not just in verbose mode) for critical merge queue failures
- Always notify users via Telegram when merge queue fails unexpectedly
- Add timeout wrapper (60s) for onStatusUpdate callback to prevent infinite blocking
- Add error handling for CI check failures in waitForCI loop
- Add comprehensive case study documentation in docs/case-studies/issue-1269/

Related Pull Request: #1268 <!-- Missing #1270! -->
```

## Root Cause Analysis

### Problem 1: Release Notes Formatting

**Location:** `scripts/format-release-notes.mjs:89-104`

```javascript
// This regex only captures the FIRST patch change entry
const patchChangesMatchWithHash = currentBody.match(/### Patch Changes\s*\n\s*-\s+([a-f0-9]+):\s+(.+?)$/s);
```

The regex uses `$` at the end with non-greedy `.+?` which only matches the first entry. When multiple changesets are merged (as happens when multiple PRs merge before a release cycle), the CHANGELOG.md correctly lists multiple entries:

```markdown
### Patch Changes

- ea19c72: Fix queue issues...
- aa42f3a: fix: improve merge queue...
```

But the formatting script only processes the first one.

### Problem 2: PR Detection Logic

**Location:** `scripts/format-release-notes.mjs:124-160`

The script attempts to find the related PR by:

1. Extracting the commit hash from the first changelog entry
2. OR using the `--commit-sha` argument passed from the workflow (the merge commit)
3. Calling `gh api repos/{repo}/commits/{sha}/pulls` to find associated PRs

The issue is that it only looks up ONE commit. When multiple PRs are merged:

- The merge commit for PR #1268 (`91d190d7`) triggered the release
- The `--commit-sha` is `91d190d7`
- The API returns PR #1268 for this commit
- PR #1270's commit (`aa42f3a`) is never looked up

### Problem 3: Changeset Merging vs. PR Association

**Location:** `scripts/merge-changesets.mjs`

The changeset merge script correctly combines multiple changeset descriptions but loses the per-changeset PR association. When changesets are merged:

```javascript
// Creates combined content but doesn't track which PR each description came from
const combinedDescription = descriptions.join('\n\n');
```

## Data and Evidence

### CHANGELOG.md Entry (Correct)

```markdown
## 1.21.4

### Patch Changes

- ea19c72: Fix queue issues: rejection, display, and formatting
  - Fix disk rejection not blocking queue placement when threshold exceeded
  - Restore "used" label on progress bars when below threshold
  - Show per-queue breakdown in /limits command
  - Group queue items by tool and use human-readable time in /solve_queue

- aa42f3a: fix: improve merge queue error handling and debugging (Issue #1269)
  - Always log errors (not just in verbose mode) for critical merge queue failures
  - Always notify users via Telegram when merge queue fails unexpectedly
  - Add timeout wrapper (60s) for onStatusUpdate callback to prevent infinite blocking
  - Add error handling for CI check failures in waitForCI loop
  - Add comprehensive case study documentation in docs/case-studies/issue-1269/
```

### GitHub Release Body (Incorrect)

The release body combined the entries but only linked to PR #1268.

### PR Merge Details

| PR    | Commit SHA    | Merged At            |
| ----- | ------------- | -------------------- |
| #1270 | `8431ad04...` | 2026-02-13T09:00:56Z |
| #1268 | `32ab8b6e...` | 2026-02-13T09:02:32Z |

## Related Research

### Changesets Project

The [@changesets/changelog-github](https://github.com/changesets/changesets) package provides a proper solution for linking PRs to changelog entries. According to their documentation:

> "The changelog entry generator for GitHub that links to commits, PRs and users."

Key insight: Changesets' official changelog formatter tracks PR associations at changeset creation time, not at release time.

### GitHub API

The [`/repos/{owner}/{repo}/commits/{ref}/pulls`](https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit) API endpoint returns PRs associated with a specific commit. However, this doesn't help when you need to find PRs for multiple commits in a merged changelog.

### Similar Issues

- [changesets/changesets#848](https://github.com/changesets/changesets/issues/848) - RFC: Publish release notes extensibility
- [googleapis/release-please](https://github.com/googleapis/release-please) - Alternative approach using conventional commits

## Proposed Solutions

### Solution 1: Parse CHANGELOG for All Commit Hashes (Recommended)

Modify `format-release-notes.mjs` to:

1. Parse ALL commit hashes from the changelog entry
2. Look up PRs for each commit hash
3. List all related PRs in the release notes

**Advantages:**

- Minimal changes required
- Works with existing changeset workflow
- Preserves chronological order

**Implementation:**

```javascript
// Extract ALL commit hashes from changelog
const commitMatches = currentBody.matchAll(/-\s+([a-f0-9]{7,40}):/g);
const commitHashes = [...commitMatches].map(m => m[1]);

// Look up PRs for each commit
const relatedPrs = new Set();
for (const hash of commitHashes) {
  const prs = await lookupPrsForCommit(hash);
  prs.forEach(pr => relatedPrs.add(pr));
}
```

### Solution 2: Use @changesets/changelog-github

Replace custom formatting with the official Changesets changelog formatter:

- Install `@changesets/changelog-github`
- Configure in `.changeset/config.json`
- PR links are automatically added at version time, not release time

**Advantages:**

- Industry-standard solution
- Maintained by Changesets team
- Handles edge cases

**Disadvantages:**

- Larger change to existing workflow
- May require adjustments to CI/CD

### Solution 3: Track PR Numbers in Changeset Files

Modify changeset creation to include PR number:

```markdown
---
'@link-assistant/hive-mind': patch
---

Fix queue issues (PR #1268)

- Fix disk rejection...
```

Then parse PR numbers from the changelog during release formatting.

**Advantages:**

- Explicit PR association
- Works even when commit history is complex

**Disadvantages:**

- Requires changes to changeset creation workflow
- Manual step for contributors

### Solution 4: Group Changes by PR in Release Notes

Instead of a flat list, structure release notes to show which changes came from which PR:

```markdown
## Changes in this release

### From PR #1268: Fix queue issues

- Fix disk rejection not blocking queue placement
- Restore "used" label on progress bars

### From PR #1270: Improve merge queue error handling

- Always log errors for critical failures
- Add timeout wrapper for onStatusUpdate
```

**Advantages:**

- Clear association between changes and PRs
- Better for users reviewing release notes

**Disadvantages:**

- Requires significant rework of formatting logic
- Needs commit-to-PR mapping for each changelog entry

## Recommended Implementation

Based on the analysis, **Solution 1** (Parse CHANGELOG for all commit hashes) is recommended because:

1. Minimal changes to existing workflow
2. Backward compatible
3. Can be implemented incrementally
4. Doesn't require changes to how changesets are created

## Files to Modify

1. `scripts/format-release-notes.mjs` - Main formatting script
2. `scripts/format-github-release.mjs` - Wrapper script (may need updates)

## Test Plan

1. Create a test scenario with two changesets
2. Merge both PRs before release
3. Verify release notes show both PRs as related
4. Verify changes are properly formatted (not merged into single list)

## References

- [GitHub Issue #1271](https://github.com/link-assistant/hive-mind/issues/1271)
- [Screenshot of problematic release](./screenshot.png)
- [@changesets/changesets](https://github.com/changesets/changesets)
- [@changesets/changelog-github](https://www.npmjs.com/package/@changesets/changelog-github)
- [GitHub API: List PRs associated with commit](https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit)
- [googleapis/release-please](https://github.com/googleapis/release-please)
