# Timeline / Sequence of Events

All references are to
[`logs/hive-issue-1811.txt`](./logs/hive-issue-1811.txt) (8.4 MB,
90 302 lines). Line numbers below are 1-based file line numbers in that
log.

## 1. Hive run starts

Log header (lines 1–5):

```
=== Start Command Log ===
Execution ID: 43c1474a-f074-499d-a9fc-032911064678
Timestamp: 2026-05-16 20:39:25.268
Command: hive https://github.com/xlabtg/tonbankcard-protocol \
  --tool claude --model opus --concurrency 1 --auto-merge \
  --all-issues --once --skip-issues-with-prs --attach-logs --verbose \
  --no-tool-check --disable-report-issue --language ru
Environment: screen
```

Concurrency is 1, so a single worker (`worker-1`) processes the queue
serially. Five issues match the filter.

## 2. Issues #113, #114, #115, #116 — happy path

Worker landmarks observed in the log:

| Issue | Worker pickup | `🔍 Searching for created PRs…` | `🔍 Checking for pull requests from branch…` |
| ----- | ------------- | ------------------------------- | -------------------------------------------- |
| #113  | line 115      | line 16584                      | line 16586                                   |
| #114  | line 16836    | line 39944                      | line 39946                                   |
| #115  | line 40222    | line 57320                      | line 57322                                   |
| #116  | line 57588    | line 78804                      | line 78806                                   |
| #117  | line 79029    | line 90301                      | **never appears**                            |

For every successful issue the "Checking for pull requests from branch
..." log is emitted on the line right after "Searching for created
pull requests or comments...". Both lines come from
`src/solve.results.lib.mjs:verifyResults()` (lines 705 and 747).

Three of these runs also exposed the existing stream-activity timeout
in Claude CLI:

```
Line 78733  [solve worker-1] ⚠️ Stream timeout — sending SIGTERM for graceful shutdown (Issue #1280, #1510, #1516)
Line 78734  [solve worker-1] ⚠️ Stream exited via force-kill timeout
Line 78735  [solve worker-1] ⚠️ Updated exit code from command result: 143
```

Exit code 143 = SIGTERM. The existing watchdog at the Claude-CLI layer
caught a non-responsive stream and recovered. The hive-parent watchdog
proposed in this PR is a complementary layer for cases the Claude-level
watchdog cannot see (e.g. stalls inside `verifyResults` after Claude
has already exited).

## 3. Issue #117 — the stall

Worker picks up #117 at line 79029:

```
Line 79029  👷 Worker 1 processing: https://github.com/xlabtg/tonbankcard-protocol/issues/117
Line 79046  [solve worker-1] 🚀 solve v1.70.0
Line 79669  [solve worker-1] 📌 Session ID: e4c7ffd6-b917-4215-8b13-912a940622d1
```

At some point during Claude's run the operator presses Ctrl+C
(the `Continuous Monitoring` mode would otherwise keep waiting because
`--once --concurrency 1` had not yet completed the last queued issue):

```
Line 90226  🛑 Received interrupt signal, shutting down gracefully...
Line 90228  ⏳ Waiting for 1 worker(s) to finish current tasks...
Line 90229  ❌ Interrupted (CTRL+C)
Line 90230  [solve worker-1] ⚠️ Session interrupted by user (CTRL+C)
Line 90231  [solve worker-1] ⚠️ Updated exit code from command result: 130
```

The solve worker handles SIGINT correctly and runs its full post-Claude
cleanup:

