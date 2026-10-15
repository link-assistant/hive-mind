# Case study: issue #2303 — "✅ Work session finished successfully" for a session that a full disk killed

- Issue: https://github.com/link-assistant/hive-mind/issues/2303 (opened 2026-09-27, reopened 2026-10-15)
- Pull requests: #2304 (first attempt, open, not merged), #3390 (this branch, commit `288190c4`, merge `90dfeb59`)
- Parent: #3282 (critical-path umbrella)
- Affected work: `/claude https://github.com/link-foundation/meta-language/pull/196 --think high`, session
  `56291848-d17d-4326-8b41-3ac995221efc`, execution `b105ce98-52a1-4c2d-949a-bfa872c4f784`, `--isolation docker`,
  solve v2.32.0, start-command 0.34.0
- Upstream: link-foundation/start#174, fixed by link-foundation/start#175 (start-command 0.34.1)

The title says "memory killed". The evidence says **disk**: the container's writable layer grew to 122.7 GB on a
192.7 GB disk, while the RAM markers stayed healthy (`memAvailableBytes=11173277696` of 12.5 GB at 06:34:23).

## Collected data

The incident data was collected for PR #2304 and is copied here unchanged from its branch
(`issue-2303-928b0c381ae1`, head `a0e1c899`).

| File                                   | What it is                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `issue.json`                           | `gh issue view 2303 --json title,body,comments,createdAt,closedAt`, taken 2026-10-15                |
| `screenshot.png`                       | The Telegram message from the issue: ✅ success, 13h 38m 59s, container filesystem 60 KB → 122.7 GB |
| `data/issue-2303.json`                 | The issue as first reported                                                                         |
| `data/pr196-comments-summary.json`     | Every comment the session posted on link-foundation/meta-language#196 (author, time, first line)    |
| `data/pr196-timeline.json`             | That pull request's timeline                                                                        |
| `data/pr196-commits.json`              | The commits the session pushed                                                                      |
| `data/disk-timeline.txt`               | Every `Disk (/)` line of the last uploaded solve log                                                |
| `data/resource-markers.txt`            | Every `📈 [RESOURCES]` marker (CPU, RAM, heap, disk) of the same log                                |
| `raw/pr-3390-commit-288190c4-src.diff` | Source and changeset diff of the fix on this branch                                                 |

The last uploaded log (Auto-restart 1/5, 105 MB) is at
https://github.com/konard/public-logs/tree/main/tmp-hive-mind-log-upload-NZNC8e/a4ec9aa61d4d6441; only the excerpts
above are committed. The log of the interrupted Auto-restart 2/5 iteration was never uploaded.

## Timeline (UTC)

| Time                | Event                                                                                                                                                                                                                                                                                         | Evidence                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 2026-09-25 17:47:08 | Session starts. `Disk (/): 126.7 GB available / 192.7 GB total (34.2% used)`                                                                                                                                                                                                                  | `data/disk-timeline.txt`     |
| 2026-09-26 06:20:37 | `Disk (/): 40.8 GB available` — 86 GB used by the container's writable layer so far                                                                                                                                                                                                           | `data/disk-timeline.txt`     |
| 06:22:57            | First iteration ends; log uploaded                                                                                                                                                                                                                                                            | PR #196 comments             |
| 06:23:11            | `🔄 Auto-restart 1/5` (uncommitted changes)                                                                                                                                                                                                                                                   | PR #196 comments             |
| 06:34:23            | Last resource marker ever written: 40.5 GB free (78.95% used)                                                                                                                                                                                                                                 | `data/resource-markers.txt`  |
| 06:54:07            | `🔄 Auto-restart 2/5 — CI failures detected`; the session keeps building                                                                                                                                                                                                                      | PR #196 comments             |
| ≈ 07:20             | The writable layer reaches ≈ 122.7 GB and the host root filesystem runs full                                                                                                                                                                                                                  | screenshot, arithmetic       |
| ≈ 07:26:07          | start-command's detached watcher: `docker logs -f` fails with ENOSPC and returns; `docker inspect` on the still-running container gives Docker's zero values (exit 0, no OOM); the watcher runs `docker rm -f` and finalizes the record as `executed` / `0` with `endTimeSource: observed-at` | upstream reproduction        |
| next poll           | Hive Mind reads `executed` / `0` and posts "✅ Work session finished successfully" (13h 38m 59s). No kill diagnosis, no auto-resume, nothing posted on meta-language#196 after 06:54:07                                                                                                       | screenshot, PR #196 comments |
| 2026-09-27 04:17:06 | Issue #2303 opened                                                                                                                                                                                                                                                                            | `issue.json`                 |
| 2026-09-27 04:26:58 | PR #2304 opened; its case study and fix commits (`152349e3` … `a0e1c899`, last on 2026-10-10) stay on that branch and are not merged                                                                                                                                                          | timeline                     |
| 2026-09-27 05:02:20 | Upstream issue link-foundation/start#174 filed                                                                                                                                                                                                                                                | timeline                     |
| 2026-09-28 18:45    | link-foundation/start#175 merged, start-command 0.34.1: the watcher waits for the real exit and records an unseen exit as `-1` / `watcher-lost-container`                                                                                                                                     | upstream                     |
| 2026-10-07          | Referenced from the failed-task review #2631                                                                                                                                                                                                                                                  | timeline                     |
| 2026-10-14 17:54:45 | Attached to the umbrella #3282                                                                                                                                                                                                                                                                | timeline                     |
| 2026-10-15 12:14:37 | Closed by the merge of #3295 through the link-repair lines of #3174, without a fix; reopened at 12:19:43                                                                                                                                                                                      | timeline, issue status note  |
| 2026-10-15 18:57:55 | Commit `288190c4` on this branch ports the Hive Mind side of #2304 onto the current code; merged into the #3282 branch as `90dfeb59`                                                                                                                                                          | `git log`                    |

