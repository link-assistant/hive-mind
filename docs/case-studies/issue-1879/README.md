# Issue 1879 Case Study: Re-downloading the Hive Mind image inside the container

## Summary

Issue: https://github.com/link-assistant/hive-mind/issues/1879

Pull request: https://github.com/link-assistant/hive-mind/pull/1880

Related issue: https://github.com/link-assistant/hive-mind/issues/1860 (the predecessor that
made Hive Mind own Docker isolation command construction).

Upstream context: https://github.com/link-foundation/start/pull/133 (native `--image` /
`--volume` / `--env` / `--privileged` Docker controls, now merged).

When a Telegram task runs with Docker isolation from the Hive Mind **Docker-in-Docker (DinD)**
deployment, the spawned `docker run konard/hive-mind-dind:latest …` reports:

```
Unable to find image 'konard/hive-mind-dind:latest' locally
latest: Pulling from konard/hive-mind-dind
…
```

and downloads a fresh, multi-gigabyte copy of the image — even though the **host** machine
already has that exact image (it is how the server is provisioned). The download repeats
because the `docker run` is talking to the container's _nested_ Docker daemon, whose image
store starts empty.

## Evidence Collected

- `raw/issue-1879.json` — issue body and metadata.
- `raw/pr-1880.json` — this PR's metadata.
- `raw/issue-1860.json` — the predecessor issue that introduced the DinD isolation flow.
- `raw/start-pr-133.json` — upstream `start` PR adding native Docker runtime controls.
- `raw/e8c6d542-task-execution.log` — the full task execution log from the issue's gist. It
  contains the `docker run … konard/hive-mind-dind:latest …` command and the
  `Unable to find image … locally` / `Pulling from …` sequence that proves the re-download.
- `raw/server-setup-gist.txt` — the server provisioning script
  (`deploy-docker.mjs` / `deploy-remote-docker.mjs`) showing how the host is set up.
- `raw/start-isolation-backend-excerpt.js` — `link-foundation/start`'s Docker isolation
  backend (`js/src/lib/isolation.js`), showing it only pulls when `dockerImageExists()` is
  false (it does **not** force-pull).

## Timeline / Sequence of Events

1. **Server provisioning** (`raw/server-setup-gist.txt`): the host pulls
   `konard/hive-mind-dind:latest`, starts a temporary container, installs/configures tooling,
   **wipes `/var/lib/docker`** (`find /var/lib/docker -mindepth 1 -delete`) so the nested
   dockerd starts from a clean state, then `docker commit`s the configured image and runs the
   final `hive-mind` container `--privileged` with `dind-entrypoint.sh` launching a nested
   `dockerd`.
