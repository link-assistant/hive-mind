# Case Study: Issue #1823 — Fix all errors on graceful shutdown

## Summary

Issue #1823 reported errors during a `hive` graceful shutdown and required that
pressing `CTRL+C` (or `$ --stop`, which injects `\003` into the screen PTY) **fully
waits for every in-flight `/solve` command to finish naturally** before hive exits.

The captured run
(`logs/tmp-start-command-logs-isolation-screen-fc60434a-8323-4825-b4ee-7cef4df5ac01.log.gz`,
41,462 lines, 34,578,679 bytes) was produced by `hive`/`solve` **v1.72.6** with:

```
hive https://github.com/labtgbot/telegram-claude-agent --tool codex --think max \
  --concurrency 1 --auto-merge --all-issues --once --skip-issues-with-prs \
  --attach-logs --verbose --no-tool-check --disable-report-issue --language ru
Environment: screen
```

Two distinct, independently reproducible defects are visible in the log, and both are
fixed in PR #1824:

1. **Premature shutdown (double signal-handler race).** On `CTRL+C`, both hive's
   `gracefulShutdown` **and** the global `exit-handler`'s SIGINT handler fired. The
   exit-handler called `process.exit(130)`, cutting hive's "wait for workers" short.
   The in-flight `/solve` — running in the **same process group** — also received the
   terminal's SIGINT directly and was interrupted mid-task, producing cascading
   downstream errors (`Could not read Codex final message file: ENOENT`,
   `No Codex usage found in turn.completed events`).
2. **753 false `ERROR` log lines.** Hive tagged **every** line a `/solve` worker wrote
   to stderr as `[solve worker-N ERROR]`, even though 733 of them were ordinary codex
   `DEBUG`/`INFO`/`WARN` trace output and benign git/gist messages. None were real
   errors.

## Captured Evidence

| File                                                                                       | Purpose                                                                            |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `logs/tmp-start-command-logs-isolation-screen-fc60434a-8323-4825-b4ee-7cef4df5ac01.log.gz` | Full 34.58 MB / 41,462-line run log, gzip-compressed (`-diff` in `.gitattributes`) |
| `logs/interrupt-sequence-tail.txt`                                                         | The smoking-gun tail (lines 41,408–41,462) around the `^C`                         |
| `logs/false-error-pattern-analysis.txt`                                                    | Distinct shapes of the 753 false `[solve worker-N ERROR]` lines, with counts       |
| `data/hive-mind-issue-1823.json`                                                           | Issue title, body, labels, timestamps, URL                                         |
| `data/hive-mind-issue-1823-comments.json`                                                  | Issue comments (empty at capture time)                                             |
| `data/hive-mind-pr-1824.json`                                                              | PR #1824 metadata                                                                  |
| `research-sources.json`                                                                    | Online and repository source list                                                  |

The full log download was verified by line count (41,462 lines) before and after
gzip compression (`gunzip -t` passes).

## Timeline (UTC, 2026-05-25)

| Time         | Event                                                                                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 18:48:57.864 | `hive v1.72.6` started in a detached `screen` session for `labtgbot/telegram-claude-agent`, `--concurrency 1 --all-issues`.                                                                                         |
| 18:49 (≈)    | 169 issues queued; worker-1 began processing the first issue.                                                                                                                                                       |
| 18:49:50     | `/solve` **session 1** (`019e6079…`) first codex activity.                                                                                                                                                          |
| ~18:50       | Session 1 created draft PR `…/pull/176` and later uploaded its solution-draft log to a gist (completed normally).                                                                                                   |
| 19:06:58     | `/solve` **session 2** (`019e6088…`) started on issue **#7**.                                                                                                                                                       |
| 19:14:58     | Session 2's last codex activity (model still streaming, `reasoning_effort=xhigh`).                                                                                                                                  |
| 19:14:58+    | Operator pressed **`CTRL+C`**. ⬇️ all four lines below appear within milliseconds:                                                                                                                                  |
| —            | `🛑 Received interrupt signal, shutting down gracefully...` ← hive `gracefulShutdown` (line 41,410)                                                                                                                 |
| —            | `⏳ Waiting for 1 worker(s) to finish current tasks...` ← hive begins its (capped) wait (line 41,412)                                                                                                               |
| —            | `❌ Interrupted (CTRL+C)` ← **exit-handler** `showExitMessage(...)` + `process.exit(130)` (line 41,413) — **the race**                                                                                              |
| —            | `[solve worker-1] ⚠️  Session interrupted by user (CTRL+C)` ← `/solve` got SIGINT **directly** (line 41,414) — **not isolated**                                                                                     |
| 19:14:58+    | Cascading downstream errors from the interrupted solve: `Could not read Codex final message file: ENOENT` (codex killed before writing it), `No Codex usage found in turn.completed events` (turn never completed). |
| —            | Log ends mid-cleanup; the run never printed `✅ Shutdown complete`.                                                                                                                                                 |

