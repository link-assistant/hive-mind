---
'@link-assistant/hive-mind': patch
---

fix(telegram): detect OOM/SIGKILL-ed detached sessions and resume tracking after a bot restart (#1927)

A `/solve` running in a detached `screen` session was OOM-killed (exit `137`),
but the Telegram bot stayed alive and **never reported the failure** — the job
silently hung forever. Two compounding gaps caused this:

**Root cause (RC-1, upstream).** The external `start-command` CLI's
`enrichDetachedStatus` re-derives a detached session's status from backend
liveness (`screen -ls`). When a shell lingers after the wrapped command is
already dead, `$ <id> --status` flips an already-completed record
(`status: executed`, `exitCode: 137`) **back to `executing` and nulls the exit
code**, even though `start` itself wrote an authoritative `Exit Code: 137` footer
to the log. The bot's monitor only reacts to a _terminal_ status, so the kill is
never surfaced. Confirmed against upstream source and filed with a runnable repro
as [link-foundation/start#134](https://github.com/link-foundation/start/issues/134)
(a regression of the fix for upstream #60/#101).

**Root cause (RC-2/3/4).** The session monitor's registry was in-memory only, so
a bot restart orphaned every detached `/solve`; there was no "last alive" marker
to bound what to resume; and the bot log could be overwritten on restart,
destroying the evidence needed to reconstruct the failure.

**Fix (defensive, consumer side — correct regardless of when upstream lands):**

- **`src/session-status.lib.mjs`** — a shared, dependency-free status vocabulary
  (`RUNNING`/`KILLED`/`FAILURE`, signal classification for 137/143/139/130) so
  every call site agrees on what an exit code means.
- **`src/isolation-runner.lib.mjs`** — `parseSessionExitFooter` /
  `readSessionExitFromLog` read the **authoritative log footer**, plus
  `checkBackendSessionAlive` / `isSessionRunning` probe the real backend.
- **`src/session-monitor.lib.mjs`** — when `--status` says `executing`, cross-check
  the footer (authoritative) and a backend-liveness probe gated by a 90s minimum
  session age, so a SIGKILL is reported instead of hanging, while a just-started
  session is never misread.
- **`src/session-store.lib.mjs`** — durable session registry (atomic
  `sessions.json` snapshot + append-only, never-truncated `sessions-events.jsonl`)
  so a restart can **resume** tracking and finally report sessions killed while
  the bot was down — resuming only sessions started **before** the bot's start
  time.
- **`src/bot-logger.lib.mjs`** — every log line is prefixed with an ISO-8601
  millisecond timestamp; structured `event()`/`heartbeat()` markers record "last
  alive"; logs **rotate, never overwrite** (prior log preserved as a timestamped
  backup) so no evidence is destroyed.
- **`src/bot-lifecycle.lib.mjs`** — heartbeat / resume-on-launch / orderly
  shutdown extracted from `telegram-bot.mjs` as pure injectable factories; a
  timestamped `bot_shutdown` marker distinguishes a clean stop from a hard kill.
- **`src/work-session-formatting.lib.mjs`** + `telegram-bot.mjs` — completion
  messages now call out a **killed** outcome (❌ killed / signal) distinctly from
  an ordinary failure.
- **`src/telegram-terminal-watch-command.lib.mjs`** — the same fix applied to the
  live `/terminal_watch` loop (req #8, "fix in all places"): it decided
  "completed" purely from `--status`, so a session killed while `--status` still
  read `executing` would be **polled forever** with a misleading "running"
  snapshot — the #1927 silent-hang, in the watch path. It now cross-checks the
  authoritative log footer (`reconcileWatchCompletion`), stops on a recorded exit,
  corrects the displayed status to the real terminal one (e.g. `killed`), and a
  completed-but-failed session renders a ❌ failure title instead of a ✅.

A `verbose` flag is threaded through the new status/footer/liveness/resume paths
with explicit `[VERBOSE]` tracing so the next failure leaves a trail (req #6).

Added `tests/test-issue-1927-*.mjs` (9 suites, 263 assertions: status vocabulary,
log-footer parsing, completion labeling, killed-detection, session store, resume,
bot logger, bot lifecycle, terminal-watch kill). Full deep-dive in
`docs/case-studies/issue-1927`
(timeline, 8 requirements, 5 root causes, per-requirement solutions, preserved
source artifacts), plus a runnable upstream repro under `experiments/`.
