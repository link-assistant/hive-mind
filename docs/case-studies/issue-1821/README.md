# Case Study: Issue #1821 - Auto-restart Missed Same-account Feedback

## Summary

Issue #1821 reports that a human feedback comment on Formal AI PR #222 was not
detected by hive-mind's auto-restart loop. The auto-restart comment that followed
only reported `CI failures detected`, even though a human comment had been posted
first.

The root cause was in `checkForNonBotComments`: in auto-restart monitoring it
classified every comment from the authenticated GitHub user as bot-generated.
In this incident both the human review feedback and hive-mind's automation
comments were posted by `konard`, so the human feedback was filtered out before
restart reasons were built.

The fix keeps filtering known bot logins and keeps the safe default that treats
the authenticated user as tool-owned while an AI tool may still be running.
`auto-restart-until-mergeable` opts in to trusting same-account comments only
between tool executions, when tool-generated same-account comments can be
filtered by the shared comment marker/ID helpers from `tool-comments.lib.mjs`.

## Local Evidence

Downloaded evidence is stored in this folder:

- `data/hive-mind-issue-1821.json` - original hive-mind issue.
- `data/hive-mind-pr-1822.json` and sibling comment/review files - prepared PR.
- `data/formal-ai-pr-222.json` - related Formal AI pull request.
- `data/formal-ai-pr-222-issue-comments.json` - PR conversation comments.
- `data/formal-ai-pr-222-review-comments.json` and `data/formal-ai-pr-222-reviews.json` - inline review/review data.
- `data/formal-ai-comment-4518909964.json` - the missed human feedback comment.
- `data/formal-ai-comment-4518934890.json` - the auto-restart comment that reported CI only.
- `data/formal-ai-branch-runs.json` and `data/formal-ai-run-*.json` - GitHub Actions run metadata.
- `ci-logs/formal-ai-run-*.log` - failed GitHub Actions logs.
- `ci-logs/solution-draft-log-pr-*.txt` - solution/auto-restart logs downloaded from Gists.

## Timeline

All timestamps are UTC.

| Time                | Event                                                                                                                                | Evidence                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 2026-05-21 23:21:47 | Formal AI PR #222 opened on branch `issue-221-77aad836fb28`.                                                                         | `data/formal-ai-pr-222.json`                                               |
| 2026-05-22 10:58:18 | Human feedback rejects the fake/offline dictionary direction and requests real API response caching.                                 | `data/formal-ai-pr-222-issue-comments.json`, comment `4518055123`          |
| 2026-05-22 11:00:21 | Hive-mind starts a new automated work session.                                                                                       | `data/formal-ai-pr-222-issue-comments.json`, comment `4518067467`          |
| 2026-05-22 13:02:35 | CI run `26289365168` starts and later fails for SHA `9893103...`.                                                                    | `data/formal-ai-branch-runs.json`, `ci-logs/formal-ai-run-26289365168.log` |
| 2026-05-22 13:04:21 | Automated working-session summary is posted.                                                                                         | `data/formal-ai-pr-222-issue-comments.json`, comment `4518895370`          |
| 2026-05-22 13:04:33 | Automated solution draft log is posted.                                                                                              | `data/formal-ai-pr-222-issue-comments.json`, comment `4518897330`          |
| 2026-05-22 13:06:01 | Human feedback is posted by `konard`: "We should not encode raw API data in .lino files as base64, it should be all human readable." | `data/formal-ai-comment-4518909964.json`                                   |
| 2026-05-22 13:08:55 | Hive-mind auto-restarts with `Reason: CI failures detected`, missing the 13:06 feedback.                                             | `data/formal-ai-comment-4518934890.json`                                   |
| 2026-05-22 13:20:41 | Next CI run `26290240103` starts and fails for SHA `40855ca...`.                                                                     | `data/formal-ai-branch-runs.json`, `ci-logs/formal-ai-run-26290240103.log` |
| 2026-05-22 13:31:41 | Later CI run `26290777696` starts and succeeds for SHA `ece9f9f...`.                                                                 | `data/formal-ai-branch-runs.json`                                          |