`grep` confirms the OLD build never emitted `Shutdown complete`, `Press CTRL+C again`,
or `force-stop` — the graceful-completion path was never reached.

## Requirements (verbatim from the issue)

| #   | Requirement                                                                                                                                                                       | Status                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| (a) | Ensure there are no errors at any stage; fix all errors seen in the log.                                                                                                          | ✅ Done                                                          |
| (b) | On `/stop` / `CTRL+C`, fully wait for every running `/solve` to finish; only complete graceful shutdown once each `/solve` has finished.                                          | ✅ Done                                                          |
| (c) | Download logs/data into `docs/case-studies/issue-1823/`; deep case study: timeline, full requirements list, root causes, solution plans, online facts, existing-libraries review. | ✅ This document                                                 |
| (d) | If data is insufficient for root cause, add debug/verbose output for the next iteration.                                                                                          | ✅ Done (verbose spawn + periodic wait-progress logging)         |
| (e) | If the issue relates to another reportable repository, file issues there with repro + workarounds + fix suggestions.                                                              | ✅ See [External Issues](#external-issues)                       |
| (f) | Apply the fix across the **entire** codebase — if the bug exists in multiple places, fix it everywhere.                                                                           | ✅ See [Codebase-Wide Audit](#codebase-wide-audit-requirement-f) |
| (g) | Plan and execute everything in this single PR until every requirement is fully addressed.                                                                                         | ✅ PR #1824                                                      |

## Root Causes

### Root cause 1 — double signal-handler race (premature shutdown)

`hive` registered its own `SIGINT`/`SIGTERM` handlers **and** called
`installGlobalExitHandlers()`, which registers a second pair in
`src/exit-handler.lib.mjs`. Node.js runs **all** registered listeners for a signal
([Node `process` docs](https://nodejs.org/api/process.html)). The exit-handler's
handler ends with:

```js
await showExitMessage('Interrupted (CTRL+C)', 130);
// ...
process.exit(130);
```

`process.exit(130)` terminates the whole process immediately, so hive's
`await Promise.all(issueQueue.workers)` never got the chance to finish — the wait was
cut short. This is the `❌ Interrupted (CTRL+C)` line racing the `🛑 Received interrupt
signal` line in the log.

### Root cause 2 — `/solve` was not isolated from the terminal's SIGINT

Hive spawned each `/solve` worker **without** `detached: true`. In a terminal/screen
session, `CTRL+C` delivers SIGINT to the entire **foreground process group**, so the
solve child (and its codex grandchild) received SIGINT directly — independently of
hive — and aborted mid-task. That directly produced:

- `[solve worker-1] ⚠️  Session interrupted by user (CTRL+C)`
- `Could not read Codex final message file: ENOENT …/codex_last_message_*.txt`
  (codex was killed before it wrote the file)
- `No Codex usage found in turn.completed events` (the turn never completed)

Per the [Node `child_process` docs](https://nodejs.org/api/child_process.html),
`detached: true` makes the child a **new process-group leader**, isolating it from the
parent's controlling-terminal signals. The parent still `await`s the child unless
`subprocess.unref()` is called — so hive keeps waiting.

### Root cause 3 — blanket `ERROR` tagging of worker stderr (false positives)

Hive logged **every** `/solve` stderr line as `[solve worker-N ERROR] …`. codex writes
its structured trace (`DEBUG`/`INFO`/`WARN`) and some tools write ordinary status lines
to stderr, so 753 lines were tagged `ERROR` when none were errors:

```
Total false-ERROR-tagged lines: 753
  by codex level:  DEBUG=359  INFO=298  WARN=76   (remaining 20 = benign git/gist/stdout)
```

(See `logs/false-error-pattern-analysis.txt`.) The authoritative failure signal is the
child's **exit code**, not the stream a line happened to be written on.

## Solution

All changes are in PR #1824.

### Fix 1 — one shutdown owner (`delegateSignalHandling`)

`src/exit-handler.lib.mjs` gained a module flag and an opt-in API:

```js
let signalHandlingDelegated = false;
export const delegateSignalHandling = (enabled = true) => {
  signalHandlingDelegated = enabled;
};
```

Both the SIGINT and SIGTERM handlers now **stand down** when delegation is active:

```js
process.on('SIGINT', async () => {
  if (signalHandlingDelegated) {
    return;
  } // hive's gracefulShutdown owns the exit
  // …unchanged default behavior for solve.mjs / telegram-bot / etc…
});
```

The flag is checked **at signal-fire time** (not registration time), so handler
registration order is irrelevant, and the default (`false`) preserves the existing
behavior for every other entry point. `hive.mjs` calls `delegateSignalHandling(true)`
before registering its own handlers. This matches the recommended pattern of a single
shutdown manager other modules hook into
([OneUptime graceful-shutdown guide](https://oneuptime.com/blog/post/2026-01-06-nodejs-graceful-shutdown-handler/view)).

### Fix 2 — isolate `/solve` and wait without a cap

In `src/hive.mjs` the worker spawn now uses `detached: true` and the children are
tracked in a live `Set`:

```js
const child = spawn(solveCommand, args, { /* … */ detached: true });
activeSolveChildren.add(child); // removed again in the close/error handlers
```

`src/hive.shutdown.lib.mjs` (`createShutdownManager`) implements the wait contract:

- **First interrupt:** stop the queue, then `await Promise.all(issueQueue.workers)`
  with **no time cap** (the previous build capped this at 10 s — that was the bug),
  printing a periodic `⏳ Still waiting …` progress line. Because each solve is in its
  own detached process group, the terminal SIGINT never reached it, so it runs to
  completion. Then cleanup and `safeExit(0)`.
- **Second interrupt** (operator insists): `forceKillActiveSolveChildren()` sends the
  signal to the **negative PID** (`process.kill(-child.pid, …)`), killing the solve
  process group including codex and grandchildren, then `safeExit(130)`.

### Fix 3 — stop mislabeling worker stderr as ERROR

The worker stderr handler in `src/hive.mjs` changed from
`log(… worker-N ERROR] ${line}, { level: 'error' })` to a neutral
`log(… worker-N stderr] ${line})` with no error level. Real failures still surface via
the child's non-zero exit code.

## Codebase-Wide Audit (requirement f)

The exact bug pair (own signal handlers **plus** `installGlobalExitHandlers`, combined
with a non-detached long-running child) exists **only** in `hive.mjs`. Audit of every
other spawner/signal owner:

| Location                          | Signal handling                                  | Long-running child spawn                         | Verdict                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/hive.mjs`                    | own handlers + global exit-handler (**raced**)   | `/solve` via `spawn` (**was attached**)          | **Fixed** — delegate + `detached: true` + uncapped wait + force-kill escape hatch.                                                                                             |
| `src/reviewers-hive.mjs`          | own SIGINT/SIGTERM only (no global exit-handler) | `./review.mjs` via `command-stream` `$\`…\``     | No race; wait is already `await Promise.all(prQueue.workers)` (uncapped). `command-stream` has no `detached` option, so isolation isn't applied here; documented, not changed. |
| `src/solve.mjs`                   | global exit-handler only (no second handler)     | n/a (it _is_ the solve process)                  | No race to fix; its SIGINT interrupt behavior is intentional and unchanged.                                                                                                    |
| `src/solve.auto-continue.lib.mjs` | none                                             | `spawn('node', resumeArgs, { stdio:'inherit' })` | Must stay **attached** — interactive resume where the user must be able to `CTRL+C`. Unchanged.                                                                                |
| `src/telegram-bot.*`              | `process.once` + screen-based isolation          | screen sessions                                  | Already isolated via screen; no change.                                                                                                                                        |
| `task.mjs` / task issue-creation  | global exit-handler                              | short-lived commands                             | No long-running child to wait for; unchanged.                                                                                                                                  |

Conclusion: the premature-shutdown root cause is unique to `hive.mjs` and is fixed
there; the false-ERROR tagging is also unique to `hive.mjs`'s worker stderr handler.

## Regression Coverage

`tests/test-graceful-shutdown-waits-1823.mjs` — 33 assertions across 6 suites:

1. `exit-handler` exposes `delegateSignalHandling` / `resetExitHandler`.
2. Source assertions on `hive.mjs` + `hive.shutdown.lib.mjs` (delegate call,
   `detached: true`, `activeSolveChildren`, `createShutdownManager`, negative-PID
   force-kill, uncapped `await Promise.all(issueQueue.workers)`, neutral `stderr]`
   tag and absence of the old `worker-${workerId} ERROR]` tag).
3. The exit-handler SIGINT/SIGTERM handlers contain the `signalHandlingDelegated`
   guard before any exit.
4. Integration: a delegated harness exits 0; a non-delegated harness exits 130.
5. Integration: a `detached` child survives `process.kill(-pid, 'SIGINT')` to the
   group and reports `COMPLETED`, while a non-detached child reports `INTERRUPTED`.
6. Unit test of `createShutdownManager` with a mocked `process.kill`: first interrupt
   waits + exits 0 + no kill; second interrupt force-kills the group + exits 130.

```bash
node tests/test-graceful-shutdown-waits-1823.mjs
```

## Debug / Verbose Output (requirement d)

Added so future incidents are diagnosable without a code change:

- Verbose spawn line: `🧒 Spawned <cmd> worker-N (pid …, detached process group)`.
- Periodic `⏳ Still waiting for N solve worker(s) to finish (Xs elapsed)…` during the
  shutdown wait (15 s interval, `unref`'d so it never blocks exit).

## Online Research & Existing Libraries

- **`detached` process groups** — [Node `child_process` docs](https://nodejs.org/api/child_process.html):
  `detached: true` → child becomes a process-group leader, isolated from the parent's
  controlling-terminal SIGINT; the parent still awaits it unless `unref()` is called.
- **Multiple signal listeners** — [Node `process` docs](https://nodejs.org/api/process.html):
  all registered listeners run; installing a SIGINT listener removes Node's default
  exit. This is exactly the double-handler race.
- **One-shutdown-owner pattern** — [OneUptime graceful-shutdown guide](https://oneuptime.com/blog/post/2026-01-06-nodejs-graceful-shutdown-handler/view):
  a single shutdown manager other modules hook into; idempotent `isShuttingDown` guard;
  reserve `process.exit()` for the forced/timeout path. We follow this.
- **`node-graceful`** ([npm](https://www.npmjs.com/package/node-graceful)) — a library
  whose listeners return promises that delay exit until cleanup completes. We implement
  the same contract in-house (`await Promise.all(issueQueue.workers)`) to avoid a new
  dependency and to keep the negative-PID force-kill escape hatch.
- **`kill-with-style`** ([npm](https://www.npmjs.com/package/kill-with-style)) — robust
  process-tree killing; our negative-PID `process.kill(-pid)` achieves the needed
  group-kill without a dependency.
- **Prior art for the race class** —
  [openai/openai-agents-js#184](https://github.com/openai/openai-agents-js/issues/184):
  a dependency's own SIGINT/SIGTERM handler preventing the app's graceful shutdown.

## External Issues

The capture also shows behavior that originates **outside** Hive Mind:

1. **codex writes structured `DEBUG`/`INFO`/`WARN` trace to stderr.** This is what made
   Hive Mind's blanket stderr→ERROR tagging so noisy. The Hive Mind side is fixed
   (neutral `stderr]` tag). The codex behavior is by design (stderr is the conventional
   place for logs), so no upstream bug is warranted — Hive Mind must not treat stderr
   as an error channel.
2. **`WARN codex_file_watcher: failed to unwatch …/.codex/skills/.system: No watch was
found.`** and **`RunningService dropped without explicit close()`** — benign codex
   shutdown-ordering warnings, emitted by the codex process during its own teardown,
   independent of how Hive Mind exits. They are informational and do not affect the run
   outcome; with `/solve` no longer interrupted, they no longer coincide with a
   user-visible failure.

No Hive Mind-caused defect needs to be filed against `labtgbot/telegram-claude-agent`
(that repository was merely the _target_ being solved in the captured run). The
`command-stream` "no `detached` option" limitation noted in the audit affects only
`reviewers-hive.mjs`, which already has no signal race and an uncapped wait; it is
documented here rather than worked around, since it does not cause the reported errors.
