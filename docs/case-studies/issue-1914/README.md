# Issue 1914 Case Study: `--isolation docker` is not working as expected

> Status: **REOPENED 2026-06-14** after PR #1915. The screen→docker fix landed,
> but isolated tasks still fail — now with `failed to register layer: no space
left on device`. **Root Cause A (the reopen): the nested Docker daemon runs on
> the `vfs` storage driver, which has no copy-on-write, so the multi-GB image
> consumes many times its size and overflows the disk.** Fixed in **PR #1926** by
> defaulting the DinD image to `fuse-overlayfs` and adding self-diagnosing
> startup preflight checks. See [**2026-06-14 Reopen**](#2026-06-14-reopen--root-cause-a-vfs-disk-amplification-pr-1926)
> first; the original PR #1915 analysis (Complaints 1 & 2) follows below.
>
> Data captured under [`./data`](./data): the issue body & comments
> (`issue-1914.json`, `issue-1914-comments.json`, `issue-1914-current.json`), the
> PR snapshot (`pr-1915.json`), the production deploy script (`deploy-docker.mjs`,
> mirrored from [gist 67532e7a](https://gist.github.com/konard/67532e7a7090462a618ca86fc00d06a6)),
> the reopen evidence (`issue-1914-comment-20260614-session.log`,
> the operator's full `$` start-command log
> [`start-command-full-log-e6599cf2.log`](./data/start-command-full-log-e6599cf2.log)
> mirrored from [gist c2457b74](https://gist.github.com/konard/c2457b741b80f917bc9b1d778f1cf759),
> `comment-screenshot-1-stuck.png`, `comment-screenshot-2-failed.png`), the live
> `vfs` reproduction (`preflight-live-vfs-reproduction.log`), the empirical
> `fuse-overlayfs` capability proof (`fuse-overlayfs-capability-proof.log`), and
> the session logs for the related issues (`issue-1860-session.log`,
> `issue-1879-session.log`, `issue-1914-session.log`).

## 2026-06-14 Reopen — Root Cause A: `vfs` disk amplification (PR #1926)

**Issue #1914 was reopened on 2026-06-14.** PR #1915 fixed Complaints 1 and 2
(the screen wrapper and the empty nested daemon), but a real isolated task still
failed. The reopen is a **third, independent root cause** that PR #1915 did not
cover.

### What the reopen evidence proves

The operator ran a real task through native docker isolation
(`data/issue-1914-comment-20260614-session.log`, `comment-screenshot-2-failed.png`):

```
Command: 'solve' '…/formal-ai/issues/461' '--model' 'opus' '--tool' 'claude' … --isolation docker
Environment: docker          ←  Complaint 1 is FIXED: native docker, not screen
…
Failed to pull Docker image: konard/hive-mind-dind:latest
Exit Code: 1
```

A manual `$ --isolated docker --image konard/hive-mind-dind:latest -- echo hi`
captured the actual daemon error (issue comment, 2026-06-14):

```
latest: Pulling from konard/hive-mind-dind
cb259a83ac3d: Already exists          ←  most layers ALREADY present (daemon is seeded)
340569b17e0a: Already exists
… (14 "Already exists") …
342bf6b888dc: Pull complete
a80e20373f2e: Extracting [===>] 498.4MB/498.4MB
… (many "Download complete") …
afd9cc6fa527: Download complete
failed to register layer: no space left on device     ←  THE REOPEN FAILURE
Error: Failed to pull Docker image: konard/hive-mind-dind:latest
```

Two facts are decisive:

1. **The screen→docker fix works.** `$ --status`/`$ --list` now report
   `isolated docker` (not `isolated screen`), and the bot built the native
   `$ --isolated docker --image … --privileged …` command. **Complaint 1 is
   closed.**
2. **The daemon is no longer empty.** Most layers report `Already exists` — the
   nested daemon was seeded (passthrough/preload now partly working), so
   **Complaint 2 improved too**. The failure is **not** "re-download the whole
   image from scratch."

The remaining failure is `failed to register layer: no space left on device`
while _registering_ (extracting) a layer — a **disk** problem, not a download
problem.

### Root Cause A — `vfs` has no copy-on-write, so layers amplify

The nested daemon (inside `konard/hive-mind-dind`) was running on the **`vfs`**
storage driver. `vfs` performs **no copy-on-write**: registering layer _N_ copies
the **entire cumulative filesystem** of layers `1..N` into a fresh directory,
rather than storing only layer _N_'s diff. For a ~30 GB image with dozens of
layers, the on-disk footprint becomes the **sum of every cumulative layer size**
— many multiples of 30 GB — so extracting even a single ~498 MB layer on top of
the ~30 GB base needs ~30 GB _more_ free space, and the daemon hits
`no space left on device`. This is exactly the observed failure: most layers
already exist, yet registering the last few overflows the disk.

This is why the earlier fixes "didn't fully work": seeding the daemon (Complaint 2) put the layers there, but `vfs` then re-expanded them on every
`docker run`/pull-completion, and a multi-GB image simply cannot fit when each
layer is stored at full cumulative size.

**Why was it `vfs`? — the precise, in-repo cause.** It was **not** a box default.
`konard/box-dind`'s entrypoint _auto-detects_ the storage driver in the order
`overlay2 → fuse-overlayfs → vfs`, with graceful fallback (it retries the next
driver when dockerd exits early), and only lands on `vfs` as a last resort. Given
this environment (`/dev/fuse` present, `fuse-overlayfs` binary shipped, `overlay`
in `/proc/filesystems`) it would have picked a **copy-on-write** driver. It did
not, because **Hive Mind's own `Dockerfile.dind` baked
`ENV DIND_STORAGE_DRIVER="vfs"`** (commit `44d2c29e`, 2026-05-01, _"Default DinD
storage driver to vfs"_). An explicit `DIND_STORAGE_DRIVER` makes box's candidate
list return _only_ that driver, so box never tried a CoW driver. The dockerd log
confirms it: `Docker daemon … storage-driver=vfs version=29.5.3` with **no**
overlay2/fuse-overlayfs attempts.

That commit chose `vfs` deliberately — its comment reads _"Prefer compatibility
for nested Docker. overlay2 can fail on common overlay-backed hosts."_ The intent
(avoid overlay2-on-overlay failures) was sound; the cost (no copy-on-write → disk
amplification on multi-GB images) was not anticipated. **`fuse-overlayfs` satisfies
both:** copy-on-write _and_ overlay-on-overlay. So the reopen is fixed by pinning
`fuse-overlayfs` instead of `vfs` — keeping box's compatibility intent while
restoring CoW.

**Empirically verified (`data/fuse-overlayfs-capability-proof.log`).** A direct
`fuse-overlayfs` mount in this very `box-dind` container reads through to the
lower layer and copies writes into the upper dir (true CoW), then unmounts
cleanly. Docker's `fuse-overlayfs` graphdriver uses exactly this mechanism, so
pinning the driver yields a working CoW daemon here. `/dev/fuse` is present
(provided by the `--privileged` flag the isolation backend already uses), which
removes the only risk of pinning an explicit driver (box does **not** fall back
when an explicit driver fails to start).

**The pinned base honors the explicit pin.** box's dind entrypoint
(`ubuntu/24.04/dind/dind-entrypoint.sh`, verified against `main`) sets
`storage_driver_candidates()` to return _only_ `$DIND_STORAGE_DRIVER` when it is
non-empty, then launches `dockerd --storage-driver="$storage_driver"` — so the
pin is passed straight to a native Docker graphdriver. That `storage_driver_candidates`/retry logic landed in box `55a9a90b` ("fix(dind):
retry storage drivers during daemon startup", 2026-06-04), well before
**box v2.3.2** (2026-06-13) — the exact base `Dockerfile.dind` pins
(`FROM konard/box-dind:2.3.2`). The capability proof was captured _inside an
actual `konard/hive-mind-dind` container_ (the production base), so the proof and
the deployed image are the same environment. If `fuse-overlayfs` somehow failed
to start, the entrypoint still brings up the user shell (returns 0) — no worse
than today — but the proof shows it starts.

### The fix (PR #1926): default to `fuse-overlayfs` (copy-on-write)

`Dockerfile.dind` now sets `ENV DIND_STORAGE_DRIVER="fuse-overlayfs"`.
`fuse-overlayfs` is **copy-on-write** (a layer costs only its own diff, like
`overlay2`) **and** works overlay-on-overlay (the compatibility property `vfs`
was chosen for). The `--privileged` flag the isolation backend already uses
provides `/dev/fuse`, and `konard/box-dind` already ships the `fuse-overlayfs`
binary. Under CoW, registering the 498 MB layer costs ~498 MB, not ~30 GB — the
pull completes and the image fits.

This is the **highest-leverage** fix: even if passthrough/seeding (Complaint 2)
is imperfect, under CoW a ~30 GB pull occupies ~30 GB instead of exploding.

### Storage drivers considered

| Driver               | Copy-on-write?               | Overlay-on-overlay (DinD)?                                                     | Verdict for the nested daemon                                                                                                                   |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **`vfs`**            | **No** — full copy per layer | Yes (works anywhere)                                                           | **Rejected.** The reopen root cause: a ~30 GB image amplifies to many×30 GB → `no space left on device`.                                        |
| **`overlay2`**       | Yes (efficient)              | **Often fails** when the parent FS is itself an overlay (common in containers) | Rejected as the default: can fail to start the nested daemon overlay-on-overlay; great on a real disk, not DinD.                                |
| **`fuse-overlayfs`** | **Yes** (like `overlay2`)    | **Yes** — designed for it (rootless/nested)                                    | **Chosen default.** CoW efficiency _and_ DinD compatibility; needs `/dev/fuse` (provided by `--privileged`); binary ships in `konard/box-dind`. |

`fuse-overlayfs` is the only option that gives both copy-on-write (fixes the disk
amplification) and overlay-on-overlay support (the reason `box-dind` defaulted to
`vfs` in the first place).

### Self-diagnosing startup preflight (debug output, per the issue's request)

The issue explicitly asked: _"If there is not enough data to find actual root
cause, add debug output and verbose mode."_ `preflightDockerIsolation()` (run at
bot startup from `src/telegram-bot.mjs`) now also probes:

- **`checkDockerStorageDriver()`** → `docker info --format '{{.Driver}}'`. When the
  driver is `vfs`, it emits a loud warning _even when the image is present_ (the
  failure mode is disk, not absence), naming the `no space left on device`
  symptom, issue #1914, and the exact remediation.
- **`checkDockerDiskSpace()`** → `df` on `docker info`'s `DockerRootDir`. When the
  image is absent **and** free space on the data root is below ~40 GiB, it warns
  that the first pull may fail with `no space left on device`.

The result object gained `storageDriver`, `storageDriverOk`, and
`diskAvailableGiB`. The probes never throw and never block startup.

**Live reproduction (`data/preflight-live-vfs-reproduction.log`).** The very
container this work was performed in is a `hive-mind-dind` on `vfs` with 58.5 GiB
free — the same configuration as the failing production deploy. Running the new
preflight against its real daemon reproduces the warning:

```
[VERBOSE] isolation-runner: docker storage driver: vfs
[VERBOSE] isolation-runner: Docker data root '/var/lib/docker' has 58.5 GiB free
⚠️ The Docker daemon backing '--isolation docker' is using the 'vfs' storage
   driver, which performs NO copy-on-write … 'failed to register layer: no space
   left on device' (issue #1914). Switch to a copy-on-write driver: rebuild/
   redeploy with the current Dockerfile.dind (it defaults to 'fuse-overlayfs'),
   or for an already-running container add '-e DIND_STORAGE_DRIVER=fuse-overlayfs'
   … and recreate it.
```

So the `no space left` failure is now **self-diagnosing at boot**, before any
task runs.

### Immediate operator workaround (no rebuild needed)

For an already-running bot container, recreate it with the CoW driver — no image
rebuild required (`konard/box-dind` reads `DIND_STORAGE_DRIVER` at entrypoint):

```bash
docker run -dit --privileged … \
  -e DIND_STORAGE_DRIVER=fuse-overlayfs \
  konard/hive-mind-dind:latest
```

The nested daemon's image store is reset by the driver switch, so re-seed it
(host passthrough or `scripts/preload-dind-isolation-image.mjs`) after recreating.

### Reopen timeline

| When             | Event                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-06-13       | Issue #1914 filed (Complaints 1 & 2). Fixed in PR #1915 (native docker backend + deploy/passthrough fix + preflight + docs).                                                                                             |
| 2026-06-14 16:43 | Real task via native docker isolation (`data/start-command-full-log-e6599cf2.log`). `Environment: docker`, `Mode: detached` confirm Complaint 1 fixed; daemon shows most layers `Already exists` (Complaint 2 improved). |
| 2026-06-14 16:47 | Issue **reopened** after repeated failed attempts: "still does not pass even a basic check… find root cause of all issues and fix them."                                                                                 |
| 2026-06-14 16:49 | The detached pull (started 16:43:55) ends at 16:49:05 in `failed to register layer: no space left on device`; task exits 1. Telegram bot blocks for ~7 min across attempts, then surfaces the error (screenshots).       |
| 2026-06-14 17:28 | Live preflight reproduction on this `vfs` daemon confirms Root Cause A (`data/preflight-live-vfs-reproduction.log`).                                                                                                     |
| PR #1926         | Default `DIND_STORAGE_DRIVER=fuse-overlayfs`; storage-driver + disk-space preflight diagnostics; docs (4 languages); tests; this case-study update; upstream report.                                                     |

### Secondary observations (noted, not the root cause)

- _"In telegram it stuck for minutes (in a blocking way, nothing else can be
  executed)."_ The ~7-minute block is the synchronous pull/extract under `vfs`
  thrashing the disk before failing. With `fuse-overlayfs` the pull completes
  quickly and the block disappears; making the pull itself asynchronous in the
  bot is a possible follow-up but is out of scope for the disk root cause.
- _"$ does not provide the full log."_ The `$`-captured isolation log truncates
  the daemon's pull progress; the full error is only visible interactively. A DX
  suggestion for `start-command`, not a Hive Mind bug — noted in
  [Upstream Report](#upstream-report).

---

## Original Analysis (PR #1915 — Complaints 1 & 2)

## Summary

Issue #1914 raises **two independent complaints** about `--isolation docker`:

1. **Complaint 1 — wrong isolation mechanism.** `--isolation docker` was running
   inside a **screen** session that merely shelled out to a hand-rolled
   `docker run`, instead of using `$`'s (start-command's) **native Docker
   isolation backend**. The issue's `$ --status` output proves it: the recorded
   session lists `isolated screen` with a `command "'docker' 'run' …"`.

2. **Complaint 2 — image re-download (the 30 GB problem).** Each isolated task
   re-pulled the multi-gigabyte Hive Mind image **inside the container**, even
   though the host already had it. The issue's manual test proves it: a bare
   `$ --isolation docker --image konard/hive-mind-dind:latest -- echo hi`
   immediately ran `docker pull konard/hive-mind-dind:latest` and started
   downloading hundreds of MB before the operator hit Ctrl+C.

The two complaints have **different root causes** and are fixed independently:

- Complaint 1 was a **Hive Mind** bug in `src/isolation-runner.lib.mjs` — it
  built `$ --isolated screen -- docker run …` instead of
  `$ --isolated docker --image … --privileged …`. Fixed: Hive Mind now hands the
  container lifecycle to start-command's native Docker backend.
- Complaint 2 is a **deployment** bug in the production deploy script
  ([gist 67532e7a](https://gist.github.com/konard/67532e7a7090462a618ca86fc00d06a6)):
  the bot container's final `docker run` never bind-mounts the host Docker
  socket, so `box`'s host-image passthrough is a **silent no-op** and the nested
  Docker daemon starts (and stays) empty. The first isolated task therefore has
  nothing to reuse and pulls the full image.

A crucial fact establishes that the two fixes compose correctly: **start-command
reuses a locally present image and only pulls when it is absent** (verified in
source — see [Online / Source Facts](#online--source-facts)). So once the nested
daemon is seeded (by passthrough or the preload script), the native backend will
**not** re-download.

## Evidence Collected

All quotes below are from the issue body (`data/issue-1914.json`).

### Complaint 1 — `isolated screen`, not docker (the `$ --status` dump)

```
  command "'docker' 'run' '--rm' '--name' 'hive-mind-isolation-…' '--workdir' '/home/box'
           '-e' 'HOME=/home/box' … '--privileged' '-e' 'HIVE_MIND_IMAGE_VARIANT=dind'
           '--volume' '/home/box/.config/gh:/home/box/.config/gh' … 'konard/hive-mind-dind:latest'
           'bash' '-lc' "…'solve' 'https://…/issues/77' '--model' 'opus' '--tool' 'claude' …""
  …
  options
    isolated screen          ←  screen isolation wrapping a docker run
    isolationMode detached
```

The container lifecycle was a `docker run` string handed to a **screen** session.
`$ --status` reports `isolated screen`, and `screen -r <uuid>` even failed
("There is no screen to be resumed") because the wrapper had already exited.

### Complaint 2 — the image re-download (manual native test)

```
box@…:~$ $ --isolation docker --image konard/hive-mind-dind:latest -- echo hi
│ isolation docker
│ image     konard/hive-mind-dind:latest
│ container docker-1781346204887-xbgtu5
│
$ docker pull konard/hive-mind-dind:latest        ←  pulls despite host having it

latest: Pulling from konard/hive-mind-dind
…
c5f3d5112c66: Downloading [==>                ]  63.66MB/1.226GB
…
^C
Error: Failed to pull Docker image: konard/hive-mind-dind:latest
```

This was run with the **native** backend directly (not through Hive Mind), which
proves Complaint 2 is independent of Complaint 1: even a correct native
invocation pulls, because the nested daemon's image store is empty.

> "It is more than 30 GB, our server cannot possible download 30 per task (not by
> space, not by time)."

## Timeline / Sequence of Events

| When             | Event                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1545            | Isolation backends (`screen`/`tmux`/`docker`) introduced; docker isolation implemented as a `docker run` wrapped in a screen session.                                                                                                                   |
| #1860            | Docker isolation must launch the **Hive Mind** image (not `ubuntu:latest`) and remount the right per-tool credentials. Fixed by building the image/volume flags — but still inside the screen wrapper.                                                  |
| #1879            | "Re-downloading the Hive Mind image inside the container." Root-caused to the empty nested daemon; shipped tag-pinning, a pull-policy knob, the preload helper, and a box base-image bump. Documented the host-socket mount only as a _recommendation_. |
| 2026-06-13 10:21 | Issue #1914 reproduction: `/claude … —isolation docker`. `$ --status` shows `isolated screen` + a `docker run` string → **Complaint 1**.                                                                                                                |
| 2026-06-13 10:23 | Manual `$ --isolation docker --image … -- echo hi` → immediate `docker pull` of the full image → **Complaint 2**.                                                                                                                                       |
| 2026-06-13 10:29 | Issue #1914 filed.                                                                                                                                                                                                                                      |
| PR #1915         | Complaint 1: switch to the native docker backend. Complaint 2: startup preflight + docs + preload-tip fix + deploy-script fix + this case study.                                                                                                        |

## Requirements From The Issue

Every distinct requirement in the issue body, with where it is addressed:

1. **`--isolation docker` must use actual Docker isolation, not screen isolation.**
   → `src/isolation-runner.lib.mjs` now emits `$ --isolated docker --image … --privileged --shell sh … --detached --session <uuid> -- '<cmd>'`. Tests: `tests/test-issue-1914-native-docker-isolation.mjs`, updated `tests/test-issue-1860-docker-isolation.mjs`.
2. **Image passthrough must work so we don't re-download the multi-GB image per task.**
   → Root-caused to the missing host-socket mount in the deploy. Fixed in the deploy script; documented in `docs/DOCKER.md`; a startup preflight now makes the misconfiguration loud.
3. **Re-check the #1860 and #1879 fixes (they "didn't work").**
   → #1860's image/credential fix was correct but lived inside the screen wrapper (now native). #1879 pinned the tag and _recommended_ the socket mount but the deploy never adopted it, so the nested daemon stayed empty. See [Root Causes](#root-causes).
4. **Check how the image is constructed at link-foundation/box and here; ensure passthrough is actually possible.**
   → `Dockerfile.dind` is `FROM konard/box-dind:2.3.2` (passthrough-capable). box's passthrough needs the host socket mounted; confirmed it is the missing piece. The remaining silent-failure gap was filed as box#102 and fixed in box v2.3.2 (now pinned here). See [Online / Source Facts](#online--source-facts).
5. **Fix it once and for all, at all levels (box and here); find the responsible.**
   → Responsible parties identified: Complaint 1 = Hive Mind's screen wrapper (fixed); Complaint 2 = the deploy script's `docker run` (fixed) plus box's _silent_ passthrough no-op (upstream report).
6. **Maybe the deploy script is the problem (gist 67532e7a).**
   → **Yes — this is the production root cause of Complaint 2.** The final `docker run` mounts only credentials, never the host Docker socket. See [Root Causes](#root-causes) and [Deploy Script Fix](#deploy-script-fix).
7. **Download all logs/data to `docs/case-studies/issue-1914`; do a deep case study (timeline, requirements, root causes, solutions, existing components, online facts).**
   → This document + [`./data`](./data).
8. **If data is insufficient for the root cause, add debug output / verbose mode for the next iteration.**
   → `preflightDockerIsolation()` + verbose tracing in `executeWithIsolation` and `checkDockerImagePresent` turn the silent no-op into an explicit, actionable startup signal.
9. **If other repos are involved, file issues there with reproducible examples, workarounds, and code suggestions.**
   → [Upstream Report](#upstream-report) (box: silent passthrough no-op; start-command: optional preflight/UX).
10. **Apply the fix across the entire codebase (all places).**
    → All `--isolation docker` paths route through `buildStartCommandArgs`/`buildDockerIsolationStartArgs`; the obsolete `HIVE_MIND_DOCKER_ISOLATION_PULL` tip in the preload script was removed; docs updated in all four languages.
11. **Do everything in this single PR (#1915).**
    → All commits land on `issue-1914-8a8c25b9f161`.

## Root Causes

### Complaint 1 (Hive Mind): docker isolation was a screen wrapper

`src/isolation-runner.lib.mjs` historically built the docker command as a string
and handed it to start-command's **screen** backend
(`$ --isolated screen -- docker run …`). That is screen isolation that _contains_
a docker invocation — not Docker isolation. Consequences visible in the issue:
`$ --status` reports `isolated screen`; `screen -r` is the only attach path; and
the lifecycle/health is tracked as a screen session, not a container.

**Fix:** delegate the container lifecycle to start-command's native Docker
backend. Hive Mind now builds:

```
$ --isolated docker --image <hive-mind image> [--privileged] --shell sh \
    -e HOME=/home/box -e HIVE_MIND_IMAGE_VARIANT=… --volume <creds> … \
    --detached --session <uuid> -- '<solve/hive/task command>'
```

`--status` now reports `isolated docker`, completion is detected with
`docker inspect` (`checkDockerContainerRunning`), and the container name is the
session UUID.

### Complaint 2 (deployment): the host Docker socket is never mounted

In the DinD deployment the bot runs inside `konard/hive-mind-dind` with its own
**nested** dockerd. The deploy wipes `/var/lib/docker` before `docker commit`, so
the nested image store is **empty on first boot**. When an isolated task runs
`docker run konard/hive-mind-dind:latest`, that talks to the nested daemon, finds
nothing, and pulls the full image.

`konard/box-dind` can seed the nested daemon automatically — **host-image
passthrough** — by reading the host's Docker socket. But passthrough only runs
when that socket is bind-mounted into the container. **It is not.** The deploy
script's final `docker run` (`data/deploy-docker.mjs:342`) mounts only:

```js
const MOUNTS = ['-v /root/.hive-mind/claude:/home/box/.claude', '-v /root/.hive-mind/codex:/home/box/.codex', '-v /root/.hive-mind/claude.json:/home/box/.claude.json', '-v /root/.hive-mind/gh:/home/box/.config/gh'].join(' ');
await run(`docker run -dit ${VARIANT.runFlags} … ${MOUNTS} ${CONTAINER}-configured …`);
```

There is **no** `-v /var/run/docker.sock:/var/run/host-docker.sock:ro` and **no**
`-e DIND_HOST_PASSTHROUGH_IMAGES`. (The `/var/run/docker.sock` references
elsewhere in the script — lines 363/395 — are probes of the _nested_ socket
inside the container, not a host passthrough mount.) With no source socket,
box's passthrough silently does nothing → nested daemon stays empty → first task
pulls 30 GB.

**Why #1879 "didn't work":** #1879 correctly identified the empty nested daemon
and shipped tag-pinning + a preload helper + a box bump, and it _recommended_ the
socket mount. But the recommendation was never applied to the production deploy,
so in practice the nested daemon was still empty. #1860's image/credential fix
was also correct — it just lived inside the screen wrapper that Complaint 1 is
about.

## Online / Source Facts

### start-command reuses a locally present image (only pulls when absent)

The installed `$` is `start-command` (verified `v0.29.0`). Its Docker backend
checks existence **before** pulling — `runInDocker` in
`src/lib/isolation.js`:

```js
const containerName = options.session || generateSessionName('docker');
if (!dockerImageExists(options.image)) {        // `docker image inspect <image>`
  const pullResult = dockerPullImage(options.image);
  if (!pullResult.success) {
    return { success: false, …, message: `Failed to pull Docker image: ${options.image}` };
  }
}
```

`dockerImageExists` (`src/lib/docker-utils.js`) runs `docker image inspect`; it
returns true for _any_ locally present image, **including one loaded via
`docker load`** (it does not require a RepoDigest). So:

- The `docker pull` in the issue's manual test fired **only because the nested
  daemon was empty** — not because start-command always pulls.
- Once the image is in the nested daemon (passthrough **or** the preload script's
  `docker save | docker load`), `dockerImageExists` returns true and **no pull
  happens**. The two fixes compose. There is no `--pull always` to remove.

### box host-image passthrough (base image `konard/box-dind:2.3.2`)

`Dockerfile.dind` is `FROM konard/box-dind:2.3.2`; `Dockerfile` is
`FROM konard/box:2.3.2`. box's passthrough is controlled by env vars its
entrypoint reads:

| Variable                           | Default                     | Meaning                                                               |
| ---------------------------------- | --------------------------- | --------------------------------------------------------------------- |
| `DIND_HOST_PASSTHROUGH`            | `public`                    | `off` / `public` (copy images with a public-registry digest) / `all`. |
| `DIND_HOST_DOCKER_SOCK`            | `/var/run/host-docker.sock` | Where the **host** socket must be mounted.                            |
| `DIND_HOST_PASSTHROUGH_IMAGES`     | _(empty = any)_             | Space-separated image-name allowlist.                                 |
| `DIND_HOST_PASSTHROUGH_REGISTRIES` | _(empty)_                   | Optional registry allowlist for `public` mode.                        |

Critically, passthrough is **enabled by default (`public`) but is a silent no-op
when the host socket is absent** — exactly the production state. In `public`
mode the host image must carry a RepoDigest (be pulled/pushed), or it is skipped.
Prior box work for #1879 (box#94 pre-seed, box#96 public-mode false positive,
box#97 per-repo allowlist) shipped in box v2.2.0 / v2.3.1; the remaining gap —
the **silent** failure mode — was filed as box#102 and **fixed in box v2.3.2**
(the entrypoint now warns when the allowlist is set but no socket is mounted).
This repo is now pinned to `2.3.2`, so the warning ships at the source.

## Existing Components / Libraries Considered

| Option                                                                        | Verdict                                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **box host-image passthrough** (mount host socket)                            | **Primary fix.** Zero per-task cost, automatic, already in the base image. Needs the socket mount + allowlist in the deploy.                                                                         |
| **`scripts/preload-dind-isolation-image.mjs`** (`docker save \| docker load`) | **Kept as the manual fallback.** Works without the host socket; seeds an already-running container. Loaded image has no RepoDigest but start-command's `docker image inspect` check still reuses it. |
| **`HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG`** tag pinning (#1879)                | **Strengthened.** Release Dockerfiles now bake it from `HIVE_MIND_VERSION`, so a parent launched as `:latest` still starts child containers from the same immutable release tag.                     |
| **`docker save`/`load` over a bind-mounted host socket directly**             | Equivalent to passthrough but manual; passthrough automates it.                                                                                                                                      |
| **`skopeo copy` / registry mirror / pull-through cache**                      | Heavier infra; unnecessary when the host already has the image and box can pass it through. Noted for completeness.                                                                                  |
| **Baking the image into the DinD image at build time**                        | Rejected: the deploy intentionally wipes `/var/lib/docker` before commit, and a 30 GB self-referential layer is impractical.                                                                         |

## Solution Applied (PR #1915)

1. **Native docker backend — `src/isolation-runner.lib.mjs`.** `buildStartCommandArgs`/
   `buildDockerIsolationStartArgs` emit `$ --isolated docker --image … --privileged
--shell sh … --detached --session <uuid> -- '<cmd>'`; completion via
   `checkDockerContainerRunning` (`docker inspect`). (Complaint 1.)
2. **Startup preflight — `src/isolation-runner.lib.mjs` + `src/telegram-bot.mjs`.**
   `preflightDockerIsolation()` probes the nested daemon at startup
   (`checkDockerImagePresent` → `docker image inspect`) and, when the image is
   absent, warns loudly with the exact remediation for each state:
   - dind + socket **not** mounted → "mount `-v /var/run/docker.sock:<sock>:ro` and set `DIND_HOST_PASSTHROUGH_IMAGES`, or run the preload script";
   - dind + socket mounted but image absent → "passthrough may have skipped it — check mode/allowlist/digest";
   - non-dind + absent → "first task will pull; pin the tag or preload".
     `resolveHostDockerSock()` honors box's own `DIND_HOST_DOCKER_SOCK`. The
     preflight never throws and never blocks startup. (Complaint 2 observability —
     directly satisfies requirement #8.)
3. **Preload-tip fix — `scripts/preload-dind-isolation-image.mjs`.** Removed the
   obsolete `HIVE_MIND_DOCKER_ISOLATION_PULL=never` tip (that env var no longer
   exists; the native backend reuses-if-present inherently) and point operators
   at automatic passthrough.
4. **Docs — `docs/DOCKER.md` (+ `.zh`/`.hi`/`.ru`).** New "Host-image passthrough"
   section: the socket mount, the passthrough env-var table, the startup
   preflight states, and the manual preload fallback.
5. **Deploy script — [gist 67532e7a](https://gist.github.com/konard/67532e7a7090462a618ca86fc00d06a6).**
   Add the host-socket mount + allowlist to the final `docker run`, and pull the
   exact release child tag before passthrough seeds the nested daemon. See
   [Deploy Script Fix](#deploy-script-fix).
6. **Release child-image pin — `Dockerfile`, `Dockerfile.dind`,
   `coolify/Dockerfile`.** Release builds pass the published npm version as
   `HIVE_MIND_VERSION`; the images now bake the same value into
   `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG`, so nested `$ --isolated docker`
   commands use `konard/hive-mind(-dind):<same release>` instead of a drifting
   `:latest`.
7. **Tests.** `tests/test-issue-1914-native-docker-isolation.mjs` (native shape),
   `tests/test-issue-1914-preflight-passthrough.mjs` (the four preflight states +
   `resolveHostDockerSock`), Docker release-order checks, and refreshed
   `#1860`/`#1879` tests.

## Recommended Operator Runbook (no re-download)

**Primary — automatic passthrough.** Add to the bot container's `docker run`:

```bash
-v /var/run/docker.sock:/var/run/host-docker.sock:ro \
-e DIND_HOST_PASSTHROUGH_IMAGES="konard/hive-mind konard/hive-mind-dind"
```

Ensure the host actually has the exact release-tagged image with a registry
digest. If the host was updated through `:latest`, extract the baked child tag
and pull that tag before starting the final container:

```bash
TAG="$(docker image inspect konard/hive-mind-dind:latest \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sed -n 's/^HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG=//p' \
  | tail -1)"
docker pull "konard/hive-mind-dind:${TAG:-latest}"
```

On the next bot start, the preflight logs `✅ … already present` and isolated
tasks reuse it.

**Fallback — explicit preload (no host socket needed):**

```bash
TAG="$(docker exec hive-mind printenv HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG || true)"
node scripts/preload-dind-isolation-image.mjs \
  --container hive-mind --image "konard/hive-mind-dind:${TAG:-latest}"
```

## Deploy Script Fix (applied)

**Applied to [gist 67532e7a](https://gist.github.com/konard/67532e7a7090462a618ca86fc00d06a6).**
The dind `VARIANT` now contributes a `passthroughFlags` field for the
host-socket mount and image allowlist, and the final `docker run` includes it.
The plain variant contributes an empty `passthroughFlags` (it runs no nested
dockerd, so there is nothing to seed). The exact passthrough change is captured
token-free in
[`data/deploy-docker.passthrough-fix.patch`](./data/deploy-docker.passthrough-fix.patch):

```diff
     entrypointFlag: '--entrypoint /usr/local/bin/dind-entrypoint.sh',
+    passthroughFlags:
+      '-v /var/run/docker.sock:/var/run/host-docker.sock:ro ' +
+      '-e DIND_HOST_PASSTHROUGH_IMAGES="konard/hive-mind konard/hive-mind-dind"',
     needsDockerd: true,
   },
   plain: {
     ...
+    passthroughFlags: '',
     needsDockerd: false,
   },
 };
-await run(`docker run -dit ${VARIANT.runFlags} ${VARIANT.finalEnvFlags} ${VARIANT.finalUserFlag} ...`);
+await run(`docker run -dit ${VARIANT.runFlags} ${VARIANT.finalEnvFlags} ${VARIANT.passthroughFlags} ${VARIANT.finalUserFlag} ...`);
```

The follow-up release-tag pin is captured in
[`data/deploy-docker.release-tag-pin.patch`](./data/deploy-docker.release-tag-pin.patch):

```diff
@@ -250,6 +256,23 @@ if (imageUpToDate) {
 // Show local image details for confirmation
 await run(`docker images --digests ${IMAGE}`);

+if (VARIANT.needsDockerd) {
+  nextStep('Ensuring exact child isolation image tag is present on host');
+  const childTagResult = await run(
+    `docker image inspect ${IMAGE} --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG=//p' | tail -1`,
+    { silent: true }
+  );
+  const childTag = childTagResult.stdout.trim() || ACTIVE_TAG;
+  const childImage = `${ACTIVE_REPO}:${childTag}`;
+  console.log(`>>> Docker isolation child image: ${childImage}`);
+  if (childImage !== IMAGE) {
+    await run(`docker pull ${childImage}`);
+  } else {
+    console.log('>>> Child image tag matches deployment image');
+  }
+  await run(`docker images --digests ${childImage}`);
+}
```

Together these are the production changes that end the re-download: on the next
bot deploy/start, box seeds the nested daemon from the host, and the host has the
exact `konard/hive-mind-dind:<release-tag>` image that the child task will ask
for. The startup preflight then logs `✅ … already present`.

> **Security note (pre-existing, unrelated to this fix):** the gist's _other_
> file, `deploy-remote-docker.mjs`, embeds a live-looking `TELEGRAM_BOT_TOKEN` in
> clear text inside its `.lenv.example` template. This fix did **not** touch that
> file, and the token is **not** reproduced anywhere in this repository. It should
> be rotated and removed from the template (and `.lenv.example` should ship only a
> placeholder). The same token already appears in several older case-study logs in
> this repo — see the issue #1745 sanitization work — so this is a known,
> pre-existing exposure rather than something introduced here.

## Upstream Report

### link-foundation/box — warn when the nested daemon runs on `vfs` (Root Cause A)

Filed as **[link-foundation/box#104](https://github.com/link-foundation/box/issues/104)**.
This is the upstream half of the reopen. box's storage-driver **auto-detection is
correct** (`overlay2 → fuse-overlayfs → vfs`, with graceful fallback), so this is
**not** a "wrong default" bug — the in-repo `Dockerfile.dind` pin was the actual
cause and is fixed here. The upstream ask is **observability**: when the daemon
_actually_ runs on `vfs` (whether pinned via `DIND_STORAGE_DRIVER=vfs` or reached
as the last-resort fallback), box emits no warning that the driver has no
copy-on-write and will amplify large images on disk — so an operator hitting
`failed to register layer: no space left on device` has no breadcrumb.

- **Reproducible example:** run `konard/box-dind` with `-e DIND_STORAGE_DRIVER=vfs`,
  then `docker pull` a multi-GB image inside it → it registers each layer as a
  full copy and a >30 GB image eventually fails with `no space left on device`,
  with no warning from box.
- **Workaround:** `-e DIND_STORAGE_DRIVER=fuse-overlayfs` (copy-on-write + works
  overlay-on-overlay; box ships the binary; `/dev/fuse` comes from `--privileged`).
  Verified in `data/fuse-overlayfs-capability-proof.log`.
- **Suggested fix (code):** add a one-line `warn` in `dind-entrypoint.sh`'s
  `start_dockerd()` success branch when the active `DIND_STORAGE_DRIVER` is `vfs`,
  explaining the CoW/disk implication and pointing at `fuse-overlayfs`; optionally
  note in the auto-detect fallback _why_ `vfs` was chosen (e.g. `/dev/fuse`
  missing). Full patch in box#104.

### link-foundation/box — passthrough is silent when an allowlist is set but no socket is mounted

Filed as **[link-foundation/box#102](https://github.com/link-foundation/box/issues/102)** —
**FIXED and shipped in [box v2.3.2](https://github.com/link-foundation/box/releases/tag/v2.3.2)**
(this repo's `Dockerfile`/`Dockerfile.dind` are now pinned to `2.3.2`). The dind
entrypoint now emits the suggested `warn` in the `! host_docker_available`
branch when `DIND_HOST_PASSTHROUGH_IMAGES` is set but no socket is mounted
(`dind-entrypoint.sh` `passthrough_host_images`):

> `host-image passthrough is enabled and DIND_HOST_PASSTHROUGH_IMAGES is set, but no host docker socket is mounted at ${DIND_HOST_DOCKER_SOCK}; the nested daemon will NOT be seeded from the host (first 'docker run' will pull from the registry). Mount it with: -v /var/run/docker.sock:${DIND_HOST_DOCKER_SOCK}:ro`

So the silent no-op is gone at the source. The in-repo `preflightDockerIsolation`
safety net still applies (it runs at bot boot, before any task, and covers the
non-dind and socket-mounted-but-still-missing states too). Original report below.

box's behavior is more nuanced than "always silent", confirmed by reading
`ubuntu/24.04/dind/dind-entrypoint.sh` at main `b81aee7`
([L398-L408](https://github.com/link-foundation/box/blob/b81aee7ab1dc2bda53733e80739e3b2284f38571/ubuntu/24.04/dind/dind-entrypoint.sh#L398-L408)):

- It **does** warn when the socket file is _present but unreachable_
  (`host docker socket … is not accessible; skipping passthrough`).
- It **stays silent by design** when no socket is mounted at all — the inline
  comment is "the common 'no host socket mounted' case stays silent so the
  default mode is free." Reasonable for plain `box-dind` containers that never
  intended passthrough.

- **The gap (filed):** when the operator sets `DIND_HOST_PASSTHROUGH_IMAGES`
  (an explicit "pass these images through" opt-in) but forgets the socket mount,
  box is _still_ silent — exactly the production state in #1914. The nested
  daemon never seeds and the first `docker run` re-pulls the multi-GB image with
  no explanation.
- **Reproducible example:** run `konard/box-dind` with
  `-e DIND_HOST_PASSTHROUGH_IMAGES="hello-world"` but **without**
  `-v /var/run/docker.sock:/var/run/host-docker.sock:ro`, then inside it
  `docker run hello-world` → it pulls from the registry even though the host has
  `hello-world`, and prints no warning.
- **Workaround:** mount the socket (this issue's fix) or `docker load` manually.
- **Suggested fix:** keep the default-mode silence but add one `warn` in the
  `! host_docker_available` branch when `DIND_HOST_PASSTHROUGH_IMAGES` is
  non-empty (clear opt-in) yet no socket exists — telling the operator to add
  `-v /var/run/docker.sock:${DIND_HOST_DOCKER_SOCK}:ro`. Optional: a one-line
  `passthrough: copied N, skipped M` summary after a successful pass. Full patch
  in box#102.

### link-foundation/start-command — optional DX niceties (no functional bug)

- start-command's reuse-if-present behavior is **correct** (`isolation.js:590`).
- Optional suggestion: when a pull is about to start for a large image, print the
  image size / a hint that it is missing locally, so the "why is it pulling?"
  question is answered in the timeline. Not required for this issue's fix.

## Verification

**Reopen / Root Cause A (PR #1926):**

- `tests/test-issue-1914-storage-driver-diagnostics.mjs` — the storage-driver and
  disk-space probes are exported and never throw; `vfs` warns even when the image
  is present (`storageDriverOk=false`); `fuse-overlayfs` is silent; the low-disk
  warning fires below the ~40 GiB threshold only when the image is absent; null
  probes degrade gracefully; all three diagnostics can stack.
- `tests/test-docker-dind-variant.mjs` — asserts `Dockerfile.dind` sets
  `ENV DIND_STORAGE_DRIVER="fuse-overlayfs"` (and never `"vfs"`), and that
  `docs/DOCKER.md` documents `DIND_STORAGE_DRIVER=fuse-overlayfs`.
- `tests/test-issue-1914-preflight-passthrough.mjs` — extended so every preflight
  scenario passes neutral storage/disk probes and asserts `storageDriverOk`/
  `diskAvailableGiB` propagate.
- Live reproduction: `data/preflight-live-vfs-reproduction.log` (real `vfs`
  daemon, preflight emits the Root Cause A warning).

**Original (PR #1915):**

- `tests/test-issue-1914-native-docker-isolation.mjs` — native shape (Complaint 1).
- `tests/test-issue-1914-preflight-passthrough.mjs` — preflight states + socket
  resolution (Complaint 2 observability).
- `tests/test-issue-1860-docker-isolation.mjs`, `tests/test-issue-1879-docker-image-reuse.mjs`
  — refreshed to the native shape and reuse-if-present semantics.
- Source confirmation that seeding prevents the pull: `start-command/src/lib/isolation.js`
  (reuse-if-present) + `docker-utils.js` (`docker image inspect`).
