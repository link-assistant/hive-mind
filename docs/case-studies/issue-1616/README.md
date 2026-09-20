# Case Study: Issue #1616 - Codex PR Lost Its Closing Issue Link

## Summary

Issue #1616 reported that PR #1615 did not contain an explicit closing link to issue #1614, so merging the PR would not close the issue. The evidence shows that the initial auto-created PR did include `Fixes #1614`, and the first `verifyResults()` pass also saw the issue reference. The link was lost later when a Codex auto-restart edited the PR description directly with `gh pr edit --body-file -` and omitted the closing keyword. Temporary watch mode then exited after the changes were committed and did not run the PR issue-link verifier again.

The fix is to make PR issue-link enforcement reusable, use it from the normal result verification path, and run the same check after temporary auto-restart watch mode finishes.

## Requirements From Issue #1616

1. Download all logs and related data for the failing PR and issue.
2. Store the compiled evidence under `docs/case-studies/issue-1616`.
3. Reconstruct the timeline and sequence of events.
4. List the requirements and identify the root cause for each problem.
5. Search for additional facts and data relevant to GitHub issue closing links.
6. Compare with Claude, Agent, and shared solver logic, and reuse shared logic where possible.
7. Implement a fix with a regression test.

## Raw Data Collected

| Path                                                     | Source                           |
| -------------------------------------------------------- | -------------------------------- |
| `raw-data/issue-1616.json`                               | `gh issue view 1616`             |
| `raw-data/issue-1614.json`                               | `gh issue view 1614`             |
| `raw-data/pr-1615.json`                                  | `gh pr view 1615`                |
| `raw-data/pr-1615-issue-comments.json`                   | PR conversation comments         |
| `raw-data/pr-1615-review-comments.json`                  | PR review comments               |
| `raw-data/pr-1615-reviews.json`                          | PR review records                |
| `raw-data/pr-1615.diff`                                  | PR #1615 diff                    |
| `raw-data/gists/solution-draft-log-pr-1776277214725.txt` | Original issue #1614 log         |
| `raw-data/gists/solution-draft-log-pr-1776279457652.txt` | Initial PR #1615 solve log       |
| `raw-data/gists/solution-draft-log-pr-1776279577944.txt` | Temporary auto-restart log       |
| `raw-data/gists/solution-draft-log-pr-1776279806899.txt` | Auto-restart-until-mergeable log |

## External Facts

GitHub recognizes closing keywords such as `fixes`, `closes`, and `resolves` in pull request descriptions. GitHub documents those keywords as the supported way to link a pull request so that merging it can close an issue: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue

GitHub also added a repository-level setting in 2025 that can disable automatic issue closure for linked PRs. That setting does not change this bug: without the closing keyword, the PR cannot be linked through GitHub's closing-reference mechanism at all. Source: https://github.blog/changelog/2025-04-23-users-can-now-choose-whether-merging-linked-pull-requests-automatically-closes-the-issue/

## Timeline

| Time UTC               | Evidence                                        | Event                                                                                                              |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 2026-04-15 18:55:09    | `solution-draft-log-pr-1776279457652.txt:1091`  | The auto-created PR body contained `Fixes #1614`.                                                                  |
| 2026-04-15 18:55:16    | `solution-draft-log-pr-1776279457652.txt:1116`  | Auto-PR link verification warned that the issue link was missing.                                                  |
| 2026-04-15 18:57:31    | `solution-draft-log-pr-1776279457652.txt:11016` | `verifyResults()` read the PR body and reported that the issue reference was present.                              |
| 2026-04-15 18:57:35    | `solution-draft-log-pr-1776279457652.txt:11033` | `verifyResults()` replaced the placeholder description with a generated summary that still included `Fixes #1614`. |
| 2026-04-15 18:59:09    | `solution-draft-log-pr-1776279806899.txt:15158` | Codex ran `gh pr edit 1615 --body-file -` and supplied a new PR description without `Fixes #1614`.                 |
| 2026-04-15 18:59:12    | `solution-draft-log-pr-1776279806899.txt:15240` | GitHub accepted the PR body edit.                                                                                  |
| 2026-04-15 18:59:47    | `solution-draft-log-pr-1776279806899.txt:17265` | Temporary auto-restart mode exited because changes had been committed.                                             |
| 2026-04-15 18:59:48    | `solution-draft-log-pr-1776279806899.txt:17278` | The driver skipped duplicate log upload and did not re-run the issue-link check.                                   |
| Current captured state | `raw-data/pr-1615.json`                         | PR #1615 body had useful summary text but no closing keyword for issue #1614.                                      |

## Root Cause

The direct root cause was a lifecycle gap. PR issue-link enforcement lived inside `verifyResults()`, which ran before temporary auto-restart watch mode. During the subsequent Codex restart, Codex edited the PR description and removed the closing keyword. When temporary watch mode ended, `solve.mjs` pushed committed changes and handled log upload, but it did not re-run `verifyResults()` or a narrower PR body issue-link enforcement step.

There was also a secondary false-negative in the auto-PR creation verifier. GraphQL returned closing issue numbers as text in stdout, while `issueNumber` was numeric. The code compared the string list directly with the numeric issue number, so `['1614'].includes(1614)` failed and produced an incorrect "issue link missing" warning even when the PR body had `Fixes #1614`.

This is not a Codex-only design problem. Codex triggered it because it directly edited the PR body from a shell command, but the same lifecycle gap could affect Claude, OpenCode, or Agent if any tool edits the PR body after `verifyResults()` has already run. The correct fix is therefore shared PR metadata enforcement, not a Codex-specific prompt change.

## Solution

1. Add `src/pr-issue-linking.lib.mjs` with pure helpers for building issue references, appending missing `Fixes ...` text, parsing GraphQL closing issue stdout, and comparing issue numbers across string/number types.
2. Refactor `src/solve.results.lib.mjs` so `verifyResults()` uses a reusable `ensurePullRequestIssueLink()` helper.
3. Call the reusable issue-link verifier from `src/solve.mjs` after temporary auto-restart watch mode pushes its committed changes.
4. Update `src/solve.auto-pr.lib.mjs` to parse and compare GraphQL closing issue numbers by normalized string value.
5. Add `tests/test-issue-1616-pr-issue-link-preservation.mjs` and include it in `npm test`.

## Regression Coverage

The new regression test models the observed PR #1615 failure mode: a meaningful Codex-written PR description with no closing keyword. It verifies that the helper preserves the body and appends `Fixes #1614`, does not duplicate existing issue links, accepts full owner/repo links, handles fork references, and treats GraphQL string output as matching numeric issue input.

## Residual Risk

The solver can enforce the link during its own lifecycle, including the temporary auto-restart path fixed here. It cannot prevent a human or external automation from editing the PR body after the solver exits. That case would need a separate scheduled or GitHub Action based guard if required.
