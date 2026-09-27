# Case study: issue #2303 — "✅ Work session finished successfully" for a session that was killed by a full disk

- Issue: https://github.com/link-assistant/hive-mind/issues/2303
- Pull request: https://github.com/link-assistant/hive-mind/pull/2304
- Affected work: `/claude https://github.com/link-foundation/meta-language/pull/196 --think high`
  (session `56291848-d17d-4326-8b41-3ac995221efc`, execution `b105ce98-52a1-4c2d-949a-bfa872c4f784`, `--isolation docker`)
- start-command version on the host: `start-command@0.34.0`

## Evidence collected in this folder

| File                                                 | What it is                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `screenshot.png`                                     | The Telegram completion message from the issue (✅ success, 13h 38m 59s, container filesystem 60 KB → **122.7 GB**) |
| `data/issue-2303.json`                               | The issue body as reported                                                                                          |
| `data/pr196-comments-summary.json`                   | Every comment the session posted on link-foundation/meta-language#196 (author, time, first line)                    |
| `data/pr196-timeline.json`                           | The pull request timeline (commits, reviews, ready-for-review, …)                                                   |
| `data/pr196-commits.json`                            | The commits the session pushed                                                                                      |
| `data/disk-timeline.txt`                             | Every `Disk (/)` line of the last uploaded solve log                                                                |
| `data/resource-markers.txt`                          | Every `📈 [RESOURCES]` marker (CPU, RAM, heap, disk) of the same log                                                |
| `../../../experiments/issue-2303-watcher-enospc.mjs` | Reproduction of the root cause against the real start-command 0.34.0 watcher                                        |

The last log the session uploaded (Auto-restart 1/5, 06:36:28, 105 MB, 2 chunks) is at
https://github.com/konard/public-logs/tree/main/tmp-hive-mind-log-upload-NZNC8e/a4ec9aa61d4d6441. It was downloaded and
analysed, but only the excerpts above are committed. The log of the interrupted Auto-restart 2/5 iteration was never
uploaded — the session was killed before it could be. The log contains no `ENOSPC` / "No space left on device" line:
it ends 50 minutes before the kill.

## Timeline (UTC)

| Time                | Event                                                                                                                                                                                                                                                                                                              | Source                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| 2026-09-25 17:47:08 | Session starts (solve v2.32.0). `Disk (/): 126.7 GB available / 192.7 GB total (34.2% used)`                                                                                                                                                                                                                       | solve log                     |
| 2026-09-25 → 26     | ~12.5 h of work in the container (Rust ports, builds, tests), 19+ commits pushed                                                                                                                                                                                                                                   | solve log, PR commits         |
| 2026-09-26 06:20:37 | `Disk (/): 40.8 GB available / 192.7 GB total (78.8% used)` — 86 GB consumed by the container's writable layer so far                                                                                                                                                                                              | solve log                     |
| 06:22:57            | First iteration ends; log uploaded                                                                                                                                                                                                                                                                                 | PR comment                    |
| 06:23:11            | `🔄 Auto-restart 1/5` (uncommitted changes)                                                                                                                                                                                                                                                                        | PR comment                    |
| 06:34:23            | Last resource marker ever written: `diskAvailableBytes=43535716352 diskUsedPercent=78.95` (40.5 GB free)                                                                                                                                                                                                           | solve log (`📈 [RESOURCES]`)  |
| 06:54:07            | `🔄 Auto-restart 2/5 — Reason: CI failures detected`. Solve keeps building in the container                                                                                                                                                                                                                        | PR comment                    |
| ≈ 07:20             | The writable layer reaches ≈ 122.7 GB; with ≈ 41 GB that were still free at 06:34 and the layer growing, the host root filesystem runs full                                                                                                                                                                        | screenshot, arithmetic        |
| ≈ 07:26:07          | start-command's detached watcher's `docker logs -f C >> LOG` fails with **ENOSPC** and returns; the watcher inspects the _still running_ container, sees `ExitCode 0 / OOMKilled false`, **`docker rm -f`s it**, writes `Exit Code: 0`, finalizes the record as `executed` / `0` with `endTimeSource: observed-at` | root cause, reproduced below  |
| ≈ 07:26 + one poll  | Hive Mind reads `$ --status` → `executed`/`0` → "✅ Work session finished successfully", duration 13h 38m 59s (= 07:26:07 − 17:47:08). No kill diagnosis, no auto-resume, no PR notice                                                                                                                             | screenshot                    |
| after               | No "Auto-restart 2/5" log and no working-session summary are ever posted on meta-language#196 — the in-progress iteration simply vanished                                                                                                                                                                          | `pr196-comments-summary.json` |

