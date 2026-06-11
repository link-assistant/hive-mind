# Issue 1905 Case Study - Missing Pull Request Link at Completion

## Scope

Issue: https://github.com/link-assistant/hive-mind/issues/1905

The report says Telegram completion messages should always include the pull
request link on successful issue-solving sessions because the solve command
already knows that URL from its own verification log. The provided screenshot
shows a `/codex` run for
https://github.com/link-foundation/meta-language/issues/60 finishing
successfully with an `Issue:` line, but without a `Pull request:` line.

## Captured Data

Raw data and evidence are stored in this directory:

| Path                                                      | Contents                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `assets/issue-screenshot.png`                             | Screenshot attached to hive-mind issue #1905.                                |
| `raw/hive-mind-issue-1905.json`                           | Issue #1905 metadata and body.                                               |
| `raw/hive-mind-issue-1905-comments.json`                  | Issue #1905 comments. Empty at capture time.                                 |
| `raw/hive-mind-pr-1906*.json`                             | Prepared PR #1906 metadata, comments, review comments, and reviews.          |
| `raw/external-meta-language-issue-60*.json`               | Referenced external issue #60 metadata and comments. Comments were empty.    |
| `raw/external-meta-language-pr-48*.json`                  | Referenced external PR #48 metadata, comments, review comments, and reviews. |
| `raw/external-meta-language-pr-48-usage-limit-log.txt`    | Initial solve log linked from PR #48's usage-limit comment.                  |
| `raw/external-meta-language-pr-48-solution-draft-log.txt` | Final auto-resume solve log linked from PR #48's solution-log comment.       |
| `raw/search-*.json`                                       | Authenticated GitHub code-search snapshots for related PR-link terms.        |

The screenshot image was downloaded with GitHub authentication and verified as a
PNG before visual inspection.

## Timeline

| Time (UTC)          | Event                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-10 14:10:03 | External PR #48 was created for `link-foundation/meta-language`.                                                                                                             |
| 2026-06-10 14:10:05 | The initial solve log recorded `gh pr create stdout: https://github.com/link-foundation/meta-language/pull/48` (`raw/external-meta-language-pr-48-usage-limit-log.txt:213`). |
| 2026-06-10 14:10:08 | The same log recorded `PR URL: https://github.com/link-foundation/meta-language/pull/48` (`raw/external-meta-language-pr-48-usage-limit-log.txt:218`).                       |
| 2026-06-10 14:10:09 | The same log recorded that issue #47 was linked to PR #48 (`raw/external-meta-language-pr-48-usage-limit-log.txt:226`).                                                      |
| 2026-06-10 17:04:34 | The final solve log found PR #48 from branch `issue-47-76af108c0f24` (`raw/external-meta-language-pr-48-solution-draft-log.txt:2391`-`2393`).                                |
| 2026-06-11 14:58:06 | Hive-mind issue #1905 was opened with the Telegram completion screenshot.                                                                                                    |

## Finding

The solve command had reliable PR evidence before Telegram completion:

- The initial solve run created PR #48 and logged its URL.
- The final resumed solve run found PR #48 from the branch and logged that URL.
- PR #48 itself remained open and ready for review in the external repository
  snapshot (`raw/external-meta-language-pr-48.json`).

The Telegram completion message used a different path. It formatted a final
message from the session monitor and only had a `pullRequestUrl` when
`resolvePullRequestUrlForSession` found one through the linked-issue lookup. If
that lookup returned no linked PR, or failed while GitHub metadata was lagging,
the monitor still sent a successful completion message but omitted the
`Pull request:` line. That explains the screenshot: the solve log knew the PR
URL, but the Telegram completion formatter never consulted the completed
session log.

## Fix

The session monitor now resolves PR URLs in this order for issue-driven
sessions:

1. Use the existing linked-PR lookup.
2. If no linked PR is returned, read the completed session log path from the
   start-command status payload.
3. Extract the first GitHub PR URL that belongs to the same owner and repo as
   the original issue.
4. Pass that URL into `formatSessionCompletionMessage`, which already appends a
   localized/idempotent `Pull request:` line.

This keeps the existing linked-issue behavior while adding the fallback the
issue requested: use the solve command's own log when it already knows the PR.

## Regression Test

`tests/test-issue-1688-subscribe-and-pr-link.mjs` now includes issue #1905
coverage:

- `extractPullRequestUrlFromText` extracts same-repository PR URLs and ignores
  foreign repositories.
- `monitorSessions` is exercised with a completed Codex session whose linked-PR
  lookup returns `null`, while `statusResult.logPath` contains the solve log PR
  URL.
- The test asserts that the edited Telegram completion message includes
  `Pull request: https://github.com/o/r/pull/77`.

Before the fix, the new regression failed on the missing `Pull request:` line.
After the fix, the focused test passes.