Hive Mind's images now pin start-command 0.37.8 (`Dockerfile:340`, `Dockerfile.dind:355`), so the upstream watcher
defect itself no longer occurs on current images.

## Requirements from the issue

1. **R1** — Do not report "✅ finished successfully" for a killed session; report the kill and its cause (here: not
   enough disk space).
2. **R2** — Report it as auto-resumed / auto-restarted when recovery happens.
3. **R3** — Auto-resume / auto-restart must actually work for this kind of kill.
4. **R4** — Collect logs and data in `docs/case-studies/issue-2303` and do a case study (timeline, requirements, root
   causes, solutions, existing components, online research).
5. **R5** — If the data is not enough to find the root cause, add debug output / verbose mode.
6. **R6** — Report issues upstream, with reproduction, workarounds and suggested fixes.
7. **R7** — Apply the fix everywhere the same problem exists.

## Root causes

- **RC1 (upstream, start-command ≤ 0.34.0).** The detached docker watcher assumed `docker logs -f` returns only when
  the container exits. It also returns when its own write fails (ENOSPC on the same disk), when the daemon restarts or
  when it is killed. `docker inspect` on a running container returns `ExitCode 0` and `FinishedAt
0001-01-01T00:00:00Z` — zero values, not a result — so the watcher removed a live container and recorded exit 0.
  Reported as link-foundation/start#174, fixed in 0.34.1.
- **RC2 (Hive Mind).** An exit 0 that Docker never observed (`endTimeSource: observed-at`) was trusted as success.
  Since start-command 0.34.1 the same situation is recorded as `exitCode -1` with `exitReason:
watcher-lost-container`, and a `-1` log footer made `getIsolationSessionState` skip the container liveness check
  (`src/session-monitor.isolation-state.lib.mjs:49-53` now handles it). Without handling, that read as a plain failure,
  so no kill diagnosis and no recovery ran either.
- **RC3 (Hive Mind).** Disk evidence was invisible at diagnosis time: `📈 [RESOURCES]` markers are written at phase
  boundaries (the last was 50 minutes before the kill), and once the container was removed its layer was freed, so the
  disk looked healthy again.
- **RC4 (Hive Mind).** A failed `$ --status` query was read as "finished" (see "What remains").
- **RC5 (Hive Mind).** After reclassifying such an exit as a kill, the default keep-on-failure policy would advertise a
  "Docker container kept" that start-command had already removed.

## Solutions on this branch

