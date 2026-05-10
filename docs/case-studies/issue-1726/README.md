# Case Study: Issue #1726 — Fully safeguard from GitHub API limit errors

- Issue: https://github.com/link-assistant/hive-mind/issues/1726
- PR: https://github.com/link-assistant/hive-mind/pull/1727
- Date: 2026-04-29
- Related prior fixes: [#1722](https://github.com/link-assistant/hive-mind/issues/1722) (silenced exec error), [#1236](https://github.com/link-assistant/hive-mind/issues/1236) (introduced `limitReset.bufferMs` + `jitterMs`)

## Summary

The `/merge` command merged a draft PR even though `gh api` calls had been failing with `HTTP 403: API rate limit exceeded`. The merge subsystem caught those errors silently and reported "no CI checks and repo has no active workflows — no CI/CD configured", which `/merge` interpreted as "all clear".

The verbose log shows the failure mode unambiguously
(`docs/case-studies/issue-1726/data/a4dccea2-a941-4a0c-a50e-60b1ed454e1e.log`,
lines 40251–40269):

```
[VERBOSE] /merge: Error fetching workflows for link-foundation/relative-meta-logic:
  Command failed: gh api "repos/link-foundation/relative-meta-logic/actions/workflows" --paginate --slurp
gh: API rate limit exceeded for user ID 1431904 ... (HTTP 403)

[VERBOSE] /merge: PR #100 has no CI checks and repo has no active workflows - no CI/CD configured
```

The same log shows ~9,000 occurrences of `rate` across the trace, with multiple buckets exhausted in parallel (REST + GraphQL).

## Root cause

Two bugs combined:

1. **`getActiveRepoWorkflows()` swallowed exceptions** in `src/github-merge.lib.mjs` and returned an empty list. Rate-limit responses (and any other error class) became "this repo has no workflows", which the merge gate treated as "no CI configured, safe to merge".
2. **None of the gh API call sites had rate-limit retry**. The existing `ghCmdRetry`/`ghRetry` helpers only recognised transient TCP/TLS faults, so a 403 fell straight through. There were ~135 raw `$gh ...` and `exec(\`gh ...\`)`call sites scattered across`src/solve._`, `src/github-merge._`, scripts, and reviewers.

Independently, the GitHub-API queue throttled at 75% of the rate-limit window. Per the issue, this was too aggressive — the throttle should kick in at 50% so the queue absorbs more headroom before requests start blocking.

## Requirements (from the issue)

The issue lists:

1. Every gh API operation must be rate-limit safe and retried at `(reset + 10 min + random(0–5 min))`.
2. Don't fail on rate-limit errors — retry. Do fail immediately on non-rate-limit errors (the bug above showed errors thrown but the process exiting 0).
3. Lower the GitHub API queue threshold from 75% to 50% of the rate-limit budget.
4. Add a custom ESLint rule that flags any unsafe gh exec call site.
5. Cover all gh-API entrypoints (`/solve`, `/merge`, reviewers, scripts).
6. Download the failing run logs and produce this case study.

## Fix

### 1. Rate-limit-safe wrappers — `src/github-rate-limit.lib.mjs`

New module exporting:

| Export                    | Purpose                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isRateLimitError`        | Match primary, secondary ("abuse-detection"), and `was submitted too quickly` patterns from message/stderr/cause chain.                                                    |
| `parseRateLimitReset`     | Read `X-RateLimit-Reset` (Unix epoch) or `Retry-After` (seconds) from the error text.                                                                                      |
| `fetchNextRateLimitReset` | Fall back to `gh api rate_limit` when no header is present; pick the soonest exhausted bucket.                                                                             |
| `computeRateLimitWait`    | Apply the issue's policy: `(reset − now) + bufferMs + random(0..jitterMs)`. Reuses `limitReset.bufferMs` (10 min) and `limitReset.jitterMs` (5 min) from `config.lib.mjs`. |
| `ghWithRateLimitRetry`    | Wrap an arbitrary `() => Promise<T>`; sleep+retry on rate-limit errors, propagate everything else.                                                                         |
| `execGhWithRetry`         | Drop-in for `child_process.exec(\`gh ...\`)` strings.                                                                                                                      |
| `wrapDollarWithGhRetry`   | Wrap a command-stream `$` tagged template; only `gh ...` calls are retried, other commands pass through.                                                                   |

The module sleeps with a periodic countdown (`⏳ Rate-limit wait: N min remaining...`) so long pauses are visible in logs.

### 2. Propagate errors instead of swallowing them

`getActiveRepoWorkflows()` no longer wraps the gh call in a `try/catch` that returns `[]`. Errors now bubble up; the merge gate sees the failure and stops instead of merging.

### 3. Layered retry in legacy helpers — `src/lib.mjs`

`ghRetry` and `ghCmdRetry` now check `isRateLimitError` first and delegate to `ghWithRateLimitRetry` before applying their existing transient-network retry. This preserves backwards compatibility while making every call through these helpers rate-limit-aware.

### 4. Local `exec` shim in the merge subsystem

In each merge file (`src/github-merge.lib.mjs`, `src/github-merge-repo-actions.lib.mjs`, `src/github-merge-ci.lib.mjs`, `src/github-merge-ci-signals.lib.mjs`, `src/github-merge-ready-sync.lib.mjs`, `src/telegram-accept-invitations.lib.mjs`, `src/solve.accept-invite.lib.mjs`), the local `exec` is rebound through `ghWithRateLimitRetry`. This converts every existing `exec(\`gh ...\`)` call site without per-call edits.

### 5. Wrapped `$` at every entry point

In each top-level file that takes `$` from `command-stream` (15 files including `src/solve.mjs`, `src/review.mjs`, `src/protect-branch.mjs`, `src/reviewers-hive.mjs`, all `src/solve.auto-*` and `src/solve.*` libs that own a `$`), the destructure was migrated:

```js
const { $: __rawDollar$ } = await use('command-stream');
const { wrapDollarWithGhRetry } = await import('./github-rate-limit.lib.mjs');
const $ = wrapDollarWithGhRetry(__rawDollar$);
```

Files that receive `$` as a parameter from a wrapped caller declare rate-limit awareness with a marker import (`import { wrapDollarWithGhRetry as _wrapDollarWithGhRetry }`).

### 6. Queue threshold lowered to 50% — `src/queue-config.lib.mjs`

Two `0.75` thresholds in `QUEUE_CONFIG` were changed to `0.5`; the docstring updated to match. Tests in `tests/queue-config.test.mjs` and `tests/limits-display.test.mjs` updated to match.

### 7. ESLint rule — `eslint-rules/no-direct-gh-exec.mjs`

The rule visits `CallExpression` and `TaggedTemplateExpression` nodes whose callee is one of `exec`, `execAsync`, `execSync`, `execRaw`, `$`, and whose first arg or template literal starts with `gh `. Files that import any of `ghWithRateLimitRetry`, `execGhWithRetry`, `ghRetry`, `ghCmdRetry`, or `wrapDollarWithGhRetry` are exempt at file scope — the rebinding _is_ the safety belt.

The rule recognises:

- Plain ESM imports (`import { ghWithRateLimitRetry } from '...'`).
- Renamed imports (`import { wrapDollarWithGhRetry as _x }`) — the source name still matches.
- `await import('...')` and `require('...')` destructures.

Wired into `eslint.config.mjs` as `gh-rate-limit/no-direct-gh-exec: 'error'`.

## Tests

- `tests/github-rate-limit.test.mjs` — 22 unit tests covering:
  - `isRateLimitError` across primary, secondary, abuse-detection, stderr, and cause-chain shapes.
  - `parseRateLimitReset` for `X-RateLimit-Reset`, `Retry-After`, and missing-header cases.
  - `computeRateLimitWait` policy: future reset, null reset (buffer + jitter only), past reset clamps baseline to 0, jitter is bounded.
  - `ghWithRateLimitRetry` succeeds on the happy path, propagates non-rate-limit errors immediately, retries rate-limit errors, gives up after `maxAttempts`.
  - `wrapDollarWithGhRetry` passes non-gh through, retries gh on rate limit, propagates other errors.

- `tests/test-no-direct-gh-exec-rule.mjs` — RuleTester valid/invalid cases for the ESLint rule.

- `tests/queue-config.test.mjs` and `tests/limits-display.test.mjs` — updated for the 50% threshold; all green.

## Verification

```
$ node tests/github-rate-limit.test.mjs
📊 22 passed, 0 failed

$ node tests/test-no-direct-gh-exec-rule.mjs
✅ no-direct-gh-exec rule tests passed

$ node tests/queue-config.test.mjs
Tests passed: 25 / 25

$ node tests/limits-display.test.mjs
Tests passed: 53 / 53

$ npx eslint . | grep gh-rate-limit/no-direct-gh-exec
(no matches — every gh exec call site in the codebase is now wrapped or marker-imported)
```

## Sources

- Failing run logs: [`data/a4dccea2-a941-4a0c-a50e-60b1ed454e1e.log`](data/a4dccea2-a941-4a0c-a50e-60b1ed454e1e.log) and [`data/d0611f43-b89e-4ed3-82ce-624187327b9e.log`](data/d0611f43-b89e-4ed3-82ce-624187327b9e.log)
- Rate-limit policy reused from `limitReset` constants in `src/config.lib.mjs` (introduced in PR #1236)
- Issue and PR linked above.
