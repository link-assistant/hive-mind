## Summary

`scripts/unacquired_jobs.py:91-95` defines `gh()`, which raises `RuntimeError` on any non-zero exit and never retries. `rerun()` (lines 155-182) does not catch it, for its reads or for `gh run rerun`. One transient GitHub failure (`HTTP 502`, a connection reset, or gh's `unexpected end of JSON input`) therefore fails `rerun-infrastructure-failures.yml:63`. That job exists to recover from infrastructure failures. Report mode downgrades the error to a warning (lines 136-138); rerun mode does not. The same applies to `scripts/check_release_needed.py:41-49`: `http_get` re-raises every `HTTPError` except 404, so one 5xx fails the release path.

Found while auditing [link-assistant/hive-mind#4149](https://github.com/link-assistant/hive-mind/issues/4149). There, two `report-checks` jobs failed 6 seconds apart on one `gh api` call that printed only `unexpected end of JSON input`. GitHub had answered an HTTP error with an empty body, and gh hides the status code in that case (cli/cli#10579).

## Reproduction

```sh
mkdir -p /tmp/fakegh && printf '#!/bin/sh\necho "unexpected end of JSON input" >&2\nexit 1\n' > /tmp/fakegh/gh && chmod +x /tmp/fakegh/gh
PATH=/tmp/fakegh:$PATH python3 scripts/unacquired_jobs.py rerun --repository o/r --run-id 1 --attempt 1
# Traceback ... RuntimeError: gh api --paginate: unexpected end of JSON input
```


## Workaround

Re-run the failed job, or run `gh run rerun <id> --failed` by hand.

## Suggested fix

Make `gh()` retry read-only calls (`api` GET, `run view`, `run list`) 3–5 times with exponential backoff when stderr matches 5xx, `429`, `connection reset`, `timeout` or `unexpected end of JSON input`. Retry `gh run rerun` only on 5xx or connection errors. hive-mind's version is `src/github-operation-retry.lib.mjs` (`classifyGitHubCommand().readOnly`, `retryTruncatedReply`) with tests in `tests/ci-false-positives-4149.test.mjs` (link-assistant/hive-mind#4150).
