# Case Study: No `ready to merge` Comment When `--auto-restart-until-mergeable` Is Enabled

**Issue:** https://github.com/link-assistant/hive-mind/issues/1389
**PR:** https://github.com/link-assistant/hive-mind/pull/1390
**Related PR (where bug occurred):** https://github.com/link-assistant/hive-mind/pull/1388
**Related Issue:** https://github.com/link-assistant/hive-mind/issues/1387
**Full log:** https://gist.githubusercontent.com/konard/2fdc3ec84d471b062087f8b0c74a35fc/raw/fa3388f92be67f60831520c33a6e7d243ba7c203/b623ee9f-27e9-4deb-8e9d-cf765bd9bfbd.log
**solve version when bug occurred:** v1.25.7

---

## Summary

When `--auto-restart-until-mergeable` is used, and the PR had a previous `## ✅ Ready to merge` comment from an earlier solve session, subsequent solve sessions would skip posting a new "Ready to merge" comment even though the PR had become mergeable again after human feedback was addressed.

This is the same root cause as issue #1371, but triggered by a different scenario: **multiple separate solve invocations** rather than a single invocation with an internal auto-restart sequence.

---

## Timeline of Events (Reconstructed)

All times UTC, from https://github.com/link-assistant/hive-mind/pull/1388

| Time (UTC)        | Event                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| 09:24:34          | **Session 1** starts: initial solution draft log uploaded to PR #1388                              |
| 09:26:50          | Session 1: auto-restart triggered (attempt 1) due to CI failures                                   |
| 09:36:08          | Session 1 iteration 1: auto-restart-until-mergeable log uploaded (cost: $0.52)                     |
| **09:37:14**      | **Session 1**: `## ✅ Ready to merge` comment posted — all CI checks passed                        |
| 09:51:14          | Human feedback: "Will it not break queue display that goes after claude limits section?"           |
| 09:51:50          | **Session 2** starts (continue mode): AI Work Session Started comment posted, PR → draft mode      |
| 09:53:53          | Session 2: AI responds to queue display question, confirms fix works                               |
| 09:54:15          | Session 2 ends: Solution Draft Log uploaded (cost: $0.53). NO "Ready to merge" comment posted.     |
| 10:03:45          | Human feedback: "Make sure we have all necessary automated tests... form an array of sections..."  |
| 10:04:09          | **Session 3** starts (continue mode, solve v1.25.7): AI Work Session Started                       |
| 10:10:53          | Session 3: Claude finishes work, solution log uploaded, entering auto-restart-until-mergeable mode |
| 10:10:54–10:15:14 | Session 3: Checks #1–#5 — CI still running (test-suites pending)                                   |
| 10:16:15          | Session 3 Check #6: `✅ PR IS MERGEABLE!`                                                          |
| **10:16:19**      | **BUG**: `Skipping duplicate "Ready to merge" comment` — comment from Session 1 found in history   |
| 10:16:19          | Session 3 ends. No "Ready to merge" comment posted despite PR being mergeable.                     |

### Log Evidence (from b623ee9f.log)

```
18118→[2026-03-04T10:16:18.809Z] [INFO] ✅ PR IS MERGEABLE!
18119→[2026-03-04T10:16:18.809Z] [INFO]    PR is ready to be merged manually
18120→[2026-03-04T10:16:18.810Z] [INFO]    Exiting auto-restart-until-mergeable mode
18121→[2026-03-04T10:16:19.138Z] [INFO]    Skipping duplicate "Ready to merge" comment    ← BUG
18122→[2026-03-04T10:16:19.139Z] [INFO]
18123→🏁 Ending work session:      2026-03-04T10:16:19.139Z
```

---

## Root Cause Analysis

### The Faulty Code (v1.25.7)

In `src/solve.auto-merge.lib.mjs`, the `watchUntilMergeable` function (the main monitoring loop for `--auto-restart-until-mergeable`) contained this logic:

```js
// From solve.auto-merge.lib.mjs ~line 435 (v1.25.7)
const readyToMergeSignature = '## ✅ Ready to merge';
const hasExistingComment = await checkForExistingComment(
  owner, repo, prNumber, readyToMergeSignature, argv.verbose
);
if (!hasExistingComment) {
  const commentBody = `## ✅ Ready to merge\n\n...`;
  await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${commentBody}`;
} else {
  await log(formatAligned('', 'Skipping duplicate "Ready to merge" comment', '', 2));
}
return { success: true, reason: 'mergeable', ... };
```

