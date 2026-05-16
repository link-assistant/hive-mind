# Solution Plan and Mapping

For each requirement and root cause, the table below lists the change
shipped in PR #1812. References point at files under `src/` unless
noted otherwise.

## Implementation map

| Requirement                       | Root cause     | Change                                                                                                                                                                                          |
| --------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 — fix silent stall             | RC1, RC2       | Add `timeoutMs` to `ghWithRateLimitRetry` / `wrapDollarWithGhRetry`. Default short timeout for read-only `gh api` / `gh pr list` calls used in `verifyResults`. Surfaces a real, retryable error instead of an infinite await. |
| R1 — visibility before fix lands  | RC3            | Add per-worker inactivity watchdog in `src/hive.mjs:worker()`. Warn on `--worker-inactivity-warn-seconds` (default 300 s); optional hard kill on `--worker-inactivity-kill-seconds` (default 0 = disabled).                    |
| R2 — case study                   | n/a            | This directory: `README.md`, `timeline.md`, `requirements.md`, `root-causes.md`, `solutions.md`, `upstream-issue-draft.md`, `logs/`.                                                              |
| R3 — debug visibility             | RC5            | Trace each shell call in `verifyResults` under `--verbose` (command, timeoutMs). Trace retry events in `ghWithRateLimitRetry`. Hive emits "worker N silent for Ms" under `--verbose` even without the warn threshold reached. |
| R4 — upstream report              | RC4            | [`upstream-issue-draft.md`](./upstream-issue-draft.md) prepared for `cli/cli`. Submission is operator-driven (PR description links it; not auto-filed).                                          |
| R5 — single PR                    | n/a            | All changes committed to `issue-1811-7f33adedb747`. Tests updated. Changeset entry added. PR #1812 description updated and marked ready when CI is green.                                         |

## Components and libraries considered

We evaluated existing options before writing new code:

1. **`p-timeout`** (sindresorhus, ~3M downloads/wk) — wraps a Promise
   with a rejection after N ms.
   - ✅ Tiny, no deps, zero runtime overhead.
   - ❌ Pure Promise wrapper; does not actually kill the child process.
     We still need to forward the timeout into `command-stream` so the
     spawned `gh` is SIGKILLed (otherwise the wrapper rejects but the
     zombie keeps spinning and the next call may queue behind it).
   - **Verdict:** use the `AbortController` path instead (below) so
     timeout *and* kill are atomic.

2. **`AbortController` + `command-stream` `signal` option** —
   `command-stream` accepts a `signal` per call. We attach a
   `setTimeout(() => controller.abort(...), timeoutMs)` and the child
   `gh` is sent SIGTERM/SIGKILL on timeout.
   - ✅ Atomic timeout-and-kill; the `await $` rejects naturally with
     an `AbortError` we can map to a "TimeoutError" rejection.
   - ✅ Native to Node 18+; we already require Node 22+.
   - **Verdict:** adopt this.

3. **`p-retry`** — retry helper with backoff.
   - ❌ We already have our own retry loop in `ghWithRateLimitRetry`
     that understands GitHub's rate-limit reset header. Replacing it
     wholesale is out of scope; integrating `p-retry` adds little
     value because the bug is *not* in retry logic, it's in the
     missing timeout primitive.
   - **Verdict:** skip.

4. **`child_process.spawn` `timeout` option** — Node lets you set a
   per-spawn timeout that sends SIGTERM after N ms.
   - ✅ Used by the new `hive.mjs` watchdog *only* as a defense-in-depth
     `child_process.kill` after a hard kill threshold. We do **not**
     set it for warn-only mode because once `timeout` fires, the child
     is gone and we cannot decide policy.
   - **Verdict:** use it for the optional hard-kill path only.

5. **GitHub Actions `timeout-minutes`** — CI-level, not relevant to
   user-machine hive runs.
   - **Verdict:** N/A.

6. **`undici` / `node-fetch` request timeouts** — would be relevant if
   we made HTTP calls ourselves, but `verifyResults` shells out to
   `gh`. Not applicable for this fix; documented in
   [`upstream-issue-draft.md`](./upstream-issue-draft.md) for the
   upstream side.

## Change list by file

### `src/github-rate-limit.lib.mjs`

1. Add `timeoutMs` to `ghWithRateLimitRetry(fn, options)`:
   - When set, race `fn()` against a `Promise.race`-style timeout that
     aborts the spawned child via `command-stream`'s `signal` (per-call
     `{ signal: controller.signal }`).
   - On timeout, throw a typed `GhTimeoutError` whose message includes
     the elapsed ms and the original command preview (truncated).
   - Map `GhTimeoutError` into the existing transient-network retry
     bucket so legitimately slow `gh` calls get retried with backoff
     (caller can override by passing `retryOnTimeout: false`).
