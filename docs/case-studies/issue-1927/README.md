# Issue 1927 Case Study: Detached `/solve` sessions OOM-killed (exit 137) but never reported by the Telegram bot

> **One-line summary.** Four detached `solve` sessions launched by the Telegram bot
> were killed by the Linux OOM-killer at the same instant (`Exit Code: 137`), the
> external start-command CLI correctly recorded the kill in each log footer, yet the
> bot stayed alive and never told the user — because liveness derived from
> `screen -ls` was trusted over the recorded terminal exit code, and nothing
> persisted the session list across a bot restart.

## Source Artifacts

All evidence is preserved under `source/` (requirement #4: "no data should be destroyed").

- Issue metadata: `source/issue-1927.json`
- Issue comments: `source/issue-1927-comments.json` (empty — the issue body carried all the detail)

The issue body links **four** start-command execution logs (four public gists); all four are
preserved here, ordered by start time:

- Killed session #1 (full, gzipped): `source/session-33900bfd.log.gz` — `solve https://github.com/link-assistant/formal-ai/issues/479`
- Killed session #1 (quick-read excerpt): `source/session-33900bfd.excerpt.log`
- Killed session #2 (full, gzipped): `source/session-5ddd6525.log.gz` — `solve https://github.com/Payel-git-ol/Octra/issues/85`
- Killed session #2 (quick-read excerpt): `source/session-5ddd6525.excerpt.log`
- Killed session #3 (full, gzipped): `source/session-d585d1fe.log.gz` — `solve https://github.com/xlabtg/teleton-agent/pull/625`
- Killed session #3 (quick-read excerpt): `source/session-d585d1fe.excerpt.log`
- Killed session #4 (full, gzipped): `source/session-442ce104.log.gz` — `solve https://github.com/leaderstat/wb-part2/issues/91`
- Killed session #4 (quick-read excerpt): `source/session-442ce104.excerpt.log`

The four logs are reproduced verbatim except for redaction of secrets. start-command itself
already redacts the `authorization` header to `***`; additionally, a scan for GitHub /
Anthropic / AWS / GitLab / JWT token patterns found a single GitHub API `temp_clone_token`
value embedded in a PR JSON payload inside `session-442ce104.log`, which was replaced with
`***REDACTED-secret-issue-1927***`. No other secrets were found in any of the four logs (the
other three carried only empty `"temp_clone_token":""` fields).

## External Research

- **Exit code 137 = 128 + 9 (SIGKILL).** A process terminated by a signal exits with
  `128 + signal`; SIGKILL is signal 9, so 137 means the process was force-killed and
  **could not catch, block, or clean up** — hence the abrupt `Killed` with no stack trace.
  The most common source is the Linux OOM-killer.
  - https://tmuxai.dev/exit-code/exit-code-137/
  - https://komodor.com/learn/how-to-fix-oomkilled-exit-code-137/
  - https://dev-ref.com/errors/linux-exit-137
- **Linux OOM-killer.** When physical memory and swap are exhausted, the kernel scores
  every process by a "badness" value dominated by memory footprint and kills the
  highest-scoring one; if freeing one process is not enough it continues, so a single OOM
  event can reap **multiple** processes nearly simultaneously. SIGKILL is delivered, so the
  victim cannot report its own death.
  - https://last9.io/blog/understanding-the-linux-oom-killer/
  - https://www.baeldung.com/linux/memory-overcommitment-oom-killer
- **GNU `screen` liveness is not job-completion.** A detached `screen` socket can linger
  (e.g. an interrupted/ungraceful detach, or a shell that outlives the command), so
  `screen -ls` listing a session does **not** prove the wrapped command is still running;
  `screen -wipe` exists precisely to reap dead sockets. This is why deriving "is it still
  executing?" from socket presence is unreliable, and the recorded exit-code footer must win.
  - https://www.gnu.org/software/screen/manual/screen.pdf
  - https://linuxize.com/post/how-to-use-linux-screen/
- **Prior art for durable supervision / resume** (requirement #5 — "check known existing
  components/libraries"):
  - **PM2** persists its process list with `pm2 save` to a dump file and restores it with
    `pm2 resurrect`, the canonical "survive a restart" pattern we mirror with
    `sessions.json` + resume-on-launch: https://pm2.keymetrics.io/docs/usage/startup/
  - **systemd** service supervision (`Restart=`, watchdog) and **supervisord** are the OS-level
    analogues; **BullMQ** is the durable-job-queue analogue (jobs persisted in Redis survive a
    worker crash): https://docs.bullmq.io/ . We deliberately stayed in-process (a small JSON
    snapshot + JSONL event log) rather than adding a Redis/daemon dependency for a Telegram bot.

## Timeline (reconstructed from the four start-command logs)

All times are from the log banners/footers (the logs already carry millisecond timestamps).

| Time (2026-06-14) | Event                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 17:19:14.582      | Bot launches session **33900bfd** in a detached `screen`: `solve formal-ai#479 --model opus --think max --tool claude --attach-logs --verbose` (cwd `/home/box`, Node v24.3.0).                              |
| 17:19 – 19:10     | Session 33900bfd runs ~1h51m, 145,905 log lines, 2,125 `thinking_tokens` events, processing **base64 PNG screenshots** (`iVBORw0KGgo…`) — memory-heavy under `--attach-logs`.                                |
| 18:48:34.261      | Bot launches a **second** detached session **5ddd6525**: `solve Octra#85 --model opus --base-branch optimize/stream-marshal-once --attach-logs --verbose` (34,427 log lines).                                |
| 18:54:18.582      | Bot launches a **third** detached session **d585d1fe**: `solve teleton-agent#625 --model opus --attach-logs --verbose --language ru` (48,206 log lines).                                                     |
| 18:56:26.861      | Bot launches a **fourth** detached session **442ce104**: `solve wb-part2#91 --model opus --attach-logs --verbose --language en` (24,934 log lines). **Four** opus sessions now run concurrently on one host. |
| **19:10:49.782**  | Host memory is exhausted; the OOM-killer terminates **d585d1fe** first (`Killed` → `Exit Code: 137`).                                                                                                        |
| **19:10:49.795**  | **+13 ms**, it terminates **442ce104** (`Exit Code: 137`).                                                                                                                                                   |
| **19:10:49.814**  | **+19 ms**, it terminates **5ddd6525** (`Exit Code: 137`).                                                                                                                                                   |
| **19:10:49.822**  | **+8 ms**, it terminates **33900bfd** (`Exit Code: 137`). All four killed inside a **40 ms** window.                                                                                                         |
| 19:10:49+         | start-command writes the authoritative footer (`====… / Finished: … / Exit Code: 137`) to **all four** logs.                                                                                                 |
| (after)           | The Telegram bot process stays alive but **never updates any of the four work-session messages** — the user is left seeing "executing…" forever for four jobs that are dead.                                 |

All **four** kills landing inside a single **40 ms** window (19:10:49.782 → .822) is the
fingerprint of one host-level OOM cascade (not four independent crashes): freeing the first
victim did not recover enough memory, so the kernel immediately took the next, and the next,
until pressure eased. None of the four processes logged an in-process out-of-memory error
(a scan found only false positives inside base64/cookie/signature blobs), confirming an
**external** SIGKILL rather than a Node heap failure.

## Requirements Extracted (verbatim intent, numbered)

1. **Detect kills via `$ --status`.** "When process killed, we should use `$ --status` to
   detect fail (in this case telegram bot was alive, and it not reported fail)."
2. **Survive a bot restart and resume.** "Even if telegram bot killed, we should detect
   restart. And if after bot start we have commands in `$`, we should try to resume them, if
   they started before bot start time."
3. **Timestamps everywhere; start time always, end time when it finishes.** "We need to make
   sure we have in all places start and end time, or start time without end time if everything
   is killed. All our logs, should write time, so we will be able to catch exact moment of such
   total failure."
4. **Never destroy prior logs; back them up; only resume what was live at the last bot
   heartbeat.** "We also need to make sure we don't destroy our previous log… so we only try to
   restore and resume /solve commands, that were executing when last telegram bot statement were
   written. We also need to have backup of all previous logs of telegram bot, so no overrides
   (no data should be destroyed)."
5. **Compile all issue data to `docs/case-studies/issue-1927/` and do a deep case study**
   (timeline, requirements, root causes, solution plans, existing-component survey, online
   research). _(This document.)_
6. **If data is insufficient for root cause, add debug output / verbose mode** for the next
   iteration.
7. **File reproducible upstream issues** against any other affected repo (here
   `link-foundation/start`), each with a reproducible example, workaround, and fix suggestion.
8. **Apply the fix across the entire codebase** — if the bug exists in multiple places, fix all
   of them.

## Root Causes

### RC-1 — Liveness was trusted over the recorded exit code (the reported bug)

The external `start-command` CLI's `enrichDetachedStatus` re-derives a detached session's
status from backend liveness (`screen -ls`). When a shell or socket lingers after the wrapped
command is already dead, `$ --status` reports `executing` and **nulls the recorded exit code**,
even though the log footer already says `Exit Code: 137`. The bot's monitor only reacts to a
_terminal_ status, so a flipped-back-to-`executing` status means the kill is never surfaced.
The **log footer is authoritative** (it is written once, at process exit); socket liveness is
a heuristic that the OOM scenario violates.

Confirmed against upstream source: the first branch of `enrichDetachedStatus`
(`if (alive && enriched.status === 'executed')`) flips `status`→`'executing'` and sets
`exitCode`/`endTime`→`null`, and never consults `readExitCodeFromLog` — even though the very
next branch does. Filed as
[link-foundation/start#134](https://github.com/link-foundation/start/issues/134) with a runnable
repro (`experiments/upstream-start-enrichDetachedStatus-flip.mjs`) that reproduces the flip
(`executed`/`137` → `executing`/`null`) against a real lingering `screen` session. It is a
regression of the fix for upstream #60 / #101 (the same "executing while actually finished"
symptom), whose remedy introduced `enrichDetachedStatus` in the first place.

### RC-2 — No durable session registry → a restart orphans everything

The session monitor kept its registry purely in memory. If the bot itself is killed (the OOM
event could just as easily have taken the bot), every detached `/solve` is orphaned with no
record to resume from, and the user's messages are stuck forever.

### RC-3 — No "last alive" marker → can't bound what to resume

There was no periodic, timestamped bot heartbeat, so even with a session list there was no way
to answer requirement #4's question — "which sessions were executing when the bot was last
alive?" — and no way to pinpoint the exact moment of a total failure (requirement #3).

### RC-4 — Logs were overwritten on restart

The bot log was opened in a way that could clobber the previous run, destroying the very
evidence needed to reconstruct a failure (violating requirement #4).

### RC-5 — Completion messaging had no "killed" vocabulary

Even when an exit code surfaced, the completion message classified outcomes as only
success/failure; a signal kill (137/143/139) was not called out as a distinct, recognizable
state, so an OOM looked like an ordinary non-zero failure (or nothing at all).

## Proposed Solutions & Plans (per requirement, with existing components considered)

- **#1 (detect kills):** Treat the **log footer exit code as authoritative**; cross-check a
  status of `executing` against (a) the footer and (b) a direct backend-liveness probe, but
  only after a minimum session age so a just-started session isn't misread. Add a shared,
  dependency-free status vocabulary (`KILLED`/`FAILURE`/`RUNNING`, signal classification) so
  every call site agrees on what 137/143/139 mean. _Existing components:_ none adopted — this is
  a thin classifier over start-command's own JSON; no library needed.
- **#2 (resume):** Persist the plain-data subset of every tracked session and reload+re-register
  it on launch, resuming only sessions started **before** the bot's start time. _Existing
  components:_ modeled on **PM2 `save`/`resurrect`** (dump-file persistence) but kept in-process
  (a JSON snapshot) to avoid a daemon/Redis dependency.
- **#3 (timestamps):** A logger where **every line begins with an ISO-8601 millisecond
  timestamp**, plus structured `event()`/`heartbeat()` markers, so the exact failure moment is
  always greppable. _Existing components:_ evaluated `pino`/`winston`; rejected to keep the bot
  dependency-light and fully injectable for tests — the formatter is a few lines.
- **#4 (no data destroyed + bound resume):** **Rotate, never overwrite** — on startup the prior
  active log is preserved as a timestamped backup; an append-only `sessions-events.jsonl` audit
  log is never truncated; a periodic **heartbeat** records "last alive" so resume only touches
  sessions that were live at that point. _Existing components:_ logrotate/`pino-roll` patterns,
  reimplemented in-process for the same dependency reason.
- **#5 (case study):** This document + the preserved `source/` artifacts.
- **#6 (debug/verbose):** Thread a `verbose` flag through the new status/footer/liveness/resume
  paths with explicit `[VERBOSE]`/`debug()` tracing, so the next failure leaves a trail.
- **#7 (upstream):** File an issue on `link-foundation/start` for the `enrichDetachedStatus`
  liveness-over-exit-code flip (RC-1), with a reproducible example, the footer-authoritative
  workaround, and a suggested fix. _Filed:_
  [link-foundation/start#134](https://github.com/link-foundation/start/issues/134), with a
  runnable repro (`experiments/upstream-start-enrichDetachedStatus-flip.mjs`) that copies the
  three upstream functions verbatim and demonstrates the flip against a real lingering `screen`
  session (`executed`/`137` → `executing`/`null`).
- **#8 (whole codebase):** Centralize the new logic in shared libs
  (`session-status.lib.mjs`, `session-store.lib.mjs`, `bot-logger.lib.mjs`,
  `bot-lifecycle.lib.mjs`) and route **every** completion/monitor path through them, so there is
  a single source of truth rather than per-call-site copies.

## Implemented Solution (this PR, #1928)

- **`src/session-status.lib.mjs`** — shared, dependency-free status vocabulary:
  `normalizeExitCode`, `RUNNING/KILLED/FAILURE`, `isKilled/isFailure/isTerminal/isExecuting`
  predicates, `describeExitSignal` and `classifyExitStatus` (137→SIGKILL, 143→SIGTERM,
  139→SIGSEGV, 130→SIGINT).
- **`src/isolation-runner.lib.mjs`** — `parseSessionExitFooter` (reads the authoritative
  `Exit Code:` footer, last match wins), `readSessionExitFromLog`, `checkBackendSessionAlive`,
  and `isSessionRunning` cross-check (RC-1).
- **`src/session-monitor.lib.mjs`** — `getIsolationSessionState` now reconciles an `executing`
  status against the footer + a liveness probe gated by a 90s minimum age; `trackSession`/
  completion persist through the store; `resumeTrackedSessions` re-registers prior sessions
  started before bot start (RC-1, RC-2).
- **`src/session-store.lib.mjs`** — durable `sessions.json` snapshot (atomic write) + append-only
  `sessions-events.jsonl` audit log that is never truncated (RC-2, RC-4).
- **`src/bot-logger.lib.mjs`** — timestamped rotating logger; `rotateOnStart` preserves the prior
  log as a timestamped backup, size-based rotation mid-run, `maxBackups` pruning (negative =
  unbounded) (RC-3, RC-4).
- **`src/bot-lifecycle.lib.mjs`** — injectable `createHeartbeat` (periodic "last alive" marker),
  `resumeSessionsOnLaunch`, and `createShutdownHandler` (records a final `bot_shutdown` event so
  an orderly stop is distinguishable from a hard kill) (RC-3).
- **`src/work-session-formatting.lib.mjs`** — three-way completion message:
  ❌ killed (signal) / ❌ failed (non-zero) / ✅ success (RC-5).
- **`src/telegram-bot.mjs`** — wires the logger + store + heartbeat + resume + shutdown handler at
  startup; records `bot_starting`; resumes before entering long-polling.
- **`src/telegram-terminal-watch-command.lib.mjs`** — the **second location** of the same bug,
  found by the requirement #8 audit. `/terminal_watch`'s live loop decided "completed" purely from
  `--status`, so a session killed while `--status` still read `executing` would be **polled
  forever** with a misleading "running" snapshot — the #1927 silent-hang in the watch path. New
  `reconcileWatchCompletion` cross-checks the authoritative footer: once an `Exit Code:` is
  recorded the watch stops, corrects the displayed status to the real terminal one (e.g. `killed`),
  and a completed-but-failed session renders a ❌ failure title instead of a ✅ (RC-1, req #8).
- **Tests:** `tests/test-issue-1927-*.mjs` (status vocabulary, log-footer parsing, completion
  labeling, the core killed-detection regression, session store, resume, bot logger, bot
  lifecycle, terminal-watch kill-detection) — all green.

## Requirement #8: Codebase-Wide Audit ("fix in all places")

The root flaw is _trusting a non-terminal `--status` (e.g. `executing`) without cross-checking the
authoritative log footer_. Every call site of `querySessionStatus` / session-status code was audited
to decide whether it shares that flaw. The footer reconciliation was applied **only** where trusting
`executing` produces the #1927 symptom (a missed kill report or an infinite poll); sites where the
non-terminal default is already the _safe_ behavior were intentionally left unchanged.

| Call site                                                                | Trusts `executing`? | #1927 impact                              | Decision                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-monitor.lib.mjs` `getIsolationSessionState` (completion)        | yes                 | **kill unreported / hang**                | **Fixed** — footer + 90s-gated liveness probe                                                                                                                                                                                                                                                                                                  |
| `session-monitor.lib.mjs` `getRunningSessionItems` (listing)             | yes                 | dead session listed "running"             | **Fixed** — calls `getIsolationSessionState`, inheriting its footer + liveness reconciliation                                                                                                                                                                                                                                                  |
| `telegram-terminal-watch-command.lib.mjs` `/terminal_watch`              | yes                 | **polls forever, misleading snapshot**    | **Fixed** — `reconcileWatchCompletion` (footer authoritative)                                                                                                                                                                                                                                                                                  |
| `cleanup.os.lib.mjs` `listActiveTaskRefsFromSessions` → `getActiveTasks` | yes                 | a killed session counts as an active task | **Kept as-is (deliberate)** — an active task → `action:'keep'` (folder _protected_ from deletion). Counting a killed session as active errs toward **keeping** a dead workspace — the safe default for a destructive op. Applying the footer here would make deletion **more aggressive** (a mis-parsed footer could delete a live workspace). |
| `cleanup.os.lib.mjs` `collectProcessDebugSessions` (debug listing)       | no                  | none — only reads `status.exists`         | **Kept as-is** — branches only on whether the session _exists_, never on executing-vs-terminal, so the RC-1 flip cannot affect it; purely informational                                                                                                                                                                                        |
| `telegram-log-command.lib.mjs` `/log`                                    | yes                 | DM-vs-chat routing only                   | **Kept as-is** — one-shot, no loop; the delivered log file already contains the kill footer, so the user sees it regardless                                                                                                                                                                                                                    |

`getIsolationSessionState` is the single reconciliation chokepoint: all four of its callers in
`session-monitor.lib.mjs` — `monitorSessions` (completion), `getRunningSessionItems` (listing),
`hasActiveSessionForUrlAsync` (duplicate-launch guard), and `getRunningTrackedIsolationSessions` —
inherit the footer + liveness cross-check automatically, so there is one source of truth rather than
four per-call-site copies.

The fix targets the **reporting and hang** paths (where a wrong `executing` silently loses a failure
or spins forever). The cleanup path's non-terminal default is the correct, safer behavior for a
destructive (workspace-deletion) operation, so it is left intact rather than made more aggressive.

## Residual Notes

- The OOM event itself is an environment/capacity problem (**four** concurrent `opus --attach-logs`
  sessions on one host, at least one streaming large base64 PNGs). This PR makes the failure
  **visible and recoverable**; it does not add host-level memory limits or admission control — that
  is a deployment concern tracked separately if desired.
- The fix is defensive at the consumer (hive-mind) side. The authoritative upstream fix belongs in
  `start-command`'s `enrichDetachedStatus` (requirement #7, filed as
  [link-foundation/start#134](https://github.com/link-foundation/start/issues/134)); the
  cross-check here keeps hive-mind correct regardless of when upstream lands.
