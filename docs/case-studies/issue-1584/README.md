# Case Study: Issue #1584 — Missing "Ready to merge" comment after second working session

## Problem Statement

After a second working session completed on [linksplatform/Numbers PR #143](https://github.com/linksplatform/Numbers/pull/143), no "Ready to merge" comment was posted, even though the PR was mergeable. The first session had successfully posted a "Ready to merge" comment, but after user feedback triggered a second session, the duplicate detection logic incorrectly suppressed the new notification.

## Timeline of Events

| Time (UTC) | Event                                           | Comment ID                                                                              |
| ---------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| 01:48:56   | Session 1 starts (solve issue #142)             | —                                                                                       |
| 02:00:21   | Session 1 Solution Draft Log posted             | [4227746421](https://github.com/linksplatform/Numbers/pull/143#issuecomment-4227746421) |
| 02:02:43   | **"Ready to merge" posted** (Session 1)         | [4227756327](https://github.com/linksplatform/Numbers/pull/143#issuecomment-4227756327) |
| 02:26:52   | User feedback: "TODO cannot be just removed..." | [4227877387](https://github.com/linksplatform/Numbers/pull/143#issuecomment-4227877387) |
| 02:30:18   | Session 2 starts (AI Work Session Started)      | [4227891653](https://github.com/linksplatform/Numbers/pull/143#issuecomment-4227891653) |
| 02:38:22   | Session 2 Solution Draft Log posted             | [4227927318](https://github.com/linksplatform/Numbers/pull/143#issuecomment-4227927318) |
| —          | **Expected: "Ready to merge" for Session 2**    | **MISSING**                                                                             |
| 02:40:16   | User posts more feedback (doc deploy)           | [4227935040](https://github.com/linksplatform/Numbers/pull/143#issuecomment-4227935040) |

## Root Cause

The `checkForExistingComment` function in `src/solve.auto-merge.lib.mjs` (line 63) searched the **entire PR comment history** for the signature `## ✅ Ready to merge`. When the `watchUntilMergeable` loop detected the PR was mergeable after Session 2, it called `checkForExistingComment` which found the old "Ready to merge" from Session 1 and returned `true`, causing the code to skip posting the new notification.

### The deduplication layers

The code had two deduplication layers (introduced by issues #1323, #1371, #1567):

1. **In-memory flag** (`readyToMergeCommentPosted`): Resets when HEAD SHA changes — correctly handles new commits
2. **Cross-process guard** (`checkForExistingComment`): Searches ALL PR comments — **this was the bug**

The in-memory flag (layer 1) would have correctly allowed the new comment since it starts as `false` in a new session. However, the cross-process guard (layer 2) found the old comment and suppressed it.

### Why the in-memory flag wasn't sufficient

The `--auto-restart-until-mergeable` mode can involve:

- **Different processes** monitoring the same PR (concurrent sessions)
- **Same process** with the in-memory flag reset on SHA change

The cross-process guard was added specifically to handle concurrent processes. However, its scope was too broad — it searched ALL comments, not just those relevant to the current working session.

## Solution

Modified `checkForExistingComment` to only search for the signature **after the last "Solution Draft Log" comment** (`## 🤖 Solution Draft Log`). This effectively scopes the deduplication to the current working session:

- A "Ready to merge" from a **previous session** (before a new Solution Draft Log) is correctly ignored
- A "Ready to merge" from a **concurrent process** in the same session (after the same Solution Draft Log) is correctly detected as a duplicate
- When **no Solution Draft Log exists**, all comments are searched (backward compatibility)

### Key change

```javascript
// Before: searched ALL comments
const bodies = result.stdout.toString();
const hasMatch = bodies.includes(commentSignature);

// After: only searches comments AFTER the last Solution Draft Log
let searchStartIndex = 0;
for (let i = commentBodies.length - 1; i >= 0; i--) {
  if (commentBodies[i].includes('## 🤖 Solution Draft Log')) {
    searchStartIndex = i + 1;
    break;
  }
}
// Only search from searchStartIndex onward
```

## Files Changed

- `src/solve.auto-merge.lib.mjs` — Modified `checkForExistingComment` to narrow search scope
- `tests/test-ready-to-merge-after-solution-draft-1584.mjs` — 14 unit tests covering the fix

## Data Files

- `data/pr-143-comments.json` — All comments from linksplatform/Numbers PR #143
- `data/pr-143-details.json` — PR details
- `data/issue-1584-details.json` — Issue details

## Related Issues

- [#1323](https://github.com/link-assistant/hive-mind/issues/1323) — Introduced `checkForExistingComment` deduplication
- [#1371](https://github.com/link-assistant/hive-mind/issues/1371) — Added in-memory flag for within-session deduplication
- [#1389](https://github.com/link-assistant/hive-mind/issues/1389) — Same root cause (all-time history search), fixed with in-memory flag
- [#1567](https://github.com/link-assistant/hive-mind/issues/1567) — Added cross-process guard using `checkForExistingComment`
