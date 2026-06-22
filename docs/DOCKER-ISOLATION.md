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

## Credential mounts in DooD (the host‑daemon mount‑source trap)

Each isolated task mounts the bot's credentials into the container so `gh`, git,
and the agent CLI authenticate: `~/.config/gh`, `~/.gitconfig`, `~/.config/git`,
and — scoped to the tool — `~/.claude` + `~/.claude.json` or `~/.codex`. Those
mount **sources** are resolved from the bot's home (e.g. `/home/box/.gitconfig`).

In **DinD** that is correct: the nested daemon shares the bot filesystem, so
`/home/box/.gitconfig` is the real file. In **DooD** the task runs on the **host**
daemon, which resolves bind‑mount sources against the **host** filesystem — where
`/home/box/...` usually does not exist. Docker then **auto‑creates each missing
source as an empty directory** on the host, which breaks the task two ways
([issue #1962](https://github.com/link-assistant/hive-mind/issues/1962)):

1. File mounts (`~/.claude.json`, `~/.gitconfig`) fail with _"Are you trying to
   mount a directory onto a file (or vice‑versa)?"_ — the task dies before it
   starts.
2. The git identity is empty (`fatal: empty ident name (for <>)`) because the
   mounted `~/.gitconfig` is an empty directory.

You must make the bot's config resolve to the **same paths on the host**. Two
supported ways:

**Option A — expose the same paths on the host (symlinks work).** Bind the
container's home config into the host at the identical paths, or symlink them.
Docker follows symlink mount sources, so pointing the host's `/home/box/.claude`
etc. at wherever the files really live is enough:

```bash
# On the host, expose the bot's credentials at the SAME paths the bot uses.
# (Adjust /home/box to the bot user's home if you changed it.)
sudo mkdir -p /home/box/.config
sudo ln -s /srv/hive-config/.gitconfig   /home/box/.gitconfig
sudo ln -s /srv/hive-config/.claude      /home/box/.claude
sudo ln -s /srv/hive-config/.claude.json /home/box/.claude.json
sudo ln -s /srv/hive-config/.config/gh   /home/box/.config/gh
# ...and ~/.codex for the Codex tool, ~/.config/git for XDG git config.
```

**Option B — point Hive Mind at a host config root (recommended).** Set
`HIVE_MIND_HOST_CONFIG_DIR` to the directory on the **host** that holds the bot's
`.gitconfig`, `.claude`, `.claude.json`, `.codex`, and `.config/gh`. In DooD,
Hive Mind then resolves the conventional `~/.x` mount sources against that root
instead of the bot home, so the host daemon binds the real files:

```bash
docker run -dit --name hive-mind --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --group-add "${HOST_DOCKER_GID}" \
  -e DIND_SKIP_DAEMON=1 \
  -e HIVE_MIND_DOCKER_ISOLATION_MODE=dood \
  -e HIVE_MIND_HOST_CONFIG_DIR=/srv/hive-config \
  konard/hive-mind-dind:latest bash -l -c 'bash /home/box/start-bot.sh'
```

`HIVE_MIND_HOST_CONFIG_DIR` only takes effect in DooD (DinD always uses the bot
home, since the sources are real there). Because the bot cannot stat host‑daemon
paths, relocated sources skip the bot‑side existence check and trust your host
layout — make sure each file/dir exists with the right type (e.g. `.claude.json`
is a **file**, `.claude` is a **directory**).

The startup preflight detects DooD and warns, before the first task, when the
mount sources are still the bot's home paths and `HIVE_MIND_HOST_CONFIG_DIR` is
unset — turning the raw Docker mount failure into an actionable message.

## The `~/.gitconfig` write trap (`Device or resource busy`)

`~/.gitconfig` is the one credential that **cannot be a writable single‑file bind
mount**. `git config --global` — which `gh-setup-git-identity --repair` runs, and
which the bot's startup git‑identity preflight invokes when no identity exists —
does **not** edit the file in place. It writes a temp file and **`rename()`s it
over** `~/.gitconfig`, and a rename **over a mountpoint** fails:

```text
error: could not write config file /home/box/.gitconfig: Device or resource busy
```

(`git config` exits 4.) So if `~/.gitconfig` is a single‑file bind mount — or a
symlink that resolves to one — any `git config --global` against it dies. By
contrast `~/.claude.json` is rewritten **in place** by the agent tooling, so a
single‑file mount there is fine; `.gitconfig` is special because of the atomic
rename.

Two consequences for the recipes above:

1. **The isolated task mounts `~/.gitconfig` read‑only.** Hive Mind binds the git
   identity (`~/.gitconfig`, `~/.config/git`) into each task with `:ro`: the task
   only **reads** the identity to commit, and a `:ro` mount makes any stray
   write‑through‑the‑mount fail fast and legibly instead of mid‑run.
2. **Do not let the bot populate its identity *through* the mounted file.** The
   path that `gh-setup-git-identity` / `git config --global` writes must **not** be
   a bind mount (or a symlink to one). Pick one of:

   - **Write‑then‑copy (recommended).** Let `gh-setup-git-identity` write
     `~/.gitconfig` on the container's **own** filesystem (no mount → the rename
     succeeds), then copy it out to the host path the task mounts read‑only. The
     task only reads it, so a `:ro` file mount there is correct.
   - **Mount a directory, not a file.** Point `GIT_CONFIG_GLOBAL` at a file inside
     a **mounted directory** (e.g. `GIT_CONFIG_GLOBAL=/home/box/.gitcfg/config`
     where `.gitcfg/` is the bind mount). Renames of files **inside** a mounted
     directory work; only renaming over the mountpoint itself fails. The same
     `GIT_CONFIG_GLOBAL` must be honored by both the bot and the isolated task.

   If you use the **Option A symlink** layout above, make `~/.gitconfig` point at a
   file the bot does **not** write through (a pre‑populated, read‑only identity),
   or the first `git config --global` will hit the trap.

See [issue #1962](https://github.com/link-assistant/hive-mind/issues/1962) and the
related box / command‑stream investigations.

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
