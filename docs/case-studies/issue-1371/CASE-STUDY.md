# Case Study: `--auto-restart-until-mergeable` Didn't Work After Regular Auto-Restart Sequence

**Issue:** https://github.com/link-assistant/hive-mind/issues/1371
**PR:** https://github.com/link-assistant/hive-mind/pull/1372
**Example:** https://github.com/link-foundation/sandbox/pull/61#issuecomment-3986937994

---

## Summary

When `--auto-restart-until-mergeable` was used in combination with a regular auto-restart sequence (triggered by uncommitted changes), the "Ready to merge" comment was not posted at the end of the process, even though the PR was actually mergeable.

---

## Timeline of Events (Reconstructed)

All times UTC, from https://github.com/link-foundation/sandbox/pull/61

| Time  | Event                                                                                                                                                                                                           |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19:41 | First `solve` run: solution draft log uploaded                                                                                                                                                                  |
| 19:43 | `## ✅ Ready to merge` comment posted (first run successful)                                                                                                                                                    |
| 20:22 | User posts feedback: "Can we fix all issues?"                                                                                                                                                                   |
| 20:23 | Second `solve` run starts: `solve https://github.com/link-foundation/sandbox/pull/61 --attach-logs --verbose --no-tool-check --auto-resume-on-limit-reset --auto-restart-until-mergeable --tokens-budget-stats` |
| 20:32 | Session ends with uncommitted changes → solution draft log uploaded                                                                                                                                             |
| 20:32 | Regular auto-restart triggered: `## 🔄 Auto-restart 1/3` comment posted                                                                                                                                         |
| 21:11 | Auto-restart session finishes: `## 🔄 Auto-restart 1/3 Log` uploaded                                                                                                                                            |
| —     | **Expected:** `## ✅ Ready to merge` comment, but never appeared                                                                                                                                                |

---

## Root Cause Analysis

### The Bug: `checkForExistingComment` Searches All-Time History

The function `watchUntilMergeable` in `src/solve.auto-merge.lib.mjs` checks if the PR is mergeable, and when it is, it posts a `## ✅ Ready to merge` comment. However, before posting, it calls `checkForExistingComment` to avoid duplicate comments (introduced in issue #1323):

```js
// From solve.auto-merge.lib.mjs ~line 435
const readyToMergeSignature = '## ✅ Ready to merge';
const hasExistingComment = await checkForExistingComment(owner, repo, prNumber, readyToMergeSignature, argv.verbose);
if (!hasExistingComment) {
  await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${commentBody}`;
} else {
  await log(formatAligned('', 'Skipping duplicate "Ready to merge" comment', '', 2));
}
return { success: true, reason: 'mergeable', ... };
```

The `checkForExistingComment` function fetches **all** PR comments and searches for the signature string anywhere in the comment history. Since the **first run** (at 19:43) posted a `## ✅ Ready to merge` comment, when the **second run**'s `startAutoRestartUntilMergeable` eventually runs after the regular auto-restart completes, it finds that old comment and silently skips posting a new one.

The function returns `{ success: true, reason: 'mergeable' }` — so no error is raised — but the user gets **no visible notification** that the second run has also concluded that the PR is ready to merge.

### Why the Deduplication Logic is Too Broad

The deduplication was introduced to prevent the case where **within the same run**, multiple `watchUntilMergeable` check cycles simultaneously determined the PR was mergeable and all tried to post comments at once.

However, the current implementation is too broad: it prevents posting **across different runs** (across different invocations of `solve`), which means a user who re-runs solve after providing feedback will not get a new "Ready to merge" notification, even though their new run correctly verified mergeability.

### When Does This Happen?

The scenario requires:

1. A first `solve` run that completes successfully and posts "Ready to merge"
2. The user provides feedback, triggering a second `solve` run with `--auto-restart-until-mergeable`
3. The second run's initial session leaves uncommitted changes → triggers regular auto-restart
4. After the regular auto-restart finishes, `startAutoRestartUntilMergeable` runs
5. It finds the PR is mergeable but skips the comment due to the old one from step 1

---

## Proposed Fix

### Option A: Add Timestamp Filtering to `checkForExistingComment` (Recommended)

Pass a `sinceTime` parameter to `checkForExistingComment` so it only looks for comments posted **after** the current solve session started. This way, old "Ready to merge" comments from previous runs won't suppress new notifications.

```js
// Modified signature
const checkForExistingComment = async (owner, repo, prNumber, commentSignature, verbose = false, sinceTime = null) => {
  // ... fetch comments ...
  const hasMatch = bodies.some(body => {
    if (!body.includes(commentSignature)) return false;
    if (sinceTime && comment.created_at && new Date(comment.created_at) < sinceTime) return false;
    return true;
  });
  // ...
};
```

Then in `watchUntilMergeable`, pass the session start time:

```js
const hasExistingComment = await checkForExistingComment(owner, repo, prNumber, readyToMergeSignature, argv.verbose, sessionStartTime);
```

### Option B: Always Post, But Use a "Force" Parameter

When `startAutoRestartUntilMergeable` is called from the main flow (not from within an iteration), always post the comment regardless of existing ones. This is simpler but risks actual duplicates within the same run.

### Option C: Track Session-Specific State

Track whether a "Ready to merge" comment was already posted **in this session** using an in-memory flag. Only skip if the flag is set (meaning we posted it during this run), not based on historical PR comments.

---

## Chosen Fix

**Option C** is the cleanest: use an in-memory flag `readyToMergeCommentPosted` scoped to `watchUntilMergeable`'s execution. The in-memory deduplication handles the actual duplicate case (multiple check cycles in the same run detecting mergeability simultaneously), while still allowing a new comment when a new run starts.

The `checkForExistingComment` call should be removed from the main "post Ready to merge" path. It was solving the right problem (preventing spammy duplicates) but using the wrong mechanism (checking all-time history instead of just the current session).

---

## Data Sources

- PR with the bug example: https://github.com/link-foundation/sandbox/pull/61
- Comment showing the expected "Ready to merge" behavior: https://github.com/link-foundation/sandbox/pull/61#issuecomment-3986491209
- Comment showing the auto-restart 1/3 log (last comment, no "Ready to merge" after it): https://github.com/link-foundation/sandbox/pull/61#issuecomment-3986937994
- Full auto-restart session log gist: https://gist.github.com/konard/48f872e2cf4f80fbbb9be4e184915c3c
- Issue #1323 (introduced the deduplication logic): https://github.com/link-assistant/hive-mind/issues/1323

---

## Related Issues

- Issue #1323: "Prevent duplicate ready-to-merge comments" — introduced the deduplication
- Issue #1190: "Auto-restart-until-mergeable feature" — original feature
- Issue #1314: "Handle cancelled CI/CD checks"
- Issue #1345: "Handle repos with no CI configured"
