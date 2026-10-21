# Case study: issue #2892, Docker daemon restart kills reported as OOM

- Issue: https://github.com/link-assistant/hive-mind/issues/2892
- Issue text, comments and the auto-fix evidence for router #724, #725 and #727:
  [data/issue-2892.md](./data/issue-2892.md)
- Related: #2900 (prevention with `live-restore`, see
  [its case study](../issue-2900/README.md)), #3533 (host reboot), #3125 (a real
  main-process OOM reported as "cause unknown").

## Summary

On 2026-10-09 the kernel OOM-killed the host dockerd. When systemd restarted it,
dockerd force-killed every container (exit 137). Four task containers still had
Docker's sticky `State.OOMKilled = true` from earlier child-process OOM kills
(rustc, clippy-driver) that they had survived. Hive Mind read
`OOMKilled && exitCode === 137` as "the task ran out of memory" and said so in
Telegram and in the PR comments. The root container, killed the same way in the
same second, had `OOMKilled = false`.

## Timeline (UTC)

| Time       | Event                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------- |
| earlier    | Task containers survive child OOM kills (724 x5, 725 x3, 727 x2, 728 x2); the flag stays true  |
| 12:11:39   | Kernel OOM-kills host `dockerd` (global OOM, not a container cgroup)                           |
| 12:11:41   | systemd: `docker.service: Main process exited, code=killed, status=9/KILL`                     |
| 12:11:45   | New dockerd: `Loading containers: start.`                                                      |
| 12:11:55   | `Container failed to exit within 10s of signal 15 - using the force` for each container        |
| 12:11:56   | Task containers record `FinishedAt`; the start-command watcher ends with `unexpected EOF`      |
| 13:31      | Root container started by hand; kill recovery reports the four tasks as `oom-killed`           |
| 2026-10-09 | Upstream: link-foundation/start#194, fixed by start PR #196 (`killed (docker daemon restart)`) |
| 2026-10-10 | auto-fix finds three more attempts with the signature; their containers are already removed    |
| 2026-10-12 | Upstream: start#209 / PR #210 add a bounded `docker events` OOM query for real main OOMs       |

## Requirements and status

| #   | Requirement (issue body and comments)                                                                           | Status                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Do not report `oom-killed` when the OOM flag comes from an earlier child kill the container survived            | Done. `resolveOomKilledState` consumes start-command's attributed `exitReason` before its own `oomKilled && 137` check. Any non-memory attribution (including `signal (SIGKILL; cause unknown)`) gives status `killed`, not `oom-killed`. |
| 2   | Detect a daemon restart (dockerd start later than `FinishedAt`, or many containers finished in the same second) | Done. `detectDockerDaemonRestart`, five sources in order (below). The "same second" signal uses the bot's own container as the anchor, because finish times alone are not enough (start#194).                                             |
| 3   | Report it as "killed by Docker daemon restart"                                                                  | Done. New kill cause `docker-daemon-restart`: PR notice title, kill diagnostics, the Telegram status line and the session list label all say so. The sticky OOMKilled evidence line is demoted.                                           |
| 4   | Hive Mind consumes the attributed `exitReason` instead of inferring OOM (comment of 2026-10-09)                 | Done (requirement 1).                                                                                                                                                                                                                     |
| 5   | Report the upstream part to link-foundation/start                                                               | Already done by the maintainer: start#194 (fixed in PR #196) and start#209 (PR #210).                                                                                                                                                     |
| 6   | Docs: recommend `"live-restore": true`                                                                          | Done under #2900: "Host Docker daemon settings" in `docs/DOCKER*.md`, linked from the READMEs. The kill notice also names the setting.                                                                                                    |
| 7   | Case study with the incident data                                                                               | This document and `data/issue-2892.md`.                                                                                                                                                                                                   |

## Root causes