The `checkForExistingComment` function fetches **all** PR comments and searches the full comment history for the signature string:

```js
const checkForExistingComment = async (owner, repo, prNumber, commentSignature, verbose = false) => {
  const result = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --jq '.[].body' 2>/dev/null`;
  if (result.code === 0 && result.stdout) {
    const bodies = result.stdout.toString();
    return bodies.includes(commentSignature); // ← searches ALL-TIME history
  }
  return false;
};
```

### Why This Is Wrong

The deduplication was originally introduced in issue #1323 to prevent duplicate comments **within the same check cycle** (e.g., if two iterations of the monitoring loop simultaneously detected mergeability). However, checking all-time history is too broad:

1. Session 1 posts `## ✅ Ready to merge` at 09:37:14
2. User provides feedback — PR is no longer "ready" from the human's perspective
3. Session 3 starts fresh, addresses feedback, CI passes again
4. Session 3 calls `checkForExistingComment` → finds the comment from Session 1
5. Session 3 silently skips posting a new notification

The user sees: PR went from "Ready to merge" → feedback → work done → **silence** (no new "Ready to merge"). They have to manually check the PR status.

### Why Both Issue #1371 and Issue #1389 Are the Same Root Cause

| Scenario             | Issue #1371                                                | Issue #1389                                            |
| -------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Trigger              | Single solve invocation with internal auto-restart         | Multiple separate solve invocations                    |
| Session count        | 1 (one process, multiple internal restart iterations)      | 3 separate processes                                   |
| When comment skipped | After internal auto-restart completes, within same process | Session 3 starts fresh with empty in-memory state      |
| Root cause           | `checkForExistingComment` finds comment from same session  | `checkForExistingComment` finds comment from Session 1 |

Both are caused by `checkForExistingComment` checking **all-time PR comment history** instead of **current session only**.

---

## The Fix (Applied in Issue #1371, commit 278415a9)

The fix replaced the `checkForExistingComment` call in `watchUntilMergeable` with an **in-memory flag**:

```js
// Added at top of watchUntilMergeable function
// Issue #1371: Track whether a "Ready to merge" comment was posted in THIS session.
// This replaces the all-time history check (checkForExistingComment) which incorrectly
// suppressed new notifications when a previous solve run had already posted one.
// In-memory deduplication correctly handles the case where multiple check cycles in
// the same run detect mergeability simultaneously, without blocking fresh runs.
let readyToMergeCommentPosted = false;

// ... inside the "PR IS MERGEABLE" branch:
if (!readyToMergeCommentPosted) {
  const commentBody = `## ✅ Ready to merge\n\n...`;
  await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${commentBody}`;
  readyToMergeCommentPosted = true;
} else {
  await log(formatAligned('', 'Skipping duplicate "Ready to merge" comment (already posted this session)', '', 2));
}
```

**Why this correctly handles both scenarios:**

- **Within the same run**: If the loop runs multiple check cycles that all see the PR as mergeable (e.g., race condition), only the first one posts the comment. The flag stays `true` for subsequent cycles.
- **Across different invocations**: Each new `solve` invocation creates a new `watchUntilMergeable` call with a fresh `readyToMergeCommentPosted = false`. The old comment from a previous session doesn't block the new notification.

---

## What the Fix Does NOT Change

The `checkForExistingComment` function is still used in **two early-exit paths** in `startAutoRestartUntilMergeable`:

1. **Fork mode** (lines ~943-957): When auto-merge is requested but the PR is from a fork (no write access). Here, deduplication across sessions makes sense — if a maintainer hasn't merged yet, we don't want to spam them with repeated "Please merge manually" comments.

2. **Insufficient permissions** (lines ~972-986): When auto-merge is requested but the user lacks merge permissions. Same reasoning as fork mode.

These paths have different semantics (they indicate a permanent limitation, not a transient state), so cross-session deduplication is appropriate there.

---

## Session 2 Note: Why No "Ready to merge" There Either

