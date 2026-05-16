# Case Study: Issue #1811 — Some Tasks in `/hive` Just Stuck, No Clear Fail or Stop

- **Issue:** [link-assistant/hive-mind#1811](https://github.com/link-assistant/hive-mind/issues/1811)
- **Pull Request:** [link-assistant/hive-mind#1812](https://github.com/link-assistant/hive-mind/pull/1812)
- **Branch:** `issue-1811-7f33adedb747`
- **Reporter:** @konard
- **Reproduction log timestamp:** 2026-05-16T20:39:25Z → captured at 2026-05-16T22:xx:xxZ
- **Hive-mind version at reproduction:** 1.70.0
- **Hive-mind version shipping the fix:** 1.72.0 → bumped in this PR

## TL;DR

A `hive` run with `--concurrency 1` over five issues of
`xlabtg/tonbankcard-protocol` completed issues #113, #114, #115, #116
successfully and then stalled on issue #117. The last log line in the
8.4 MB / 90 302-line run log is:

```
[solve worker-1] 🔍 Searching for created pull requests or comments...
```

For every previous issue this line was followed two log lines later by:

```
[solve worker-1] 🔍 Checking for pull requests from branch issue-XXX-...
```

For #117 that next line never appears. The worker never produced any
further output, the hive parent process never noticed the worker had
gone silent, and the operator had to issue Ctrl+C to escape. From the
log timeline the operator's SIGINT actually arrived **before**
`🔍 Searching...` was printed — the worker correctly cleaned up,
auto-committed, pushed, printed its session summary, then entered
`verifyResults(...)` and hung anyway.

The stall location in source is
[`src/solve.results.lib.mjs`](../../../src/solve.results.lib.mjs)
between the logs at lines 705 and 747 — specifically on the
`await $\`gh api user --jq .login\`` shell call at line ~735. This call
goes through `wrapDollarWithGhRetry`
([`src/github-rate-limit.lib.mjs`](../../../src/github-rate-limit.lib.mjs)),
which retries on rate-limit and transient network errors but **never
imposes a timeout on the underlying `$` shell call**. If `gh` hangs the
wrapper hangs with it. The hive parent
([`src/hive.mjs`](../../../src/hive.mjs) `worker(workerId)`) has no
inactivity watchdog on the spawned child process, so a silent child
produces a silent parent, indistinguishable from "Claude is just
thinking."

This case study documents the timeline, the requirements derived from
the issue, the root causes (in our wrapper and in `gh` itself), the
proposed solutions, the upstream issue draft, and the changes shipped
in PR #1812.

## Index

- [`timeline.md`](./timeline.md) — sequence of events and reproduction
- [`requirements.md`](./requirements.md) — every requirement extracted from #1811
- [`root-causes.md`](./root-causes.md) — root cause analysis (hive + solve + `gh`)
- [`solutions.md`](./solutions.md) — implementation plan with mapping to commits
- [`upstream-issue-draft.md`](./upstream-issue-draft.md) — text drafted for
  `cli/cli` (gh) about the missing default network timeout
- [`logs/`](./logs/) — raw run log preserved for forensic review

## Quick facts

| Symptom                                                            | Where                                                          |
| ------------------------------------------------------------------ | -------------------------------------------------------------- |
| Worker never finishes issue #117; no error, no exit, no signal     | `src/hive.mjs:worker()` — no inactivity watchdog               |
| Last log line is "🔍 Searching for created pull requests..."       | `src/solve.results.lib.mjs:verifyResults()` ~ line 705         |
| Next line "Checking for pull requests from branch..." never prints | Stall is between lines 705 and 747                             |
| `gh api user --jq .login` hangs indefinitely                       | `src/solve.results.lib.mjs` ~ line 735 (called via wrapped `$`)|
| Rate-limit wrapper retries forever rather than timing out          | `src/github-rate-limit.lib.mjs:ghWithRateLimitRetry()`         |
| Operator's Ctrl+C is needed to escape                              | hive.mjs spawn handlers (no inactivity warning, no kill)       |

## Linked artifacts

- Source: `src/hive.mjs`, `src/solve.results.lib.mjs`,
  `src/github-rate-limit.lib.mjs`, `src/config.lib.mjs`,
  `src/hive.config.lib.mjs`
- Tests: `tests/test-github-rate-limit.mjs` (new cases for `timeoutMs`),
  `tests/test-hive-worker-watchdog.mjs` (new)
- Reference: `src/claude.lib.mjs:executeClaudeCommand()` for the existing
  stream-activity watchdog pattern that the new hive-level watchdog
  mirrors
- Upstream reference for the gh hang: `cli/cli` has no default network
  timeout for `api` requests; see [`upstream-issue-draft.md`](./upstream-issue-draft.md)

## See also

- Issue #1809 case study at [`docs/case-studies/issue-1809`](../issue-1809/)
  for the structural template used here.
- Stream activity timeout configuration: `HIVE_MIND_STREAM_ACTIVITY_MS`
  in `src/config.lib.mjs`.
