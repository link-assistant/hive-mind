---
'@link-assistant/hive-mind': patch
---

fix(hive): require closing keywords for PR detection

The `/hive` command was incorrectly skipping issues by reporting they had
PRs when those PRs only mentioned the issues without actually solving them.

**Root cause**: The `batchCheckPullRequestsForIssues` function used GitHub's
`CROSS_REFERENCED_EVENT` timeline items, which are created whenever a PR
body/title/commit mentions an issue number - regardless of whether the PR
actually solves the issue.

**Example**: PR #369 in VisageDvachevsky/StoryGraph is an audit PR that
created 28 new issues (#370-#397) and listed them in a table. This caused
GitHub to create cross-reference events linking that PR to all 28 issues,
but PR #369 only actually fixes #368.

**Solution**:

- Add `prClosesIssue()` function to detect GitHub closing keywords
  (fixes, closes, resolves - case-insensitive)
- Update GraphQL query to include PR body text
- Only count PRs that contain "fixes #N", "closes #N", or "resolves #N"
  for the specific issue number
- Add verbose logging when PRs are skipped for only mentioning issues

This aligns with GitHub's own auto-close behavior where only specific
keywords trigger issue closure when a PR is merged.

Fixes #1094
