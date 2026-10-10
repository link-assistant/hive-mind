# Case study: issue #2889 — in-place kill recovery commits whole writable layers concurrently, filling the disk

- Issue: https://github.com/link-assistant/hive-mind/issues/2889
- Pull request: https://github.com/link-assistant/hive-mind/pull/2894
- Related: #2887 (the resumed command is the Telegram alias), #2888 (a fresh fallback cannot resume Codex threads), #2498 (random recovery delay), #2189 / #2408 (same-container resume), link-foundation/start#176, link-foundation/start#193 (fixed in start PR #196).

## Data in this folder

| File                                       | What it is                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `data/issue-2889.json`                     | The issue as filed (title, body, author, timestamps)                                                         |
| `data/issue-2889-comments.json`            | Issue comments: the start#193 cross-reference and the owner's note that start PR #196 fixed the tracking bug |
| `data/pr-2894-comments.json`               | PR conversation comments (the failed first solution draft and the session start)                             |
| `data/pr-2894-review-comments.json`        | PR inline review comments (none)                                                                             |
| `data/docker-start-handoff-experiment.log` | Output of `experiments/issue-2889-docker-start-handoff.mjs --compare-snapshot` on a real Docker daemon       |

The incident host itself (the dockerd journal, `docker system df`, the container list) was not available to this session. The timeline and numbers below come from the issue body, which quotes them. Everything about how the code behaves was checked against the source and against a real Docker daemon (see [Experiment](#experiment-real-docker)).

## Timeline (UTC, 2026-10-09)

| Time            | Event                                                                                                                                                                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| before          | Host: Ubuntu 24.04, 6 CPU, 11.7 GB RAM, 193 GB disk, Docker 29.6.1 with the **containerd image store** (overlayfs snapshotter), `live-restore` off. Four `/codex` solve tasks (link-assistant/router #724, #725, #727, #728) run as `$ --isolated docker` containers; all are Rust builds |
| 12:11:39        | The kernel OOM-kills the **host dockerd** (7.3 GB RSS, about 22 concurrent `docker diff` calls from a disk-space-saviour test suite, link-foundation/disk-space-saviour#22)                                                                                                               |
| 12:11           | systemd restarts dockerd, which SIGKILLs every running container (exit 137): the root `hive-mind` container and the four task containers                                                                                                                                                  |
| 13:31           | The root container is started again by hand; `hive-telegram-bot` runs its kill recovery for the four killed sessions                                                                                                                                                                      |
| 13:31 + 34–73 s | After random delays of 34–73 s (#2498) all four recoveries call `$ --resume <uuid> -- <recovery command>`. A command is given, so start-command uses `docker-snapshot`: a `docker commit` of each **whole writable layer** (11, 21.2, 23.5 and 36.8 GiB; mostly Cargo `target/`)          |
| next 30+ min    | The four commits run concurrently. containerd uses about 280 % CPU for 30+ minutes. Free disk falls from 52 GB to 2 GB (96 % used)                                                                                                                                                        |
| later           | router#727's and router#725's commits fail with `failed to apply diff: … no space left on device`. Both fall back to fresh runs, which fail (#2888)                                                                                                                                       |
| later           | The two successful snapshots leave the original container (11 / 23.5 GiB) next to the `start-command-resume/<name>:1` image (46.7 / 62.7 GB with the base) until someone removes the original by hand                                                                                     |
| later           | Two `$ --resume` processes started at once start their containers, then fail to save the record (store lock timeout): link-foundation/start#193                                                                                                                                           |

## Requirements from the issue

| #   | Requirement                                                                                                                        | Status in PR #2894                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Recovery never fills the disk it needs to keep working                                                                             | Done: no copy for new containers (R2); legacy snapshots wait for headroom or fall back (R3)                                                                                                                                                              |
| R2  | Avoid the copy: resume with `docker start` (`ResumeMode.DOCKER_START`), with the command read from a file written before the start | Done: `src/docker-resume-handoff.lib.mjs`, `resumeWithDockerStart` in `src/session-kill-resume.in-place.lib.mjs`                                                                                                                                         |
| R3  | If a snapshot is needed: free-disk preflight with headroom, one at a time, drop regenerable caches                                 | Preflight and serialization done (`src/docker-resume-snapshot-guard.lib.mjs`). Dropping caches is not possible on a stopped legacy container; see [Limitations](#limitations)                                                                            |
| R4  | Remove the original stopped container after a snapshot-derived container starts                                                    | Done, with `docker rm` (never `-f`); `HIVE_MIND_KEEP_TASK_CONTAINER=always` keeps it                                                                                                                                                                     |
| R5  | Remove obsolete `start-command-resume/*` images after the task finishes                                                            | Done: the images are tracked per session (`containerSnapshotImages`) and removed with the finished task's container                                                                                                                                      |
| R6  | Report `waiting for disk` / `snapshotting N GiB` in Telegram                                                                       | Done: the recovery lifecycle message gains a detail line                                                                                                                                                                                                 |
| R7  | Case study with data, timeline, requirements, root causes, solutions, research                                                     | This document                                                                                                                                                                                                                                            |
| R8  | Debug output where the data is not enough                                                                                          | `[VERBOSE] docker-resume-handoff:` and `[VERBOSE] In-place resume of …` lines on every decision (handoff found or not, disk measurements, queue position, removal results)                                                                               |
| R9  | Report related upstream issues with reproduction, workaround and fix suggestions                                                   | See [Upstream reports](#upstream-reports)                                                                                                                                                                                                                |
| R10 | Apply the fix everywhere the same problem exists                                                                                   | Every place that probed the task container by its tracking key now uses `getDockerTaskContainerName` (resource monitor, OOM probe, stale-executing probe, completion removal), because a `docker start` recovery keeps the container but changes the key |

## Root causes

1. **A command forces a copy.** start-command decides the resume mode from two facts (`js/src/lib/execution-resume.js` in link-foundation/start): a stopped Docker container resumed **without** a command uses `docker start`; **with** a command it uses `docker-snapshot`, which `docker commit`s the container and runs the command in a new container from that image. The kill recovery always passes the recovery command (`solve … --resume <session>`), so every recovery copied the whole writable layer.
2. **The launch command could not be re-run.** `docker start` re-runs the command the container was created with: the start gate (`while [ ! -e "$gate" ] …; rm -f "$gate"`) followed by the original task. The gate file is deleted once released, so a restart waited out its 30 s timeout and then ran the original task from scratch instead of the recovery. There was no way to pass a new command into a stopped container.
3. **Nothing bounded the copies.** The four recoveries ran their commits at the same time with no free-space check. On the containerd image store a commit writes a compressed blob and an unpacked snapshot, while the original container stays on disk. Peak usage is about three times the writable layer. 3 × 92.5 GiB is far more than the 52 GB that was free.
4. **The commit is slow regardless of the change size.** containerd's default differ walks both directory trees in full (`doubleWalkDiff`). A commit therefore costs time in proportion to the whole filesystem, not the change, which explains "even a ~560 KiB layer takes 10+ minutes" (see [Research](#online-research)).
5. **Nothing cleaned up.** After a successful snapshot the original container (all of its data is now in the image) and, after the task finished, the `start-command-resume/*` image were left behind.
6. **The state was invisible.** The Telegram recovery message said "launching" and nothing else for the whole 30-minute commit or until it failed.

The tracking failure seen during the same recovery (two concurrent `$ --resume` processes losing their records) is a separate start-command bug: start#193, fixed in start PR #196.

## Solution in PR #2894

### Resume in place with `docker start` and a command handoff (R1, R2)

Every Hive Mind task container is now created with a short prefix in front of its gated command (`withDockerResumeHandoff`):

```sh
h='/tmp/hive-mind-resume-command-<session id>'; if [ -f "$h" ]; then exec sh "$h"; fi; <gate loop>; exec <task>
```

The first start finds no file and runs the task through its gate, as before. To recover a killed session the bot:

1. reads the handoff path back from the container's own `Config.Cmd` (`readDockerResumeHandoffPath`), so a container created before this change is recognised as having no handoff;
2. writes `exec <recovery command>` to that path with `docker cp`, which works on a stopped container (`writeDockerResumeHandoff`);
3. runs `$ --resume <uuid>` **without** a command. start-command picks `docker-start` and restarts the same container, which runs the recovery command.

Nothing is copied. The container keeps its ID, its writable layer (the cloned repository, the build cache) and its HostConfig, so the CPU/RAM limits applied with `docker update` survive too. start-command already uses the same `docker cp` + entrypoint selector technique for its own `--on-kill-resume` marker (`js/src/lib/execution-recovery.js`).

The recovery is tracked under the execution UUID, or under the container name if the killed session was already keyed by the UUID. The killed session's completion then cannot delete the recovery's entry. Every Docker probe uses the recorded `containerName` rather than the key.

### Guarded snapshot for legacy containers (R1, R3, R4)

A container without the prefix can only take a new command through `docker-snapshot`. That path now:

- **runs one snapshot at a time** (`dockerSnapshotQueue`). Waiting recoveries report "Waiting for N other container snapshot(s) to finish first.";
- **checks the headroom first**: the free space on the Docker data root must cover 2 × the writable layer (blob + unpacked snapshot) + a 10 GiB reserve. While it does not, the recovery reports "Waiting for disk: …" and re-checks every 30 s for up to 10 minutes. Then it falls back to a fresh launch rather than fill the disk. Unknown sizes fail open, which is the old behaviour;
- reports "Snapshotting the N GiB container filesystem …";
- gives the derived container the handoff prefix as well, so its next recovery is a `docker start`;
- **removes the stopped original** with `docker rm` (never `-f`) once the derived container runs, unless `HIVE_MIND_KEEP_TASK_CONTAINER=always`.

### Cleanup when the task finishes (R5)

The snapshot images a session's recoveries created are carried from the killed session to its recovery (`containerSnapshotImages`, persisted). When the finished task's container is removed, its images are removed too, newest first, with `docker rmi`. Docker refuses while a container still uses an image, which is the right outcome for a kept container. A container kept for investigation lists its images and the `docker rmi` command in the "kept" section.

The completion action for the killed session is settled after its recovery is known (`settleDockerTaskContainerActionAfterRecovery`). A container restarted by `docker start` is never `docker rm -f`'d, even with `HIVE_MIND_KEEP_TASK_CONTAINER=never`. A snapshotted original that was already removed is not reported as kept.

### Status in Telegram (R6)

`reportRecoveryLifecycle` takes a `detail` line. A changed detail updates the message even within the same phase, so the user sees "Restarting the same container with docker start (no filesystem copy).", "Waiting for disk: …", "Waiting for 1 other container snapshot to finish first." or "Snapshotting the 23.5 GiB container filesystem …" as they happen.

## Alternatives considered

| Option                                                                           | Why not (or not alone)                                                                                                                                                                               |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Always relaunch fresh instead of resuming in place                               | Loses the cloned repository and build cache, and Codex threads cannot be resumed in a new container (#2888)                                                                                          |
| Keep `docker-snapshot`, only serialize and preflight                             | Still copies tens of GB per recovery and still takes 30+ minutes of CPU on containerd; kept only as the fallback for legacy containers                                                               |
| `docker start` + `docker exec` the recovery command                              | The restarted container re-runs its original command (the task), which would then run twice                                                                                                          |
| Put the build output on a named volume so `docker commit` skips it               | Changes every task's filesystem layout and does not help the containers that already exist. The handoff makes the commit unnecessary instead                                                         |
| Upstream `--recovery-command` at launch (start#176, `--on-kill-resume`)          | Covers recoveries start-command triggers itself. The bot's recovery command depends on state known only at recovery time (the tool session ID to resume), so it has to be handed over after the kill |
| Delete `target/` from the stopped container's upperdir on the host before commit | Needs root on the Docker host and knowledge of the snapshotter's internal paths; the bot runs inside a container                                                                                     |

## Online research

- **start-command resume modes**: link-foundation/start `js/src/lib/execution-resume.js` (0.36.0, checked 2026-10-10). `DOCKER_START` is chosen only when no new command is given; with a command the plan is `docker commit <name> start-command-resume/<name>:<attempt>`, then `docker run --name <name>-resume-<attempt> …`. There is no disk check and no serialization, and neither the original nor the image is ever removed. The design is described in start's `docs/case-studies/issue-162/solutions.md`.
- **containerd image store disk usage**: Docker's documentation, ["containerd image store with Docker Engine"](https://docs.docker.com/engine/storage/containerd/), says "containerd stores images in both compressed and uncompressed formats". It is the default for fresh Docker Engine 29 installations, and its data lives under containerd's own root (`/var/lib/containerd`), not Docker's `data-root`. This is the basis of the 2× headroom factor, and the ENOSPC path in the issue is under `/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/`.
- **Why commit time grows with the filesystem, not the change**: Sealos, ["How Sealos DevBox Cut Container Commit Time from 15 Minutes to 1 Second"](https://sealos.io/blog/sealos-devbox-commit-performance-optimization/). containerd's default diff uses `doubleWalkDiff`, "a full, recursive walk of two directory trees". A 10 GB commit took 847 s and a 1 KB incremental commit 39 s, with the CPU at 100 %. Their fix reads only the overlayfs `upperdir` (`fs.DiffDirChanges` with `DiffSourceOverlayFS`) in a patched containerd. A stock Docker installation does not have that fix, which matches the incident's 10+ minute commit of a ~560 KiB layer.
- **`docker cp` on stopped containers**: the Docker CLI reference for `docker cp` says "You can copy to or from either a running or stopped container", and files are created with root's UID:GID. The handoff file only needs to be readable by `sh`, and it is written with mode 0644.
- **Existing components**: start-command's own `--on-kill-resume` recovery (start#176) uses the same `docker cp` marker + entrypoint selector technique. CRIU/`docker checkpoint` could keep process state, but it is experimental, needs root and CRIU on the host, and does not reduce disk usage. No existing library offers "re-run a stopped container with a different command without committing it". Docker has no such API; `docker start` always re-runs `Config.Cmd`.

## Experiment (real Docker)

`experiments/issue-2889-docker-start-handoff.mjs` launches a container exactly as Hive Mind does (handoff prefix + start gate), writes 64 MiB, and kills it. It then hands over a recovery command and resumes by execution UUID ([full output](./data/docker-start-handoff-experiment.log)). Docker 29.8.0, start-command 0.35.4, alpine:3.20:

```
$ --resume (no command): {"success":true,"mode":"docker-start",...} in 643 ms
PASS: the very same container is running again
PASS: the recovery sees the killed task's files (same writable layer)
PASS: the gated task did not run again
PASS: no start-command-resume/* image was committed
PASS: no <session>-resume-* container was created
$ --resume -- <command> (previous behaviour): mode=docker-snapshot in 2511 ms; images: start-command-resume/…:2 74.9MB
```

The same 64 MiB layer becomes a 74.9 MB image with the old path and nothing with the new one. The cost of the old path grows with the layer size: 11–37 GiB in the incident.

`examples/issue-2889-manual-docker-start-recovery.sh` is the same procedure for an operator recovering a container by hand.

## Tests

- `tests/test-issue-2889-docker-resume-handoff.mjs` (default suite, 72 assertions). It covers:
  - the handoff prefix (including running it in a real `sh`);
  - the Docker helpers on non-zero exits;
  - the disk guard and the queue;
  - the docker-start path: tracking keys, a handoff write failure, the relaunch race, and limits on start-command 0.34.1;
  - the snapshot path: original removal, `always`, waiting for disk, serialization;
  - recovery tracking and disk-limit kill targets;
  - the completion action after a recovery, with the monitor run end to end;
  - the lifecycle detail line.

  Each fix was reverted in turn to confirm that the tests fail without it.

- `tests/test-issue-2189-same-container-resume.mjs` is updated for the handoff-wrapped recovery command.

## Upstream reports

- link-foundation/start#193: concurrent `$ --resume` loses the execution record (lock timeout). Already filed and fixed in start PR #196.
- link-foundation/start#198: `--resume <id> -- <command>` copies the whole writable layer with no disk preflight, no serialization and no cleanup. It suggests a copy-free command handoff for `docker start` ([copy](./upstream-start-snapshot-storage.md)).

## Limitations

- **Containers created before this change** still need a snapshot for their first recovery. It is now bounded (one at a time, headroom, original removed), but it is still a full copy and still slow on containerd. Their derived container has the handoff, so later recoveries are copy-free.
- **Dropping regenerable caches before a snapshot** (`target/`, `node_modules/.cache`) is not done. The container is stopped, starting it re-runs its original command, and editing the snapshotter's directories needs root on the host. The copy-free path makes it unnecessary for new containers.
- **The headroom check measures the Docker data root** reported by `checkDockerDiskSpace` (`docker info` `DockerRootDir`, then `df` where the bot runs). If containerd's root (`/var/lib/containerd`) is on a different filesystem, it is not what gets measured. In the incident both were on `/`.
- **The snapshot queue is per bot process.** Two bots sharing one Docker host do not serialize against each other.
