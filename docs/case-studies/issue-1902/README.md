# Case Study: Issue #1902 - Prevent One-Off Log Repositories

## Summary

Issue #1902 reported that two log uploads created dedicated public repositories:

- `konard/log-tmp-solution-draft-log-pr-1781180521736.txt`
- `konard/log-tmp-solution-draft-log-pr-1781180537724.txt`

Both uploaded files were under Hive Mind's 25 MB file limit, so they should have
used gist uploads first through `gh-upload-log` auto mode. If gist upload fails
and `gh-upload-log` falls back to repository mode, or if a log is larger than the
gist limit, repository storage should use the shared visibility repositories:
`public-logs` for public targets and `private-logs` for private targets.

The root cause is in `gh-upload-log` auto fallback routing. In the captured run,
automatic mode first tried to create a gist. GitHub returned a secondary
content-creation rate limit for the gist API. `gh-upload-log` then fell back to
repository mode. Because the file still fit within the gist limit, upstream
shared-repository routing did not apply, so the fallback created a dedicated
`log-tmp-*` repository even though shared repository mode was enabled.

## Captured Evidence

| File                                                    | Purpose                                                   |
| ------------------------------------------------------- | --------------------------------------------------------- |
| `raw-data/issue-1902.json`                              | Issue title, body, labels, timestamps, and URL            |
| `raw-data/issue-1902-comments.json`                     | Issue comments, empty at capture time                     |
| `raw-data/pr-1909.json`                                 | Prepared PR metadata                                      |
| `raw-data/pr-1909-issue-comments.json`                  | PR conversation comments, empty at capture time           |
| `raw-data/pr-1909-review-comments.json`                 | PR inline comments, empty at capture time                 |
| `raw-data/pr-1909-reviews.json`                         | PR reviews, empty at capture time                         |
| `raw-data/linked-repo-1781180521736.json`               | First linked one-off repository metadata                  |
| `raw-data/linked-repo-1781180521736-contents.json`      | First linked repository file metadata                     |
| `raw-data/linked-repo-1781180521736-commits.json`       | First linked repository initial commit                    |
| `raw-data/linked-repo-1781180537724.json`               | Second linked one-off repository metadata                 |
| `raw-data/linked-repo-1781180537724-contents.json`      | Second linked repository file metadata                    |
| `raw-data/linked-repo-1781180537724-commits.json`       | Second linked repository initial commit                   |
| `raw-data/gh-upload-log-README.md`                      | Upstream `gh-upload-log` documentation snapshot           |
| `raw-data/gh-upload-log-cli.js`                         | Upstream CLI argument handling snapshot                   |
| `raw-data/gh-upload-log-index.js`                       | Upstream upload-strategy and fallback snapshot            |
| `raw-data/gh-upload-log-repository-upload.js`           | Upstream shared-vs-dedicated repository logic snapshot    |
| `raw-data/gh-upload-log-pr-28.json`                     | Related upstream collision-handling PR metadata           |
| `raw-data/gh-upload-log-pr-30.json`                     | Related upstream shared-repository PR metadata            |
| `raw-data/gh-upload-log-issue-31.json`                  | Filed upstream fallback-routing issue metadata            |
| `raw-data/gh-upload-log-issue-31-comments.json`         | Filed upstream fallback-routing issue comments            |
| `raw-data/gh-upload-log-npm-metadata.json`              | Current npm package metadata for `gh-upload-log`          |
| `logs/tmp-solution-draft-log-pr-1781180521736.txt.gz`   | Full 20,632,466 byte linked log, compressed               |
| `logs/tmp-solution-draft-log-pr-1781180537724.txt.gz`   | Full 20,653,037 byte linked log, compressed               |
| `logs/gist-upload-evidence-1781180008338.txt`           | Earlier successful gist upload from the same run          |
| `logs/dedicated-repo-upload-evidence-1781180521736.txt` | Gist rate-limit failure and dedicated-repository fallback |
| `logs/linked-repo-summary-1781180521736.json`           | Concise first linked repository summary                   |
| `logs/linked-repo-summary-1781180537724.json`           | Concise second linked repository summary                  |
| `logs/run-version-evidence.txt`                         | Focused run/version/upload command evidence               |
| `research-sources.json`                                 | Online and repository source list                         |
| `upstream-gh-upload-log-issue.md`                       | Body used to file the upstream fallback-routing issue     |

The full downloaded logs were verified before compression:

- `tmp-solution-draft-log-pr-1781180521736.txt`: 73,484 lines, 20,632,466 bytes.
- `tmp-solution-draft-log-pr-1781180537724.txt`: 73,790 lines, 20,653,037 bytes.

## Timeline

