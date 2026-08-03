# Issue 2135: `Work session failed (exit code: 1)` after a session log grew to 286 MB

## Executive summary

On 2026-08-02 a `fix` run against
[link-foundation/meta-language](https://github.com/link-foundation/meta-language)
ended after 1 h 34 min with a Telegram notification saying only

> `Work session failed (exit code: 1)`

The wrapper log for execution `2757eeb3-68e6-43bb-8a6a-20c55dfd2958` is
**286,452,210 bytes / 1,354,860 lines**. Its last useful lines are a V8 heap
abort inside the `solve` child and hive-mind's own reaction to it:

```text
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
❌ Error: solve exited with code null
Reason: exitCode=1 oomKilled=false
```

The log is large because hive-mind wrote its own output into it, over and over.
`getPullRequestChangeStats()` measured the pull-request diff by running
`gh pr diff` through `command-stream`'s **default `mirror: true`**, so the whole
diff was echoed to stdout, copied into the session log by the stdio interceptor
(issue #1549), published by `--attach-logs`, and — because the same run used
`--development-log` — committed into the pull-request branch. The next
`gh pr diff` therefore contained the previous log, which was mirrored again.

The amplification is measurable in the log itself. Each restart iteration
records the size of the development-log slice it publishes:

| Session                    | Development-log slice committed to the branch | Attached log size |
| -------------------------- | --------------------------------------------- | ----------------- |
| `60d82f4e-…` (initial)     | 2,660,092 B (2.7 MB)                          | 19,492 KB         |
| `42e652b1-…` (restart 1/5) | 37,951,473 B (38 MB)                          | 57,548 KB         |
| `7a6e5ba3-…` (restart 2/5) | 80,317,341 B (80 MB)                          | 136,356 KB        |
| `1f5063de-…` (restart 3/5) | 199,382,735 B (199 MB)                        | — died first      |

`raw/log-metrics.json` shows the same loop from the other side: 772,135 lines
carry one leading `+` (a log line seen through one diff), 535,963 carry two
(a diff of a log that already contained a diff), and 293 carry three or four.
135 `diff --git` headers appear in 34 separate mirrored dumps, several of them
4–24 MB each. The largest single file in the diff is hive-mind's own
`solve.log`, added at **178,833 lines** in one hunk
(`raw/committed-solve-log-in-diff.txt`).

Two further defects turned that growth into a fatal, unexplained failure:

- `measureDiff` in `src/pull-request-changes.lib.mjs` split the whole diff into
  an array of lines, rebuilt per-file `body` strings, and ran
  `body.match(/^\+[^+]/gm)` — a match array with one string per added line. On a
  60 MB diff that is several copies of the diff plus a multi-million-entry array
  live at once, which is what pushed V8 over the limit (the log's last GC line
  is `Mark-Compact 2279.2 (2351.9) -> 2236.7 (2279.3) MB`).
- When V8 aborts it raises `SIGABRT`, so Node reports `code === null` on
  `child.on('close')`. `src/hive.mjs` computed `exitCode = code || 0`, i.e.
  **an OOM-killed worker was recorded as success**, and `src/fix.mjs` printed
  the bare `solve exited with code null` before exiting 1 — the "exit code: 1"
  with no cause that the issue is named after.

## Requirements inventory

Every requirement stated in the issue body, with its resolution.

| #   | Requirement (issue #2135)                                                                                   | Resolution                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Find the root cause of `Work session failed (exit code: 1)` and the huge log                                | Root-cause chain below, reconstructed from the 286 MB wrapper log                                                                                 |
| 2   | Fix it                                                                                                      | `src/pull-request-changes.lib.mjs` (quiet + single-pass), `src/child-exit.lib.mjs` + `src/hive.mjs` + `src/fix.mjs` (signal-aware exit reporting) |
| 3   | Apply the fix across the **entire** codebase, not just where it was first seen                              | Quiet-probe sweep over 13 modules and a spawner sweep over 6, both pinned by source-scanning tests                                                |
| 4   | Download all logs/data related to the issue into `./docs/case-studies/issue-2135`                           | `raw/` (excerpts + metrics + checksums) and `scripts/measure-session-log.mjs`; provenance below                                                   |
| 5   | Deep case-study analysis: timeline, requirement list, root cause per problem, solution plan per requirement | This document                                                                                                                                     |
| 6   | Review known existing components/libraries that solve a similar problem                                     | "Prior art" section below                                                                                                                         |
| 7   | Search online for additional facts                                                                          | Node `maxBuffer`/V8 heap-limit references cited in "Prior art"                                                                                    |
| 8   | If there is not enough data, add debug output and a verbose mode for the next iteration                     | `src/log-growth.lib.mjs` warns at 64 MB / 256 MB / 1 GB of session log; the diff probe warns past 8 MB and reports `diffBytes`                    |
| 9   | Report the defect to other repositories/projects if it belongs there                                        | Not applicable — see "Is this someone else's bug?"                                                                                                |
| 10  | Plan and execute everything in one pull request                                                             | [#2138](https://github.com/link-assistant/hive-mind/pull/2138)                                                                                    |

## Evidence archive and provenance

The raw log published with the issue is at
<https://github.com/konard/private-logs/tree/main/log-tmp-start-command-logs-isolation-docker-2757eeb3-68e6-43bb-8a6a-20c55dfd2958>,
split into three parts because of GitHub's file-size limit:

| File                                                            | Bytes       | SHA-256                                                            |
| --------------------------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `…2757eeb3-….part-00.log.txt`                                   | 104,857,600 | `27be5b8b0445eb786f029603dcda956e36187d68cf7c9dd065e126d7c54c3f89` |
| `…2757eeb3-….part-01.log.txt`                                   | 104,857,600 | `0d5ceedb9138fcabaa65bcaee25e9bb37f411a3a50f869299cc439a4c44139b4` |
| `…2757eeb3-….part-02.log.txt`                                   | 76,737,010  | `8905fce14d538087158fff2b2e3148de0ecd88f47923ff6059ff7566c49bf96e` |
| concatenation of the three (`full.log`, the file analysed here) | 286,452,210 | `51d461c04d937a7bd1331a7f2003400a522bb08a1721135d206ae279e280aae1` |

The 286 MB log is deliberately **not** committed: committing session logs into a
branch is the very mechanism that caused this incident. `raw/` instead holds the
bounded excerpts every claim in this document rests on, plus the full metrics:

```text
c3cf0fc18e679706b687d74aa9ea675cdb81393dcfcec0bf5d2ab9a6d01fa087  amplification-timeline.txt
98cf9f491464a64ae03727e9d99136c956cd413b22117787a7ed135b1876fb89  committed-solve-log-in-diff.txt
b009dd0da1d9792a19849fb8ba36305b97a6f138beee7badab9cebadb794e5a2  first-diff-mirror.txt
189ebba02fd7bff69f03731bd820be25962e1293054fbb1f60536946ef0d24e7  heap-abort.txt
6fac2b41ec51d8342d97191df74aa16300fc38ab200f62d72f86c2c4bc66977f  restart-trigger.txt
766dd3f7a0810f669685aa3953746b60ae384825336e79a99d3b800961be1f81  wrapper-log-head.txt
3f1e3b244441df8f986b6d146eb4eeff6fb33f952993c94454888b19b9e1df09  wrapper-log-tail.txt
4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945  issue-2135-comments.json
c03b7cf4d0c6f47bbc4e1a36d247c065e2e89bb9cac001585cd6504922f1f60d  issue-2135.json
f6a03921805f9bea5343d659f85cf649a6dace39af7b0859e0af91d3c90af533  log-metrics.json
```

`issue-2135-comments.json` is the empty array `[]`: the issue carried no comments
when this analysis was performed, so the issue body is the complete requirement
source.

`log-metrics.json` is reproducible — the numbers quoted above come from

```bash
node docs/case-studies/issue-2135/scripts/measure-session-log.mjs \
  /path/to/full.log --json docs/case-studies/issue-2135/raw/log-metrics.json
```

which streams the file line by line (it does not fit comfortably in a Node heap,
which is the point of the issue).

## Timeline

All timestamps UTC; line numbers refer to `full.log`.

| Time / line               | Event                                                                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16:52:17.854 (line 3)     | Wrapper starts `fix https://github.com/link-foundation/meta-language --ci-cd --attach-logs --verbose --no-tool-check --disable-report-issue --language en` in `konard/hive-mind-dind:2.11.5` |
| 16:52:43 (line 70)        | `fix` spawns `solve … --development-log --deep-analysis --auto-merge --attach-logs --verbose` for issue #191                                                                                 |
| 16:52:43 (line 128)       | Session log opened at `/home/box/solve-2026-08-02T16-52-43-913Z.log`; the stdio interceptor now copies everything printed into it                                                            |
| 17:24:06 (line 26859)     | AI session ends; workspace has grown by 32 MB (`phase=after_agent … deltaBytes=33050656`)                                                                                                    |
| 17:24 (line 26879)        | Development log finalised for session `60d82f4e-…`, slice `0-2660092`                                                                                                                        |
| 17:24 (line 26887)        | `⚠️  Development log collection failed: Development-log publication rescan found residual credential material.` — the artefacts stay on disk, uncommitted                                    |
| 17:24 (lines 26895-26896) | `📝 No AI comments detected, attaching working session summary…` is immediately followed by `diff --git a/.github/workflows/js.yml` — **the mirrored `gh pr diff`**                          |
| 17:26 (line 98889)        | Log attached to the pull request: `📊 Log size: 19492KB`                                                                                                                                     |
| 17:27:20 (line 170849)    | `🔄 RESTART TRIGGERED: Uncommitted changes detected` — the untracked `?? dev/log/issues/191/pulls/192/sessions/` left by the failed publication (restart 1/5)                                |
| 17:5x (line 178961)       | Restart-1 development log written: slice `0-37951473` (38 MB); the branch now carries a 178,833-line `solve.log`                                                                             |
| 18:0x (line 278001)       | `📊 Log size: 57548KB`                                                                                                                                                                       |
| 18:0x (line 377066)       | Restart 2/5 triggered; slice `0-80317341` (80 MB); `📊 Log size: 136356KB`                                                                                                                   |
| 18:2x (line 937481)       | Restart 3/5 triggered; slice `0-199382735` (199 MB)                                                                                                                                          |
| 18:26 (line 1354838)      | `FATAL ERROR: Reached heap limit Allocation failed` after `Mark-Compact 2279.2 (2351.9) -> 2236.7 (2279.3) MB`                                                                               |
| 18:26 (line 1354851)      | `❌ Error: solve exited with code null` — `fix` sees SIGABRT as a null code                                                                                                                  |
| 18:26:42.508 (tail)       | Wrapper: `Exit Code: 1`, `Reason: exitCode=1 oomKilled=false` → Telegram `Work session failed (exit code: 1)`                                                                                |
| 18:54:42                  | Issue #2135 filed                                                                                                                                                                            |

`oomKilled=false` is accurate and misleading at the same time: the _container_
was never OOM-killed (11.7 GB total, 7.3 GB free at the last snapshot). It was
the Node **heap** ceiling (~2.28 GB before the abort), inside a container with
memory to spare, that ended the run.

## Root causes

### RC1 — the diff-size probe mirrored its own input into the log

`getPullRequestChangeStats()` ran

```js
const diffResult = await $`gh pr diff ${prNumber} --repo ${owner}/${repo}`;
```

`command-stream` defaults to `mirror: true`, so the diff went to stdout as well
as to `result.stdout`. Nothing in the codebase wanted the diff _printed_ — only
measured. With `--attach-logs` and `--development-log` that stdout copy becomes a
file committed to the branch, and the branch is what the next `gh pr diff`
describes. The loop is closed, and each turn multiplies rather than adds.

**Fix.** `src/pull-request-changes.lib.mjs` now measures through
`quietProbe($)` (`{ mirror: false, capture: true }`, the idiom introduced for
issue #2130), so the diff is read and never echoed.

### RC2 — the same defaulted-to-loud pattern existed elsewhere

The diff probe was the one that exploded, but any probe whose output is
unbounded can do it. A sweep found the same shape in 13 modules
(`src/review.mjs`, `src/solve.results.lib.mjs`, `src/solve.repository.lib.mjs`,
`src/contributing-guidelines.lib.mjs`, `src/github.lib.mjs`,
`src/solve.keep-working.lib.mjs`, `src/solve.auto-continue.lib.mjs`,
`src/solve.minimal-restart-prompt.lib.mjs`, `src/solve.preparation.lib.mjs`,
`src/solve.progress-monitoring.lib.mjs`, `src/github-entity-validation.lib.mjs`,
`src/bidirectional-interactive.lib.mjs`, `src/fix.ci-cd-issue.lib.mjs`).
All now probe quietly, and `tests/test-issue-2135-log-explosion.mjs` scans the
sources so a re-introduction fails the suite.

The sweep also uncovered a latent crash: `src/contributing-guidelines.lib.mjs`
called `.raw()` on the result of `wrapDollarWithGhRetry`, which returns a plain
Promise rather than a `ProcessRunner`. The `TypeError` was swallowed by the
surrounding `try`, so contributing-guidelines detection had been silently
disabled. It is fixed and pinned by a test.

### RC3 — `measureDiff` kept several copies of the diff in the heap

The old parser did `diff.split('\n')`, re-joined per-file bodies, and then ran a
global regex `match`, which allocates one string per added line. For the 60 MB
diff in this run that is hundreds of megabytes of garbage at the exact moment
the process was already carrying the mirrored copy.

**Fix.** `measureDiff` now walks the diff by line offsets, counts as it goes,
and retains section text only for the two paths that could be the solver's
placeholder. It also returns `diffBytes` and warns past
`LARGE_DIFF_WARNING_BYTES = 8 MB`.

### RC4 — a signalled child was reported as `code null`, or as success

V8's OOM handler calls `abort()`, so the child dies on `SIGABRT` and
`child.on('close', (code, signal))` gives `code === null, signal === 'SIGABRT'`.

- `src/fix.mjs` printed `solve exited with code null` — technically true,
  diagnostically useless.
- `src/hive.mjs` computed `exitCode = code || 0`, which turns `null` into **0**:
  a worker killed by the OOM handler was recorded as a _successful_ worker.

**Fix.** `src/child-exit.lib.mjs` provides `describeChildExit()` (which names the
signal and adds "this usually means the process ran out of memory" for
`SIGABRT`/`SIGKILL`/code 134), `isLikelyOutOfMemoryExit()`, and
`attachChildExitHandlers()`. `src/hive.mjs` adopts the shared handlers (which
also removes the `code || 0` masking); `src/fix.mjs`, `src/task.mjs`,
`src/fix.ci-cd-issue.lib.mjs`, `src/isolation-runner.lib.mjs` and
`src/telegram-command-execution.lib.mjs` pass the `signal` through
`describeChildExit()`. A signalled child is now always named and never counted
as success.

### RC5 — nothing complained while the log grew by two orders of magnitude

A healthy session log is single-digit megabytes. This one passed 19 MB, 57 MB,
136 MB and 199 MB without a word, and the first sign of trouble was the process
dying.

**Fix.** `src/log-growth.lib.mjs` counts the bytes the logger and the stdio
interceptor append and emits one warning per threshold crossed
(64 MB / 256 MB / 1 GB), naming the mirrored-command-output cause and pointing
here. `setLogFile()` resets the counter, so each session counts its own log.

### RC6 (contributing, not fixed here) — the failed development-log publication triggered the restarts that multiplied the growth

`⚠️  Development log collection failed: … residual credential material` left
`?? dev/log/issues/191/pulls/192/sessions/` untracked in the workspace. Watch
mode saw untracked files, restarted with "you MUST handle these uncommitted
changes by either committing…", and the AI committed hive-mind's own session
logs into the pull-request branch — which is exactly the input RC1 feeds on.
Three restarts of an ever-larger log followed.

With RC1 fixed the loop cannot amplify (the log no longer absorbs the diff), but
"hive-mind restarts a session because its own artefact write failed, and the
remedy it prescribes is to commit its logs into the user's branch" is a separate
defect in the development-log publication path. It is recorded here and filed
separately rather than widened into this pull request.

## Solution plan, per requirement

| Requirement                         | Plan                                                                                                                                                      | State                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Stop the log explosion              | Probe `gh pr diff` quietly; measure in a single pass; warn past 8 MB                                                                                      | Done — `src/pull-request-changes.lib.mjs`                 |
| Stop it everywhere                  | Quiet-probe sweep across 13 modules, pinned by a source-scanning test                                                                                     | Done — `tests/test-issue-2135-log-explosion.mjs`          |
| Make the failure explain itself     | `describeChildExit` / `attachChildExitHandlers` in all six spawners; never map a signal to exit 0                                                         | Done — `src/child-exit.lib.mjs` + the six spawner modules |
| Give the next iteration evidence    | Threshold warnings on log growth; `diffBytes` in the change stats                                                                                         | Done — `src/log-growth.lib.mjs`, `src/lib.mjs`            |
| Preserve the evidence               | Stream-measure the 286 MB log; commit bounded excerpts, metrics, checksums and the measuring script                                                       | Done — this directory                                     |
| Restart loop on own artefacts (RC6) | Treat hive-mind's own `dev/log/**` artefacts as not-the-AI's-uncommitted-work, the way `.playwright-mcp/` (#1124) and AI scratch dirs (#2119) already are | Filed separately; out of scope for this pull request      |

## Prior art / existing components reviewed

- **`command-stream`'s own `mirror`/`capture` options.** No new machinery was
  needed: the library already supports exactly the behaviour wanted here. The
  defect was that `mirror` defaults to `true`, so _forgetting_ the option is
  what costs you. `src/quiet-probe.lib.mjs` (issue #2130) already existed as the
  house idiom; this change is mostly "use the thing we already built,
  everywhere".
- **Node's `child_process` `maxBuffer`.** `exec`/`execFile` cap collected output
  at 1 MB (200 KB for the `*Sync` variants) and kill the child with
  `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` past it
  ([nodejs.org](https://nodejs.org/api/child_process.html),
  [nodejs/node#9829](https://github.com/nodejs/node/issues/9829)). `execa`
  raises the default to 10 MB
  ([execa](https://github.com/sindresorhus/execa)). `command-stream` has no such
  cap, which is why an unbounded probe here is unbounded in the heap too. A
  future hardening step is a byte cap on probe capture, refusing to buffer a
  diff past N MB rather than measuring it.
- **`gh pr diff --name-only`.** The GitHub CLI can return just the file list,
  which would bound the probe by construction — but the stats need per-file
  addition counts, so the patch is genuinely needed. `--exclude <glob>` is a
  plausible future refinement for `dev/log/**`.
- **Log rotation (`pino`/`winston`/`logrotate`).** Size-capped rotation is the
  standard answer to an unbounded log, and would have kept the _file_ small.
  It would not have helped here: the bytes still pass through the process, still
  get attached, and still get committed. Rotation treats the symptom; the causal
  fix is not to mirror unbounded output at all. The growth _warning_ added in
  `src/log-growth.lib.mjs` is the diagnostic half of the same idea.
- **`--max-old-space-size`.** The common answer to `Reached heap limit`
  ([nodejs/node#18889](https://github.com/nodejs/node/issues/18889)) is a bigger
  heap. Explicitly rejected: the heap was consumed by a self-feeding loop, so a
  larger ceiling buys one more doubling and then fails identically, later and
  more expensively.
- **Existing hive-mind precedents for "our own artefacts are not the AI's
  work":** `.playwright-mcp/` cleanup (#1124) and the AI-scratch-directory
  generalisation (#2119). RC6 is the same class of bug applied to
  `dev/log/**` and is the natural home for the follow-up fix.

## Is this someone else's bug?

No. Every link in the chain is hive-mind's own code: the un-quieted probe, the
whole-diff parser, the `code || 0` exit mapping, and the missing growth warning.
`command-stream` behaves as documented (`mirror` defaults to `true`), Node
behaves as documented (a `SIGABRT` child reports `code === null`), and V8
behaves as documented (heap-limit abort). Nothing needs to be reported upstream;
requirement 9 is satisfied by this finding rather than by a filed issue.

## Regression tests

`tests/test-issue-2135-log-explosion.mjs` (28 assertions, suite `default`):

- the diff probe is invoked with `mirror: false, capture: true` and prints
  nothing, verified with a `$` double that records its options;
- a synthetic 9 MB diff is measured correctly (`additions === 36000`), reports
  `diffBytes`, and produces a `level: 'warning'` message mentioning logs;
- a source sweep asserts every module in the quiet-probe list still probes
  quietly, and that `contributing-guidelines` never calls `.raw()` on the
  retry-wrapped `$` (comment lines excluded);
- `describeChildExit` / `isLikelyOutOfMemoryExit` name signals and OOM;
- `attachChildExitHandlers` maps `close(null, 'SIGABRT')` to exit code 1 with
  exactly one error log, passes `close(0)` and `close(7)` through unchanged, and
  reports spawn errors;
- a source sweep asserts the six spawner modules use the shared handlers rather
  than `code || 0`;
- the growth tracker warns once per threshold and resets with the log file.
