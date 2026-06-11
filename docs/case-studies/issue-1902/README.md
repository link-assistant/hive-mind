# Case Study: Issue #1902 - Prevent One-Off Log Repositories

## Summary

Issue #1902 reported that two log uploads created dedicated public repositories:

- `konard/log-tmp-solution-draft-log-pr-1781180521736.txt`
- `konard/log-tmp-solution-draft-log-pr-1781180537724.txt`

Both uploaded files were under Hive Mind's 25 MB file limit, so they should have
used gist uploads. If a log is larger than that limit, it should use the shared
visibility repositories provided by `gh-upload-log`: `public-logs` for public
targets and `private-logs` for private targets.

The root cause was that Hive Mind invoked `gh-upload-log` in automatic mode. In
the captured run, automatic mode first tried to create a gist. GitHub returned a
secondary content-creation rate limit for the gist API. `gh-upload-log` then fell
back to repository mode. Because the file still fit within the gist limit, upstream
shared-repository routing did not apply, so the fallback created a dedicated
`log-tmp-*` repository.

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
| `logs/tmp-solution-draft-log-pr-1781180521736.txt.gz`   | Full 20,632,466 byte linked log, compressed               |
| `logs/tmp-solution-draft-log-pr-1781180537724.txt.gz`   | Full 20,653,037 byte linked log, compressed               |
| `logs/gist-upload-evidence-1781180008338.txt`           | Earlier successful gist upload from the same run          |
| `logs/dedicated-repo-upload-evidence-1781180521736.txt` | Gist rate-limit failure and dedicated-repository fallback |
| `logs/linked-repo-summary-1781180521736.json`           | Concise first linked repository summary                   |
| `logs/linked-repo-summary-1781180537724.json`           | Concise second linked repository summary                  |
| `logs/run-version-evidence.txt`                         | Focused run/version/upload command evidence               |
| `research-sources.json`                                 | Online and repository source list                         |

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
2. Logs that fit the GitHub file limit should use gist uploads.
3. Logs that exceed the GitHub file limit should use shared `public-logs` or
   `private-logs` repositories.
4. The fix needs a regression test that would have failed for the captured path.
5. Preserve logs, metadata, timeline, root-cause analysis, and solution notes in
   `docs/case-studies/issue-1902/`.

## Root Cause

Hive Mind called `gh-upload-log` without a concrete upload mode:

```text
gh-upload-log "/tmp/solution-draft-log-pr-1781180521736.txt" --public --description "..." --verbose
```

That selected upstream automatic mode. In automatic mode, `gh-upload-log` chose
gist mode for the 19.68 MB file because it was under the 25 MB gist limit. When
GitHub rejected gist creation with a secondary rate limit, upstream automatic mode
fell back to repository mode.

The fallback still had `useSharedRepository: true`, but upstream shared-repository
routing only applies when the file is larger than the gist limit:

```js
return useSharedRepository && getFileSize(filePath) > GITHUB_GIST_FILE_LIMIT;
```

For a 19.68 MB file, that returned `false`, so repository fallback used the legacy
dedicated repository path and created `log-tmp-solution-draft-log-pr-1781180521736.txt`.
The second linked repository has the same shape: a single public repository with one
20.65 MB log file and an initial `Add log file` commit.

The bug was therefore not that shared repositories were unavailable. The bug was
that Hive Mind delegated the mode decision and fallback policy to `gh-upload-log`
instead of making the Hive Mind contract explicit.

## Solution

Implemented changes:

1. Added `selectGhUploadLogMode()` in `src/log-upload.lib.mjs`.
2. Added `buildGhUploadLogArgs()` so tests can assert the exact CLI arguments used
   by the wrapper.
3. Changed `uploadLogWithGhUploadLog()` to default from the actual file size:
   - `--only-gist` when the log size is at or below the configured file limit.
   - `--only-repository --shared-repository` when the log size exceeds that limit.
4. Changed `attachLogToGitHub()` to pass the same explicit mode based on
   `githubLimits.fileMaxSize`.
5. Kept repository mode pointed at shared repositories by passing
   `useSharedRepository: true`.

With this fix, a small log that hits a gist secondary rate limit fails the external
upload cleanly instead of falling back into a dedicated repository. Large logs still
use repository storage, but only with the shared visibility repository flag.

## Regression Coverage

Added `tests/test-issue-1902-log-upload-routing.mjs`.

The test covers:

- The exact captured size range: 20,632,466 bytes selects gist mode.
- Gist-mode arguments include `--only-gist`.
- Gist-mode arguments do not include repository flags.
- Files over 25 MB select repository mode.
- Repository-mode arguments include `--only-repository --shared-repository`.
- Repository-mode arguments do not include `--no-shared-repository`.

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

No upstream issue was filed. The upstream behavior is internally consistent: auto
mode may fall back from gist to repository, and shared repository mode is only used
for files above the upstream gist limit. Hive Mind needed to stop using auto mode
for its stricter log-upload contract.
