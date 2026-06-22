# Docker isolation: DinD vs DooD (languages: en • [zh](DOCKER-ISOLATION.zh.md) • [hi](DOCKER-ISOLATION.hi.md) • [ru](DOCKER-ISOLATION.ru.md))

Hive Mind can run each task in its own Docker container with `--isolation docker`
(see [DOCKER.md](./DOCKER.md) for the surrounding Docker setup). This page
explains the **two ways** that isolation can talk to a Docker daemon — **DinD**
and **DooD** — the trade‑off between them, and the exact run recipe for each.

> **TL;DR** — On a disk‑constrained host, prefer **DooD**: the bot shares the
> host Docker daemon, so isolated tasks **reuse the host's copy of the image with
> zero copy, zero pull, and zero extra disk**. DinD gives each bot its own nested
> daemon but must hold a **second, full copy** of the multi‑GB image.
> See [issue #1962](https://github.com/link-assistant/hive-mind/issues/1962).

## The runner is the same — only the daemon differs

`--isolation docker` always issues the **same** plain command through
start‑command:

```text
$ --isolated docker --image <ref> [--privileged] --shell sh -e … --volume … \
    --detached --session <uuid> -- '<command>'
```

i.e. a normal `docker run` against **whatever daemon the bot's `docker` talks
to**. The mode is purely about **which daemon that is**:

| Mode                            | Which daemon runs the task                   | Image cost                                                        | Per‑task isolation                           |
| ------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| **DinD** (Docker‑in‑Docker)     | a **nested** daemon inside the bot container | a **full second copy** of the image must live in the nested store | container per task **and** a private daemon  |
| **DooD** (Docker‑out‑of‑Docker) | the **host** daemon (shared via its socket)  | **zero** — the task reuses the host's existing image              | container per task; the **daemon is shared** |

Both modes give each task its own container (process / filesystem / network
isolation). The difference is the daemon: DinD nests one (full image copy, more
isolation); DooD shares the host's (zero copy, the only no‑copy option when free
disk can't hold a second copy of the image).

## How Hive Mind picks the mode

Hive Mind resolves the mode from, in priority order:

1. **`HIVE_MIND_DOCKER_ISOLATION_MODE`** — explicit `dind` or `dood`. Use this to
   be unambiguous.
2. **`DIND_SKIP_DAEMON`** truthy — box's DooD switch. The DinD entrypoint skips
   starting the nested daemon, so the `docker` CLI targets the host daemon →
   **DooD**.
3. **`DOCKER_HOST`** pointing at a non‑nested daemon (`tcp://…`, `ssh://…`, or a
   `unix://` socket that is **not** the in‑container default
   `/var/run/docker.sock`) → **DooD**.
4. Otherwise → **DinD** (the historical default, so existing deployments are
   unchanged).

With `--verbose` (or `TELEGRAM_BOT_VERBOSE=true`) the launch log prints the
resolved mode and which daemon `docker` targets, so a misconfiguration is
visible immediately.

## DinD recipe (nested daemon)

Each task runs on a daemon nested inside the bot container. The nested store
starts **empty**, so the image must be seeded into it (box host‑image
passthrough) or the first task pulls the full multi‑GB image. This is documented
in detail in [DOCKER.md → Host‑image passthrough](./DOCKER.md#host-image-passthrough-avoid-re-downloading-multi-gb-images):

```bash
docker run -dit --privileged --name hive-mind --restart unless-stopped \
  # ... your usual credential mounts ...
  -v /var/run/docker.sock:/var/run/host-docker.sock:ro \
  -e DIND_HOST_PASSTHROUGH_IMAGES="konard/hive-mind konard/hive-mind-dind" \
  konard/hive-mind-dind:latest bash -l -c 'bash /home/box/start-bot.sh'
```

DinD costs the disk for the duplicated image, but each bot gets a fully private
daemon. Prefer it when daemon isolation matters more than disk.

## DooD recipe (shared host daemon) — recommended when disk is tight

The bot shares the **host** daemon by mounting the host Docker socket as
`/var/run/docker.sock` and skipping the nested daemon. Isolated tasks then run on
the host daemon, **reusing the host's image with no pull and no copy**:

```bash
# The host's docker group GID — the container needs it to read the mounted socket.
HOST_DOCKER_GID="$(getent group docker | cut -d: -f3)"

docker run -dit --name hive-mind --restart unless-stopped \
  # ... your usual credential mounts ...
  -v /var/run/docker.sock:/var/run/docker.sock \
  --group-add "${HOST_DOCKER_GID}" \
  -e DIND_SKIP_DAEMON=1 \
  -e HIVE_MIND_DOCKER_ISOLATION_MODE=dood \
  konard/hive-mind-dind:latest bash -l -c 'bash /home/box/start-bot.sh'
```

Key flags:

- `-v /var/run/docker.sock:/var/run/docker.sock` — the bot's `docker` now talks
  to the **host** daemon (not a nested one).
- `--group-add <host-docker-gid>` — **required** so the non‑root `box` user can
  read the mounted socket; without it `docker` fails with a permission error.
- `-e DIND_SKIP_DAEMON=1` — tells the DinD image's entrypoint not to start its
  own daemon (there is nothing to nest).
- `-e HIVE_MIND_DOCKER_ISOLATION_MODE=dood` — makes the mode explicit so the
  diagnostics describe the **host** daemon and never false‑warn about a nested
  daemon or passthrough that does not exist in DooD. (Setting `DIND_SKIP_DAEMON`
  already infers DooD; this makes it unambiguous.)

> **One image, both modes.** `konard/hive-mind-dind` runs in **either** mode —
> the difference is only the run flags above. You do not need a separate image
> for DooD.

> **Security note.** DooD shares the host daemon, so tasks can reach every
> container and image on the host. Use it on hosts you control, where that trust
> boundary is acceptable.

## Concrete‑tag requirement (both modes)

`resolveDockerIsolationImageTag()` makes each task request the **exact**
`HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG` (e.g. `konard/hive-mind-dind:2.0.13`), not
the floating `:latest`. For zero‑copy reuse the daemon must hold **that concrete
tag**:

- **DooD** — pull the exact tag on the **host** before starting tasks:
  ```bash
  docker pull konard/hive-mind-dind:2.0.13
  ```
- **DinD** — seed the **nested** daemon with the exact tag (passthrough or the
  preload script in [DOCKER.md](./DOCKER.md#host-image-passthrough-avoid-re-downloading-multi-gb-images)).

Release images bake `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG` from the published
`HIVE_MIND_VERSION`, so a parent started as `:latest` still launches child
containers from the same immutable release tag. Pin that resolved version in your
deploy; if the daemon only has `:latest`, a digest drift forces a fresh
multi‑gigabyte pull.

## Verifying DooD reuse (no silent re‑pull)

Two checks confirm the bot is in DooD and will reuse the host image:

```bash
# 1. The bot's docker reaches the HOST daemon (DooD access OK).
docker exec hive-mind docker info >/dev/null && echo "DooD docker access OK"

# 2. The exact isolation tag is already present on that daemon (zero-copy reuse).
TAG="$(docker exec hive-mind printenv HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG || true)"
docker exec hive-mind docker image inspect "konard/hive-mind-dind:${TAG:-latest}" >/dev/null \
  && echo "Image present on the host daemon → zero-copy, no pull on first task"
```

The startup preflight performs the equivalent probe automatically and logs, in
DooD mode:

- ✅ image present on the **host** daemon → tasks reuse it (zero copy / zero pull);
- ⚠️ image **absent** on the host daemon → pull the exact tag on the host and pin
  `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG` (it never mentions a nested daemon or
  passthrough, which don't exist in DooD);
- ⚠️ host daemon on the `vfs` storage driver / low free disk → the usual
  disk‑overflow warnings, pointed at the **host** daemon.

## Related

- [DOCKER.md](./DOCKER.md) — general Docker setup, the DinD image, and host‑image
  passthrough for DinD.
- [issue #1962](https://github.com/link-assistant/hive-mind/issues/1962) — the
  request to support and document both modes.
- [issue #1914](https://github.com/link-assistant/hive-mind/issues/1914),
  [#1879](https://github.com/link-assistant/hive-mind/issues/1879),
  [#1946](https://github.com/link-assistant/hive-mind/issues/1946) — the
  DinD image‑reuse / disk work this builds on.
