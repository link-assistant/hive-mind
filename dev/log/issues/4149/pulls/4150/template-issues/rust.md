## Summary

`scripts/unacquired-jobs.py:42-47` defines `gh()`, which raises `RuntimeError` on any non-zero exit and never retries. `command_rerun` (lines 126-152) does not catch it, both for its reads (`fetch_unacquired`, `is_newest_run`) and for `gh run rerun`. One transient GitHub failure (`HTTP 502`, a connection reset, or gh's `unexpected end of JSON input`) therefore fails `rerun-infrastructure-failures.yml:69`. That job exists to recover from infrastructure failures. List mode catches the error (lines 116-120); rerun mode does not.

Found while auditing [link-assistant/hive-mind#4149](https://github.com/link-assistant/hive-mind/issues/4149). There, two `report-checks` jobs failed 6 seconds apart on one `gh api` call that printed only `unexpected end of JSON input`. GitHub had answered an HTTP error with an empty body, and gh hides the status code in that case (cli/cli#10579).

## Reproduction

```sh
mkdir -p /tmp/fakegh && printf '#!/bin/sh\necho "unexpected end of JSON input" >&2\nexit 1\n' > /tmp/fakegh/gh && chmod +x /tmp/fakegh/gh
GH_BIN=/tmp/fakegh/gh python3 scripts/unacquired-jobs.py rerun --repository o/r --run-id 1 --attempt 1
# Traceback ... RuntimeError: gh api --paginate failed: unexpected end of JSON input
```


## Workaround

Re-run the failed job, or run `gh run rerun <id> --failed` by hand.

## Suggested fix

Make `gh()` retry read-only calls (`api` GET, `run view`, `run list`) 3–5 times with exponential backoff when stderr matches 5xx, `429`, `connection reset`, `timeout` or `unexpected end of JSON input`. Retry `gh run rerun` only on 5xx or connection errors. hive-mind's version is `src/github-operation-retry.lib.mjs` (`classifyGitHubCommand().readOnly`, `retryTruncatedReply`) with tests in `tests/ci-false-positives-4149.test.mjs` (link-assistant/hive-mind#4150).