```
Line 90238  [solve worker-1] 💾 Auto-committing changes (--auto-commit-uncommitted-changes is enabled)...
Line 90240  [solve worker-1] [issue-117-d5131e193e4d ad9a7c1] Auto-commit: Changes made by Claude during problem-solving session
Line 90247  [solve worker-1] 📤 Pushing changes to remote...
Line 90248  [solve worker-1] ✅ Changes committed successfully
…
Line 90295  [solve worker-1] ✅ Session ID: e4c7ffd6-b917-4215-8b13-912a940622d1
Line 90296  [solve worker-1] ✅ No uncommitted changes found
…
Line 90301  [solve worker-1] 🔍 Searching for created pull requests or comments...
Line 90302  [solve worker-1]    (cd "/tmp/gh-issue-solver-1778968390332" && claude --resume e4c7ffd6-b917-4215-8b13-912a940622d1 --model opus)
```

Line 90302 is a redundant "continue session" hint printed by the solve
cleanup path. Line 90301 is the entry into `verifyResults()`. **No
further output is ever produced.** The log file ends at line 90302 and
the worker process never terminates without further operator
intervention. From the hive parent's point of view the child is alive,
its stdout is just silent, and there is no watchdog telling the
operator (or the parent) that anything is wrong.

## 4. Why the stall is silent

`src/solve.results.lib.mjs:verifyResults()` (lines 705..747):

```js
// line 705
await log('🔍 Searching for created pull requests or comments...');
…
// line 735
const userResult = await $`gh api user --jq .login`;
…
// line 747
await log(`🔍 Checking for pull requests from branch ${branchName}...`);
```

The first `await` after the log line at 705 is the shell call at line 735. `$` is `wrapDollarWithGhRetry(__rawDollar$)` from
`src/github-rate-limit.lib.mjs`. `wrapDollarWithGhRetry` recognises
`gh` invocations and runs them under `ghWithRateLimitRetry`, which:

1. Awaits the inner `$\`...\`` Promise to completion (no timeout).
2. Inspects the result; on a rate-limit error it sleeps until the
   reset time; on a transient network error it backs off and retries.

If the inner `$` Promise never resolves — which is exactly what happens
when `gh` itself hangs talking to api.github.com without a network
timeout — `ghWithRateLimitRetry` waits forever.

## 5. Why the parent doesn't notice

`src/hive.mjs:worker(workerId)` spawns `solve.mjs` via
`child_process.spawn` and only attaches listeners for `stdout` /
`stderr` / `close` / `error`. There is no `setInterval` watchdog, no
heartbeat protocol, no warning when N seconds elapse without a data
event from the child. The only periodic log line ("⏳ Waiting…
Queue: N, Processing: 1") is emitted **once per worker assignment**
(observed at lines 129, 16850, 40225, 57592, 79032), not on a periodic
timer.

## 6. Operator experience

From the operator's chair: hive keeps the terminal busy, the worker
process is `R`-state, no output for many minutes, no obvious failure,
nothing in the log says "I'm stuck on the `gh api user` call." Pressing
Ctrl+C surfaces the cleanup logs but does not actually unblock the
`gh` child (the inherited SIGINT may already have killed `gh` — the
`$` Promise still never resolves).

## 7. Investigation (this PR)

- Read `hive-issue-1811.txt` end-to-end; isolated the
  "🔍 Searching…" → "🔍 Checking…" pattern as the offending region.
- Read `src/solve.results.lib.mjs` (`verifyResults` definition).
- Read `src/github-rate-limit.lib.mjs` (`ghWithRateLimitRetry`,
  `wrapDollarWithGhRetry`) — confirmed no timeout layer.
- Read `src/hive.mjs:worker()` — confirmed no inactivity watchdog
  around the spawned child process.
- Read `src/claude.lib.mjs` — confirmed the existing stream-activity
  timeout pattern is local to Claude CLI streaming, not the verify
  phase.
- Read `src/config.lib.mjs` — confirmed `streamStartupMs` /
  `streamActivityMs` knobs already exist for Claude streams; the new
  hive-level watchdog can follow the same env-var convention.
- Searched the gh CLI (`cli/cli`) docs and known issues for a default
  network timeout — none exists; users must terminate hung `gh`
  processes themselves. This is captured in
  [`upstream-issue-draft.md`](./upstream-issue-draft.md).
