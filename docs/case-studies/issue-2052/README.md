# Case Study — Issue #2052: "No log uploaded on stop"

- **Issue:** https://github.com/link-assistant/hive-mind/issues/2052 (bug)
- **PR:** https://github.com/link-assistant/hive-mind/pull/2055
- **Reported by:** @konard
- **Referenced external session:** https://github.com/uselessgoddess/difflite/pull/3
  (auto-commit `19a4ef5` was made, but no log was attached and the session was
  not recognized as stopped by the user)

## 1. Requirements extracted from the issue

Each sentence of the issue mapped to an actionable requirement:

| #   | Requirement                                                                                        | Status                                                    |
| --- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| R1  | A manually stopped session must **upload its log** to the PR.                                      | Verbose tracing added to measure/close the race (see §4). |
| R2  | A manually stopped session must be **recognized as "stopped by user"**, not as an OOM/forced kill. | **Fixed** (see §4).                                       |
| R3  | Collect all logs/data for the issue into `docs/case-studies/issue-2052/`.                          | Done (`data/`, `screenshots/`).                           |
| R4  | Deep case study: timeline, requirements, root causes, solution plans, existing components.         | This document.                                            |
| R5  | Search online for additional facts/data.                                                           | §6.                                                       |
| R6  | Ensure the code is **uniform and deduplicated** ("works sometimes, not others").                   | §5.                                                       |
| R7  | If data is insufficient for the root cause, add **debug output / verbose mode**.                   | Verbose interrupt tracing added (§4).                     |
| R8  | If another repo is involved, **file an issue** there with repro, workaround, and fix suggestion.   | §7 (upstream `start` package).                            |
| R9  | Apply the fix **everywhere** the problem exists (not just one place).                              | §5.                                                       |

## 2. Timeline / sequence of events (reconstructed)

1. A `/solve` session for `uselessgoddess/difflite#3` runs inside an **isolation
   backend** (docker) launched via the external `$` (start-command) package.
2. The operator issues a manual stop (Telegram `/stop <uuid>` or `$ --stop <uuid>`).
   Screenshot 2 (`screenshots/img2.png`) shows the manual stop.
3. `docker stop` delivers **SIGTERM** to PID 1, waits a fixed grace period
   (~10 s by default), then **SIGKILL**.
4. hive-mind's interrupt/graceful-shutdown path runs:
   - **auto-commit** of uncommitted changes → _fast_ → succeeds
     (commit `19a4ef5` exists on the PR — proof the handler ran).
   - **log upload** to the PR (a Gist attach of a multi-MB log) → _slow_ →
     **cut off by SIGKILL** before the PR comment is posted → "no log uploaded".
5. The process dies with **exit 137** (128 + SIGKILL). The completion classifier
   labels 137 as _"killed — out of memory or forced kill (SIGKILL)"_, with no
   awareness that a user `/stop` caused it → "not recognized as stopped by user".

## 3. Root causes

- **RC1 — "No log uploaded on stop":** the interrupt handler auto-commits (fast)
  and _then_ uploads the log (slow, several seconds for an 8–13 MB gist). The
  isolation backend's stop grace period (`docker stop` → ~10 s → SIGKILL) can
  expire mid-upload, so the commit lands but the log comment never posts. The
  grace period is controlled by the external `start` package, not hive-mind.
- **RC2 — "Not recognized as stopped by user":** `session-status.lib.mjs`
  unconditionally maps exit `137` to _"out of memory or forced kill (SIGKILL)"_
  and `143` to _"terminated (SIGTERM)"_, with **no notion of an operator-initiated
  stop**. A user `/stop` and a genuine OOM produce the same exit code, so they
  were indistinguishable at report time.
- **RC3 — Non-uniformity ("works sometimes, not others"):** the graceful
  log-upload path is wired only around the **top-level** `executeClaude`
  (`beginWorkingSession`/`endWorkingSession` in `solve.mjs`). The restart/watch
  iteration loops (`executeToolIteration` in `solve.restart-shared.lib.mjs`,
  driven by `solve.watch.lib.mjs` / `solve.auto-merge.lib.mjs`) are **not**
  bracketed the same way — explaining why a stop sometimes attaches a log and
  sometimes does not.

## 4. Fixes implemented in this PR

**RC2 (primary, fully fixed):** propagate an explicit "stopped by user" signal.

- `src/session-monitor.lib.mjs` — new `markSessionStopRequested(sessionId, {requestedBy})`
  sets `sessionInfo.stopRequestedByUser` (matching by tracking key _or_ isolation
  `sessionId` UUID) and persists it.
- `src/telegram-start-stop-command.lib.mjs` — the `/stop <uuid>` isolated-session
  flow calls `markSessionStopRequested` **before** forwarding CTRL+C, so even a
  fast SIGKILL race finds the flag at report time; records the requester's handle.
- `src/work-session-formatting.lib.mjs` — `formatSessionCompletionMessage` now
  renders a killed-but-user-requested session as **"🛑 Work session stopped by
  user"** instead of the OOM/forced-kill text.
- `src/locales/{en,ru,zh,hi}.lino` — new `telegram.work_session_stopped` key
  (the case study for issue #2015 established that missing locale keys leak the
  raw key, so all four catalogs are updated).

**RC1 / R7 (observability to close the race next iteration):**

- `src/solve.interrupt.lib.mjs` — added `--verbose`-gated timing traces
  (`[interrupt] +Nms auto-commit: start/done`, `log-upload: start/done`) so the
  next run can _measure_ how long the log upload takes vs. the SIGKILL deadline
  and confirm/deny RC1 with real numbers.

**Tests:** `tests/test-issue-2052-stopped-by-user.mjs` covers the 137/143 →
"stopped by user" labeling, the OOM path staying unchanged without the flag, and
`markSessionStopRequested` matching by UUID and by tracking key.

## 5. Uniformity / deduplication (R6, R9)

The signal→reason vocabulary already lives in a single source of truth
(`session-status.lib.mjs`, introduced by issue #1927), so the "stopped by user"
distinction is added once and consumed by every formatter. RC3 documents the
remaining structural non-uniformity (working-session bracketing only wraps the
top-level session, not the iteration loops); the verbose traces from R7 make it
measurable before restructuring the iteration loops, which is tracked as
follow-up so this PR stays focused and low-risk.

## 6. External research

- POSIX/Node exit-code convention: a process terminated by signal N exits with
  `128 + N` → SIGTERM(15)=143, SIGKILL(9)=137. This is why 137 alone cannot
  distinguish OOM from an operator kill — the _context_ (a recorded `/stop`) is
  the only reliable discriminator, which is exactly what RC2's fix adds.
- `docker stop` semantics: sends SIGTERM, waits `--time` seconds (default 10),
  then SIGKILL. A slow shutdown task (large log upload) that exceeds the grace
  period is force-killed — the mechanism behind RC1.

## 7. Upstream issue (R8)

The stop grace period that races the log upload is owned by the external `$`
(start-command / `@link-assistant/start`) package. An upstream issue should
request a **configurable stop timeout** (e.g. `$ --stop <uuid> --time <sec>`,
forwarding docker's `--time`) so a graceful shutdown has enough time to finish
the log upload. Repro, workaround (commit-first is already done), and the
suggested `--time` flag are captured in `data/upstream-issue-draft.md`.