2. `wrapDollarWithGhRetry(dollar, options)` learns a
   `defaultTimeoutMs` and an optional per-call override:
   `$.gh({ timeoutMs })\`gh api …\`` or via the call-site option
   currently used for `verbose`.
3. Log a one-line trace on first retry of any kind:
   `⏳ Retrying gh call after Ns (reason=transient_network, attempt=2)`.

### `src/solve.results.lib.mjs`

1. Use the new `timeoutMs` argument for the early `gh api user`,
   `gh pr list`, `gh search prs` shell calls in `verifyResults`
   (default: 15 000 ms each, configurable via `argv` /
   `HIVE_MIND_GH_TIMEOUT_MS`).
2. Under `argv.verbose`, log the resolved command and timeout
   immediately before each call (`[verifyResults] $ gh api user
   (timeoutMs=15000)`).
3. On `GhTimeoutError`, surface a clearer log line so the operator
   knows where the stall was, and continue with a fallback path that
   does not depend on knowing the current user (best-effort search by
   branch only, which is what the function already does after this
   call).

### `src/hive.mjs`

1. In `worker(workerId)`, after `spawn(...)`, record `lastActivityAt`
   and `lastWarnAt`.
2. Update `lastActivityAt = Date.now()` on every `stdout`/`stderr`
   `data` event.
3. Start a `setInterval(checkActivity, 1000)` that:
   - If `Date.now() - lastActivityAt >= warnSeconds * 1000` and
     `Date.now() - lastWarnAt >= warnSeconds * 1000`, log
     `⚠️ Worker N silent for Xs (issue #ISSUE). Last log: "<last
     output line>"` and update `lastWarnAt`.
   - If `killSeconds > 0` and `Date.now() - lastActivityAt >=
     killSeconds * 1000`, log
     `🛑 Worker N silent for Xs > kill threshold; sending SIGTERM` and
     call `child.kill('SIGTERM')`. If still alive after 10 s, send
     `SIGKILL`.
   - Clear the interval in the `child.on('close')` handler.
4. Always clear the interval in error paths to avoid leaks.

### `src/hive.config.lib.mjs`

Add two yargs options:

```js
.option('worker-inactivity-warn-seconds', {
  type: 'number',
  description: 'Warn when a hive worker emits no output for N seconds (0 disables)',
  default: 300,
})
.option('worker-inactivity-kill-seconds', {
  type: 'number',
  description: 'Kill a hive worker after N seconds of no output (0 disables)',
  default: 0,
})
```

Both options are also readable from env vars
`HIVE_MIND_WORKER_INACTIVITY_WARN_SECONDS` and
`HIVE_MIND_WORKER_INACTIVITY_KILL_SECONDS` via `src/config.lib.mjs`.

### `src/config.lib.mjs`

Expose a new `timeouts.ghApiMs` setting (default 15 000 ms) and
`workers.inactivityWarnMs` / `workers.inactivityKillMs` so the same
defaults are reachable from both solve and hive without reaching into
yargs internals.

## Test plan

### `tests/test-github-rate-limit.mjs` (new cases)

- `ghWithRateLimitRetry` with `timeoutMs` rejects after the configured
  delay when the inner `fn()` never resolves.
- `ghWithRateLimitRetry` with `timeoutMs` and `retryOnTimeout: true`
  retries up to `maxApiRetries` and finally rejects with
  `GhTimeoutError`.
- `wrapDollarWithGhRetry` propagates `timeoutMs` to the wrapped call.

### `tests/test-hive-worker-watchdog.mjs` (new)

- Fake child that emits one line then sleeps 5 s: with
  `warnSeconds=1` the watchdog emits at least one warning before the
  child completes.
- Fake child that never emits anything: with `killSeconds=2` the
  child receives SIGTERM within 3 s.
- Fake child that emits steadily: no warnings are emitted.

### Manual reproduction

`experiments/repro-stuck-hive-1811.mjs` runs `gh api user` against a
local `nc -l 12345` socket (which accepts the connection and never
responds), confirms the call hangs without the fix, and confirms it
times out cleanly with the fix. Script gated behind
`RUN_NETWORK_HANG_REPRO=1` to keep CI deterministic.

## Release plan

- Bump `package.json` from `1.72.0` → `1.73.0`.
- Add `.changeset/issue-1811-stuck-task-watchdog.md` describing the
  fix and the new CLI options.
- Update PR #1812 description (remove `[WIP]`, link this case study
  and the upstream draft).
- Mark PR ready for review once CI is green.

## Out of scope (deliberately deferred)

- Replacing `command-stream` with `execa` (RC2 fix does not require
  it; would balloon scope).
- Sub-second heartbeat protocol between hive parent and solve child
  (the data-based watchdog covers the observed failure mode).
- Per-tool watchdogs inside the verify phase for `gh pr list` /
  `gh search prs` (covered by the shared `timeoutMs` plumbing).
- Auto-filing the upstream `cli/cli` issue from CI — kept manual so
  the PR author can include their own context and follow up.