1. Docker's `State.OOMKilled` is set once any process in the container is
   OOM-killed and is never cleared (moby#43564). It does not say the main
   process died of OOM.
2. start-command 0.35.4 mapped that flag plus exit 137 to
   `memory-exhaustion (cgroup-oom-killer)`. This was fixed upstream (start#194,
   PR #196).
3. Hive Mind did its own `oomKilled && exitCode === 137` check in
   `resolveOomKilledState` and never read the attributed `exitReason`. A daemon
   restart also kills start-command's watcher (`unexpected EOF`), so no exit
   footer is written and that check was the only path taken.
4. `describeKillCause` treated the sticky flag plus 137 as proof of an OOM kill.
   Only the host-reboot veto (#3533) overrode it; there was no daemon-restart
   cause.

## Solution

### Detection (`src/docker-daemon-restart.lib.mjs`)

`detectDockerDaemonRestart` attributes an exit 137 (or an unknown exit) to a
daemon restart. It never throws, and every probe is injectable:

1. start-command's `exitReason` `killed (docker daemon restart)`.
2. The log line `Exit evidence: docker-daemon-restart`. An
   `Exit evidence: main-oom` line stops the heuristics below.
3. The docker.service journal: a service exit or restart line plus
   `using the force` for this exact container ID.
4. dockerd's start time (systemd, then the dockerd process) within 60 s after
   the container's `FinishedAt`, for a container started before it.
5. The bot's own container (`docker inspect $HOSTNAME`, only when
   `/.dockerenv` exists): it was killed within 15 s of the task and restarted
   after it. This also works when the task container was already removed, and
   inside the bot container, where the host journal and dockerd are not visible.
   Two unrelated containers dying together points at the daemon, not at a task's
   cgroup.

### Wiring

- `src/session-monitor.oom.lib.mjs`: before the `oom-killed` step,
  `resolveDaemonRestartKill` runs. A detected restart, or any attributed
  non-memory `exitReason`, resolves to status `killed`.
- `src/session-monitor.kill-sections.lib.mjs`: the plain-kill path (no OOM flag)
  runs the same detection, so the root-container case is named too.
- `src/session-monitor.lib.mjs` passes the detector from the isolation runner;
  tests inject their own and the default for library callers is none, so no
  real `docker` call runs in tests.
- The finding is stored as `sessionInfo.dockerDaemonRestart` and persisted
  (`PERSISTABLE_FIELDS`), so it survives a bot restart.
- `src/session-kill-diagnostics.lib.mjs`: cause `docker-daemon-restart`, with
  the evidence lines; a host reboot (#3533) still takes precedence. The OOMKilled
  line says the flag is sticky and does not explain this exit. "Cause unknown"
  alone is never upgraded to a forced kill or a daemon restart, because a real
  main-process OOM can also come back as "cause unknown" (#3125).
- `src/session-kill-recovery.lib.mjs`: title "Working session was killed by
  Docker daemon restart", headline "recovered from a Docker daemon restart".
  Kill recovery still runs.
- `src/work-session-formatting.lib.mjs`: "Docker daemon restart" label and
  "killed by Docker daemon restart (SIGKILL)" in the session list.
- `src/session-tool-exit.lib.mjs`: the exit line no longer adds "cgroup OOM" for
  this cause.

## Tests

`tests/issue-2892-daemon-restart.test.mjs` (15 tests, mocks only). It replays
the incident journal and status:

- exit reason parsing; the journal needs both lines for the exact container;
- detection order, and no detection for other exits, without a restart, or
  against `main-oom` evidence; the dockerd start-time sources;
- `resolveOomKilledState` returns `killed` for the daemon restart and for
  `cause unknown`, keeps `oom-killed` for `memory-exhaustion` (#2015), and
  remembers the finding;
- `describeKillCause` names the cause and demotes the sticky flag; "cause
  unknown" is not downgraded;
- the PR notice, the Telegram status and the completion report;
- persistence across a bot restart;
- the bot-container anchor for removed and inspected task containers, and no
  match for a task that ended an hour earlier.

The issue #1914, #2015, #2303, #2408, #2498 and #3533 suites still pass.

## Limits

- Inside the bot container the host journal, `systemctl` and `pgrep dockerd`
  are usually not visible. Detection then relies on start-command's attribution
  (0.37.9 or later; the images pin 0.38.0), its log evidence, or the
  bot-container anchor.
- The bot-container anchor needs the bot to run in a container that was killed
  by the same restart. A bot on the host, or a bot whose container was recreated
  (new ID, no old `FinishedAt`), gives no anchor.
- The start-time heuristic can misattribute a real OOM that happens within 60 s
  before a daemon restart. A `main-oom` evidence line prevents that.
- Prevention is #2900: with `"live-restore": true` a daemon restart does not
  kill containers at all.

## Upstream

- link-foundation/start#194, fixed by start PR #196, included in the pinned
  start-command. start#209 / PR #210 cover the opposite case (a real main OOM
  after the last sample).
- moby#43564 already tracks the sticky flag. No new issue is needed.
- [link-foundation/start#241](https://github.com/link-foundation/start/issues/241):
  in start-command 0.38.0 the only daemon-restart evidence is a local
  `journalctl -u docker.service` (`src/lib/exit-evidence.js:80-96`). A `$`
  inside a container that reaches the host through a mounted `docker.sock`
  counts as local but has no host journal, so a daemon-restart kill gets
  `Exit evidence: unavailable`. The issue suggests Docker-API evidence that
  survives a daemon restart (`State.FinishedAt` / `StartedAt` of other
  containers). The bot-container anchor here covers that gap downstream. The
  report is based on the package source; the live repro steps in it were not
  run.
