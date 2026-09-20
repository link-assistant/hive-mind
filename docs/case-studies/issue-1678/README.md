# Case Study: Issue #1678 - Never Post Truncated `--attach-logs` Output

## Summary

Issue #1678 reported that Hive Mind posted a truncated solution draft log even though
`--attach-logs` is expected to preserve complete logs. The concrete failure was the
web-capture PR #107 log comment:

- `docs/case-studies/issue-1678/logs/web-capture-pr-107-truncated-comment-body.md`
- `docs/case-studies/issue-1678/raw-data/web-capture-pr-107-truncated-comment-4316778290.json`

The root cause was local to Hive Mind: when a large log exceeded GitHub comment limits,
`attachLogToGitHub()` correctly selected `gh-upload-log`, but if `gh-upload-log`
failed, Hive Mind fell back to `attachTruncatedLog()` and posted a misleading
`Solution Draft Log (Truncated)` comment.

The fix removes that fallback. If full external upload fails, Hive Mind now reports
the upload failure in local logs and returns failure without posting partial log
content to GitHub.

## Captured Evidence

| File                                                                                       | Purpose                                                            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `raw-data/issue-1678.json`                                                                 | Issue title, body, labels, timestamps, and URL                     |
| `raw-data/issue-1678-comments.json`                                                        | Issue comments, empty at capture time                              |
| `raw-data/pr-1679.json`                                                                    | Prepared PR metadata and checks                                    |
| `raw-data/pr-1679-issue-comments.json`                                                     | PR conversation comments, empty at capture time                    |
| `raw-data/pr-1679-review-comments.json`                                                    | PR inline comments, empty at capture time                          |
| `raw-data/pr-1679-reviews.json`                                                            | PR reviews, empty at capture time                                  |
| `raw-data/web-capture-pr-107.json`                                                         | Related web-capture PR metadata                                    |
| `raw-data/web-capture-pr-107-truncated-comment-4316778290.json`                            | The posted truncated log comment                                   |
| `logs/web-capture-pr-107-truncated-comment-body.md`                                        | Extracted comment body                                             |
| `logs/tmp-start-command-logs-isolation-screen-78003ab5-3a5f-4cbb-81e0-05fce6a8916d.log.gz` | Full 37.51MB referenced run log, gzip-compressed                   |
| `logs/tmp-start-command-log-tail-360.txt`                                                  | Tail excerpt around the upload failure                             |
| `raw-data/gh-upload-log-pr-28.json`                                                        | Related `gh-upload-log` PR #28 metadata                            |
| `raw-data/gh-upload-log-pr-30.json`                                                        | Related `gh-upload-log` PR #30 metadata                            |
| `raw-data/gh-upload-log-0.8.0-dry-run.txt`                                                 | Current `gh-upload-log` dry-run output showing shared repositories |
| `raw-data/github-code-search-attachTruncatedLog.txt`                                       | GitHub code search results for the old fallback                    |
| `raw-data/related-hive-mind-prs-log-upload.json`                                           | Related merged Hive Mind PRs                                       |
| `research-sources.json`                                                                    | Online and repository source list                                  |

The full log download was verified before compression by line count: 65,676 lines,
39,328,210 bytes.

## Timeline

| Time (UTC)          | Event                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 2026-04-24 21:45:07 | `solve v1.56.8` started for `link-assistant/web-capture#106` with `--attach-logs --verbose`.                             |
| 2026-04-24 21:45:25 | Draft PR `link-assistant/web-capture#107` was created.                                                                   |
| 2026-04-24 22:27:56 | Hive Mind started uploading the 39MB solution draft log to PR #107.                                                      |
| 2026-04-24 22:27:56 | `attachLogToGitHub()` detected a large file and selected `gh-upload-log`.                                                |
| 2026-04-24 22:27:58 | `gh-upload-log` failed in repository mode with `Repository not found` during push.                                       |
| 2026-04-24 22:28:03 | Hive Mind fell back to a truncated GitHub comment.                                                                       |
| 2026-04-25 08:34:37 | Hive Mind issue #1678 was opened from that incident.                                                                     |
| 2026-04-25 08:35:18 | `gh-upload-log` PR #30 was merged, changing large logs to shared `public-logs` / `private-logs` repositories by default. |

## Requirements

1. Never show a truncated log for `--attach-logs`.
2. Use full logs only: inline full comments when they fit, otherwise `gh-upload-log`.
3. Upload logs as public when the target repository is public.
4. Upload logs as private when the target repository is private.
5. Support the `gh-upload-log` changes from PR #28 and PR #30.
6. Preserve logs, data, timeline, root-cause analysis, and solution plans in
   `docs/case-studies/issue-1678/`.
7. Search related code, related PRs, and online sources.

## Root Cause

`src/github.lib.mjs` contained this large-log failure path:

```js
await log('  ❌ gh-upload-log failed');
await log('  🔄 Falling back to truncated comment...');
return await attachTruncatedLog(options);
```

That behavior was originally a last-resort GitHub comment fallback, but it violates
the current `--attach-logs` contract. A partial comment is worse than a clear upload
failure because reviewers can mistake the partial content for a complete trace.

The related `gh-upload-log` failure is also important:

- PR #28 fixed repository creation failures and name collision handling.
- PR #30 changed large uploads to shared repositories by default.
- Current `gh-upload-log --dry-mode` output for the captured 37.51MB log routes to
  `public-logs/<generated-path>`, not a dedicated per-log repository.

Hive Mind needed to consume both old and new `gh-upload-log` output shapes.

## Solution

Implemented changes:

1. Removed `attachTruncatedLog()` from `src/github.lib.mjs`.
2. Changed `gh-upload-log` failure handling to return `false` without posting a
   truncated GitHub comment.
3. Kept local diagnostics pointing at the full local log path when upload fails.
4. Added `parseGhUploadLogOutput()` in `src/log-upload.lib.mjs`.
5. Parsed the newer `gh-upload-log` fields:
   - `📄 <raw URL>`
   - `File count: <n>`
   - `Repository: public-logs/private-logs`
   - `Path: <shared repository path>`
6. Avoided using short-lived private repository raw URLs in PR comments; private
   repository uploads link to the stable repository/tree URL instead.

## Regression Coverage

Added `tests/test-log-upload-output-1678.mjs` and wired it into `npm test`.

The test covers:

- `gh-upload-log` v0.8 shared repository output.
- Multi-file repository uploads via `File count`.
- Legacy dedicated repository output with `📄` raw URLs.
- Absence of the old truncated-comment fallback in `src/github.lib.mjs`.

Focused verification:

```bash
node tests/test-log-upload-output-1678.mjs
```

## Online Research

GitHub's REST gist examples expose a `raw_url` and `truncated` field for gist files.
GitHub's repository REST examples expose the `visibility` field used by Hive Mind to
decide whether uploads should be public or private. The `gh-upload-log` CLI now also
prints a warning when a private repository raw URL contains an expiring token; Hive
Mind avoids putting those short-lived private raw URLs into long-lived PR comments.

Sources are listed in `research-sources.json`.

## External Issues

No new upstream issue was filed. The observed `gh-upload-log` repository-mode failure
matches the class of problems already addressed by:

- https://github.com/link-foundation/gh-upload-log/pull/28
- https://github.com/link-foundation/gh-upload-log/pull/30

Hive Mind's remaining responsibility was to stop posting truncated fallback comments
and to parse the new `gh-upload-log` output correctly.
