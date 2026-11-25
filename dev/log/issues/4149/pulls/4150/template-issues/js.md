## Summary

A single transient GitHub API failure fails a job that has nothing wrong with it:

- `scripts/land-via-pull-request.mjs:204-227` (`waitForPullRequestChecks`) runs `gh pr checks <url> --required --watch --fail-fast` and retries only when the output matches `/no (required )?checks reported/i`. Any other failure, such as `HTTP 502`, a connection reset, or gh's `unexpected end of JSON input`, breaks the loop and throws `CommandFailedError`. It is reached from `push-main-with-rebase-retry.mjs:144`.
- `scripts/rerun-unacquired.mjs` calls `githubApi()` (`scripts/github-api.mjs`) without retrying. `isTransient` exists but is not used there, so one 5xx fails `rerun-unacquired.yml`.
- `scripts/check-deprecated-packages.mjs:39` makes one registry fetch per package with no retry, and line 120 turns any error into exit 1. A single 5xx or reset fails `security.yml` on a pull request. The python template's copy retries 3 times.

Found while auditing [link-assistant/hive-mind#4149](https://github.com/link-assistant/hive-mind/issues/4149). There, the `report-checks` job of two runs failed within 6 seconds of each other (14:39:22 and 14:39:28 UTC) on one `gh api` poll that printed only `unexpected end of JSON input`. GitHub had answered an HTTP error with an empty body, and gh hides the status code in that case (cli/cli#10579).

## Reproduction

```sh
node --input-type=module -e "
import { waitForPullRequestChecks } from './scripts/land-via-pull-request.mjs';
let calls = 0;
const runner = async () => (++calls === 1 ? { code: 1, stdout: '', stderr: 'unexpected end of JSON input' } : { code: 0, stdout: '', stderr: '' });
await waitForPullRequestChecks({ runner, url: 'x', delayMs: 0 }).then(r => console.log('passed', r), e => console.log('failed after', calls, 'call(s):', e.message));
"
# failed after 1 call(s): ... (the second call would have passed)
```

## Workaround

Re-run the failed job.

## Suggested fix

Retry read-only `gh`/API calls (`gh pr checks`, `gh api` GET, registry GETs) on 5xx, `429`, connection resets, timeouts and `unexpected end of JSON input`, with backoff and a small attempt limit. Never retry writes on `unexpected end of JSON input`: the status is hidden, so the write may already have happened. In `waitForPullRequestChecks`, treat those messages like "no checks reported". hive-mind's version is `classifyGitHubCommand().readOnly` plus `retryTruncatedReply` in `src/github-operation-retry.lib.mjs`, with tests in `tests/ci-false-positives-4149.test.mjs` (link-assistant/hive-mind#4150).
