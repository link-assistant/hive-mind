# Case Study: Issue #1647 - `--auto-attach-solution-summary` skipped the summary

- Issue: [link-assistant/hive-mind#1647](https://github.com/link-assistant/hive-mind/issues/1647)
- Prepared fix PR: [link-assistant/hive-mind#1648](https://github.com/link-assistant/hive-mind/pull/1648)
- Observed PR: [link-assistant/hive-mind#843](https://github.com/link-assistant/hive-mind/pull/843)
- Linked feature issue for observed PR: [link-assistant/hive-mind#817](https://github.com/link-assistant/hive-mind/issues/817)
- Related prior fix: [link-assistant/hive-mind#1626](https://github.com/link-assistant/hive-mind/pull/1626)

## Summary

The run on PR #843 captured a Claude result summary, but `--auto-attach-solution-summary`
did not post it. The log proves this sequence:

1. The solve session started at `2026-04-18T17:10:52Z`.
2. The result summary was captured at `2026-04-18T17:43:15Z`.
3. The auto-attach check scanned comments after `2026-04-18T16:19:28Z`.
4. A human/operator PR comment from `2026-04-18T16:29:41Z` was counted as an
   AI-authored comment because it was posted by the same GitHub user that ran solve.
5. The summary was skipped, and only the solution draft log was posted.

The previous #1625 fix worked correctly: the tool-generated session-start comment
was skipped by tracked ID. The remaining bug was that the scan started from the
feedback `referenceTime`, not from the current work-session start.

## Requirements

Issue #1647 asked for:

1. Download all logs and data related to the issue into `docs/case-studies/issue-1647`.
2. Reconstruct the timeline and sequence of events.
3. List the issue requirements.
4. Identify root causes for each problem.
5. Propose solution plans for each requirement.
6. Search online for additional facts and related components or libraries.
7. Add debug output or verbose mode if data was insufficient.
8. Report upstream issues if the root cause belongs to another project.

The available data was sufficient to identify the local root cause. No upstream
GitHub, GitHub CLI, or Claude Code issue is required.

## Data Inventory

Raw evidence is preserved under `source-data/`:

- `source-data/gists/solution-draft-log-pr-1776534201375.txt` - full referenced
  gist log, 47,579 lines.
- `source-data/github/issue-1647.json` - this issue metadata.
- `source-data/github/issue-817.json` and `issue-817-comments.json` - linked
  feature issue data used by the failing run.
- `source-data/github/pr-843.json` - observed PR metadata.
- `source-data/github/pr-843-issue-comments.json` - PR conversation comments.
- `source-data/github/pr-843-review-comments.json` and `pr-843-reviews.json` -
  review-comment surfaces, both empty for this case.
- `source-data/github/related-issue-1625.json` and `related-pr-1626.json` -
  prior related solution-summary fix.

## Timeline

| Time (UTC)           | Event                                                                               | Evidence                                           |
| -------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| 2026-04-18T16:19:28Z | Issue #817 was last updated. This became `referenceTime`.                           | Gist lines 224-232                                 |
| 2026-04-18T16:29:41Z | Human/operator PR feedback was posted by `konard` on PR #843.                       | `pr-843-issue-comments.json`, comment `4274107766` |
| 2026-04-18T17:10:34Z | `solve` started with `--auto-attach-solution-summary`.                              | Gist lines 3-10                                    |
| 2026-04-18T17:10:52Z | Work session started.                                                               | Gist line 176                                      |
| 2026-04-18T17:10:53Z | `AI Work Session Started` comment posted and tracked.                               | Gist lines 179-180, comment `4274190951`           |
| 2026-04-18T17:10:59Z | `prepareFeedbackAndTimestamps()` logged `Reference time: 2026-04-18T16:19:28.000Z`. | Gist lines 224-232                                 |
| 2026-04-18T17:43:15Z | Claude result summary was captured.                                                 | Gist line 47341                                    |
| 2026-04-18T17:43:16Z | Auto-attach scanned comments after `2026-04-18T16:19:28Z`.                          | Gist lines 47433-47435                             |
| 2026-04-18T17:43:17Z | The scan found 1 non-tool PR conversation comment and skipped the summary.          | Gist lines 47502-47504                             |
| 2026-04-18T17:43:28Z | Solution draft log was posted, with no solution summary comment before it.          | `pr-843-issue-comments.json`, comment `4274242512` |

## Root Cause

`checkForAiCreatedComments()` answers a session-scoped question: did the AI post
any comments during the current solve session? However, `solve.mjs` passed the
broader `referenceTime` returned by `prepareFeedbackAndTimestamps()`.

That `referenceTime` is designed for result verification and feedback discovery,
not for session-local comment attribution. In the failing run it came from the
linked issue #817 update time (`2026-04-18T16:19:28Z`). It was earlier than the
operator PR feedback at `2026-04-18T16:29:41Z`, and much earlier than the work
session start at `2026-04-18T17:10:52Z`.

Because the operator and solve command both used the GitHub user `konard`, the
pre-session feedback comment matched all old conditions:

- author was the current GitHub user;
- created after `referenceTime`;
- not a tracked tool-generated comment;
- not recognized by a tool marker.

The #1625 comment-ID tracking and marker fallback were not broken. They correctly
skipped the session-start bookkeeping comment. The wrong time boundary allowed a
real pre-session human/operator comment into the "AI created comments during
session" set.

## Online Research

The local design already uses the correct GitHub API surfaces:

- GitHub's issue-comments REST API applies to both issues and pull requests,
  and comment objects include fields such as `id`, `body`, `user`, and
  `created_at`: https://docs.github.com/en/rest/issues/comments
- GitHub's pull-request review-comments REST API is a separate inline-review
  surface, also with `user` and `created_at`: https://docs.github.com/en/rest/pulls/comments
- `gh api --paginate` is the GitHub CLI-supported way to fetch all pages from
  paginated API endpoints: https://cli.github.com/manual/gh_api

No external component needs replacement. The existing `gh api` approach is
appropriate; the bug was the caller's boundary timestamp.

## Solution Options

1. Use the work-session start time when checking for AI-authored comments.
   This is the minimal fix and matches the user-facing semantics of "during
   session". Implemented in PR #1648.
2. Extend `startWorkSession()` to return the GitHub-created timestamp of the
   session-start comment. This could reduce local clock-skew risk but is not
   required to fix the observed false positive.
3. Use GitHub API `since` filters for future optimization. This can reduce
   payload size, but filtering still needs the correct session-start boundary.
4. Replace `gh api` calls with Octokit. This would be a larger dependency and
   does not solve the attribution bug by itself.

## Implemented Fix

`solve.mjs` now captures the return value from `startWorkSession()` as
`workStartTime` and passes it to `checkForAiCreatedComments()` for
`--auto-attach-solution-summary`.

`checkForAiCreatedComments()` was renamed internally from `referenceTime` to
`sessionStartTime` in comments and verbose logs so the next investigation sees
the correct boundary explicitly.

## Verification

The regression test in `tests/test-solution-summary.mjs` fails before the fix
because `solve.mjs` did not capture `startWorkSession()` and still called:

```js
checkForAiCreatedComments(referenceTime, owner, repo, prNumber, issueNumber);
```

After the fix, it asserts the call uses:

```js
checkForAiCreatedComments(workStartTime, owner, repo, prNumber, issueNumber);
```

Focused verification:

```bash
node tests/test-solution-summary.mjs
```

Result: 37/37 passing after installing dependencies from `package-lock.json`.
