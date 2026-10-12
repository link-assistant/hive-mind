# `docker ps --format '{{json .}}'` made dockerd walk every container layer

[Issue #3000](https://github.com/link-assistant/hive-mind/issues/3000) reports that two hive-mind
container listings asked dockerd for the size of every container. They did not need the sizes. On the
production host each listing took 2.5 s instead of 0.35 s. It also failed whenever a task deleted a file
during the walk:

```
Error response from daemon: snapshotter.Usage failed for 698e6ba296d2…: lstat /var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/snapshots/7214/fs/tmp/ccCBKh2I.s: no such file or directory
```

The callers then handled the failure badly. `/cleanup` printed "(none detected)". The image reclaim plan
treated every image as unused.

[PR #3002](https://github.com/link-assistant/hive-mind/pull/3002) fixes all three: it names the
fields, `/cleanup` reports a failed listing, and the reclaim plan gives up instead of guessing.

## Data

| File                                                                                                                                                                                                 | Content                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`data/issue.json`](data/issue.json), [`data/issue-comments.json`](data/issue-comments.json)                                                                                                         | Issue snapshot. There are no comments.                                                                                                                                                                                                       |
| [`data/issue-2629.json`](data/issue-2629.json)                                                                                                                                                       | [#2629](https://github.com/link-assistant/hive-mind/issues/2629). Item 1 is the same failure seen from `hive-cleanup` three days earlier: "(none detected)" in 2 of 12 runs, 11–17 s per listing.                                            |
| [`data/issue-2892.json`](data/issue-2892.json)                                                                                                                                                       | [#2892](https://github.com/link-assistant/hive-mind/issues/2892), the dockerd OOM kill (concurrent layer walks) that the issue cites.                                                                                                        |
| [`data/docker-for-linux-1179.json`](data/docker-for-linux-1179.json), [`data/ptone-scion-1867.json`](data/ptone-scion-1867.json), [`data/openzim-zimfarm-1591.json`](data/openzim-zimfarm-1591.json) | The same problem in other projects (see [Research](#research-existing-components-and-upstream-reports)).                                                                                                                                     |
| [`data/upstream-source-research.md`](data/upstream-source-research.md)                                                                                                                               | Notes on the docker/cli, moby and containerd source, with pinned commits and quoted code: how the CLI decides to send `size=1`, why the daemon fails the whole list, `docker system df`, `docker image ls`, and the Docker 29 release notes. |
| [`data/docker-api-proxy.log`](data/docker-api-proxy.log)                                                                                                                                             | The API requests the docker CLI sends for each command, captured with [`docker-api-proxy.mjs`](../../../experiments/issue-3000/docker-api-proxy.mjs).                                                                                        |
| [`data/repro-graphdriver-fuse-overlayfs.log`](data/repro-graphdriver-fuse-overlayfs.log)                                                                                                             | [`reproduce-size-walk.sh`](../../../experiments/issue-3000/reproduce-size-walk.sh) on the solver host (Docker 29.8.2, graphdriver `fuse-overlayfs`, 4 × 20 000-file layers): slow, but never fails.                                          |
| [`data/repro-containerd-overlayfs-run1.log`](data/repro-containerd-overlayfs-run1.log), [`data/repro-containerd-overlayfs-run2.log`](data/repro-containerd-overlayfs-run2.log)                       | The same script against Docker 29.9.0 on the containerd image store (`docker:dind`, `/var/lib/docker` on tmpfs). It reproduces the production error.                                                                                         |
| [`data/minimal-upstream-repro.log`](data/minimal-upstream-repro.log)                                                                                                                                 | [`minimal-upstream-repro.sh`](../../../experiments/issue-3000/minimal-upstream-repro.sh): one container that churns temp files, and the failure rate of every size-walking call. It is the repro used in the upstream reports.               |
| [`data/du-walk-race-go.log`](data/du-walk-race-go.log)                                                                                                                                               | [`du-walk-race/main.go`](../../../experiments/issue-3000/du-walk-race/main.go): containerd/continuity's `DiskUsage` walk, with and without skipping vanished entries.                                                                        |
| [`data/reclaim-plan-before-after.log`](data/reclaim-plan-before-after.log)                                                                                                                           | [`reclaim-plan-on-ps-failure.mjs`](../../../experiments/issue-3000/reclaim-plan-on-ps-failure.mjs) on `main` and on this branch: what the reclaim plan does when `docker ps` fails.                                                          |
| [`upstream/`](upstream)                                                                                                                                                                              | The text of the issues filed upstream.                                                                                                                                                                                                       |

## Timeline

| Date (UTC)        | Event                                                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2016-06 – 2020-01 | docker/cli starts sending `size=1` when a `--format` template uses `.Size` (moby/moby#23247, #24703). docker/cli#2232 (merged 2020-01-06) makes the probe execute real template functions, so `{{json .}}`, which calls every method, always asks for sizes. |
| 2021-01-05        | docker/for-linux#1179: "`docker ps --format='{{json .}}'` is extremely slow due to Size field". Still open.                                                                                                                                                  |
| 2023-03-06        | docker/cli#4067: an explicit `--size=false` overrides the auto-detection. Older CLIs ignore it.                                                                                                                                                              |
| 2025-11-10        | Docker 29.0.0 makes the containerd image store the default for fresh installs. On that store, one failed rw-layer walk fails the whole `GET /containers/json?size=1`.                                                                                        |
| 2025-12-17        | openzim/zimfarm#1591 hits `snapshotter.Usage failed … lstat …: no such file or directory` on `inspect?size=True`.                                                                                                                                            |
| 2026-06-24        | `da88ee52` adds `listDockerIsolationContainers()` to `/cleanup` with `docker ps -a --format '{{json .}}'`.                                                                                                                                                   |
| 2026-09-04        | `3968dafb` (#2187) adds `collectDockerImageReclaimPlan()` with the same format. It runs after every solve, in the disk guard and in the reclaimable-space report.                                                                                            |
| 2026-09-25        | ptone/scion#1867 reports the same failure and fixes it with explicit fields: "fails 10/10 times with `{{json .}}`, and succeeds 10/10 times with explicit fields".                                                                                           |
| 2026-10-07        | #2629: `hive-cleanup` silently reports "(none detected)" in 2 of 12 runs. The listing takes 11–17 s against a 20 s timeout and fails with the same snapshotter error.                                                                                        |
| 2026-10-09        | #2892: dockerd is OOM-killed by concurrent layer walks (`docker diff` from another tool). Its restart kills every task.                                                                                                                                      |
| 2026-10-10 09:30  | #3000 is filed with measurements from production (Docker 29.6.1, containerd store, 8 containers): 2.527 s with `{{json .}}` against 0.352 s with `{{.Names}}`. PR #3002 is opened at 09:41.                                                                  |
| 2026-10-11/12     | Investigation: API capture, reproductions on both storage backends, source reading, fix and tests (this document).                                                                                                                                           |

## Requirements from the issue

| #   | Requirement                                                                                        | Where it is addressed                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `docker ps` names the fields it needs instead of `{{json .}}`, so the size walk never runs.        | [`src/docker-ps-format.lib.mjs`](../../../src/docker-ps-format.lib.mjs), used by both call sites. [Fix 1](#1-name-the-fields)                                              |
| R2  | The existing JSON-lines parsers keep working.                                                      | The format still emits one JSON object per line. The test parses rendered output with `parseDockerPsJsonLines`.                                                            |
| R3  | A failed `docker ps` in the reclaim plan means "no plan" (`null`), not "no containers".            | [`collectDockerImageReclaimPlan`](../../../src/docker-image-reclaim.lib.mjs). [Fix 3](#3-a-failed-listing-means-no-reclaim-plan)                                           |
| R4  | `/cleanup` must not report a failed listing as "no containers" (from the issue's problem list).    | `readDockerIsolationContainers()` + `src/cleanup.mjs`. [Fix 2](#2-cleanup-reports-a-failed-listing)                                                                        |
| R5  | Collect logs and data in `docs/case-studies/issue-3000`, and do a case study with online research. | This folder.                                                                                                                                                               |
| R6  | Add debug output if the root cause is not clear.                                                   | Not needed: the root cause is reproduced and traced to source lines. The experiments (an API proxy and repro scripts) stay in `experiments/issue-3000/` for the next time. |
| R7  | Report the problem to other projects, with a repro, workarounds and suggested fixes.               | [Upstream reports](#upstream-reports).                                                                                                                                     |
| R8  | Apply the fix everywhere in the codebase.                                                          | [Everywhere else](#everywhere-else-in-the-codebase). A test scans `src/` for any `docker ps` that asks for sizes.                                                          |

## Root causes

### 1. The docker CLI asks for sizes whenever `{{json .}}` is used

Before it calls the API, `docker ps` runs the `--format` template once against a probe `ContainerContext`.
If the template called `Size()`, the CLI adds `size=1` to the request
([cli/command/container/list.go#L71-L115](https://github.com/docker/cli/blob/e4078058de0a9f4d5cb65f946f4b8a090e19fffe/cli/command/container/list.go#L71-L115)).
`{{json .}}` encodes the context with `MarshalJSON`, which calls **every** exported method, `Size()`
included
([formatter/reflect.go#L25-L71](https://github.com/docker/cli/blob/e4078058de0a9f4d5cb65f946f4b8a090e19fffe/cli/command/formatter/reflect.go#L25-L71)).
So `{{json .}}` always asks for sizes.

The API proxy shows exactly that ([`data/docker-api-proxy.log`](data/docker-api-proxy.log)):

| Command                                           | Request                                        |
| ------------------------------------------------- | ---------------------------------------------- |
| `docker ps -a --format '{{json .}}'`              | `GET /v1.56/containers/json?all=1&size=1`      |
| `docker ps -a --format '{"ID":{{json .ID}},…}'`   | `GET /v1.56/containers/json?all=1`             |
| `docker ps -a --size=false --format '{{json .}}'` | `GET /v1.56/containers/json?all=1`             |
| `docker image ls --format '{{json .}}'`           | `GET /v1.56/images/json`                       |
| `docker system df`                                | `GET /v1.56/system/df` (no `type`: everything) |

hive-mind used `{{json .}}` in both listings (`src/cleanup.os.lib.mjs:370` and
`src/docker-image-reclaim.lib.mjs:341` on `main`). Both read only the ID, names, image, state, status
and labels.

### 2. A size is a walk of the container's writable layer

With `size=1`, dockerd computes `SizeRw` and `SizeRootFs` for every container. On the containerd image
store, `GetContainerLayerSize` calls the snapshotter's `Usage` for the container's rw snapshot
([daemon/containerd/service.go#L336-L367](https://github.com/moby/moby/blob/9fabd6dfbb926381278c436a866bc8d6ac222274/daemon/containerd/service.go#L336-L367)).
For an active snapshot the overlay snapshotter runs `fs.DiskUsage(upperdir)` from containerd/continuity.
That is a `filepath.Walk` that `lstat`s every file. The cost grows with the number of files in every
task's layer, and task layers hold whole checkouts, `node_modules` and build trees.

Measured:

| Host                                                                              | `{{json .}}`             | explicit fields        |
| --------------------------------------------------------------------------------- | ------------------------ | ---------------------- |
| Production, Docker 29.6.1, containerd store, 8 containers (issue)                 | 2.527 s                  | 0.352 s (`{{.Names}}`) |
| Production, #2629                                                                 | 11–17 s                  | —                      |
| Solver host, Docker 29.8.2, fuse-overlayfs graphdriver, 4 × 20 000 files, 30 runs | 5 232 ms avg, 0 failed   | 75 ms avg, 0 failed    |
| dind, Docker 29.9.0, containerd store, 4 × 20 000 files + churn, 20 runs          | 354 ms avg, **7 failed** | 134 ms avg, 0 failed   |

### 3. On the containerd store, a file deleted mid-walk fails the whole listing

`filepath.Walk` lists a directory and then `lstat`s each entry. If a task deletes an entry in between,
which compilers do with their temp files all the time, continuity's callback returns the error
([fs/du_unix.go#L68-L71](https://github.com/containerd/continuity/blob/555e512ce5c436ac0a05cdd516eff4ae5995ed15/fs/du_unix.go#L68-L71)).
The snapshotter then returns `lstat …: no such file or directory`, or `readdirent …` if a whole directory
went away.

Dockerd does not tolerate that. `daemon/list.go` computes sizes in an errgroup, and one container's error
fails the whole request
([daemon/list.go#L163-L170](https://github.com/moby/moby/blob/9fabd6dfbb926381278c436a866bc8d6ac222274/daemon/list.go#L163-L170)).
`docker system df` lists containers the same way and fails with "failed to retrieve container list: …".
The graphdriver path only logs the error and reports `-1`
([daemon/images/image_unix.go#L19-L50](https://github.com/moby/moby/blob/9fabd6dfbb926381278c436a866bc8d6ac222274/daemon/images/image_unix.go#L19-L50)).
That is why the solver host (fuse-overlayfs) never fails, while production (containerd store) does.

[`data/minimal-upstream-repro.log`](data/minimal-upstream-repro.log): one container churns 300 files in
`/tmp`, 50 runs of each call:

```
docker ps -a --size          failed 16/50
docker ps -a --format '{{json .}}' failed 11/50
docker ps -a                 failed 0/50
docker system df             failed 13/50
# GET /containers/json?all=1&size=1 status codes:
     37 200
     13 500
```

The walk alone, without docker ([`data/du-walk-race-go.log`](data/du-walk-race-go.log)):

```
continuity v0.5.0 walk:  failed 1060/2000 map[lstat <path>: no such file or directory:1050 readdirent <path>: no such file or directory:10]
skip-ENOENT walk:        failed 0/2000 map[]
```

### 4. Both callers turned "the listing failed" into "there are no containers"

- `listDockerIsolationContainers()` used `tryExec`, which turns any failure or timeout into `null` and
  drops stderr. The function then returned `[]`. `/cleanup` printed `(none detected)`, the same output
  as a clean host. This is #2629 item 1.
- `collectDockerImageReclaimPlan()` passed the failed output (`runDocker` → `null`) to
  `parseDockerJsonLines(null)`, which gives `[]`. With no containers, no image is in use, so every
  superseded image went into `remove`. The reclaimable-space report counted in-use images as free space,
  and `docker image rm` was attempted for them. Docker refuses to remove an image a container uses (no
  `-f` is passed), so the damage was a false estimate and failed removals. That still depended on
  Docker's refusal, not on hive-mind's plan.

[`data/reclaim-plan-before-after.log`](data/reclaim-plan-before-after.log): a running task uses
`konard/hive-mind:2.35.2`, and `docker ps` fails with the snapshotter error:

```
# before (main d6e47d1a)
plan: remove konard/hive-mind:2.35.2; reclaimable 12992276070 bytes

# after (this branch)
plan: null (no plan — nothing counted, nothing removed)
```

## Fix

### 1. Name the fields

[`src/docker-ps-format.lib.mjs`](../../../src/docker-ps-format.lib.mjs) holds the one `docker ps`
format both callers use. It is exactly the format proposed in the issue:

```
{"ID":{{json .ID}},"Names":{{json .Names}},"Image":{{json .Image}},"State":{{json .State}},"Status":{{json .Status}},"Labels":{{json .Labels}}}
```

`dockerPsArgs()` returns `['ps', '--all', '--format', DOCKER_PS_JSON_FORMAT]`. Each line is still a
JSON object, so `parseDockerPsJsonLines` and `parseDockerJsonLines` are unchanged. Explicit fields were
chosen over `--size=false` because they work with every docker CLI. Older CLIs silently ignore
`--size=false` and walk anyway.

### 2. `/cleanup` reports a failed listing

`readDockerIsolationContainers()` in `src/cleanup.os.lib.mjs` returns
`{ containers, available, error }`:

- no docker binary (ENOENT): `available: false`, no error, since there is nothing to clean;
- the command failed: `error` holds docker's stderr;
- success: the parsed containers.

`src/cleanup.mjs` prints `⚠️  Could not list containers, so none are removed: <docker's error>` instead
of `(none detected)`. `listDockerIsolationContainers()` keeps its old signature and returns `[]` on
failure, so no other caller changes.

### 3. A failed listing means no reclaim plan

`collectDockerImageReclaimPlan()` returns `null` when `docker ps` fails, as it already did when
`docker image ls` failed. Its three callers already treat `null` as "nothing to do":

- `solve.cleanup.lib.mjs:64`;
- `disk-guard.lib.mjs:233`;
- `reclaimable-space.lib.mjs:108`.

### Tests

[`tests/test-issue-3000-docker-ps-size-walk.mjs`](../../../tests/test-issue-3000-docker-ps-size-walk.mjs)
runs in the default suite and has 19 checks:

- the format never references `.Size` or `{{json .}}`, matches the issue, renders to valid JSON from a
  real `{{json .}}` record, and is parsed by `parseDockerPsJsonLines`;
- no `docker ps` call in `src/` uses `{{json .}}`, `--size` or `-s`;
- `/cleanup`: a successful listing, the snapshotter error (reported, not empty), no docker binary, and
  empty output;
- reclaim plan: the explicit format is used, an in-use image is kept, and a failed `docker ps` gives
  `null`.

On `main` the test cannot run, since `docker-ps-format.lib.mjs` and `readDockerIsolationContainers` do
not exist there. The before/after behaviour of `main` is in
[`data/reclaim-plan-before-after.log`](data/reclaim-plan-before-after.log) and the API capture above.

## Everywhere else in the codebase

Other calls that make dockerd walk container layers stay as they are:

| Call                                                                                                                                                     | Why it stays                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docker system df`: `estimateDockerBytes` (`system-cleanup-estimates.lib.mjs:200`), `measureDockerReclaimableBytes` (`docker-image-reclaim.lib.mjs:364`) | They need the reclaimable figure across all types, and the CLI has no type flag. A failure already becomes "unavailable" / `null`.                                                                                       |
| `docker system df --format '{{.Type}}\|{{.Size}}'`: `readDockerImagesDiskUsage` (`formal-ai-image-store.lib.mjs:230`)                                    | It needs only images, but `docker system df` cannot be limited to them. A failure falls back to estimating from removed images. If this ever matters, `GET /system/df?type=image` (API ≥ 1.42) skips the container walk. |
| `docker inspect --size` (`isolation-runner.lib.mjs:861`)                                                                                                 | A deliberate measurement of one task's own layer for the disk report and limit (#2189 throttles it). A failure becomes `null`, and the last known size is kept.                                                          |
| `docker image ls --format '{{json .}}'` (`docker-image-reclaim.lib.mjs:344`)                                                                             | Image listing does not walk container layers: the proxy shows plain `GET /images/json`, and the image sizes come from snapshot metadata. It never failed in any repro.                                                   |

Other repositories in the organization: a code search finds `{{json .}}` only in `docker info` and
`docker stats` calls (link-foundation/start), which do not compute container sizes.
link-foundation/disk-space-saviour already lists containers without sizes (its tests assert no
`--size` and no `{{json .}}`).

## Research: existing components and upstream reports

- **docker/cli `--size=false`** (docker/cli#4067, 2023): the official workaround for
  docker/for-linux#1179. It works only on CLIs from 2023 or later, so the explicit fields are more
  portable.
- **Explicit-field formats** are the fix other projects arrived at independently:
  - ptone/scion#1867 ("fails 10/10 times with `{{json .}}`, and succeeds 10/10 times with explicit
    fields");
  - link-assistant/hive-control-center `auto-fix` (cited in the issue);
  - link-foundation/disk-space-saviour.
- **The Docker Engine API** `GET /system/df?type=image|container|volume|build-cache` (API 1.42) can
  limit `df` to one object type. The CLI does not expose it (`df.go` has a TODO).
- **moby/moby#52090** (29.3.0) stopped `docker system prune` from failing on layer-size errors. It did
  not change `list.go` or `disk_usage.go`. Later `df` fixes (29.2.1 #51979, 29.5.3 #52672, 29.6.0 #52901)
  address prune races and image accounting, not the rw-layer walk. Release notes up to 29.9.0 have no
  change to this behaviour.
- **containerd/nerdctl#3027**: snapshotter `Usage` calls are expensive with many objects. That is the
  same cost from the nerdctl side.
- **Same error elsewhere**: openzim/zimfarm#1591 (`inspect?size=True`) and ptone/scion#1864 (`docker
system df`). Their fix was to tolerate the failure on their side.

Before this PR, no moby/moby or containerd/continuity issue for this failure existed. A search for "snapshotter.Usage"
finds only reports from downstream projects.

### Upstream reports

| Project               | Report                                                                           | Asks for                                                                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| moby/moby             | [moby/moby#53920](https://github.com/moby/moby/issues/53920)                     | `containers/json?size=1` and `/system/df` should not fail the whole request when one container's size cannot be computed: log it and report `-1`, as the graphdriver path and #52090 do. ([text](upstream/moby-moby-issue.md)) |
| containerd/continuity | [containerd/continuity#332](https://github.com/containerd/continuity/issues/332) | `fs.DiskUsage` should skip entries that vanish mid-walk. A tested patch is included. ([text](upstream/containerd-continuity-issue.md))                                                                                         |

Both include the minimal repro, its output, the workarounds and the suggested code change. They link to each other. moby/moby#53641 (`docker inspect --size` hangs on fuse-overlayfs) is another report of the size walk on the inspect path.

## Follow-ups (not in this PR)

- #2629 stays open for its other items: resume containers, sizes, TTL, and the `rm -f` race. This PR
  covers item 1 (flaky detection). Of the fixes #2629 suggests, it uses the size-free format and
  reports the error. It does not add a retry, because a listing that no longer walks layers has nothing
  transient to retry.
- If the Formal AI image store ever needs a reliable image total during heavy task churn, it can read
  `GET /system/df?type=image` over the socket instead of running `docker system df`.