Why this cannot have been a real exit 0: solve always posts a working-session summary and its log before it exits
successfully; nothing was posted after 06:54:07. A memory kill would have given `137`/`OOMKilled=true`, which the
watcher keeps and Hive Mind has reported correctly since #1927/#2134. The only path that turns a live container into
`executed / 0` is the watcher path below, and it is triggered by exactly the condition the screenshot shows — a
122.7 GB writable layer on a 192.7 GB disk.

The issue title says "memory killed". The evidence says **disk** (the screenshot's container size and the disk
markers); the RAM markers stayed healthy throughout (`memAvailableBytes=11173277696` of 12.5 GB at 06:34:23).

## Requirements extracted from the issue

1. **R1** — Do not report "✅ finished successfully" for a session that was killed; report it as killed, and say why
   (here: not enough disk space).
2. **R2** — Report it as auto-resumed / auto-restarted when recovery happens.
3. **R3** — Auto-resume / auto-restart must actually work for this kind of kill.
4. **R4** — Collect all logs and data into `docs/case-studies/issue-2303` and do a deep case study (timeline,
   requirements, root causes, solutions, existing components, online research).
5. **R5** — If the data is insufficient for a root cause, add debug output / verbose mode.
6. **R6** — Report upstream issues (with reproducible examples, workarounds, suggested fixes) where another project is
   involved.
7. **R7** — Apply the fix everywhere the same problem exists in the codebase.

## Root causes

### RC1 (upstream, start-command 0.34.0): the detached watcher removes a running container when `docker logs -f` dies

`buildDetachedDockerCompletionScript()` (`start-command/src/lib/docker-cleanup.js`) builds:

```sh
docker logs -f C >> LOG 2>&1;
state=$(docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}} {{.State.StartedAt}} {{.State.FinishedAt}}' C);
if [ "$__start_command_exit" -eq 0 ] && [ "$__start_command_oom" != true ]; then docker rm -f C …; else keep; fi;
<footer "Exit Code: $__start_command_exit"> >> LOG;
node detached-finalize.js <uuid> …
```

It assumes `docker logs -f` returns only when the container exits. That is false: it returns when **its own write
fails** (ENOSPC on `LOG`'s filesystem — the very disk the container filled), when the daemon restarts (`live-restore`
keeps containers running but drops follow streams), or when it is killed. At that moment `docker inspect` on the
running container returns `ExitCode=0`, `OOMKilled=false`, `FinishedAt=0001-01-01T00:00:00Z` — Docker's zero values
for a container that has not finished (see the Docker Engine API `ContainerState`). The watcher therefore:

1. `docker rm -f`s a live container — this is what actually killed the session;
2. writes `Exit Code: 0` into the footer from the same bogus value;
3. finalizes the execution record as `executed` / `0`. The one tell it records is `endTimeSource: "observed-at"`
   (the zero `FinishedAt` is discarded as unknown), whereas every container that really exited is finalized with
   `endTimeSource: "docker-finished-at"`.

Reproduced with the real 0.34.0 code: `node experiments/issue-2303-watcher-enospc.mjs` runs the watcher script
against a live `alpine` container with the log path set to `/dev/full` (every write fails with ENOSPC). Result: the
container is removed while running and `$ --status` reports `executed`, `exitCode 0`, `endTimeSource observed-at`.

