# The Docker disk-space preflight never ran when the bot used the host Docker socket

[Issue #3001](https://github.com/link-assistant/hive-mind/issues/3001) reports that the
no-space preflight from [#1914](https://github.com/link-assistant/hive-mind/issues/1914)
never worked in production. In production the bot runs in the `hive-mind` container and
talks to the host's Docker through a mounted `/var/run/docker.sock`. Every start logged:

```
[VERBOSE] isolation-runner: docker storage driver: overlayfs
[VERBOSE] isolation-runner: could not parse df output for Docker disk space
```

The check was skipped with no visible warning. Isolated tasks were then launched without
any disk check on a host that had already filled up once (ENOSPC,
[link-foundation/start#193](https://github.com/link-foundation/start/issues/193),
[#2889](https://github.com/link-assistant/hive-mind/issues/2889)).
[PR #3003](https://github.com/link-assistant/hive-mind/pull/3003) fixes it.

## Data

| File                                                                                                                                        | Content                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [`data/issue-3001.json`](data/issue-3001.json), [`data/issue-3001-comments.json`](data/issue-3001-comments.json)                            | Issue snapshot (no comments at the time of the fix).                                                                           |
| [`data/link-foundation-start-193.md`](data/link-foundation-start-193.md)                                                                    | The related start-command issue: a full disk on 2026-10-09 14:32 UTC left a 0-byte `executions.lock` behind.                   |
| [`experiments/issue-3001/reproduce-output.txt`](../../../experiments/issue-3001/reproduce-output.txt)                                       | Reproduction: `df` on `DockerRootDir` fails in a socket-client container, but succeeds through the daemon.                     |
| [`experiments/issue-3001/command-stream-nonzero-exit-output.txt`](../../../experiments/issue-3001/command-stream-nonzero-exit-output.txt)   | command-stream's `$` resolves (does not throw) when `df` exits 1, with empty stdout.                                           |
| [`experiments/issue-3001/sibling-probes-nonzero-exit-output.txt`](../../../experiments/issue-3001/sibling-probes-nonzero-exit-output.txt)   | `checkDockerImagePresent(missing)` and `checkTmuxSessionRunning(missing)` returned `true` before the fix and `false` after it. |
| [`experiments/issue-3001/probe-from-socket-container-output.txt`](../../../experiments/issue-3001/probe-from-socket-container-output.txt)   | The new probe run inside `node:22-alpine` with only the Docker socket: 138.7 GiB free, measured through the daemon.            |
| [`experiments/issue-3001/gh-retry-nonzero-exit-output.txt`](../../../experiments/issue-3001/gh-retry-nonzero-exit-output.txt)               | The same root cause in the GitHub retry wrapper: a failing `gh` call was attempted once before the fix and 3 times after it.   |
| [`experiments/issue-3001/command-stream-result-fields-output.txt`](../../../experiments/issue-3001/command-stream-result-fields-output.txt) | Fields of a resolved command-stream result (`code`, `exitCode`, `stdout`, `stderr`, …).                                        |

All experiments were run on Docker Engine 29.8.2 with a nested daemon (`fuse-overlayfs`,
`/var/lib/docker`). A second container mounted only `/var/run/docker.sock` to play the
role of the production `hive-mind` container.

## Timeline

| Time (UTC)       | Event                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-06-14 17:59 | Commit `5f60c04e` (#1914) adds `checkDockerDiskSpace()`: `df -Pk $(docker info -f {{.DockerRootDir}})` in the bot's own filesystem. Development and the dind image ran the daemon in the same container, so the path existed there.                          |
| 2026-09-02/04    | [#2189](https://github.com/link-assistant/hive-mind/issues/2189): `$ --stop` assumed command-stream throws on a non-zero exit. That one call site was fixed locally, but the general pattern was not audited.                                                |
| 2026-10-09 14:32 | The production host's disk fills (concurrent `docker commit` snapshots, [#2889](https://github.com/link-assistant/hive-mind/issues/2889)). start-command is left with an empty lock file ([start#193](https://github.com/link-foundation/start/issues/193)). |
| 2026-10-10 09:30 | Issue #3001 is opened: in the host-socket deployment the preflight logs only `could not parse df output` and never measures anything.                                                                                                                        |
| 2026-10-10 09:43 | PR #3003 is opened as a draft.                                                                                                                                                                                                                               |
| 2026-10-12       | Reproduced (see Data). The fix, the codebase-wide sweep and the tests are pushed to PR #3003.                                                                                                                                                                |

## Requirements from the issue

| #   | Requirement                                                                                                    | Where it is addressed                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Measure the data root through the daemon when it is not visible locally, using the already-present task image. | `src/docker-disk-space.lib.mjs` (`measureThroughDaemon`)                                                                                            |
| R2  | With the containerd image store, also measure `/var/lib/containerd`.                                           | `resolveDockerStoragePaths()` / `resolveContainerdRoot()`                                                                                           |
| R3  | Log the real reason (`df failed: …`, data root not visible) at warning level.                                  | `preflightDockerIsolation()` pushes a warning with `disk.error`, logged with `logger.warn`                                                          |
| R4  | Add a test for the container-with-socket deployment.                                                           | `tests/docker-disk-space-host-socket-3001.test.mjs`                                                                                                 |
| R5  | Collect logs and data in `docs/case-studies/issue-3001` and write a case study with online research.           | This document and `data/`                                                                                                                           |
| R6  | Add debug/verbose output where the root cause would otherwise be unclear.                                      | `[VERBOSE] docker-disk-space:` lines for every decision (local or daemon, which image, why a path failed)                                           |
| R7  | Report issues to other repositories where relevant.                                                            | See [Upstream](#upstream). No upstream defect was found.                                                                                            |
| R8  | Apply the fix everywhere the same problem exists.                                                              | See [Root cause 2](#2-code-assumed-command-streams--throws-on-a-non-zero-exit): sibling Docker probes, the `gh` retry wrapper and 12 other modules. |

## Root causes

### 1. `DockerRootDir` is a path in the daemon's filesystem, not the client's

`docker info` reports the daemon's view of the world. With the host socket mounted into a
container, the daemon runs on the host, so `/var/lib/docker` is a host path. Inside the
bot container that path is missing (busybox: `can't find mount point`, GNU: `No such
file or directory`) or, worse, could be an unrelated local directory. Either way, `df` on
it says nothing about the daemon's disk.

`docker info .Name` tells the two topologies apart. When the daemon runs in the same
container (dind, local development), the name is equal to `os.hostname()`. Through a host
socket it is the host's name. The reproduction shows `4f3f33d398a6` (daemon) versus
`276a97e7c250` (client).

**Fix.** `checkDockerDiskSpace()` (now in `src/docker-disk-space.lib.mjs`) measures
locally only when the daemon is local. Otherwise, or when local `df` fails, it runs `df`
inside a throwaway container. Any process the daemon starts sees the daemon's filesystem:

```
docker run --rm --pull never --network none --log-driver none --entrypoint df \
  --mount type=bind,source=<DockerRootDir>,target=/hive-mind-disk-probe,readonly \
  <task image> -Pk /hive-mind-disk-probe
```

- `--pull never`: never download anything. The task image is already required on the
  host, and other local images are tried if it is missing.
- `--mount type=bind` instead of `-v`: `-v` silently **creates** a missing host path,
  while `--mount` fails ([Docker bind-mount docs](https://docs.docker.com/engine/storage/bind-mounts/)).
- `--entrypoint df`: skips image entrypoints such as the dind start script.
- `--network none --log-driver none`: no side effects.

### 2. Code assumed command-stream's `$` throws on a non-zero exit

command-stream resolves with `{ code, stdout, stderr }` when a command fails. Its README
documents this as the default ("Default behavior: Commands don't throw on non-zero exit";
`shell.errexit(true)` opts in to throwing). Nothing in hive-mind enables `errexit`.

So the failing `df` produced an empty stdout. `parseInt` gave `NaN`, and the probe logged
"could not parse df output" at verbose level. The real failure, `df` exiting 1, was never
seen. The same assumption produced more false negatives elsewhere:

| Area                                                                                                                                                        | Effect before the fix                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `checkDockerImagePresent`                                                                                                                                   | A missing image was reported as present (verified, see Data).                                                         |
| `checkTmuxSessionRunning`                                                                                                                                   | A missing tmux session (or missing tmux) was reported as running (verified).                                          |
| `releaseDockerContainerStartGate`, `removeDockerContainer`, `killDockerContainer`                                                                           | Failures were reported as success.                                                                                    |
| `wrapDollarWithGhRetry`                                                                                                                                     | Rate-limited and transient `gh` failures were never retried: 1 attempt instead of 3 (verified).                       |
| `claude.runtime-switch.lib.mjs`                                                                                                                             | With `bun` missing, `--force-claude-bun-run` still rewrote Claude's shebang to bun. A failed backup `cp` was ignored. |
| `claude.lib.mjs`, `codex.lib.mjs`                                                                                                                           | A missing `start-agent` still set `agentCommanderInstalled = true`.                                                   |
| `solve.progress-monitoring.lib.mjs`                                                                                                                         | Failed `gh` PATCH and `gh pr edit` calls were logged as a successful progress update.                                 |
| `critical-error-commit.lib.mjs`                                                                                                                             | A failed `git status … 2>&1` was read as uncommitted changes (its error text was on stdout).                          |
| `hive.mjs`, `reviewers-hive.mjs`, `github.lib.mjs`, `bidirectional-interactive.lib.mjs`, `development-log.lib.mjs`, `youtrack-sync.mjs`, `memory-check.mjs` | Failures were swallowed instead of reaching the catch block that logs or reports them.                                |

**Fix.** `assertCommandSucceeded(result, label)` in `src/command-result.lib.mjs` throws
for a non-zero `code`. The error carries `code`, `stdout` and `stderr`, and its message
uses the first line of stderr, or of stdout for `2>&1` callers. Each site above routes its
result through it, so its existing catch block runs.

`wrapDollarWithGhRetry` is different, because many callers rely on getting a non-zero
result back. It turns only _retryable_ non-zero results (rate limit, transient
network/5xx) into retries, and returns the last result unchanged when the budget runs out.

Sites that decide from stdout content alone were reviewed and left unchanged, because an
empty stdout already means "no" there: `checkScreenSessionRunning`,
`checkDockerContainerRunning`, `querySessionStatus`, `listIsolationSessions`,
`getDockerContainerWritableLayerSize`, `findStartCommandBinary`, and the diagnostic
`getResourceSnapshot`. Sites that already check `.code`/`.exitCode`, which is most of
`solve.*`, were also left as they were.

### 3. With the containerd image store, image layers are not under `DockerRootDir`

Docker Engine 29 uses the containerd image store by default on fresh installs. Image
content and snapshots then live in `/var/lib/containerd`, and `data-root` does not move
them ([Docker daemon docs](https://docs.docker.com/engine/daemon/),
[containerd image store](https://docs.docker.com/engine/storage/containerd/),
[Microsoft Tech Community write-up](https://techcommunity.microsoft.com/discussions/azure/docker-engine-v29-on-linux-why-data-root-no-longer-prevents-os-disk-growth-and-h/4504862)).
The production log shows driver `overlayfs`, which is this store's snapshotter (the
legacy graph driver is `overlay2`). So even a working `df` on `DockerRootDir` could
measure the wrong disk.

**Fix.** `parseDockerInfo()` detects the store: `DriverStatus` has `driver-type
io.containerd.snapshotter.v1`, or the driver is `overlayfs`. `resolveContainerdRoot()`
then adds the containerd root:

- `HIVE_MIND_DOCKER_CONTAINERD_ROOT` overrides it.
- A dockerd-managed containerd (`/run/docker/…` address) uses `<DockerRootDir>/containerd/daemon`.
- Otherwise it is `/var/lib/containerd`.

Each path is measured, and the smallest free space wins.

### 4. A disabled safety check was only visible in verbose mode

When the probe failed, the preflight silently had `diskAvailableGiB = null`.
`preflightDockerIsolation()` now returns `diskError`. It warns, at warning level, that the
low-disk check is DISABLED and why, and it suggests the manual `df` commands to run on the
host. On success it logs `💾 Docker storage: ~N GiB free on <path> (measured through the
Docker daemon)`.

## Alternatives considered

| Option                                                         | Verdict                                                                                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Bind-mount the host's `/var/lib/docker` into the bot container | Works, but changes the deployment, couples the bot to the host layout, and gives the bot read access to all container data.                    |
| `docker system df`                                             | Reports how much Docker _uses_, not how much the filesystem has _free_.                                                                        |
| Docker Engine API (`/info`, `/system/df`)                      | Neither reports free space on the data-root filesystem.                                                                                        |
| Node `fs.statfs()`                                             | Same namespace problem as `df`. It is a good fit for the local case, but `df -Pk` is kept so the local and daemon paths parse the same output. |
| A dedicated probe image (e.g. `busybox`)                       | Would need a pull on air-gapped hosts. Reusing the task image, or any local image with `--pull never`, needs nothing new.                      |

## Upstream

- **command-stream**: resolving on a non-zero exit is documented, intended behaviour, so
  there is no defect to report. The bug was in hive-mind's call sites.
- **Docker**: `DockerRootDir` being a daemon-side path is by design, and the containerd
  store split is documented. Nothing to report.
- **link-foundation/start#193** (ENOSPC leaving an empty lock file) is already reported
  and closed. This fix reduces how often that path is reached, by warning before the disk
  fills, but it does not change start-command.

## Tests

- `tests/docker-disk-space-host-socket-3001.test.mjs`: replays the host-socket topology
  with a fake command runner. It covers the daemon measurement and its flags, the local
  fallback, the containerd store, image fallback, `docker info` failure, busybox
  header-only `df` output, the preflight warning text and level, and the sibling probes
  returning `false`.
- `tests/command-nonzero-exit-sites-3001.test.mjs`: `assertCommandSucceeded`, a
  behavioural check of the critical-error recovery, and a source guard that every site
  above checks the exit code.
- `tests/github-rate-limit.test.mjs`: retry of a _resolved_ rate-limited result, the last
  result returned when the budget is spent, and no retry for a non-retryable failure.
- `tests/test-issue-1914-storage-driver-diagnostics.mjs`: accepts the new
  `{ availableGiB: null, error }` shape.
