# Case Study: Issue #1682 - Failure Log Upload Reported as Success With a Null Link

## Summary

Issue #1682 reported two user-facing problems in the failure-log path:

1. A Codex failure ended with `✅ Failure logs uploaded to Pull Request successfully`,
   which visually marked a failed run as successful.
2. The PR comment linked `[View complete failure log](null)`. On GitHub, that
   relative Markdown URL was displayed as a broken `.../pull/null` link.

The captured run used Hive Mind v1.56.11. `gh-upload-log` uploaded the log to the
shared public repository and printed both stable tree and raw URLs, but Hive Mind
selected `rawUrl` for a single-file repository upload even though the old parser
did not populate `rawUrl` for the new shared-repository output shape.

Issue #1678 fixed the parser in v1.56.12, but issue #1682 still exposed two missing
guards: Hive Mind should never post a `null` log link, and failure-log terminal
status should not use a green check mark.

## Captured Evidence

| File                                                                                       | Purpose                                                   |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `raw-data/issue-1682.json`                                                                 | Issue title, body, labels, timestamps, and URL            |
| `raw-data/issue-1682-comments.json`                                                        | Issue comments, empty at capture time                     |
| `raw-data/issue-1680.json`                                                                 | Original solved issue that produced PR #1681              |
| `raw-data/issue-1680-comments.json`                                                        | Original issue comments                                   |
| `raw-data/pr-1681.json`                                                                    | Linked PR metadata                                        |
| `raw-data/pr-1681-comments.json`                                                           | Linked PR conversation comments                           |
| `raw-data/pr-1681-comment-4318685883.json`                                                 | Broken failure-log comment with `(null)` link             |
| `raw-data/pr-1681-review-comments.json`                                                    | Linked PR inline comments                                 |
| `raw-data/pr-1681-reviews.json`                                                            | Linked PR reviews                                         |
| `raw-data/pr-1683.json`                                                                    | Prepared PR metadata for this fix                         |
| `raw-data/gh-upload-log-repo.json`                                                         | Related upstream repository metadata                      |
| `raw-data/gh-upload-log-pr-28.json`                                                        | Related gh-upload-log PR #28 metadata                     |
| `raw-data/gh-upload-log-pr-30.json`                                                        | Related gh-upload-log PR #30 metadata                     |
| `logs/tmp-start-command-logs-isolation-screen-b1711bff-a275-45d4-b3ce-384077c5a18f.log.gz` | Full 43.48 MB referenced execution log, gzip-compressed   |
| `logs/key-log-lines.txt`                                                                   | Tail excerpt around key log-upload and failure lines      |
| `logs/gh-upload-log-output-snippet.txt`                                                    | Focused upload-output snippet used by the regression test |
| `research-sources.json`                                                                    | Online and repository source list                         |

The full log was verified before compression by line count: 67,515 lines.

## Timeline

| Time (UTC)          | Event                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-25 09:28:27 | `solve v1.56.11` started for issue #1680 with `--tool codex --attach-logs --verbose`.                                             |
| 2026-04-25 09:30    | Draft PR #1681 was created and linked to issue #1680.                                                                             |
| 2026-04-25 09:56    | Codex emitted an error event and the solve run entered the failure-log attachment path.                                           |
| 2026-04-25 09:56    | Hive Mind detected the 46 MB log and selected `gh-upload-log`.                                                                    |
| 2026-04-25 09:56    | `gh-upload-log` uploaded to `konard/public-logs/tree/main/log-tmp-solution-draft-log-pr-1777111005509.txt` and printed a raw URL. |
| 2026-04-25 09:56    | Hive Mind posted PR comment 4318685883 with `[View complete failure log](null)`.                                                  |
| 2026-04-25 09:56    | Terminal output printed `✅ Failure logs uploaded to Pull Request successfully`, then `❌ CODEX execution failed`.                |
| 2026-04-25 10:03    | Issue #1682 was opened from the broken comment and misleading terminal status.                                                    |

## Requirements

1. Failure states must not be visually marked with `✅`.
2. Public target repositories must upload public logs.
3. Private target repositories must upload private logs.
4. A successful external log upload must resolve to a usable URL before Hive Mind
   posts a GitHub comment.
5. If no usable URL is resolved, Hive Mind must fail the log attachment and keep
   the full local log path instead of posting a broken link.
6. Preserve logs, data, timeline, root-cause analysis, and solution plans in
   `docs/case-studies/issue-1682/`.
7. Search related code, related PRs, and online sources.

## Root Cause

The immediate broken link came from this v1.56.11 behavior:

```js
const logUrl = uploadResult.chunks === 1 ? uploadResult.rawUrl : uploadResult.url;
```

For the captured `gh-upload-log` output, the old parser populated the repository
page URL from the `🔗` line but did not parse the printed `📄` raw URL. Because the
upload had one file, Hive Mind selected `uploadResult.rawUrl`, which was `null`.
The comment was still posted, so GitHub rendered the Markdown target `(null)` as a
relative link under the PR URL.

Issue #1678 already fixed the parser for current shared-repository output and made
private repository uploads prefer stable repository/tree URLs over short-lived raw
URLs. The remaining design flaw was that `attachLogToGitHub()` trusted
`uploadResult.success` without separately validating the URL that would be posted.

The misleading terminal status was independent: the failure branch logged a green
check after attaching failure logs. The log attachment may have succeeded, but the
run itself was failed, so a green success indicator next to the word "Failure" was
ambiguous.

## Solution

Implemented changes:

1. Added `selectLogUploadUrl()` in `src/github.lib.mjs`.
2. Kept public single-file repository uploads on direct raw URLs.
3. Kept private repository uploads on stable repository/tree page URLs.
4. Added a usable-URL guard before building a GitHub comment. If the selected URL
   is missing or malformed, Hive Mind now returns failure and logs the local file
   path instead of posting a broken link.
5. Changed failure-log terminal messages from green-check success wording to
   neutral attachment wording:
   - `📎 Failure log uploaded ...`
   - `📎 Failure logs attached to Pull Request`
6. Added regression coverage in `tests/test-log-upload-output-1682.mjs` and wired
   it into `npm test`.

## Regression Coverage

The focused test covers:

- The exact public shared-repository upload snippet from the captured run.
- Rejection of successful upload objects that lack a usable URL.
- Private repository uploads choosing a stable repository/tree page over a raw URL
  with an expiring token.
- Absence of green-check failure-log terminal wording.

Focused verification:

```bash
node tests/test-log-upload-output-1682.mjs
```

## Online Research

GitHub documents that pull request comments are managed through issue comment
endpoints because every pull request is also an issue. That matches Hive Mind's
use of issue-comment APIs for PR log comments.

GitHub's repository contents API documents content access and `download_url`
fields, which matches Hive Mind's fallback raw URL resolution for repository
uploads when `gh-upload-log` does not print a raw URL directly.

Sources are listed in `research-sources.json`.

## External Issues

No new upstream issue was filed. The captured failure was caused by Hive Mind's
v1.56.11 URL selection and status wording, not by `gh-upload-log` failing to upload.
Related `gh-upload-log` changes are already represented by PR #28 and PR #30.