Related upstream defect of the same class (`code || 0`): `spawn-helpers.js` (`child.on('close', code => code || 0)`)
and `isolation-log-utils.js` `runAsIsolatedUser` (`exitCode: code || 0`) turn a signal-killed child (`code === null`)
into exit 0.

### RC2 (Hive Mind): an exit 0 without a Docker finish time was trusted as success

`session-monitor` took `$ --status`'s `executed / 0` at face value. The footer does not help — it is written by the
same watcher from the same inspect result. Hive Mind already had defenses for fabricated _failures_ (#2117) and stale
`executing` (#1927/#2189), but none for a fabricated _success_.

### RC3 (Hive Mind): the disk evidence was invisible at diagnosis time

The kill diagnosis (#2134) looked at the disk only through `📈 [RESOURCES]` markers in the solve log. They are written
at phase boundaries — the last one (06:34:23, 79% used) was ~50 minutes before the kill — and once the watcher
removed the container, the 122.7 GB writable layer was freed, so the disk looked healthy again at completion time.

### RC4 (Hive Mind): a failed status query read as success

`getIsolationSessionState()`'s `catch` returned `{ running: false, exitCode: null, status: null }`, which the
completion pipeline classifies as a success — the same false "✅" for any transient `$ --status` failure.

### RC5 (Hive Mind): "Docker container kept" for a container that no longer exists

Once a success is reclassified as a kill, the default `HIVE_MIND_KEEP_TASK_CONTAINER=on-failure` policy would
advertise the container as kept (`docker start -ai …`) — but the watcher already removed it.

## Solutions implemented in this pull request

| Requirement | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1, RC2     | `src/session-monitor.unobserved-exit.lib.mjs`: `detectUnobservedDockerExit()` / `reclassifyUnobservedDockerExit()`. A docker session whose `$ --status` says exit 0 (or `executed`/`completed` with no code) **and** `endTimeSource: "observed-at"` is reported as `killed` with `exitCode null`; the original values stay on `statusResult.reportedExitCode` / `reportedStatus`, and the reason on `statusResult.unobservedExit`. Wired in as a wrapper around `getIsolationSessionState()`, so every return path is covered. |
| R1, RC3     | `src/session-monitor.host-disk.lib.mjs`: every monitor tick samples the filesystem that holds the session log with one `fs.promises.statfs()` call and keeps the **lowest** free space seen (`hostDiskMinAvailableBytes`, `hostDiskTotalBytes`, `hostDiskMinAvailableAt`, `hostDiskPath`, persisted across restarts). `describeKillCause()` uses it as disk evidence with the existing thresholds (≥ 95% used or ≤ 512 MiB free).                                                                                              |
| R1, RC3     | `findDiskFullMarker()`: an `ENOSPC` / "No space left on device" line in the log is disk-full evidence (only for an abnormal end, like the #2189 fatal-marker scan).                                                                                                                                                                                                                                                                                                                                                            |
| R1          | The headline names the cause: "❌ Work session killed (disk full)" instead of a bare "killed" when there is no signal exit (`formatSessionCompletionMessage({ killCause })`). The kill diagnostics section lists the host reading and why the reported exit 0 was not trusted.                                                                                                                                                                                                                                                 |
| R2, R3      | No new mechanism was needed: once the session is classified as killed, the existing `--on-session-kill=resume` default (#2134/#2189) runs — the container is gone, so it starts a fresh `solve … --resume <last tool session id>` and the Telegram message and PR notice both name the recovery session. Covered end-to-end by the new test.                                                                                                                                                                                   |
| RC4         | A failed `$ --status` query keeps the session tracked (`running: true`, `error`) instead of reporting it as finished; after 20 consecutive failures (`STATUS_QUERY_ERROR_LIMIT`) it is reported as failed, never as a success.                                                                                                                                                                                                                                                                                                 |
| RC5         | `buildDockerTaskContainerCompletionAction({ containerRemoved })`: for an unobserved exit neither a "kept" section nor a removal attempt.                                                                                                                                                                                                                                                                                                                                                                                       |
| R5          | Verbose logs for every new decision: `not trusting the reported success — …`, `host disk <path>: … (session minimum …)`, `statfs failed`, `Error refreshing isolated session … keeping it tracked`, `container was already removed by start-command`.                                                                                                                                                                                                                                                                          |
| R6          | Upstream issue filed: https://github.com/link-foundation/start/issues/174                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| R7          | All completion paths go through `getIsolationSessionState()`; the fabricated-success check and the host-disk sampling live there and in the monitor loop, so screen and docker, first poll and post-restart poll, are all covered. The upstream `code                                                                                                                                                                                                                                                                          |     | 0` instances are reported upstream (they are not in this repository). |

Tests: `tests/test-issue-2303-unobserved-docker-exit.mjs` (49 assertions) — detection unit cases, the monitor state
wrapper, host-disk sampling and persistence, ENOSPC/host-disk kill diagnosis, the headline, and a full monitor run
reproducing the incident (executing with 0.1 GB free → `executed/0/observed-at`) that asserts: killed (disk full),
kill diagnostics, a `--resume <tool session>` recovery launch, no "container kept", no removal, and only the recovery
session left tracked.

## Upstream report

- https://github.com/link-foundation/start/issues/174 — "Detached docker watcher `docker rm -f`s a
  still-running container when `docker logs -f` fails (ENOSPC), and finalizes it as `executed / 0`". It contains the
  reproduction above, workarounds and a suggested fix:
  - after `docker logs -f` returns, check `docker inspect -f '{{.State.Running}}'`; while running, `docker wait` (or
    re-attach `docker logs -f --since …`) instead of treating it as finished;
  - treat a zero `FinishedAt` as "not finished", never as exit 0;
  - never `rm -f` a container whose `State.Running` is true;
  - fix the `code || 0` fallbacks so a signal-killed child is not exit 0.

Workarounds until then:

- Put the start-command log folder on a different filesystem than Docker's data root, so the watcher's log writes do
  not fail when containers fill `/var/lib/docker`.
- Run `$ --isolation docker --keep-container …`: the `keep` policy never removes the container, so an early
  `docker logs -f` return can no longer kill the session (the record is still finalized too early).
- Keep enough free disk for long sessions: Hive Mind's queue already defers new work above
  `HIVE_MIND_DISK_THRESHOLD` (default 65%), but a single running task can still fill the rest of the disk.

## Existing components considered

- `docker wait` / Engine API `POST /containers/{id}/wait` — the reliable way to wait for the real exit (returns the
  real `StatusCode`); `docker events --filter container=… --filter event=die` is an alternative.
- Node `fs.promises.statfs()` (Node ≥ 18.15) — a single syscall for free/total bytes; used here instead of spawning
  `df`.
- Docker's `--storage-opt size=` (overlay2 on xfs with `pquota`) — a hard per-container writable-layer cap, which would
  turn "fill the host disk" into a contained ENOSPC inside the container.

## Online research

- Docker reports `ExitCode 0` and `FinishedAt 0001-01-01T00:00:00Z` for a container that is still running — they are
  zero values, not results ([oneuptime: wait for a container and get its exit code](https://oneuptime.com/blog/post/2026-02-08-how-to-wait-for-a-docker-container-to-exit-and-get-its-exit-code/view),
  [Nick Janetakis: checking the exit code of stopped containers](https://nickjanetakis.com/blog/docker-tip-22-checking-the-exit-code-of-stopped-containers)).
- A full `/var/lib/docker` filesystem is the usual cause of "no space left on device", and `docker logs -f` can exit
  on it while the container keeps running ([Dash0](https://www.dash0.com/faq/how-to-fix-no-space-left-on-device-in-docker),
  [Baeldung](https://www.baeldung.com/linux/docker-fix-no-space-error)).