## Requirements

Issue #1821 and the related comments require:

- Detect human feedback comments during auto-restart monitoring.
- Preserve downloaded logs and issue data under `docs/case-studies/issue-1821`.
- Reconstruct the timeline and root cause from evidence.
- Check GitHub API comment surfaces and existing code components before changing behavior.
- Add diagnostics or verbose output if the cause is otherwise ambiguous.
- Add a regression test before relying on the fix.
- Update the prepared PR #1822 with the implementation and evidence.

## External Research

GitHub documents that pull requests expose multiple comment surfaces. Conversation
comments on a pull request are accessed through the Issues comments endpoints
because a pull request is also an issue, while line-level code comments use pull
request review comment endpoints:

- [GitHub REST guide: Working with comments](https://docs.github.com/en/rest/guides/working-with-comments?apiVersion=2026-03-10)
- [GitHub REST API endpoints for pull requests](https://docs.github.com/en/rest/pulls)

The existing hive-mind code already fetched both PR conversation comments and
PR review comments, so the incident was not caused by using the wrong GitHub API
endpoint. The failure happened after fetch, during author filtering.

## Root Cause

`src/solve.auto-merge-helpers.lib.mjs` had this behavior:

1. Fetch current GitHub user with `gh api user --jq .login`.
2. Treat a comment as bot-authored when `comment.user.login === currentUser`.
3. Filter out bot-authored comments.

That rule conflated "same account as the automation token" with
"tool-generated". It works only when the automation account and the human
reviewer are different accounts. In this repository workflow they can be the
same account (`konard`), so the real human feedback comment was excluded.

The restart reason then correctly reflected only the remaining trigger: CI
failure. That is why the auto-restart comment said `CI failures detected`.

## Existing Components Checked

- `src/tool-comments.lib.mjs` already centralizes markers for comments posted by
  hive-mind itself, including solution logs, working-session summaries,
  auto-restart notices, ready-to-merge notices, and tracked comment IDs.
- `src/solve.results.lib.mjs` already uses `isToolGeneratedComment` and
  `isToolTrackedCommentId` to distinguish tool-posted comments from same-account
  AI/human comments.
- `checkForNonBotComments` was the outlier. It used login identity instead of
  the shared marker helpers.

No new library is required. The right local component is the existing
`tool-comments.lib.mjs` marker/ID filter.

## Fix

`checkForNonBotComments` now:

- Keeps filtering known bot login patterns such as `[bot]`, `github-actions`,
  `dependabot`, `renovate`, and similar service accounts.
- Uses `isToolTrackedCommentId(comment.id)` and
  `isToolGeneratedComment(comment.body)` to skip hive-mind/tool-generated
  comments.
- Treats same-account non-tool comments as human feedback only when the caller
  explicitly passes `trustAuthenticatedUserComments: true`.
- Keeps the default safe for contexts where an AI tool may still be running by
  treating authenticated-user comments as tool-owned.
- Emits more precise verbose output for skipped tool comments, skipped bot
  comments, and detected same-account feedback.
- Accepts an injectable command runner so the behavior can be tested without
  live GitHub calls.

## Verification

Regression coverage:

- `tests/test-issue-1821-auto-restart-same-user-feedback.mjs`

The test reproduces the incident shape:

- Authenticated user: `konard`.
- Same-account solution log comment: ignored by marker.
- Same-account auto-restart comment: ignored by marker.
- Same-account human feedback comment `4518909964`: detected only in the
  auto-restart idle-monitoring context.
- Same-account human feedback comment without the opt-in: ignored for the safe
  default.
- Other-account human comment: detected by default.
- Bot account comment: ignored by login pattern.

Before the filter fix, the test failed because the human feedback comment was
classified as bot-authored. After the fix, it passes.

## Follow-up Options

- Continue requiring all tool-posted comments to include a stable hidden marker
  or tracked ID.
- Consider logging aggregate skip counts in non-verbose mode if comment
  detection becomes hard to audit in future incidents.
- If automation and humans frequently share one account, prefer explicit
  tool-generated markers over account identity for every feedback-sensitive
  workflow.