2. **Task launch**: inside the running `hive-mind` container the Telegram bot calls
   `executeWithIsolation('solve', …, { backend: 'docker' })`
   (`src/isolation-runner.lib.mjs`). For the docker backend this builds an explicit
   `docker run --rm … konard/hive-mind-dind:latest bash -lc 'solve …'` wrapped in a tracked
   `start --isolated screen` session (the design from issue #1860).
3. **The re-download**: that `docker run` targets the **nested** dockerd inside the container.
   Its image store is empty (step 1 wiped it and the commit baked nothing back in), so Docker
   prints `Unable to find image 'konard/hive-mind-dind:latest' locally` and pulls the whole
   image from Docker Hub — see `raw/e8c6d542-task-execution.log` lines 31+.
   - Timestamp in the log: `2026-06-09 11:31:04` UTC, execution `e8c6d542-…`, running
     `solve https://github.com/link-assistant/hive-mind/issues/1854 --model opus --tool claude`.

## Requirements From The Issue

1. Avoid re-downloading an image inside the container when the host already has it; reuse the
   host's installed image.
2. Investigate the version-pinning hypothesis ("we didn't pin the image to the same version
   that was downloaded on the host machine").
3. Consider simplifying the flow now that `link-foundation/start#133` is merged.
4. Preserve all logs and issue data under `docs/case-studies/issue-1879`.
5. Do a deep case study: timeline, requirements, root causes, solution plans, and a survey of
   existing components/libraries that solve a similar problem.
6. Search online for additional facts.
7. If the data is insufficient to find the root cause, add debug/verbose output for the next
   iteration.
8. If another repository is involved, file an issue there with a reproducible example,
   workaround, and suggested fix.
9. Apply the fix across the whole codebase (every place the problem occurs).
10. Add automated regression coverage.

## Root Causes

### Root cause 1 (primary): the nested daemon starts with an empty image store

`docker run` uses the daemon it is pointed at. Inside the DinD container that is the **nested**
dockerd, not the host daemon. Docker's default pull policy is `missing`: it reuses a local
image if present and otherwise pulls. Because the nested store is empty — the provisioning
script deletes `/var/lib/docker` before `docker commit`, and the commit does not re-seed it —
every first isolated task on a fresh container pulls the full image. The host's copy is in a
_different_ daemon and is therefore invisible to the nested `docker run`.

This is **not** caused by start force-pulling. `link-foundation/start`'s Docker backend only
pulls when `dockerImageExists()` returns false (see
`raw/start-isolation-backend-excerpt.js`), and Hive Mind does not even use that backend for
docker isolation — it builds its own `docker run` inside a `screen` session. So switching to
start's native backend ("simplify the flow") would not change this behavior.

### Root cause 2 (secondary, the issue's hypothesis): `:latest` is unpinned

The isolation image was hardcoded to `konard/hive-mind-dind:latest`. Even if the nested daemon
were seeded, an unpinned `:latest` whose registry digest later drifts from the host copy would
trigger a fresh pull under `--pull=always` and produces non-reproducible runs (the isolated
task may run a different build than the parent). Pinning the tag does not by itself prevent the
empty-store pull, but it is a precondition for reliable reuse and reproducibility.

## Online / Source Facts

- Docker `docker run` reference: `--pull` accepts `always` | `missing` | `never`; default is
  `missing` (use local image if present, otherwise pull):
  https://docs.docker.com/reference/cli/docker/container/run/
- Docker image-store isolation: each daemon has its own image store; a nested
  Docker-in-Docker daemon does not share the host daemon's images:
  https://docs.docker.com/engine/security/rootless/ and the canonical
  `jpetazzo/dind` discussion "Using Docker-in-Docker for your CI … is it a good idea?"
  (https://jpetazzo.github.io/2015/09/03/do-not-use-docker-in-docker-for-ci/), which
  documents exactly this "the inner Docker will download images again" pitfall and recommends
  bind-mounting the host socket or pre-seeding the inner cache.
- `docker save` / `docker load` move an image between daemons without a registry round trip:
  https://docs.docker.com/reference/cli/docker/image/save/
- `link-foundation/start` Docker backend pulls only when the image is missing locally
  (`raw/start-isolation-backend-excerpt.js`).

## Existing Components / Libraries Considered

- **`docker save | docker load`** (built-in) — the simplest, dependency-free way to copy an
  image from the host daemon into the nested daemon. Chosen for the preload helper.
- **Bind-mounting the host Docker socket** (`-v /var/run/docker.sock:…`) — would make isolated
  containers siblings on the host daemon and reuse host images for free, but it discards the
  DinD isolation guarantee that issue #1860 deliberately adopted. Documented as an alternative,
  not chosen.
- **A local registry / pull-through cache** (`registry:2` mirror, `registry-mirrors`) — robust
  for many nodes but heavyweight for a single-host deployment. Documented as a scaling option.
- **`docker run --pull`** (built-in) — the lever to force reuse (`never`) or refresh
  (`always`). Wired up so operators can opt in.

## Solution Applied (this PR)

The fix gives operators the levers to reuse the host image and makes the behavior observable.
All changes are in code Hive Mind controls; the cross-daemon seeding itself is a deploy-time
action (a helper script is provided) plus an upstream request.

### 1. Image tag pinning — `src/isolation-runner.lib.mjs`

- New `resolveDockerIsolationImageTag()`; `getDockerIsolationImage()` now composes
  `repo:tag`. The tag defaults to `latest` (unchanged behavior) and can be pinned with
  `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG` (e.g. `1.74.11`). `HIVE_MIND_DOCKER_ISOLATION_IMAGE`
  remains a full override.

### 2. Pull policy control — `src/isolation-runner.lib.mjs`

- New `getDockerIsolationPullPolicy()` reads `HIVE_MIND_DOCKER_ISOLATION_PULL`
  (`always` | `missing` | `never`; invalid values ignored). When set,
  `buildDockerIsolationCommand()` emits `--pull <policy>` on the `docker run` (before the
  image). Default behavior is unchanged (no flag → Docker's `missing`). Setting `never` makes
  isolated tasks reuse a seeded image and fail fast instead of silently re-downloading.

### 3. Verbose observability — `src/isolation-runner.lib.mjs`

- `executeWithIsolation(..., { verbose: true })` now logs the resolved image **and** the pull
  policy, so the next operator can see exactly what `docker run` will do.

### 4. Host-image preload helper — `scripts/preload-dind-isolation-image.mjs`

- Seeds the nested daemon from the host with `docker save <image> | docker exec -i <container>
docker load`, skipping the copy if the nested daemon already has the image. Run it once after
  the container starts (and after image updates), then set
  `HIVE_MIND_DOCKER_ISOLATION_PULL=never`.

### 5. Documentation — `.env.example`

- Documents `HIVE_MIND_IMAGE_VARIANT`, `HIVE_MIND_DOCKER_ISOLATION_IMAGE`,
  `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG`, and `HIVE_MIND_DOCKER_ISOLATION_PULL`.

### 6. Regression tests — `tests/test-issue-1879-docker-image-reuse.mjs`

- Cover tag resolution, image composition, pull-policy parsing, and `docker run` construction
  (flag presence/ordering, pinned-tag + `never` combination). The issue #1860 suite still
  passes unchanged.

## Recommended Operator Runbook (full reuse, no re-download)

1. Pin the tag to the deployed version:
   `export HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG=<version>` (or rely on `latest`).
2. After the `hive-mind` container starts, seed the nested daemon:
   `node scripts/preload-dind-isolation-image.mjs --container hive-mind --image konard/hive-mind-dind:<tag>`.
3. Force reuse so tasks never re-download:
   `export HIVE_MIND_DOCKER_ISOLATION_PULL=never`.

The durable fix — baking the seeding into the DinD image/entrypoint so step 2 is automatic —
is requested upstream (see below).

## Upstream Report

The nested-daemon-starts-empty behavior originates in the DinD base image
(`konard/box-dind`, from `link-foundation/box`). An issue is filed there requesting that the
nested daemon be pre-seeded (or a documented startup hook be provided) so the inner daemon
reuses host images instead of re-downloading them. It includes a reproducible example, the
`docker save | docker load` workaround, and the suggested fix. Link added to this case study
and the PR once filed.
