# Root Cause Analysis

Three independent defects compose the symptom in
[`logs/hive-issue-1811.log`](./logs/hive-issue-1811.log): an upstream
`gh` defect (no default network timeout), a wrapper defect (no
per-call timeout in our rate-limit retry layer) and a hive-level
visibility defect (no inactivity watchdog on spawned workers).

## RC1 — `verifyResults()` calls `gh api user` without a timeout

**File:** `src/solve.results.lib.mjs` lines 705..747 (current `main`).

```js
// line 705
await log('🔍 Searching for created pull requests or comments...');
…
// line ~735
const userResult = await $`gh api user --jq .login`;
…
// line 747
await log(`🔍 Checking for pull requests from branch ${branchName}...`);
```

`$` is the wrapped `command-stream` `$` returned by
`wrapDollarWithGhRetry(__rawDollar$)` (`src/solve.results.lib.mjs:14–17`).
When `gh api user` hangs — either because the GitHub API is slow, the
TCP connection is silently dropped, or `gh` was sent SIGINT in a way
that prevents normal stdio close — the `await` at line 735 never
resolves, and the worker never reaches line 747.

The smoking gun in the log is that for issues #113–#116 the next log
line ("🔍 Checking for pull requests from branch ...") is emitted
immediately after the "🔍 Searching..." line. For #117 it is missing.
Nothing else runs between those two log lines except a short
synchronous variable extraction, two `await` shell calls, and a couple
of helper invocations — so the stall has to be on one of those shell
calls, and the first (and most likely) is `gh api user`.

## RC2 — `wrapDollarWithGhRetry` has no timeout on the underlying `$` call

**File:** `src/github-rate-limit.lib.mjs`.

`ghWithRateLimitRetry(fn, options)` awaits `fn()` (which is `$\`...\``)
and inspects the result. There is no `Promise.race` against a timeout,
no `AbortController` wired through to `command-stream`, no
`SIGTERM`-after-N-seconds escape hatch. When `fn()` never resolves the
function never returns.

This is the most actionable fix point: adding an opt-in `timeoutMs`
parameter to `ghWithRateLimitRetry` (and a default for `gh api*` calls)
is a small, contained change that converts every silent hang into a
visible, retryable error.

## RC3 — `src/hive.mjs:worker()` has no inactivity watchdog

**File:** `src/hive.mjs` lines 716–918 (the `worker(workerId)` function).

The current spawn looks like:

```js
const child = spawn(solveCommand, args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});

child.stdout.on('data', chunk => { … });
child.stderr.on('data', chunk => { … });
child.on('close', code => { … });
child.on('error', err => { … });
```

There is no fifth listener — no `setInterval(checkActivity, …)` and
no "if `Date.now() - lastDataAt > N` then warn/kill" logic. The only
time-based output the hive parent emits is the
`⏳ Waiting... Queue: N, Processing: 1` line at lines 129, 16850,
40225, 57592, 79032 in the log — once per worker handoff, **never**
periodically while a worker is busy.

`src/claude.lib.mjs:executeClaudeCommand()` already has an analogous
pattern (`resetActivityTimeout()` around the Claude CLI stream, lines
~820–910) that force-kills Claude after `streamActivityMs`. That
pattern is the design reference for the new hive-level watchdog; it
just needs to be applied one level higher (parent watching child
process activity, not Claude streaming JSONL parse activity).

## RC4 — `gh` CLI has no default network timeout

**Upstream repo:** `cli/cli`.

`gh api` (and `gh graphql`) issue HTTPS requests via Go's
`net/http.Client`. The default `Timeout` on a Go HTTP client is zero,
which means "no timeout." `gh` does not override that default. There is
no `--timeout` flag and no `gh config` key for it (checked via web
search and gh release notes through 2.74.x). Long-running requests can
therefore hang for as long as the kernel keeps the underlying TCP
socket open — minutes to hours under certain network conditions.

A more detailed root cause for the upstream gap, with a minimal repro
and a suggested fix, is in
[`upstream-issue-draft.md`](./upstream-issue-draft.md). Even with a
configurable timeout in `gh`, layered defense is still needed in our
wrapper (RC2) because we want to retry rate-limit/transient errors
**after** the timeout fires.

## RC5 — Verbose mode does not log individual shell commands

`verifyResults()` logs human-readable phase markers ("🔍 Searching...",
"🔍 Checking for pull requests from branch...") but not the individual
shell commands it dispatches. Under `--verbose` an operator should see
something like:

```
[verifyResults] $ gh api user --jq .login           (timeoutMs=15000)
[verifyResults] $ gh pr list --repo OWNER/REPO …    (timeoutMs=15000)
```

so a future hang can be diagnosed without re-running. The change is
small and falls naturally out of the `timeoutMs`-aware `$` wrapper
introduced for RC2.

## Cross-check: how often did this fire in the reproduction?

In the 5-issue reproduction run only the last issue (#117) stalled
inside `verifyResults`. Issues #113–#116 went through the same path
successfully. This is consistent with a transient `gh`/network hang,
not a deterministic bug; which is why a *timeout* + *visibility* fix is
correct and a *protocol redesign* would be overkill.

## Cross-check: the SIGINT timing

The operator's Ctrl+C arrived around log line 90226. The "🔍 Searching..."
line that begins the stalled region is at log line 90301 — **after**
the SIGINT. So the order of events is:

1. Worker is running Claude on #117, has been running for a while.
2. Operator suspects the worker is stuck and presses Ctrl+C.
3. Hive parent prints `🛑 Received interrupt signal, shutting down
   gracefully...`.
4. Solve worker prints `⚠️ Session interrupted by user (CTRL+C)`
   and runs its full cleanup (auto-commit, push, session summary).
5. Cleanup completes; `verifyResults()` is entered.
6. The first shell call (`gh api user --jq .login`) hangs.
7. Log file ends; operator has to kill the hive process from a second
   terminal.

In other words: even after the operator explicitly tries to interrupt
the run, the worker still gets stuck on the same `gh` call. This is a
strong argument for *both* timeout and watchdog layers — SIGINT alone
is not a reliable way to recover, because `gh`'s missing default
network timeout (RC4) means the underlying network read sometimes
absorbs the signal.
