# Issue 2134 case study: a work session reported as OOM-killed while it kept running for another 3.5 hours

## Executive summary

On 2026-08-02 the Telegram bot announced

> ❌ **Work session killed — out of memory or forced kill (SIGKILL) (exit code: 137)**

for the `/solve` run on
[hive-mind#2130](https://github.com/link-assistant/hive-mind/issues/2130)
(session `30920087-c181-47f0-bc75-66a78402d400`, start-command execution
`8716e72e-8ff0-491d-8170-ece5a6b30354`).

The session **was not killed**. It kept running for another **3 hours 29
minutes**, finished normally, and auto-merged
[hive-mind#2131](https://github.com/link-assistant/hive-mind/pull/2131). The
authoritative footer of its own execution log reads:

```
Finished: 2026-08-02 21:11:07.311
Exit Code: 0
```

Three independent defects combined into the reported symptom:

1. **A real host OOM event was mis-attributed to this session as a kill.** The
   host was at **822 MB available of 12.5 GB (93.4 % used)** at 17:40:30 with 5
   concurrent sessions. The kernel OOM killer fired, Docker set
   `State.OOMKilled = true` on this container, and start-command's `$ --status`
   flipped the record to `status executed / exitCode 137` — while
   `docker inspect` still reported the container **running**. Hive Mind's
   `oomKilled === true` branch is the **only** terminal path in the session
   monitor that skips every cross-check added by issues #1927, #1939 and #2117,
   so it believed the status without verifying anything.
2. **The offered resume command was garbage:** `--resume "${sessionId}"`. The
   session-id scanner accepts any token after `Session ID:`, and the run had
   printed Hive Mind's own source code (which contains the template literal
   `` `📌 Session ID: ${sessionId}` ``) into its log.
3. **Nothing ever corrected the false report.** The session was dropped from
   tracking at 17:42:06; the successful completion at 21:11 was never announced
   in Telegram and never mentioned in the pull request — exactly the "silently
   continuing, with no indication that fail happened" symptom in the issue.

The screenshot from the issue is preserved as
[`data/issue-screenshot.png`](data/issue-screenshot.png).

## Evidence

All raw data is committed under [`data/`](data):

| File                                                    | What it is                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| `data/hive-telegram-bot.log.txt` (493 665 lines)        | Telegram bot log with `--verbose` (from the gist linked in the issue) |
| `data/working-session-8716e72e.log.txt` (311 289 lines) | start-command execution log of the session that was declared killed   |
| `data/issue-screenshot.png`                             | The Telegram message shown in the issue                               |

All times are UTC on 2026-08-02.

| Time               | Event                                                                                                                                      | Source                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 16:36:01           | start-command launches the detached docker session `30920087-…` (execution `8716e72e-…`, image `konard/hive-mind-dind:2.11.5`)             | working log, header                                          |
| 16:36:24           | `📈 [RESOURCES] phase=solve_start` — 9.77 GB available of 12.5 GB                                                                          | working log:100                                              |
| 16:37:15           | `phase=after_clone` — 10.4 GB available                                                                                                    | working log:1302                                             |
| 17:40:30           | Bot heartbeat: **availableBytes 822 599 680 (0.82 GB) of 12.54 GB — 93.4 % used**, load1 12.83, disk 31 % used                             | bot log, heartbeat `uptimeSec 21151`                         |
| ~17:40:30–17:41:30 | **Kernel OOM killer fires on the host.** ~9 GB is freed between two heartbeats; Docker sets `OOMKilled=true` on the container              | inferred from the two heartbeats + `oomKilled` in `--status` |
| 17:41:23           | `docker inspect for '30920087-…': running` — status `executing`, `exitCode null`                                                           | bot log:~87700                                               |
| 17:41:30           | Bot heartbeat: 9.78 GB available again (memory released by the OOM kill)                                                                   | bot log, heartbeat `uptimeSec 21211`                         |
| 17:41:30           | `$ --status` now returns `status executed`, `exitCode 137`, `oomKilled true` → `[VERBOSE] … treating it as terminal oom-killed (exit 137)` | bot log:87852-87854                                          |
| 17:42:06           | Completion message sent, session removed from tracking, `session_completed {"exitCode":137,"status":"oom-killed"}` — **emitted 3 times**   | bot log:88480, 88539, 88605                                  |
| 17:42:06           | `editMessageText` fails with `400: message is not modified` (duplicate identical completion edit)                                          | bot log:88482                                                |
| 17:42:11           | `session-resume: last tool session id … is ${sessionId} (scanned 3 chunks)` → resume command offers `--resume "${sessionId}"`              | bot log:88600                                                |
| 17:42 → 21:11      | **The container keeps running.** No monitoring, no messages, no PR comment                                                                 | —                                                            |
| 21:11:02           | `📈 [RESOURCES] phase=solve_exit` — 8.9 GB available, disk 35.8 % used, `solve exit 0`                                                     | working log:311271                                           |
| 21:11:04           | `Pull request: #2131 has been auto-merged`                                                                                                 | working log:311234                                           |
| 21:11:07           | start-command footer: `Finished: 2026-08-02 21:11:07.311` / **`Exit Code: 0`**; container kept with `Reason: exitCode=0 oomKilled=true`    | working log, tail                                            |

Two decisive cross-checks:

- `grep -c 'Exit Code: 137' data/working-session-8716e72e.log.txt` → **0**. The
  137 was never in the log; it came from the OOM/status path, not from the
  fabricated-footer defect of issue #2117.
- The working log contains exactly **one** `🚀 solve v2.11.5` banner (line 90).
  No auto-restart and no auto-resume ever happened — the premise "if we do
  auto-resume/restart by default" in the issue describes a behaviour that does
  not exist yet for killed _sessions_ (only for in-process agent restarts).

## Root causes

### RC1 — `oomKilled === true` is treated as terminal without any verification

`src/session-monitor.lib.mjs` (before this PR):

```js
if (statusResult?.exists && statusResult.status) {
  if (statusResult.oomKilled === true) {
    return resolveOomKilledState(sessionName, sessionInfo, statusResult, { verbose, runner, exitFromLog });
  }
  if (runner.isExecutingSessionStatus(statusResult.status)) {
    /* #1927 cross-checks */
  }
  if (runner.isTerminalSessionStatus(statusResult.status)) {
    /* footer wins, #1939/#2117 deferral */
  }
}
```

`resolveOomKilledState()` (`src/session-monitor.stale-executing.lib.mjs`) read
the log footer but only used it to _pick an exit code_; a footer that says
`finished: false` did not stop it, and container liveness was never probed. It
returned `{ running: false, status: 'oom-killed' }` unconditionally.

That is wrong because **`State.OOMKilled` is not a statement about the
container's main process**. It is set when _any_ process in the container's
cgroup is killed by the OOM killer, and it stays `true` afterwards — the
container can, and here did, keep running and exit 0.
See [moby/moby#47618](https://github.com/moby/moby/issues/47618),
[Docker forums: "Why Docker Container State OOMKilled not working properly?"](https://forums.docker.com/t/why-docker-container-state-oomkilled-not-working-properly/61824)
and [missing-container-metrics](https://github.com/Paycasso/missing-container-metrics),
which exists precisely because the OOM signal Docker exposes is coarse.

Issue #2015 introduced this branch to stop a genuinely OOM-killed session from
being polled forever. That requirement is preserved: the fix only refuses to
declare a kill **while the container is demonstrably alive**.

### RC2 — the session-id scanner accepts template placeholders

`src/session-resume.lib.mjs`:

```js
const SESSION_ID_MARKER_RE = /Session ID:\s*`?([^\s`]+)`?/gi;
```

Any non-whitespace token is accepted; only `unknown` and `n/a` were filtered.
The run had `cat`-ed Hive Mind's own sources, which contain
``console.log(`📌 Session ID: ${sessionId}`)``, so the literal string
`${sessionId}` won the "last match" race and was offered to the user as a resume
id. Tool session ids are UUIDs (Claude/Codex) or comparable opaque ids — a
shape check is enough to reject this class of false positive.

### RC3 — no diagnosis of _why_ a kill happened

The killed message said "out of memory **or** forced kill" because nothing
inspected the machine state. All the data needed to disambiguate was already
being collected and thrown away:

- `src/solve.resource-diagnostics.lib.mjs` writes
  `📈 [RESOURCES] phase=… memAvailableBytes=… diskUsedPercent=…` markers into the
  session log (`solve_start`, `after_clone`, `after_agent`, `restart_*`,
  `solve_exit`) and can already parse them back.
- The bot logs a `bot_heartbeat` resource snapshot every 60 s — the 822 MB
  reading that explains this incident came from there.
- On Linux, `/sys/fs/cgroup/memory.events` (`oom`, `oom_kill` counters),
  `/proc/meminfo`, `/proc/pressure/memory` and `dmesg -T | grep -i
'killed process'` name the exact victim process. None were consulted.

### RC4 — a terminal report is never revisited

Once a session is removed from tracking the monitor forgets it. When the
"killed" session later finished successfully, nothing corrected the Telegram
message and nothing was written to the pull request.

### RC5 (secondary) — duplicate completion notifications

`session_completed` was emitted **three times** for this session within six
seconds (17:42:06.442, 17:42:06.562, 17:42:12.498), and the second edit failed
with `400: Bad Request: message is not modified`. `monitorSessions()` can
overlap with itself; the completion path is not re-entrancy-guarded.

## Requirements extracted from the issue

| #   | Requirement (verbatim intent)                                                                                                                                                           | Where it is addressed                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| R1  | Do not report a kill that did not happen (the underlying symptom of the screenshot)                                                                                                     | RC1 fix — verified OOM classification                        |
| R2  | In the pull request, if auto-resume/restart happens, say so and upload the intermediate working-session log                                                                             | `solve` recovery notice + `--attach-logs`-gated upload       |
| R3  | In Telegram, show `recovered from out of memory` / `recovered from forced kill` warnings                                                                                                | recovery section in the completion message                   |
| R4  | Be exact about the root cause: use the existing resource monitoring — almost all RAM used → say OOM; disk full → say disk; otherwise forced kill; name the process that caused the kill | kill-cause diagnostics from resource markers + system probes |
| R5  | Options and envs to configure the behaviour, consistent in **all** places (Telegram and PR); nothing deleted; all configurations handled                                                | `--on-session-kill` / `HIVE_MIND_ON_SESSION_KILL` et al.     |
| R6  | Logs are uploaded as usual **only** if `--attach-logs` is enabled                                                                                                                       | recovery upload is gated on `--attach-logs`                  |
| R7  | Download all data into `docs/case-studies/issue-2134`, deep analysis, timeline, requirements, root causes, solution plans, prior art                                                    | this document                                                |
| R8  | Add debug output / verbose mode where data was insufficient                                                                                                                             | new verbose diagnostics (below)                              |
| R9  | Report upstream issues with reproducible examples, workarounds and code-fix suggestions                                                                                                 | link-foundation/start issue (below)                          |
| R10 | Apply the fix everywhere the problem exists in the codebase                                                                                                                             | codebase sweep (below)                                       |

## Solution plans

### R1 — verified OOM classification

`resolveOomKilledState()` becomes async and follows the same evidence ladder the
rest of the monitor already uses:

1. **Log footer wins.** `finished: true` → use its exit code and classification.
   Exit 0 with `oomKilled=true` is a _survived_ OOM event, not a kill.
2. **Liveness beats the status record.** No footer + the backing container is
   still alive (`docker inspect`) → the session is still running; keep polling
   and remember that an OOM event was observed.
3. **Otherwise** report `oom-killed` as before (issue #2015 behaviour).

The same liveness cross-check is applied to the unverified-docker-failure path
of issue #2117, so no terminal failure is announced while the container runs.

### R2/R3/R5/R6 — consistent recovery reporting

- A session that survived an OOM event completes with a warning section
  (`⚠️ Recovered from out-of-memory event` / `… from forced kill`) in Telegram.
- `solve` posts the same recovery notice to the pull request when it restarts a
  killed working session, and uploads the intermediate log **only** when
  `--attach-logs` is set.
- Behaviour is selected by one option, honoured identically by the bot and by
  `solve`: `--on-session-kill=report|resume` (env
  `HIVE_MIND_ON_SESSION_KILL`), with `report` (today's behaviour) as the
  default so nothing changes silently.

### R4/R8 — kill-cause diagnostics

A new `describeKillCause()` collects, in order of confidence:

- the last `📈 [RESOURCES]` marker before the end of the session log
  (`memAvailableBytes`, `memTotalBytes`, `diskUsedPercent`, `diskAvailableBytes`);
- `/sys/fs/cgroup/memory.events` (`oom_kill` count) and `memory.max`;
- `docker inspect` `State.OOMKilled` / `State.ExitCode`;
- `dmesg` OOM-killer lines naming the victim (`Killed process <pid> (<comm>)`),
  when readable.

and renders one of:

- `out of memory — 0.8 GB of 12.5 GB available (93 % used) at 17:40:30, kernel OOM killer terminated <process>`
- `disk full — 0.2 GB of 192.7 GB available (99.9 % used)`
- `forced kill — memory (8.3 GB available) and disk (35.8 % used) were healthy`

with `[VERBOSE]` lines for every probe so the next incident is diagnosable even
if the heuristic picks wrong (R8).

### R9 — upstream

`$ --status` reported `status executed / exitCode 137` for a container that
`docker inspect` reported as **running**, purely because `State.OOMKilled` was
true. That is an upstream defect in
[link-foundation/start](https://github.com/link-foundation/start): the
detached-docker status enrichment must not synthesise a terminal result from
`OOMKilled` while `State.Running` is true.

### Prior art / existing components consulted

- **moby/moby** `State.OOMKilled` semantics ([#47618](https://github.com/moby/moby/issues/47618)) — the reason a container-level OOM flag cannot be treated as a process outcome.
- **missing-container-metrics** ([GitHub](https://github.com/Paycasso/missing-container-metrics)) — exports `oom_kills` per container by watching Docker events + cgroup counters; confirms `memory.events`/`oom_kill` as the canonical counter to read.
- **cgroup v2 `memory.events` / `memory.oom.group`** — the kernel-side source of truth for "how many processes in this cgroup were OOM-killed"; `memory.oom.group=1` makes an OOM kill terminate the whole container, which is the configuration that would make Docker's flag meaningful.
- Internal prior art reused rather than reinvented: `src/session-monitor.docker-terminal.lib.mjs` (#2117 deferral), `src/session-monitor.stale-executing.lib.mjs` (#1927 footer-first ladder), `src/solve.resource-diagnostics.lib.mjs` (resource markers), `src/env-config.lib.mjs` (env parsing conventions), `src/auto-restart-budget.lib.mjs` (#2119 restart budget).

## Codebase sweep (R10)

Every place that turns a status record into "this session ended" was reviewed:

| Location                                                                | Verdict                                                                           |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/session-monitor.lib.mjs` `getIsolationSessionState()`              | fixed — OOM branch now verified; unverified docker failures also liveness-checked |
| `src/session-monitor.stale-executing.lib.mjs` `resolveOomKilledState()` | fixed — footer/liveness ladder                                                    |
| `src/session-monitor.docker-terminal.lib.mjs`                           | reused for the OOM deferral                                                       |
| `src/session-resume.lib.mjs` `extractSessionIds()`                      | fixed — placeholder/shape validation                                              |
| `src/isolation-runner.lib.mjs` `parseSessionStatusOutput()`             | unchanged — parsing `oomKilled` is correct; only its _interpretation_ was wrong   |
| `src/cleanup.lib.mjs` (`Exited (137)` parsing)                          | unchanged — reports container state, never a session outcome                      |

## Related issues

- #1927 — killed session never reported (footer-first ladder)
- #1939 — docker terminal status with unknown exit code while the container runs
- #2015 — `oomKilled` must be terminal (the branch fixed here)
- #2117 — fabricated docker exit code (deferral reused here)
- #2119 — shared auto-restart budget
