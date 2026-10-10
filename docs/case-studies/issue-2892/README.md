# Case study: issue #2892 — containers killed by a Docker daemon restart are reported as OOM-killed

- Issue: https://github.com/link-assistant/hive-mind/issues/2892
- Pull request: https://github.com/link-assistant/hive-mind/pull/2901
- Upstream (start-command): [link-foundation/start#194](https://github.com/link-foundation/start/issues/194), fixed by [start PR #196](https://github.com/link-foundation/start/pull/196) and released as `start-command@0.36.0` (npm, 2026-10-09T21:56Z). Every Hive Mind Dockerfile pins it (`Dockerfile`, `Dockerfile.dind`, `Dockerfile.e2e`).
- Docker engine: [moby/moby#43564](https://github.com/moby/moby/issues/43564) already describes the sticky container-wide `OOMKilled` flag, so no duplicate engine issue was filed.
- Related incident: [link-foundation/disk-space-saviour#22](https://github.com/link-foundation/disk-space-saviour/issues/22), the concurrent `docker diff` storm that drove the host `dockerd` out of memory.

## Data in this folder

| File                                    | What it is                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `data/issue-2892.json`                  | The issue as filed, including the incident context and the host journal lines                               |
| `data/issue-2892-comments.json`         | Both issue comments: the upstream report link and the upstream fix summary                                  |
| `data/host-journal-excerpt.txt`         | The journal, `$ --list` and bot-event lines quoted in the issue, in one place                               |
| `data/upstream-start-194.json`          | link-foundation/start#194 (the upstream report)                                                             |
| `data/upstream-start-pr-196.json`       | link-foundation/start PR #196 (the upstream fix)                                                            |
| `data/upstream-start-194-case-study.md` | start's own case study for #194; its full logs live in start's `docs/case-studies/issue-195/data` archive   |
| `data/moby-43564.json`                  | The Moby issue about the sticky `OOMKilled` flag                                                            |
| `data/reproduction-before.txt`          | `experiments/issue-2892-daemon-restart-attribution.mjs` against the code before this PR: every record → OOM |
| `data/reproduction-after.txt`           | The same replay with this PR: every record → "killed by a Docker daemon restart"                            |

The issue includes no full session logs. The journal lines in it are the primary evidence. start's case study preserves the three full logs of the same day, with checksums. They are not duplicated here.

## Timeline (2026-10-09, UTC; the journal in the issue uses CEST = UTC+2)

| Time        | Event                                                                                                                                                                                                        | Source                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| earlier     | Four `/codex` tasks for link-assistant/router#724, #725, #727 and #728 run as `$ --isolated docker` containers with a 2.9 GiB limit (hive-mind 2.34.0, start-command 0.35.4)                                 | issue                        |
| earlier     | In each container, `rustc`/`clippy-driver` (a **child** process) is OOM-killed and the session survives: 724 ×5, 725 ×3, 727 ×2, 728 ×2. Docker sets `State.OOMKilled=true` for good.                        | issue                        |
| ≈12:11      | A disk-space-saviour test suite inside the root container issues about 22 concurrent `docker diff` calls, and host `dockerd` grows to 7.3 GB RSS                                                             | issue, disk-space-saviour#22 |
| 12:11:39    | `kernel: Out of memory: Killed process 823 (dockerd) … anon-rss:7302520kB`: a **global** OOM that killed the daemon, not a container                                                                         | journal                      |
| 12:11:41    | `systemd: docker.service: Main process exited, code=killed, status=9/KILL`                                                                                                                                   | journal                      |
| 12:11:45    | `dockerd: Loading containers: start.` systemd restarted the daemon. live-restore is disabled, so the old containers are not kept.                                                                            | journal                      |
| 12:11:55    | `dockerd: Container failed to exit within 10s of signal 15 - using the force`. Every container, including the root `hive-mind` container (`OOMKilled=false`), ends with exit 137 in the same second.         | journal                      |
| 13:31       | The root container is started again by hand. The bot's kill recovery reads `$ --list` (`exitCode 137, oomKilled true, exitReason memory-exhaustion (cgroup-oom-killer)`) and reports `status: "oom-killed"`. | issue                        |
| 15:03       | The upstream part is reported as start#194                                                                                                                                                                   | issue comment                |
| 21:13–21:56 | start PR #196 adds exit attribution; `start-command@0.36.0` is published                                                                                                                                     | issue comment, npm           |

## Requirements

| #   | Requirement (from the issue)                                                                                                | Where it is addressed                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Before reporting `oom-killed`, check that the OOM kill hit the main process near `FinishedAt`, not an earlier child process | `resolveOomKilledState` step 4 and `describeKillCause` consume start 0.36's main-process attribution (`exitEvidence.mainOom`)            |
| R2  | Detect a daemon restart (dockerd start time vs `FinishedAt`, or many containers finished in the same second)                | `detectDockerDaemonRestart` in `src/session-exit-attribution.lib.mjs`, plus start 0.36's journal attribution                             |
| R3  | Report it as "killed by Docker daemon restart"                                                                              | New cause `docker-daemon-restart`: Telegram "Kill diagnostics" and PR title "Working session was killed by a Docker daemon restart"      |
| R4  | Report the upstream part to link-foundation/start                                                                           | start#194 → start PR #196 → `start-command@0.36.0`, which is consumed here                                                               |
| R5  | Docs: recommend `"live-restore": true` in `/etc/docker/daemon.json`                                                         | `docs/DOCKER.md` (and the ru/zh/hi translations), plus a tip in the PR notice for this cause                                             |
| R6  | Case study with data, timeline, requirements, root causes, solutions and research                                           | This folder                                                                                                                              |
| R7  | Add debug output / verbose mode where data is missing                                                                       | `[VERBOSE]` lines from the probe, the attribution verdict and the kill-reporting line (all off unless `--verbose`)                       |
| R8  | Report to other repositories where relevant                                                                                 | start#194 (done). moby#43564 already exists. disk-space-saviour#22 covers the trigger.                                                   |
| R9  | Fix every affected place                                                                                                    | Status (`session-monitor.oom`), diagnosis (`session-kill-diagnostics`), Telegram (`kill-sections`), PR notice (`kill-recovery`), parsers |

## Root causes

1. **Hive Mind treated `OOMKilled && exit 137` as proof of an OOM kill.**
   - In `resolveOomKilledState`, any `oomKilled=true` record whose session was not running and had no footer became `oom-killed`.
   - In `describeKillCause`, `containerOomExplainsExit` was true for exit 137, and a positive cumulative `cgroupMemory.oomKills` also forced `out-of-memory`.
   - Neither fact says _when_ the OOM happened. Docker sets `State.OOMKilled` when any process in the container is OOM-killed and never clears it (moby#43564). `memory.events` `oom_kill` is a lifetime counter.
2. **No source distinguished who sent the SIGKILL.** A daemon restart, `docker kill`, and the OOM killer all produce exit 137. start-command 0.35.4 derived `exitReason: memory-exhaustion (cgroup-oom-killer)` from the same sticky flag (start#194), and Hive Mind passed it on as more evidence.
3. **The host ran with live-restore disabled.** One `dockerd` crash therefore killed every container at once (operational root cause; the trigger was disk-space-saviour#22).

## Solution in this PR

```
$ --status record ──► resolveExitAttribution ──► kind?
   exitReason            1. daemon restart: exitReason "killed (docker daemon restart)",
   options.exitEvidence     exitEvidence.daemonRestart, or the "Exit evidence: docker-daemon-restart" log line
   log "Exit evidence:"  2. main OOM:      exitEvidence.mainOom or "Exit evidence: main-oom"
                         3. not main OOM:  "signal (SIGKILL; cause unknown)", mainOom=false, "Exit evidence: unavailable"
        │ none of 1–2, docker, exit 137/unknown
        ▼
detectDockerDaemonRestart(container)        ← Hive Mind's own probe (DinD cannot read the host journal)
   • other containers finished within ±2 s of this one, ≥2 of them, and at least one with OOMKilled=false
   • or (local socket only) docker.service ActiveEnterTimestamp within ±120 s of FinishedAt
```

- **Status.** A daemon restart or "not main OOM" gives `killed`. A real main-process OOM, or no attribution at all, still gives `oom-killed`, as issue #2015 requires. Kill recovery (`--on-session-kill`) treats both as kills, so `resume` behaves the same.
- **Diagnosis.**
  - New cause `docker-daemon-restart`. Summary: "killed by a Docker daemon restart — dockerd force-killed the container (SIGKILL, exit 137); the container OOM event(s) observed earlier hit a child process and did not end the session".
  - "Not main OOM" becomes `forced-kill` with "cause unknown".
  - The raw `OOMKilled` and cgroup observations stay in the evidence list.
- **PR notice.** The title is "❌ Working session was killed by a Docker daemon restart", followed by a live-restore tip.
- **Parsers.** `parseSessionStatusOutput` and `parseSessionListOutput` read `options.exitEvidence` in both JSON and links-notation output.

Why the probe needs at least one non-OOM sibling: a host-wide memory storm can OOM-kill several containers in the same second, and each of them then honestly reports `OOMKilled=true`. A daemon restart also kills containers that never had an OOM event. In this incident that was the root `hive-mind` container. The `docker.service` start time is used only when the Docker socket is local (`DOCKER_HOST` empty or `unix://`). Inside the root container, `systemctl` cannot see the host's `docker.service`, so the sibling signal does the work there. In this incident the task containers and the root container were all on the host daemon, and all of them were killed at 12:11:55.

### Alternatives considered

| Option                                                                            | Verdict                                                                                                                                                                               |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compare the last `📈 [RESOURCES]` cgroup `oomKills` sample with the final counter | Rejected. The last sample is up to one interval old and can miss the final increment, which would turn a real OOM into "not OOM". start uses a 3 s window of samples it takes itself. |
| Parse the kernel journal for `oom-kill:… task_memcg=…<id>` with the main PID      | Exact, but needs host journal access. The bot runs inside DinD without it. start 0.36 does this where it is possible.                                                                 |
| `docker events --since/--until` for `die`/`kill`/`oom` events                     | Events are kept in memory by the daemon and lost when it restarts, which is exactly the case here.                                                                                    |
| Only "many containers finished in the same second"                                | Insufficient alone: a host OOM storm looks the same. Hence the non-OOM sibling condition, which start's analysis also requires.                                                       |

## Online research

- Docker live-restore docs (https://docs.docker.com/engine/daemon/live-restore/):
  - Setting `"live-restore": true` in `/etc/docker/daemon.json` keeps containers running while `dockerd` is down.
  - `systemctl reload docker` (SIGHUP) applies it "and avoid[s] any downtime for your containers".
  - Limitations:
    - Upgrades are covered only for patch releases (`YY.MM.x`).
    - It applies to standalone containers, not Swarm services.
    - A container may block on a full 64 KiB log FIFO during a long outage.
- moby#43564: `State.OOMKilled` is true when any process in the container was OOM-killed, even if the main process kept running.
- cgroup v2 `memory.events` (kernel docs, `Documentation/admin-guide/cgroup-v2.rst`): `oom_kill` is "the number of processes belonging to this cgroup killed by any kind of OOM killer", which makes it a cumulative counter.
- start PR #196 / start-command 0.36.0:
  - The new exit reasons are `killed (docker daemon restart)` and `signal (SIGKILL; cause unknown)`.
  - It adds `options.exitEvidence {daemonRestart, mainOom}` and an `Exit evidence:` log line.
  - The daemon-restart verdict needs a local journal: docker.service stop/start plus a force-kill line for the exact container ID.

## Verification

- `tests/issue-2892-daemon-restart-oom-misreport.test.mjs` (16 tests) fails on the code before this PR (missing attribution and cause) and passes with it. It covers:
  - the legacy 0.35.4 record with and without the probe
  - both 0.36.0 verdicts, and a real main-process OOM
  - the parsers
  - the Telegram sections and the PR notice
  - the probe on the incident, on an OOM storm, on a lone container with and without a recent `docker.service` start, and with Docker unavailable
- `node experiments/issue-2892-daemon-restart-attribution.mjs` replays the incident (`data/reproduction-before.txt` vs `data/reproduction-after.txt`). Passing a container name runs the real probe with `--verbose`-style tracing.
- The earlier OOM tests (#2015, #2134, #2189, #2301, #2408, #2498) still pass unchanged.

## Remaining limits

- Without start 0.36's journal verdict, a single container killed by a daemon restart can only be attributed when the hive-mind probe can see the `docker.service` start time. That means a local socket on the host. Inside DinD it falls back to start's `signal (SIGKILL; cause unknown)`, which Hive Mind now reports as a forced kill with an unknown cause instead of out of memory.
- A legacy record (start < 0.36) with no other container killed alongside and no readable service start time still reads `oom-killed`, as before. Nothing in the data can contradict it.
