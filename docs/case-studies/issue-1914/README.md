# Issue 1914 Case Study: `--isolation docker` is not working as expected

> Status: analysis + fixes delivered in PR #1915.
> Data captured under [`./data`](./data): the issue body & comments
> (`issue-1914.json`), the PR snapshot (`pr-1915.json`), the production deploy
> script (`deploy-docker.mjs`, mirrored from
> [gist 67532e7a](https://gist.github.com/konard/67532e7a7090462a618ca86fc00d06a6)),
> and the session logs for the three related issues
> (`issue-1860-session.log`, `issue-1879-session.log`, `issue-1914-session.log`).

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
   → `Dockerfile.dind` is `FROM konard/box-dind:2.3.1` (passthrough-capable). box's passthrough needs the host socket mounted; confirmed it is the missing piece. See [Online / Source Facts](#online--source-facts).
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

### box host-image passthrough (base image `konard/box-dind:2.3.1`)

`Dockerfile.dind` is `FROM konard/box-dind:2.3.1`; `Dockerfile` is
`FROM konard/box:2.3.1`. box's passthrough is controlled by env vars its
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
box#97 per-repo allowlist) shipped in box v2.2.0 / v2.3.1; the remaining gap is
the **silent** failure mode, which the upstream report targets.

## Existing Components / Libraries Considered

| Option                                                                        | Verdict                                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **box host-image passthrough** (mount host socket)                            | **Primary fix.** Zero per-task cost, automatic, already in the base image. Needs the socket mount + allowlist in the deploy.                                                                         |
| **`scripts/preload-dind-isolation-image.mjs`** (`docker save \| docker load`) | **Kept as the manual fallback.** Works without the host socket; seeds an already-running container. Loaded image has no RepoDigest but start-command's `docker image inspect` check still reuses it. |
| **`HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG`** tag pinning (#1879)                | **Retained.** Ensures the seeded tag matches exactly so an unpinned `:latest` drift can't force a re-pull.                                                                                           |
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
   Add the host-socket mount + allowlist to the final `docker run`. See
   [Deploy Script Fix](#deploy-script-fix).
6. **Tests.** `tests/test-issue-1914-native-docker-isolation.mjs` (native shape),
   `tests/test-issue-1914-preflight-passthrough.mjs` (the four preflight states +
   `resolveHostDockerSock`), and refreshed `#1860`/`#1879` tests.

## Recommended Operator Runbook (no re-download)

**Primary — automatic passthrough.** Add to the bot container's `docker run`:

```bash
-v /var/run/docker.sock:/var/run/host-docker.sock:ro \
-e DIND_HOST_PASSTHROUGH_IMAGES="konard/hive-mind konard/hive-mind-dind"
```

Ensure the host actually has the image with a registry digest
(`docker pull konard/hive-mind-dind:latest` on the host). On the next bot start,
the preflight logs `✅ … already present` and isolated tasks reuse it.

**Fallback — explicit preload (no host socket needed):**

```bash
node scripts/preload-dind-isolation-image.mjs \
  --container hive-mind --image konard/hive-mind-dind:latest
```

## Deploy Script Fix

In `deploy-docker.mjs`, the dind `VARIANT` should contribute a passthrough mount

- allowlist, and the final `docker run` should include them. Concretely:

```js
// dind variant only: let box seed the nested daemon from the host so isolated
// tasks reuse the host image instead of re-pulling 30 GB (issue #1914).
passthroughFlags: ('-v /var/run/docker.sock:/var/run/host-docker.sock:ro ' + '-e DIND_HOST_PASSTHROUGH_IMAGES="konard/hive-mind konard/hive-mind-dind"',
  // …
  await run(`docker run -dit ${VARIANT.runFlags} ${VARIANT.finalEnvFlags} ${VARIANT.passthroughFlags} ` + `${VARIANT.finalUserFlag} ${VARIANT.entrypointFlag} --name ${CONTAINER} ` + `--restart unless-stopped ${MOUNTS} ${CONTAINER}-configured bash -l -c 'bash /home/box/start-bot.sh'`));
```

(The plain variant contributes an empty `passthroughFlags`.) This is the single
production change that ends the re-download. No secrets are involved; the bot
token is read from `.lenv` on the server and is unaffected.

## Upstream Report

### link-foundation/box — passthrough is silent when an allowlist is set but no socket is mounted

Filed as **[link-foundation/box#102](https://github.com/link-foundation/box/issues/102)**.

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

- `tests/test-issue-1914-native-docker-isolation.mjs` — native shape (Complaint 1).
- `tests/test-issue-1914-preflight-passthrough.mjs` — preflight states + socket
  resolution (Complaint 2 observability).
- `tests/test-issue-1860-docker-isolation.mjs`, `tests/test-issue-1879-docker-image-reuse.mjs`
  — refreshed to the native shape and reuse-if-present semantics.
- Source confirmation that seeding prevents the pull: `start-command/src/lib/isolation.js`
  (reuse-if-present) + `docker-utils.js` (`docker image inspect`).
