# Case Study: Issue #1756 — `504 Gateway Timeout (https://api.github.com/graphql)` aborts auto-PR creation

- Issue: https://github.com/link-assistant/hive-mind/issues/1756
- PR: https://github.com/link-assistant/hive-mind/pull/1757
- Date: 2026-05-05
- Related prior fixes: [#1536](https://github.com/link-assistant/hive-mind/issues/1536) (added `ghRetry`/`ghCmdRetry` for transient network errors), [#1726](https://github.com/link-assistant/hive-mind/issues/1726) (added rate-limit-safe wrappers + ESLint guard)

## Summary

`solve` aborted with a fatal error when GitHub's GraphQL endpoint returned `HTTP 504`
during the auto-PR creation step. The user was running:

```
solve https://github.com/xlabtg/teleton-agent/issues/477 --tool claude --attach-logs --verbose --no-tool-check
```

After ~30 minutes of fork setup, branch creation, the initial commit and a successful
push, `gh pr create` failed once with:

```
error checking for existing pull request: HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)
```

The whole solver session terminated with exit code `13`. There was no retry; one
504 from the GraphQL fronted of `gh pr create` was enough to throw away all the
work above.

The full log is stored at
[`data/c30f7f87-ff3c-4821-ace3-53cb96f93d35.log`](data/c30f7f87-ff3c-4821-ace3-53cb96f93d35.log).
The `gh pr create` failure surfaces at lines 345–351:

```
Command: cd ".../gh-issue-solver-1777998609107" && gh pr create --draft \
  --title "$(cat '/tmp/pr-title-1777998623516.txt')" \
  --body-file "/tmp/pr-body-1777998623515.md" \
  --base main --head konard:issue-477-92dc3d8d2d09 --repo xlabtg/teleton-agent

❌ FATAL ERROR: PR creation failed
   PR creation failed: Command failed: ...
   error checking for existing pull request:
   HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)
```

## Timeline (from data log)

| Time (UTC)             | Event                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| 2026-05-05 16:29:48.10 | `solve` launched in detached screen session.                                                       |
| 2026-05-05 ~16:30:00   | Fork detection completes; clone of `konard/xlabtg-teleton-agent` succeeds.                         |
| 2026-05-05 ~16:30:30   | Default branch synced; new branch `issue-477-92dc3d8d2d09` created from `main`.                    |
| 2026-05-05 ~16:31:00   | `Initial commit with task details` created and pushed to fork.                                     |
| 2026-05-05 ~16:31:30   | Compare API confirms branch is 1 commit ahead of `main`; auto-PR pipeline begins.                  |
| 2026-05-05 ~16:32:00   | `gh pr create --draft ...` invoked.                                                                |
| 2026-05-05 ~16:32:?    | `gh pr create` fails: `HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)`.            |
| 2026-05-05 17:04:28.16 | `solve` exits with code 13 after the interactive "Would you like to create a GitHub issue" prompt. |

## Requirements (from the issue)

The issue lists four explicit requirements:

1. Make sure all places in the codebase with access to GitHub are covered with a retry mechanism.
2. Double-check that 504 and other typical retryable errors are automatically retried.
3. Download all logs and data related to the issue and compile them under `docs/case-studies/issue-{id}` for deep case-study analysis (timeline, root causes, requirements, solutions).
4. If there isn't enough data to find the actual root cause, add debug output and a verbose mode to surface it next iteration. Where the issue is in another project, file a reproducible report there.

## Root cause

`gh pr create` itself is not the bug. GitHub's GraphQL frontend periodically returns
`5xx` (status pages and post-mortems show this happens repeatedly under load,
including 502/503/504). The bug is on our side: the **specific code path that calls
`gh pr create` in `src/solve.auto-pr.lib.mjs` does not go through any retry wrapper.**

Concretely, two `execAsync` invocations were the unprotected sites:

```js
// src/solve.auto-pr.lib.mjs
const { exec } = await import('child_process');
const { promisify } = await import('util');
const execAsync = promisify(exec);
...
const result = await execAsync(command, { encoding: 'utf8', cwd: tempDir, env: process.env });
                                                                                       // ^ #1 — primary attempt
...
const retryResult = await execAsync(command, { encoding: 'utf8', cwd: tempDir, env: process.env });
                                                                                       // ^ #2 — retry-without-assignee
```

The project already has rate-limit-safe wrappers (issue #1726 — `execGhWithRetry`,
`ghWithRateLimitRetry`, `wrapDollarWithGhRetry`) and transient-network retry helpers
(issue #1536 — `ghRetry`, `ghCmdRetry`). However:

- `execGhWithRetry` only retried on **rate-limit** errors. Pure transient 5xx like
  `504 Gateway Timeout` were rethrown immediately after the first failure.
- The ESLint rule `gh-rate-limit/no-direct-gh-exec` is silenced when a file imports
  any of the safe wrappers (it does file-level scope, not call-site scope). The
  `solve.auto-pr.lib.mjs` file _does_ import `wrapDollarWithGhRetry` (with an
  underscore prefix as a "marker") for the `$gh ...` calls, so the rule does not
  flag the direct `execAsync(command)` call on lines 1140 and 1168 even though
  that call still has zero retry coverage.

So the fix has two parts:

1. **Make `execGhWithRetry` retry on transient network errors too** (504/502/503,
   `socket hang up`, `unexpected EOF`, etc.) on top of its existing rate-limit retry,
   matching the behaviour of `ghRetry`/`ghCmdRetry`. After this, **every** call site
   that opts into the wrapper inherits both kinds of retry automatically.
2. **Replace the direct `execAsync(command)` calls in `solve.auto-pr.lib.mjs`
   with `execGhWithRetry`**, so the `gh pr create` step actually uses the wrapper.

After (1), `execGhWithRetry` becomes the single drop-in replacement for the
`promisify(exec)`-style `gh ...` invocations across the codebase. The wrapper
catches the 504 produced by `error checking for existing pull request: HTTP 504:
504 Gateway Timeout (https://api.github.com/graphql)`, sleeps with exponential
backoff, and retries.

## External factors (data we found online)

GitHub's REST and GraphQL fronts return 5xx (502/503/504) at low frequency by
design — the documented status page (https://www.githubstatus.com/) regularly
shows brief incidents for `api.github.com` and `webhook.githubapp.com`. Their
own client libraries (`octokit/request.js`, `gh` CLI internals) implement
retry-with-backoff for these error classes. The error string we observed
(`HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)`) is the
literal message `gh` prints when its GraphQL request times out at GitHub's
edge — i.e., the request never reached the application layer.

This is the same class of failure as transient network errors (TCP reset, TLS
handshake timeout). The existing `isTransientNetworkError` helper in
`src/lib.mjs` already lists `'http 504'`, `'gateway timeout'`, etc. — we
just weren't running the failing call through it.

## Fix

### 1. `src/github-rate-limit.lib.mjs#execGhWithRetry` — add transient network retry

`execGhWithRetry` already calls `ghWithRateLimitRetry`. We layer transient retry on
top:

- Recognise transient errors via the existing `isTransientNetworkError` helper.
- On a transient failure (and not the last attempt), wait with exponential backoff
  (`delay * backoff^attempt`) and retry. Defaults match `ghCmdRetry`: `maxAttempts=3`,
  `delay=1000`, `backoff=2`.
- Rate-limit retries still run as before (separate retry budget — they sleep
  until reset + buffer + jitter).

### 2. `src/solve.auto-pr.lib.mjs` — route `gh pr create` through `execGhWithRetry`

Replaces `await execAsync(command, …)` (twice) with
`await execGhWithRetry(command, { execOptions: { encoding: 'utf8', cwd: tempDir, env: process.env }, label: 'gh pr create' })`.
The collaborator-check call on line 913 is already inside a `catch`-and-skip
block, but we route it through the wrapper too for consistency.

### 3. Tests — `tests/test-execgh-transient-retry-1756.mjs`

Unit tests covering:

- `execGhWithRetry` retries on `HTTP 504` / `502` / `503` / `socket hang up`.
- `execGhWithRetry` does **not** retry on non-transient errors (404, 403 not
  rate-limit, plain `Error`).
- The retry counter respects `maxAttempts`.
- A real reproduction of the issue's exact error message
  (`error checking for existing pull request: HTTP 504: 504 Gateway Timeout
(https://api.github.com/graphql)`) is detected as transient and retried.

## Alternatives considered

- **Switch to `octokit/request.js` retry plugin.** Would pull in a runtime
  dependency and force a much larger refactor (we'd no longer be calling `gh`).
  Not justified for a fix to one error class that the existing helper already
  knows how to recognise.
- **Move every direct `execAsync(\`gh …\`)`to`ghCmdRetry`.** `ghCmdRetry`
  uses command-stream `$`, not `child_process.exec`. The `solve.auto-pr.lib.mjs`
  call site needs the exact `cwd`/`env`/`encoding` options that `execAsync`
  takes, so `execGhWithRetry` is the appropriate wrapper.
- **Tighten the ESLint rule to fire per-call instead of per-file.** Considered
  for a follow-up; the call-site escape used by `solve.auto-pr.lib.mjs` is the
  literal pattern `const execAsync = promisify(exec); execAsync(`gh …`)`, which
  the rule's identifier-based detection misses. Tracked as a follow-up so we
  catch the next time someone re-imports `child_process.exec` locally.

## Reproducing the bug

The original failure required GitHub to actually return 504 for `gh pr create`.
We can deterministically simulate it with a fake `exec` injected into
`execGhWithRetry`. The new test file does exactly that — it asserts that the
504 error string from this very issue's log retries the underlying call.

## Verification

- `node tests/test-execgh-transient-retry-1756.mjs` passes 100%.
- The existing `tests/test-gh-retry-1536.mjs` and
  `tests/github-rate-limit.test.mjs` suites still pass — the change is additive.
- The repo lints clean with `npm run lint` (no new direct exec sites).

## Cross-project follow-ups

The 504 originated at GitHub's GraphQL edge. There is nothing for us to file
upstream — `gh` already surfaces the error verbatim, and GitHub publishes 5xx
behaviour as expected on https://www.githubstatus.com/. Our fix is to retry
on our side, which is what every official client recommends.
