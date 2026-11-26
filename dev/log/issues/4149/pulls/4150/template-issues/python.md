## Summary

`scripts/check_zizmor_compatibility.py:28-33` reads upstream metadata with `subprocess.run(["gh", "api", endpoint], ..., check=True)` and does not retry. It runs on pull requests (`workflows.yml:108`), so one transient GitHub failure (`HTTP 502`, a connection reset, or gh's `unexpected end of JSON input`) fails the Workflows check for a change that broke nothing. Related: `scripts/version_and_commit.py:149-164` runs `gh workflow run release.yml …` once, with no retry, and returns 1 on any failure (lines 605-607).

Found while auditing [link-assistant/hive-mind#4149](https://github.com/link-assistant/hive-mind/issues/4149). There, two `report-checks` jobs failed 6 seconds apart on one `gh api` call that printed only `unexpected end of JSON input`. GitHub had answered an HTTP error with an empty body, and gh hides the status code in that case (cli/cli#10579).

## Reproduction

```sh
mkdir -p /tmp/fakegh && printf '#!/bin/sh\necho "unexpected end of JSON input" >&2\nexit 1\n' > /tmp/fakegh/gh && chmod +x /tmp/fakegh/gh
PATH=/tmp/fakegh:$PATH python3 -c "import sys; sys.path.insert(0, 'scripts'); import check_zizmor_compatibility as c; c.gh_json('repos/zizmorcore/zizmor/releases/latest')"
# subprocess.CalledProcessError: ... returned non-zero exit status 1 (first attempt, no retry)
```

## Workaround

Re-run the failed job.

## Suggested fix

Wrap read-only `gh api` calls in a retry (3–5 attempts with exponential backoff) when stderr matches 5xx, `429`, `connection reset`, `timeout` or `unexpected end of JSON input`. Retry the `gh workflow run` dispatch only on 5xx or connection errors, not on `unexpected end of JSON input`: the status is hidden, so the dispatch may already have happened. hive-mind's version is `src/github-operation-retry.lib.mjs` (`classifyGitHubCommand().readOnly`, `retryTruncatedReply`) with tests in `tests/ci-false-positives-4149.test.mjs` (link-assistant/hive-mind#4150).