Looking at Session 2 (09:51:50Z to 09:54:15Z), it ended with just a "Solution Draft Log" comment and no "Ready to merge". This is **expected behavior** in this case: Session 2 was just responding to a comment question (not addressing CI failures or making the PR mergeable after a problem), and the PR was already marked as not-draft / ready for review. The `watchUntilMergeable` loop in Session 2 would have seen CI checks passing and either:

- Detected the PR was already mergeable but posted the comment (which would have been correct) OR
- The PR was still in "draft" mode from the conversion at session start

Further investigation of Session 2's log would clarify this.

---

## Verification

The fix (commit 278415a9, released in v1.26.0) can be verified by:

1. Running solve on a PR with `--auto-restart-until-mergeable`
2. After "Ready to merge" is posted, providing feedback to trigger a new solve session
3. Confirming the new session posts a new "Ready to merge" when CI passes

The in-memory flag approach is the correct solution because:

- It correctly prevents within-session duplicates (original intent of the deduplication)
- It allows cross-session notifications (fixing the bug)
- It's simpler than timestamp-based filtering
- It matches how other similar flags work in the codebase (e.g., `autoRestartCommentPosted`)

---

## Industry Context: Comment Deduplication Patterns

The core tension in automated PR comment deduplication is between two approaches:

### API/History-Based Deduplication (Old approach — `checkForExistingComment`)

The dominant pattern in the GitHub automation ecosystem is to **search all existing comments** for a signature/marker before posting. This is used by tools like:

- [Sticky Pull Request Comment](https://github.com/marketplace/actions/sticky-pull-request-comment) — uses a "header" field as a deduplication key
- [Find, Create or Update Comment](https://github.com/marketplace/actions/find-create-or-update-comment) — embeds `<!-- bot-comment-id:key -->` in body
- [Probot](https://github.com/probot/ideas/issues/35) — proposed `<!-- probot:APP_ID -->` marker

**Pros:** Stateless from the bot's perspective; GitHub is the source of truth; survives restarts and CI runner recycling.

**Cons:**

1. **Scope too broad for multi-session workflows**: Finds comments from _previous runs_, not just the current run. This is the exact bug that affected hive-mind.
2. **Pagination cost**: Every trigger requires scanning all PR comments (API-rate-limited).
3. **Race conditions**: Two concurrent jobs can both call "list comments" before either has posted, and both post.

The distributed systems literature ([Architecture Weekly](https://www.architecture-weekly.com/p/deduplication-in-distributed-systems)) notes that in-memory deduplication "is completely lost on process restart, CI runner reuse, or parallel job execution" — but for the specific hive-mind use case (single process, sequential sessions), in-memory deduplication within `watchUntilMergeable` is sufficient.

### In-Memory Deduplication (New approach — `readyToMergeCommentPosted`)

The fix uses a local variable scoped to `watchUntilMergeable`'s execution. This is:

- Correct for the within-session duplicate case (two check cycles in one process)
- Correct for the cross-session case (new process = new variable = no interference)
- Zero API overhead within the session

The key insight is that `watchUntilMergeable` is **not a long-lived singleton** — it runs once per solve invocation. So in-memory state is perfectly appropriate: each invocation is independent.

---

## Related Issues

- **Issue #1323**: "Prevent duplicate ready-to-merge comments" — introduced the `checkForExistingComment` deduplication
- **Issue #1371**: First occurrence of this bug (single session with internal auto-restart). Same root cause, fixed before this issue was filed
- **Issue #1190**: Original `--auto-restart-until-mergeable` feature implementation
- **Issue #1345**: Handle repos with no CI configured (adds `noCiConfigured` path)
- **Issue #1356**: Handle usage limit reset in auto-restart mode

---

## Data Sources

- Full log from bug occurrence: [b623ee9f-27e9-4deb-8e9d-cf765bd9bfbd.log](./b623ee9f.log)
- PR where bug occurred: https://github.com/link-assistant/hive-mind/pull/1388
- PR comments data: [pr-1388-details.json](./pr-1388-details.json)
- Fix commit: https://github.com/link-assistant/hive-mind/commit/278415a9
- Issue #1371 case study: [../issue-1371/CASE-STUDY.md](../issue-1371/CASE-STUDY.md)