| Req.    | Change                                                                                                                                                                                                                                                                                                                                                   | Where                                                                                                                               |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| R1, RC2 | `detectUnobservedDockerExit` recognizes a docker session whose exit Docker never saw (`watcher-lost-container`, or `observed-at` with a success). `reclassifyUnobservedDockerExit` reports it as `killed` with `exitCode null`, keeping the reported values in `reportedExitCode` / `reportedStatus`. It wraps every return path of the isolation state. | `src/session-monitor.unobserved-exit.lib.mjs:63-78`, `:92-109`; wired in `src/session-monitor.lib.mjs:654`                          |
| R1, RC2 | `$ --status` parsing keeps `endTimeSource` and `observedAt` (JSON and text output); a `-1` footer from a lost container no longer skips the liveness check.                                                                                                                                                                                              | `src/isolation-runner.parsers.lib.mjs:162-163`, `:217-218`; `src/session-monitor.isolation-state.lib.mjs:49-53`                     |
| R1, RC3 | The monitor samples the filesystem holding the session log with `fs.promises.statfs()` while the session runs and keeps the lowest free space seen; the fields are persisted across restarts.                                                                                                                                                            | `src/session-monitor.host-disk.lib.mjs:55-82`; `src/session-monitor.lib.mjs:800`; `src/session-store.lib.mjs:60`                    |
| R1, RC3 | The kill diagnosis uses the host-disk minimum and ENOSPC / "No space left on device" log lines as disk-full evidence, and says why the reported success was not trusted.                                                                                                                                                                                 | `src/session-kill-diagnostics.lib.mjs:310-326`, `:360`, `:388-390`, `:459-460`, `:500-505`                                          |
| R1, R2  | The headline names the cause: "killed (disk full)", or, once a recovery is launched, "still in progress: recovering from a kill (disk full)" (all four locales).                                                                                                                                                                                         | `src/work-session-formatting.lib.mjs:185`, `:215-217`, `:262`; `src/locales/{en,ru,hi,zh}.lino`; `src/session-monitor.lib.mjs:1061` |
| R3      | No new recovery mechanism: once the session is classified as killed, the existing `--on-session-kill=resume` path runs and starts `solve … --resume <tool session>` (the kill-recovery work for issues #2887, #2888, #2889 and #2891 is merged into the same branch).                                                                                    | `src/session-monitor.lib.mjs`                                                                                                       |
| RC5     | `buildDockerTaskContainerCompletionAction({ containerRemoved })` posts neither a "kept" section nor a removal attempt for a container start-command already removed.                                                                                                                                                                                     | `src/session-monitor.lib.mjs:585-594`, `:832`                                                                                       |
| R5      | Verbose logs for every new decision (not trusting the reported success, host disk readings, liveness re-check of a `-1` footer).                                                                                                                                                                                                                         | `src/session-monitor.unobserved-exit.lib.mjs:97-99`, `src/session-monitor.isolation-state.lib.mjs:50-52`                            |
| R6      | Upstream issue link-foundation/start#174 (filed from PR #2304), fixed upstream by link-foundation/start#175.                                                                                                                                                                                                                                             | upstream                                                                                                                            |
| R4      | This folder.                                                                                                                                                                                                                                                                                                                                             |                                                                                                                                     |

## Tests

`node --test tests/unobserved-docker-exit-2303.test.mjs` → **6/6 pass** on this branch (2026-10-15):

- `$ --status`: `endTimeSource` and `observedAt` are parsed from JSON and text output;
- detection is narrow: docker plus an exit Docker never observed;
- the isolation state reports an unobserved docker exit as killed, never as success;
- disk-full evidence: host disk samples and ENOSPC lines name the cause;
- the headline says killed and names the cause;
- end to end (the incident replayed with 0.1 GB free): "⚠️ Work session still in progress: recovering from a kill
  (disk full)", a kill diagnostics section, one recovery launch with `--resume <tool session>`, no "Docker container
  kept", no removal attempt, a PR notice, and only the recovery session left tracked.

## What remains, and why

Status: **PARTIAL.** R1–R3 are covered by code and the tests above; R4, R6 are done. Not done:

1. **RC4 is not ported.** PR #2304 kept a session tracked after a failed `$ --status` query and gave up after 20
   consecutive failures (`STATUS_QUERY_ERROR_LIMIT`). On this branch the `catch` in `getIsolationSessionState` still
   returns `{ running: false, exitCode: null, status: null }` (`src/session-monitor.isolation-state.lib.mjs:127-130`),
   so one transient query failure ends tracking. Since #3209 that is reported as "⚠️ Work session ended, but its exit
   status is unknown" (`src/work-session-formatting.lib.mjs:231-234`), not as ✅, but no kill diagnosis or recovery runs.
2. **The reproduction script** `experiments/issue-2303-watcher-enospc.mjs` (runs the 0.34.0 watcher against a live
   container with its log on `/dev/full`) exists only on the #2304 branch.
3. **No live verification** on a host whose disk actually fills up; the evidence is the replayed incident in the
   end-to-end test.
4. **PR #2304 is still open.** It carries an older README at this same path; if it is ever merged, its README will
   conflict with this one (the data files here are byte-identical copies, so they will not).
5. A single task can still fill the host disk. A per-container writable-layer cap (`--storage-opt size=`) is not used.

## Existing components

- `docker wait` / Engine API `POST /containers/{id}/wait` — waits for the real exit and returns the real status code;
  `docker events --filter event=die` is an alternative. start-command 0.34.1 now waits this way.
- Node `fs.promises.statfs()` (Node ≥ 18.15) — free/total bytes in one syscall, used instead of spawning `df`.
- Docker `--storage-opt size=` (overlay2 on xfs with `pquota`) — a hard per-container writable-layer limit, which
  would turn "fill the host disk" into an ENOSPC inside the container only.

## Online research

- Docker reports `ExitCode 0` and `FinishedAt 0001-01-01T00:00:00Z` for a container that is still running:
  [oneuptime: wait for a container and get its exit code](https://oneuptime.com/blog/post/2026-02-08-how-to-wait-for-a-docker-container-to-exit-and-get-its-exit-code/view),
  [Nick Janetakis: checking the exit code of stopped containers](https://nickjanetakis.com/blog/docker-tip-22-checking-the-exit-code-of-stopped-containers).
- A full `/var/lib/docker` filesystem is the usual cause of "no space left on device":
  [Dash0](https://www.dash0.com/faq/how-to-fix-no-space-left-on-device-in-docker),
  [Baeldung](https://www.baeldung.com/linux/docker-fix-no-space-error).
- Node.js `fs.statfs`: https://nodejs.org/api/fs.html#fspromisesstatfspath-options

## Reproduction

```bash
node --test tests/unobserved-docker-exit-2303.test.mjs
```
