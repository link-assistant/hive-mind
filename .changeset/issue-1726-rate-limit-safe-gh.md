---
'@link-assistant/hive-mind': patch
---

Fully safeguard from GitHub API rate-limit errors — issue #1726.

`/merge` merged a draft PR even though every `gh api` call had been failing
with `HTTP 403: API rate limit exceeded`. The merge subsystem caught those
errors silently in `getActiveRepoWorkflows()` and reported _"no CI checks
and repo has no active workflows — no CI/CD configured"_, which `/merge`
interpreted as _"all clear"_. Verbose log
([`docs/case-studies/issue-1726/data/a4dccea2-a941-4a0c-a50e-60b1ed454e1e.log`](./docs/case-studies/issue-1726/data/a4dccea2-a941-4a0c-a50e-60b1ed454e1e.log),
lines 40251–40269):

```
[VERBOSE] /merge: Error fetching workflows for link-foundation/relative-meta-logic:
  Command failed: gh api "repos/link-foundation/relative-meta-logic/actions/workflows" --paginate --slurp
gh: API rate limit exceeded for user ID 1431904 ... (HTTP 403)

[VERBOSE] /merge: PR #100 has no CI checks and repo has no active workflows - no CI/CD configured
```

Two combining root causes:

1. **`getActiveRepoWorkflows()` swallowed exceptions** in
   [`src/github-merge.lib.mjs`](./src/github-merge.lib.mjs) and returned
   `[]`. Rate-limit responses became "this repo has no workflows", which the
   merge gate treated as "no CI configured, safe to merge".
2. **No gh API call site had rate-limit retry**. The existing
   `ghCmdRetry`/`ghRetry` helpers only recognised transient TCP/TLS faults,
   so a 403 fell straight through. ~135 raw `$gh ...` and
   `` exec(`gh ...`) `` call sites scattered across `src/solve.*`,
   `src/github-merge.*`, scripts, and reviewers.

Fix:

- **New rate-limit module**
  [`src/github-rate-limit.lib.mjs`](./src/github-rate-limit.lib.mjs) with
  `isRateLimitError`, `parseRateLimitReset`, `fetchNextRateLimitReset`,
  `computeRateLimitWait`, `ghWithRateLimitRetry`, `execGhWithRetry`,
  `wrapDollarWithGhRetry`. Applies the issue's policy:
  `wait = (resetTime − now) + bufferMs (10 min) + random(0..jitterMs) (0..5 min)`,
  reusing `limitReset.bufferMs` / `limitReset.jitterMs` from
  [`src/config.lib.mjs`](./src/config.lib.mjs) (introduced in #1236).
- **Propagate errors instead of swallowing**. `getActiveRepoWorkflows()`
  no longer wraps the gh call in try/catch that returns `[]`. Errors bubble
  up; the merge gate sees the failure and stops.
- **Layered retry in legacy helpers**. `ghRetry` and `ghCmdRetry` in
  [`src/lib.mjs`](./src/lib.mjs) check `isRateLimitError` first and delegate
  to `ghWithRateLimitRetry` before applying transient-network retry.
- **Local `exec` shim** in 7 merge files rebound through
  `ghWithRateLimitRetry` — converts every existing `` exec(`gh ...`) `` site
  without per-call edits.
- **Wrapped `$` at every entry point** (15 files). `wrapDollarWithGhRetry`
  routes every `$gh ...` through the retry helper while passing non-gh
  commands unchanged.
- **Marker imports** in 17 callee files that receive `$` as a parameter,
  declaring rate-limit awareness for the ESLint rule.
- **Queue threshold lowered** from 75% to 50% in
  [`src/queue-config.lib.mjs`](./src/queue-config.lib.mjs).
- **Custom ESLint rule**
  [`eslint-rules/no-direct-gh-exec.mjs`](./eslint-rules/no-direct-gh-exec.mjs)
  flags any unsafe `gh` exec call site; files that import a known-safe
  wrapper are exempted at file scope.

Tests:

- [`tests/github-rate-limit.test.mjs`](./tests/github-rate-limit.test.mjs)
  — 22 unit tests covering `isRateLimitError` (primary, secondary,
  abuse-detection, stderr, cause-chain), `parseRateLimitReset` (header
  variants), `computeRateLimitWait` (future / null / past reset, jitter
  bounds), `ghWithRateLimitRetry` (success, propagation, retry-then-succeed,
  exhausted retries), `wrapDollarWithGhRetry` (passthrough, retry,
  propagation).
- [`tests/test-no-direct-gh-exec-rule.mjs`](./tests/test-no-direct-gh-exec-rule.mjs)
  — RuleTester valid/invalid cases.
- Updated `tests/queue-config.test.mjs` and `tests/limits-display.test.mjs`
  for the 50% threshold.

Documentation:
[`docs/case-studies/issue-1726/`](./docs/case-studies/issue-1726/README.md)
contains the failing run logs, root-cause analysis, fix breakdown, and
verification commands.