| Time (UTC)                      | Event                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 2026-06-11 12:13:29             | Hive Mind uploaded a 9.26 MB solution draft log through `gh-upload-log` automatic mode. The gist upload succeeded.    |
| 2026-06-11 12:13:35             | Hive Mind posted the gist-backed log comment to `lefinepro/kefine#173`.                                               |
| 2026-06-11 12:13:56 to 12:21:59 | GitHub repeatedly returned secondary content-creation rate limits while the process tried to create comments.         |
| 2026-06-11 12:22:03             | Hive Mind invoked `gh-upload-log` automatic mode for `/tmp/solution-draft-log-pr-1781180521736.txt`, a 19.68 MB file. |
| 2026-06-11 12:22:05             | Gist creation failed with a GitHub secondary rate limit, and `gh-upload-log` fell back to repository mode.            |
| 2026-06-11 12:22:06             | The first one-off public repository was created: `log-tmp-solution-draft-log-pr-1781180521736.txt`.                   |
| 2026-06-11 12:22:21             | The second linked repository initial commit was created.                                                              |
| 2026-06-11 12:22:22             | The second one-off public repository was created: `log-tmp-solution-draft-log-pr-1781180537724.txt`.                  |
| 2026-06-11 14:16:43             | Issue #1902 was opened to report the unexpected one-off repositories.                                                 |

## Requirements

1. Default Hive Mind log uploads must not create a separate repository per log.
2. Hive Mind should keep using `gh-upload-log` auto mode.
3. Logs that fit the GitHub file limit should attempt gist uploads first.
4. If gist upload fails and repository fallback is used, the fallback should use
   shared `public-logs` or `private-logs` repositories.
5. Repository-per-log behavior should only happen when explicitly requested with
   `gh-upload-log` options such as `--no-shared-repository`.
6. Report the fallback-routing bug upstream with a reproduction, workarounds, and
   a suggested code fix.
7. The fix needs a regression test that would have failed for the captured path.
8. Preserve logs, metadata, timeline, root-cause analysis, and solution notes in
   `docs/case-studies/issue-1902/`.

## Root Cause

Hive Mind called `gh-upload-log` in automatic mode:

```text
gh-upload-log "/tmp/solution-draft-log-pr-1781180521736.txt" --public --description "..." --verbose
```

That is the correct high-level integration point: auto mode should select gist
when possible and repository storage when needed. In the captured run,
`gh-upload-log` chose gist mode for the 19.68 MB file because it was under the
25 MB gist limit. When GitHub rejected gist creation with a secondary rate limit,
upstream automatic mode fell back to repository mode.

The fallback still had `useSharedRepository: true`, but upstream shared-repository
routing only applies when the file is larger than the gist limit:

```js
return useSharedRepository && getFileSize(filePath) > GITHUB_GIST_FILE_LIMIT;
```

For a 19.68 MB file, that returned `false`, so repository fallback used the legacy
dedicated repository path and created `log-tmp-solution-draft-log-pr-1781180521736.txt`.
The second linked repository has the same shape: a single public repository with one
20.65 MB log file and an initial `Add log file` commit.

The bug was therefore not that auto mode exists, and not that shared repositories
were unavailable. The bug is that `gh-upload-log` repository fallback only uses
shared repositories when the original file is larger than the gist limit. Once
auto mode has already fallen back into repository upload, repository routing
should depend on `useSharedRepository`, not on the original gist-size decision.

## Solution

Implemented changes:

1. Filed upstream issue
   [link-foundation/gh-upload-log#31](https://github.com/link-foundation/gh-upload-log/issues/31)
   with the reproduction, workarounds, and suggested routing fix.
2. Added `buildGhUploadLogArgs()` so tests can assert the exact CLI arguments used
   by the wrapper.
3. Changed `uploadLogWithGhUploadLog()` to default to `--auto --shared-repository`
   instead of forcing `--only-gist` or `--only-repository`.
4. Changed `attachLogToGitHub()` to pass `mode: 'auto'` and
   `useSharedRepository: true`.
5. Kept the legacy dedicated repository path available only when a caller
   explicitly passes `useSharedRepository: false`, which builds
   `--no-shared-repository`.

With this fix, Hive Mind preserves `gh-upload-log` auto behavior and explicitly
requests shared repository fallback. The remaining fallback bug for sub-25 MB
gist failures is tracked upstream in
[link-foundation/gh-upload-log#31](https://github.com/link-foundation/gh-upload-log/issues/31).

## Regression Coverage

Added `tests/test-issue-1902-log-upload-routing.mjs`.

The test covers:

- Default wrapper arguments keep auto mode enabled.
- Default wrapper arguments include `--shared-repository`.
- Default wrapper arguments do not include `--only-gist`,
  `--only-repository`, or `--no-shared-repository`.
- Dedicated repository behavior requires explicit `useSharedRepository: false`,
  which builds `--no-shared-repository`.

Focused verification:

```bash
node tests/test-issue-1902-log-upload-routing.mjs
```

## Online Research

GitHub documents secondary REST API limits and recommends pausing when a secondary
limit is returned. The captured failure is consistent with those docs: GitHub
returned HTTP 403 secondary-rate-limit responses for content creation around the
same time as the gist upload failed.

GitHub's file attachment and repository large-file documentation confirm the 25 MB
boundary used by Hive Mind's `githubLimits.fileMaxSize`. The upstream `gh-upload-log`
README and implementation confirm that gist is the intended path under that limit,
and shared repositories are the intended path for repository-mode large logs.

Sources are listed in `research-sources.json`.

## External Issues

Filed upstream issue
[link-foundation/gh-upload-log#31](https://github.com/link-foundation/gh-upload-log/issues/31).
The issue includes the captured reproduction, the `shouldUseSharedRepositoryMode()`
root cause, caller workarounds, and a suggested code-level fix: repository routing
should use shared repositories whenever `useSharedRepository` is true, including
auto-mode fallback after a gist failure below the gist limit.
