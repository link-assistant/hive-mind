# Case Study: Issue #1413 — Ready Tag Misplaced by `/merge` Command

## Summary

The `/merge` command incorrectly applied the `ready` label to PR #843
("Implement bidirectional interactive mode") when processing issue #1411
("Disable sentry by default"). PR #843 has no relation to issue #1411; the
correct linked PR is #1412.

**Root Cause:** The `syncReadyTags()` function uses a GitHub full-text text
search (`gh pr list --search "in:body fixes #1411"`) to find PRs linked to
ready issues. This text search matches any PR whose body text contains the
string `1411` alongside a closing keyword — including PRs that reference the
number `1411` as a source code **line number** in a code snippet within the
PR body, not as an issue reference.

---

## Timeline of Events

| Time (UTC)          | Event                                                          |
| ------------------- | -------------------------------------------------------------- |
| 2026-03-10 15:10:19 | PR #1412 created (`fixes #1411` — correct, intended PR)        |
| 2026-03-10 15:08:01 | Issue #1411 labeled `ready`                                    |
| 2026-03-10 19:22:39 | `/merge` command run → `syncReadyTags()` called                |
| 2026-03-10 19:22:39 | `ready` label added to PR #1412 ✅ (correct)                   |
| 2026-03-10 19:22:39 | `ready` label added to PR #843 ❌ (incorrect — false positive) |

---

## Affected Components

- **File:** `src/github-merge.lib.mjs`
- **Function:** `syncReadyTags()` (specifically Step 2, lines ~369–403)

---

## Root Cause Analysis

### The Faulty Search Query

In `syncReadyTags()`, Step 2 iterates over issues with the `ready` label and
tries to find linked open PRs to propagate the tag to:

```js
// Step 2: For each issue with 'ready', find linked PRs and sync label to them
const { stdout: linkedPRsJson } = await exec(
  `gh pr list --repo ${owner}/${repo} \
   --search "in:body closes #${issue.number} OR fixes #${issue.number} OR resolves #${issue.number}" \
   --state open --json number,title,labels --limit 10`
);
```

The `--search "in:body ..."` flag uses **GitHub's full-text search** which
indexes the entire text of the PR body. It matches the string `"fixes #1411"`
anywhere in the body, including:

- Legitimate closing references: `Fixes #1411` → means "this PR closes issue #1411" ✅
- Source code line references: `1411→    await log(...)` → a line number in a code snippet ❌

### The Specific False Positive

PR #843 ("Implement bidirectional interactive mode") has a body that contains
a code snippet with line number `1411→` (a reference to line 1411 in
`src/claude.lib.mjs`). The GitHub full-text search index matched this as a
hit for the query `fixes #1411`, producing a false positive.

Additionally, a PR comment on #843 (posted by `konard` on 2025-12-05)
contained source code with line `1411→ await log(...)`. GitHub's search may
have indexed this content as part of the PR.

### Why the Fix Failed to Prevent the Label

The `syncReadyTags()` function does not validate whether the matched PR
genuinely uses GitHub's issue-closing syntax. It only checks whether the
PR number is already in `readyPRNumbers` (to avoid double-adding), then
unconditionally calls `addLabel()`.

---

## Correct Approach: GitHub GraphQL `timelineItems` API

GitHub tracks actual closing references via the PR/Issue timeline. The
correct way to find PRs that genuinely close an issue is to use the GitHub
GraphQL API's `timelineItems` with `CROSS_REFERENCED_EVENT` or the REST API's
issue timeline endpoint and filter for `cross-referenced` events where the
source is a PR:

```
GET /repos/{owner}/{repo}/issues/{issue_number}/timeline
```

Filter for events where:

- `event === "cross-referenced"`
- `source.issue.pull_request` exists (indicating the source is a PR, not an issue)

This returns only PRs that GitHub actually knows are linked to the issue via
closing keywords — the same data GitHub uses to auto-close issues when PRs
are merged.

Alternatively, using the GitHub GraphQL API:

```graphql
{
  repository(owner: "link-assistant", name: "hive-mind") {
    issue(number: 1411) {
      timelineItems(itemTypes: [CONNECTED_EVENT, CROSS_REFERENCED_EVENT]) {
        nodes {
          ... on CrossReferencedEvent {
            source {
              ... on PullRequest {
                number
                title
              }
            }
          }
        }
      }
    }
  }
}
```

### Verification

Running the REST timeline endpoint for issue #1411 confirms:

- `cross-referenced` event pointing to PR #1412 ✅
- `cross-referenced` event pointing to issue #1413 (this issue itself, as a cross-reference — not a PR) ✅
- PR #843 does **not** appear in the timeline as a closing reference ✅

---

## Proposed Fix

Replace the full-text body search in `syncReadyTags()` Step 2 with the
GitHub REST API issue timeline to get genuine closing PRs:

**Before (faulty):**

```js
const { stdout: linkedPRsJson } = await exec(
  `gh pr list --repo ${owner}/${repo} \
   --search "in:body closes #${issue.number} OR fixes #${issue.number} OR resolves #${issue.number}" \
   --state open --json number,title,labels --limit 10`
);
```

**After (correct):**

```js
// Use GitHub issue timeline to find PRs that genuinely close this issue
// via closing keywords — avoids false positives from text search matching
// line numbers or code snippets in PR bodies.
const { stdout: timelineJson } = await exec(`gh api repos/${owner}/${repo}/issues/${issue.number}/timeline --paginate`);
const timeline = JSON.parse(timelineJson.trim() || '[]');
const closingPRNumbers = timeline
  .filter(
    e =>
      e.event === 'cross-referenced' &&
      e.source?.issue?.pull_request != null && // source is a PR
      e.source?.issue?.state === 'open' // PR is still open
  )
  .map(e => e.source.issue.number);
```

Then fetch full PR data for those numbers and proceed as before.

---

## Impact

- **Severity:** Medium — a stale PR (PR #843) received an unintended `ready`
  label, causing it to appear in the merge queue.
- **User Impact:** Risk of accidentally merging old/unrelated PRs via the
  `/merge` command.
- **Frequency:** Could occur whenever a PR body contains a source code snippet
  with line numbers that match an issue number.

---

## Related Issues

- Issue #1367: Original feature request for `syncReadyTags()`
- Issue #1411: Issue whose `ready` label triggered the bug
- PR #1412: Correct PR linked to issue #1411
- PR #843: Incorrectly labeled PR (false positive)

---

## References

- [GitHub REST API: Issue Timeline](https://docs.github.com/en/rest/issues/timeline)
- [GitHub closing keywords](https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue)
- [GitHub full-text search](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests)
