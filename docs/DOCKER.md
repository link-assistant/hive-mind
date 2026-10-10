# Docker Support for Hive Mind (languages: en • [zh](DOCKER.zh.md) • [hi](DOCKER.hi.md) • [ru](DOCKER.ru.md))

This document explains how to run Hive Mind in Docker containers.

## Quick Start

### Option 1: Using Pre-built Image from Docker Hub (Recommended)

```bash
# Pull the latest image
docker pull konard/hive-mind:latest

# Create persistent host directories used by the current Docker workflow
mkdir -p /root/.hive-mind/claude /root/.hive-mind/codex /root/.hive-mind/agents/skills /root/.hive-mind/gh
touch -a /root/.hive-mind/claude.json

# Run the container in detached mode with the same mounts we use locally
docker run -dit --user box --name hive-mind --restart unless-stopped \
  -v /root/.hive-mind/claude:/home/box/.claude \
  -v /root/.hive-mind/codex:/home/box/.codex \
  -v /root/.hive-mind/agents:/home/box/.agents \
  -v /root/.hive-mind/claude.json:/home/box/.claude.json \
  -v /root/.hive-mind/gh:/home/box/.config/gh \
  konard/hive-mind:latest bash -l -c 'bash /home/box/start-bot.sh'

# Open a shell in the running container
docker exec -it hive-mind bash

# Inside the container, authenticate with GitHub
gh auth login -h github.com -s repo,workflow,user,read:org,gist

# Authenticate with Claude
claude

# Install or update Codex CLI
bun install -g @openai/codex@latest

# Log in to Codex using the current device auth flow
codex login --device-auth

# Verify Codex after login succeeds with "Successfully logged in"
codex exec --model gpt-5.4-mini "hi"

# Verify Playwright MCP registration in both CLIs
claude mcp list | grep playwright
codex mcp list | grep playwright

# Exit the shell when setup is complete
exit
```

> **Before relying on the bot, enable Docker `live-restore` on the host.** Without
> it, any `dockerd` restart (crash, OOM kill, upgrade) kills the bot, every
> running task and the queue. See
> [Host Docker daemon settings](#host-docker-daemon-settings).

### Option 2: Building Locally

```bash
# Build the production image
docker build -t hive-mind:local .

# Run the image
docker run -it hive-mind:local
```

### Option 3: Docker-in-Docker Image

Use `konard/hive-mind-dind:latest` when the agent must run Docker commands,
Docker Compose, or Testcontainers inside the Hive Mind container.

```bash
# Pull the Docker-in-Docker image
docker pull konard/hive-mind-dind:latest

# Default runtime: privileged container starts an inner dockerd
docker run --rm --privileged -it konard/hive-mind-dind:latest bash

# Inside the container, verify nested Docker
docker info
docker run hello-world
```

The image defaults the inner Docker daemon to
`DIND_STORAGE_DRIVER=fuse-overlayfs`. This is a **copy-on-write** driver, so the
multi-gigabyte Hive Mind images cost roughly their real size once on disk —
unlike `vfs`, which copies every layer in full and inflated the on-disk
footprint to many times the image size, overflowing the disk with
`failed to register layer: no space left on device`
([issue #1914](https://github.com/link-assistant/hive-mind/issues/1914)).
`fuse-overlayfs` also works overlay-on-overlay (the compatibility that `vfs` was
originally chosen for), and the image already ships the `fuse-overlayfs` binary;
Hive Mind launches the DinD container with `--privileged`, so `/dev/fuse` is
available. Overrides:

- `-e DIND_STORAGE_DRIVER=overlay2` — faster on hosts that support nested
  overlay mounts, but can fail on overlay-backed hosts;
- `-e DIND_STORAGE_DRIVER=vfs` — last-resort compatibility only; uses many times
  the disk and is the configuration that caused issue #1914.

> **Already-running container on the old `vfs` image?** Add
> `-e DIND_STORAGE_DRIVER=fuse-overlayfs` to the bot container's `docker run`
> and recreate it — no rebuild required.

On shared hosts, prefer a Sysbox runtime when it is available:

```bash
docker run --rm --runtime=sysbox-runc -it konard/hive-mind-dind:latest bash
```

The DinD image is published separately from `konard/hive-mind:latest` so users
who do not need nested Docker keep the existing lower-privilege image.

The DinD bot container runs on the **host** daemon, so a host `dockerd`
restart kills it, together with every task nested inside it. Enable
`live-restore` on the host first; see
[Host Docker daemon settings](#host-docker-daemon-settings).

### Option 4: Persistent Formal AI Service

All Hive Mind runtime images include the pinned `formal-ai` wrapper. The separate `Dockerfile.formal-ai` extends the root `konard/hive-mind-dind` Telegram image and runs:

```bash
formal-ai serve --agent-mode --host 0.0.0.0 --port 8080
```

The repository Compose file provides the complete topology:

```bash
docker compose build
docker compose up -d formal-ai
docker compose run --rm hive-mind-solver \
  https://github.com/owner/repo/issues/123 --tool codex --model formal-ai
```

The service and its Docker network are both named `link-assistant-formal-ai`, and the named `formal-ai-memory` volume persists `/home/box/.formal-ai` across restarts. The solver receives:

```text
HIVE_MIND_FORMAL_AI_BASE_URL=http://link-assistant-formal-ai:8080
```

Hive Mind forwards that endpoint into every `--isolation docker` task. For the Compose hostname `link-assistant-formal-ai`, the root container resolves the outer-network address immediately before launch and gives the nested task the resulting routable IP. Custom external hostnames remain unchanged, preserving DNS, virtual-host routing, and HTTPS certificate verification. In custom nested-Docker deployments, attach the service and root container to a shared routable network. `start-command` 0.31.0 can select a network at launch ([start#154](https://github.com/link-foundation/start/issues/154)), but `docker run --network` _replaces_ the default bridge, which would cut a task off from GitHub, so Hive Mind attaches nested task containers with `docker network connect` after they are created (see the next section); unusual network policies may still require setting the variable to an address routable from nested task containers.

For a manual deployment:

```bash
docker network create link-assistant-formal-ai
docker volume create formal-ai-memory

docker build -f Dockerfile.formal-ai -t hive-mind-formal-ai:local .
docker run -d --privileged --restart unless-stopped \
  --name formal-ai \
  --network link-assistant-formal-ai \
  --network-alias link-assistant-formal-ai \
  -v formal-ai-memory:/home/box/.formal-ai \
  hive-mind-formal-ai:local

docker run --rm --network link-assistant-formal-ai \
  -e HIVE_MIND_FORMAL_AI_BASE_URL=http://link-assistant-formal-ai:8080 \
  konard/hive-mind:latest \
  solve ISSUE_URL --tool agent --model formal-ai
```

#### On-demand Formal AI sidecar (default for the bot)

The Compose service above keeps Formal AI running permanently. A bot host that
only occasionally answers `--model formal-ai` does not need that, so Hive Mind
manages the container itself: the first Formal AI task starts it, and the last
one to finish stops it again.

```text
task container ──docker network connect──▶ hive-mind-formal-ai (internal)
                                              └── hive-mind-formal-ai container
                                                    └── hive-mind-formal-ai-memory volume
```

- The sidecar runs as `hive-mind-formal-ai` on the internal network of the same
  name, with the alias `link-assistant-formal-ai`. `--internal` means the
  network has no egress, and no port is published, so the model is reachable
  from attached task containers and from nowhere else.
- Each task holds a lease keyed on its session id (which is also its container
  name). Leases are re-derived from Docker on every reconcile, so a task that
  crashes cannot pin the container forever, and a task that is still being
  created keeps its lease for a one-hour launch window.
- Task containers are attached with `docker network connect` inside the same
  gate that starts the sidecar, and receive the sidecar's address (not the DNS
  alias) as `HIVE_MIND_FORMAL_AI_BASE_URL`.
- If the sidecar cannot start or the attach fails, the task is stopped instead
  of continuing on a different model
  ([issue #2146](https://github.com/link-assistant/hive-mind/issues/2146)).
- Memory lives in the `hive-mind-formal-ai-memory` volume, which is never
  removed — not when the container stops, not when the image changes.

While no lease is held, the sidecar image is refreshed by pulling
`HIVE_MIND_FORMAL_AI_UPDATE_TAG` and comparing digests. A new digest is adopted
only through the Formal AI persisted-memory upgrade contract
([formal-ai#982](https://github.com/link-assistant/formal-ai/issues/982)):
`memory upgrade-status` preflight, `memory migrate` with a byte-exact backup and
a receipt, then a boot of the new image whose `/health` must report the memory
as compatible. Any failure after the migration restores the backup named in the
receipt and keeps the previous image. Installed agentic CLIs and operational
utilities (`claude-profiles`, `gh-setup-git-identity`, `gh-pull-all`,
`gh-load-issue`, `gh-load-pull-request`, `gh-upload-log`) are refreshed on the
same idle condition. The environment variables for both are documented in
[Configuration](CONFIGURATION.md#41-docker-isolation-settings).

#### Host-image passthrough (avoid re-downloading multi-GB images)

When the bot runs with `--isolation docker` inside a release DinD image, each
task is launched as a _nested_
`docker run konard/hive-mind-dind:<release-tag> ...`. Release images bake
`HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG` from the published `HIVE_MIND_VERSION`,
so even a parent container started as `konard/hive-mind-dind:latest` uses the
same immutable release tag for child containers. That nested `docker run` talks
to the **inner** dockerd, whose image store starts **empty** (the deploy wipes
`/var/lib/docker` before
`docker commit`). Docker then reports `Unable to find image '…' locally` and
pulls a fresh copy — and the Hive Mind images are multiple gigabytes, so the
first isolated task can spend a very long time (or run out of disk)
re-downloading an image the **host already has**. See
[issue #1914](https://github.com/link-assistant/hive-mind/issues/1914) and
[#1879](https://github.com/link-assistant/hive-mind/issues/1879).

The base image (`ghcr.io/link-foundation/box-dind`) can seed the inner daemon
from the host
automatically — **host-image passthrough** — but only when the host Docker
socket is bind-mounted into the container. **Without the socket mount,
passthrough is a silent no-op** and the inner daemon stays empty. Mount it and
set the allowlist:

```bash
docker run -dit --privileged --name hive-mind --restart unless-stopped \
  # ... your usual credential mounts ...
  -v /var/run/docker.sock:/var/run/host-docker.sock:ro \
  -e DIND_HOST_PASSTHROUGH_IMAGES="konard/hive-mind konard/hive-mind-dind" \
  konard/hive-mind-dind:latest bash -l -c 'bash /home/box/start-bot.sh'
```

Passthrough is controlled by these environment variables (honored by `box-dind`):

| Variable                           | Default                     | Purpose                                                                                   |
| ---------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| `DIND_HOST_PASSTHROUGH`            | `public`                    | `off`, `public` (copy only images with a public-registry digest), or `all`.               |
| `DIND_HOST_DOCKER_SOCK`            | `/var/run/host-docker.sock` | Where the host socket is mounted inside the container. Hive Mind reads the same variable. |
| `DIND_HOST_PASSTHROUGH_IMAGES`     | _(empty = any)_             | Space-separated image-name allowlist, e.g. `konard/hive-mind konard/hive-mind-dind`.      |
| `DIND_HOST_PASSTHROUGH_REGISTRIES` | _(empty)_                   | Optional registry allowlist for `public` mode.                                            |

In the default `public` mode, only images that carry a digest from a public
registry are copied, so the host copy must be a pulled/pushed image (a locally
`docker build`-only image without a `RepoDigest` will be skipped — push it first
or use `all`).

For release deployments, make sure the host also has the exact child tag before
the final bot container starts. Pulling only `:latest` is not enough once the
release image has pinned `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG`:

```bash
TAG="$(docker image inspect konard/hive-mind-dind:latest \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sed -n 's/^HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG=//p' \
  | tail -1)"
docker pull "konard/hive-mind-dind:${TAG:-latest}"
```

**Startup preflight.** When `--isolation docker` is enabled, the bot probes the
inner daemon at startup and logs the result, so a misconfiguration surfaces
immediately instead of as a surprise pull mid-task:

- ✅ image already present → isolated tasks reuse it (no pull);
- ⚠️ socket **not** mounted → it tells you to add the socket mount + allowlist;
- ⚠️ socket mounted but image still absent → it tells you to check the
  passthrough mode/allowlist/digest;
- ⚠️ inner daemon on the `vfs` storage driver → it tells you to switch to
  `fuse-overlayfs` (the disk-amplification root cause of issue #1914);
- ⚠️ low free space on the Docker data root with the image still absent → it
  warns that the impending pull may run out of disk.
- ⚠️ the host daemon (through the mounted socket) or the task daemon reports
  `LiveRestoreEnabled=false` → it tells you how to enable `live-restore` with
  `systemctl reload docker`, never `restart`
  ([Host Docker daemon settings](#host-docker-daemon-settings), issue #2900).

Run the bot with `--verbose` (or `TELEGRAM_BOT_VERBOSE=true`) for the underlying
`docker image inspect` traces.

**Task container retention.** When a Docker-isolated task reaches a terminal
state, Hive Mind removes the task container after a successful run so its
writable layer is reclaimed while the host-side start-command log remains
available. Failed runs are kept by default for investigation, and the Telegram
completion message includes inspect and cleanup commands. Override the policy
with `HIVE_MIND_KEEP_TASK_CONTAINER=always|on-failure|never` (default:
`on-failure`).

#### Docker task resource limits

Telegram-launched Docker tasks have a default memory cap of 25% of host RAM.
CPU and disk limits are optional; override the memory cap as needed:

```bash
hive-telegram-bot --isolation docker \
  --container-cpu 50% \
  --container-memory 2GiB \
  --container-disk 20GB
```

The equivalent environment variables are `TELEGRAM_CONTAINER_CPU`,
`TELEGRAM_CONTAINER_MEMORY`, and `TELEGRAM_CONTAINER_DISK`. A CPU value is a
fixed core count such as `1.5`, or a percentage of the host's logical CPUs.
Memory and disk accept decimal units (`MB`, `GB`, `TB`), binary units (`MiB`,
`GiB`, `TiB`), or percentages. Memory percentages use total host RAM; disk
percentages use the space available on the filesystem at task launch.

No limit is inferred: omitting a setting preserves the existing unlimited
behavior. Docker applies CPU and RAM limits while the task is held behind its
start gate, before the task command runs. Docker storage quotas are not portable
across storage drivers, so Hive Mind enforces the disk setting against the
container's writable layer on each session-monitor tick (30 seconds by default).
When usage exceeds the limit, the container is stopped and the completion
message reports the measured usage and configured limit. The Docker daemon must
have the relevant CPU and memory cgroup controllers delegated; if Docker cannot
apply a requested kernel limit, Hive Mind keeps the start gate closed, removes
or stops the container where possible, and reports the launch failure instead
of silently running the task unlimited.

**Manual fallback.** To seed an already-running container immediately (or when
you cannot change the deployment), copy the host image into the inner daemon:

```bash
TAG="$(docker exec hive-mind printenv HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG || true)"
node scripts/preload-dind-isolation-image.mjs \
  --container hive-mind --image "konard/hive-mind-dind:${TAG:-latest}"
```

This streams `docker save … | docker exec -i <container> docker load` so the
tarball never touches disk, and is a no-op if the inner daemon already has the
image. Once the image is present, start-command's native Docker backend reuses
it automatically (Docker's default "missing" pull policy — it pulls only when
the image is absent, so there is no re-download).

### Option 4: Development Mode (Gitpod-style)

For development purposes, the legacy `Dockerfile` provides a Gitpod-compatible environment:

```bash
# Build the development image
docker build -t hive-mind-dev .

# Run with credential mounts
docker run --rm -it \
    -v ~/.config/gh:/home/box/.persisted-configs/gh:ro \
    -v ~/.local/share/claude-profiles:/home/box/.persisted-configs/claude:ro \
    -v ~/.config/claude-code:/home/box/.persisted-configs/claude-code:ro \
    -v "$(pwd)/output:/home/box/output" \
    hive-mind-dev
```

## Host Docker daemon settings

### Enable `live-restore` (strongly recommended)

By default (`"live-restore": false`), **any restart of the host `dockerd` stops
every container on it**. That includes a crash, an OOM kill, an
`apt upgrade docker-ce` or a `systemctl restart docker`. For Hive Mind that
means the bot container, every running task and the in-memory solve queue all
die together. `--restart unless-stopped` brings the bot back, but the running
tasks and the queue are gone. This is what happened in
[issue #2900](https://github.com/link-assistant/hive-mind/issues/2900): the
host `dockerd` was OOM-killed, systemd restarted it, and it killed the bot and
all four running tasks with exit 137.

Container processes are children of `containerd-shim`, not of `dockerd`. With
`"live-restore": true`, a restarted `dockerd` re-attaches to the still-running
containers instead of killing them
([Docker docs](https://docs.docker.com/engine/daemon/live-restore/)).

`live-restore` is a **reloadable** option, so you can turn it on without
stopping a single container. Run this on the **host** (not inside the bot
container):

```bash
curl -fsSL https://raw.githubusercontent.com/link-assistant/hive-mind/main/scripts/enable-docker-live-restore.sh | sudo bash
```

The script ([`scripts/enable-docker-live-restore.sh`](../scripts/enable-docker-live-restore.sh))
does the following:

- merges `"live-restore": true` into `/etc/docker/daemon.json`, keeping every
  other key (it makes a backup first, and leaves invalid JSON untouched);
- validates the result;
- **reloads** dockerd;
- verifies the new setting.

Use `--dry-run` to preview the change, or `--no-reload` to only edit the file.

To do the same by hand:

```bash
# 1. Add the key, keeping any existing settings, e.g. /etc/docker/daemon.json:
#    { "log-driver": "json-file", "live-restore": true }
sudoedit /etc/docker/daemon.json

# 2. Apply it WITHOUT stopping containers: reload, NEVER restart
sudo systemctl reload docker        # or: sudo kill -HUP "$(pidof dockerd)"

# 3. Verify
docker info -f '{{.LiveRestoreEnabled}}'   # -> true
```

> ⚠️ **Use `systemctl reload docker`, never `systemctl restart docker`,** while
> containers are running. Until live-restore is on, the restart itself kills
> every container, which is exactly the outage you are trying to prevent.

Hive Mind checks this setting at startup when `--isolation docker` is enabled.
If the daemon that runs the bot or its tasks has live-restore off, the bot logs
a warning with these exact steps. Inside the DinD image, the bot probes the
host daemon through the mounted host socket (see
[Host-image passthrough](#host-image-passthrough-avoid-re-downloading-multi-gb-images)).
The check is diagnostic only and never blocks startup.

**What live-restore does not cover:**

- **A host reboot.** Containers stop with the machine. You still need
  `--restart unless-stopped` on the bot container, and the solve queue still
  needs to be persisted
  ([#2890](https://github.com/link-assistant/hive-mind/issues/2890)).
- **Feature-release Docker upgrades.** Docker supports live restore only
  across patch upgrades (e.g. `29.6.0` → `29.6.1`). After a larger upgrade, or
  after a change to daemon options such as the storage driver or bridge IP,
  the containers may not be restored. Plan those for a quiet moment.
- **Long daemon outages.** While dockerd is down, container output goes into a
  FIFO buffer (64 KiB by default). Once it is full, writes to it block, and
  Docker documents that dockerd must then be restarted to flush it.
- **Swarm.** Live restore applies to standalone containers only. Older Docker
  releases refuse to run swarm mode with live-restore on, so the script stops
  on a swarm node unless you pass `--allow-swarm`.
- **Flag plus file conflicts.** If dockerd is already started with the
  `--live-restore` flag, do not also add the key to `daemon.json`: dockerd
  refuses to start when a directive comes from both. The script detects this
  case (the daemon already reports `true`) and changes nothing.
- **Docker Desktop.** Set it in _Settings → Docker Engine_. Applying it there
  restarts the engine, so do it while no task is running.

**The nested DinD daemon.** The `konard/hive-mind-dind` image starts its own
inner `dockerd` without `--live-restore`. Nothing restarts that inner daemon on
its own, so the risk is low, and the bot only logs it. Requested upstream in
[link-foundation/box#131](https://github.com/link-foundation/box/issues/131).
To enable it today, bind-mount a `daemon.json` with `{"live-restore": true}` at
`/etc/docker/daemon.json` into the container.

## Authentication

The production Docker image (`Dockerfile`) extends the pinned full `ghcr.io/link-foundation/box` image, which provides Ubuntu 24.04 plus the general development toolchain. **IMPORTANT:** Authentication is performed **inside the container AFTER** the Docker image is fully installed and running.

**Why Authentication Happens After Installation:**

- ✅ Avoids Docker build timeouts caused by interactive prompts
- ✅ Prevents build failures in CI/CD pipelines
- ✅ Allows the installation script to complete successfully
- ✅ Supports automated Docker image builds

### GitHub Authentication

```bash
# Inside the container, AFTER it's running
gh auth login -h github.com -s repo,workflow,user,read:org,gist
```

**Note:** The installation script intentionally does NOT call `gh auth login` during the build process. This is by design to support Docker builds without timeouts.

### Claude Authentication

```bash
# Inside the container, AFTER it's running
claude
```

### Codex Authentication

Install or update Codex CLI inside the running container:

```bash
bun install -g @openai/codex@latest
```

Log in with the device auth flow we currently use:

```bash
codex login --device-auth
```

The command should finish with:

```text
Successfully logged in
```

Then run the current smoke test:

```bash
codex exec --model gpt-5.4-mini "hi"
```

This approach allows:

- ✅ Multiple Docker instances with different GitHub accounts
- ✅ Multiple Docker instances with different Claude subscriptions
- ✅ Persistent Codex authentication and session data when `/home/box/.codex` is mounted
- ✅ No credential leakage between containers
- ✅ Each container has its own isolated authentication
- ✅ Successful Docker builds without interactive authentication

## Router isolation (experimental)

Mounting credentials into a container gives the agent inside the credential itself. `--use-router` is the alternative: the subscription stays in a single `hive-mind-router` sidecar on an internal Docker network, and each task container is given only a short-lived token scoped to itself, plus a request log of its own.

```bash
solve https://github.com/owner/repo/issues/42 --isolation docker --use-router
```

Nothing changes without the flag. See [Router isolation](./ROUTER.md) for the design, the configuration, and the limits of the experimental state, and [Collecting logs](./COLLECTING-LOGS.md) for reading the resulting audit trail.

## Playwright MCP State in Docker

The image build now registers Playwright MCP for both Claude and Codex:

- `claude mcp add playwright -s user -- ...`
- `codex mcp add playwright -- ...`

The CI workflow also builds the Docker image and verifies that:

- `playwright --version` works as a CLI fallback;
- `npx --no-install @playwright/mcp --help` works without reinstalling the MCP package;
- `claude mcp list` reports the Playwright server as connected/enabled, not pending or unavailable;
- `codex mcp list` reports the Playwright server as connected/enabled, not pending or unavailable.

If you still reproduce `codex mcp list` showing `No MCP servers configured yet` in a running container, the most likely root cause is a mounted `/home/box/.codex` directory from the host. In this image `HOME=/home/box`, so mounting `/home/box/.codex` replaces the image-baked Codex config, including any preconfigured MCP entries.

That means:

- the published image can be correct,
- the runtime container can still show Codex as unconfigured,
- and the difference is caused by persisted host state overriding the container defaults.

To confirm that quickly, compare these two cases:

```bash
# Fresh container without host-mounted Codex state
docker run --rm -it konard/hive-mind:latest bash -lc 'codex mcp list'

# Container with persisted Codex state from host
docker run --rm -it \
  -v /root/.hive-mind/codex:/home/box/.codex \
  konard/hive-mind:latest \
  bash -lc 'codex mcp list'
```

If the first command shows `playwright` and the second does not, the host-mounted Codex directory is the source of the mismatch.

## Prerequisites

1. **Docker:** Install Docker Desktop or Docker Engine (version 20.10 or higher)
   with [`live-restore` enabled](#host-docker-daemon-settings)
2. **Internet Connection:** Required for pulling images and authentication

## Directory Structure

```
.
├── Dockerfile                    # Production image based on ghcr.io/link-foundation/box
├── experiments/
│   └── solve-dockerize/
│       └── Dockerfile            # Legacy Gitpod-compatible image (archived)
├── scripts/
│   └── verify-docker-image.sh    # Docker image verification script
└── docs/
    └── DOCKER.md                 # This file
```

## Advanced Usage

### Running with Persistent Storage

To persist authentication and work between container restarts, mount the actual per-tool directories instead of a generic `/home/box` volume. In our Docker images `HOME=/home/box`, so Codex stores its data in `/home/box/.codex`.

```bash
# Host directories used by the current local Docker workflow
mkdir -p /root/.hive-mind/claude /root/.hive-mind/codex /root/.hive-mind/agents/skills /root/.hive-mind/gh
touch -a /root/.hive-mind/claude.json

# Run with persistent mounts
docker run -dit --user box --name hive-mind --restart unless-stopped \
  -v /root/.hive-mind/claude:/home/box/.claude \
  -v /root/.hive-mind/codex:/home/box/.codex \
  -v /root/.hive-mind/agents:/home/box/.agents \
  -v /root/.hive-mind/claude.json:/home/box/.claude.json \
  -v /root/.hive-mind/gh:/home/box/.config/gh \
  konard/hive-mind:latest bash -l -c 'bash /home/box/start-bot.sh'

# Fix ownership after the container starts
BOX_UID=$(docker exec hive-mind id -u box)
chown -R $BOX_UID:$BOX_UID /root/.hive-mind/claude /root/.hive-mind/codex /root/.hive-mind/agents /root/.hive-mind/gh
chown $BOX_UID:$BOX_UID /root/.hive-mind/claude.json
```

The mounted Codex directory keeps the files we rely on:

- `/home/box/.codex/auth.json`
- `/home/box/.codex/config.toml`
- `/home/box/.codex/sessions/`
- `/home/box/.codex/hive-mind/repositories/<owner>/<repo>/` (repository-scoped capability working state, rebuilt before each task)

The optional `/home/box/.agents/skills/` mount stores user-level Agent Skills for the long-running container itself. It is **not** propagated into `--isolation docker` task containers (see the next section). Hive Mind does not deploy or commit these capabilities to the target repository.

### What a `--isolation docker` task receives (issue #2190)

Since [issue #2190](https://github.com/link-assistant/hive-mind/issues/2190) a task container no longer inherits the whole `~/.claude`, `~/.claude.json`, `~/.codex` or `~/.agents` tree of the host. Only the credential file and the session directories are shared:

| Tool   | Shared with every task (bind-mounted)                                       | Per container (from the image)                                                   |
| ------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| claude | `~/.claude/.credentials.json`, `~/.claude/projects/`, `~/.claude/sessions/` | `~/.claude.json`, `settings.json`, `plugins/`, `skills/`, `commands/`, `agents/` |
| codex  | `~/.codex/auth.json`, `~/.codex/sessions/`                                  | `config.toml`, `plugins/`, `skills/`, `~/.agents/`                               |
| all    | `~/.config/gh`, `~/.gitconfig`, `~/.config/git`                             |                                                                                  |

Why:

- **One credential file for all tasks.** A token refreshed by one task (or by the host) is immediately visible to every other task, because they all mount the very same file.
- **No global reconfiguration from inside a task.** Plugins, marketplaces, skills, MCP registrations and settings a task installs stay in that container and disappear with it; the next task starts from the image defaults again.
- **No inherited bloat.** A plugin synced into the host's global state (the `superpowers` plugin from the Codex remote catalog or the official Claude marketplace was the trigger for issue #2190) is never mounted into a task, so it cannot make the agent refuse to work or inflate its token usage.
- **Audit stays global.** `projects/` and `sessions/` are still mounted from the host, so transcripts of every task can be discovered and audited in one place.

Hive Mind creates the session directories on the host before launching a task. The credential file is never created for you: an empty `auth.json` makes Codex fail with `EOF while parsing`, so log in once on the host (or seed it with `{}` and log in from a task). With `--use-router` none of the vendor paths is mounted at all: the task authenticates only with its own router token ([docs/ROUTER.md](./ROUTER.md)).

On top of the mount split, every `solve`/`hive` start audits the global Claude/Codex configuration and, by default, removes anything that is not part of the minimal profile (plugins, marketplaces, global skills, MCP servers other than Playwright, and the Codex remote plugin sync). Disable the repair with `--no-agent-config-auto-repair` or `HIVE_MIND_AGENT_CONFIG_AUTO_REPAIR=0`; the warnings are still printed.

### Required Codex capability preflight

For Codex tasks, Hive Mind reads the issue, all issue comments and repository instruction files before launching `codex exec`. Explicitly required plugin selectors (for example, `superpowers@openai-curated`) and skill names (for example, `superpowers:using-superpowers`) are resolved against `codex plugin list --available --json`. Selected providers are installed into the repository-scoped Codex home above and verified before execution.

Every task rebuilds that scope from an empty plugin and skill state. It copies current authentication and non-plugin runtime settings, disables remote plugin synchronization, and materializes only explicitly selected providers from the inspected marketplace. It never copies the parent's plugin cache or global Agent Skills. Thus an image or parent configuration update remains visible without allowing stale or unrequested instructions to enter a task.

The preflight always inspects the exact catalog rendered by `codex debug prompt-input`, even when the task declares no optional capabilities. Every visible entry must resolve to a core skill under the scoped `skills/.system`, an explicitly required repository skill, or a skill under a selected scoped plugin payload. The verbose log records each accepted name, provider, version and normalized path. An unexpected skill, an untrusted path, or an unavailable/unparseable probe on a Codex version that supports it stops execution; capability advisory mode cannot bypass this security check.

If the mounted directory predates an image-provided marketplace or MCP configuration, refresh that parent configuration first; the preflight reports the missing snapshot or exact capability and a remediation command.

Because this mount fully overrides the image's `/home/box/.codex` directory, it can also preserve an older `config.toml` that does not include the Playwright MCP registration added by newer images. After starting a container with an older persisted Codex directory, re-run:

```bash
codex mcp add playwright -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080
```

Hive Mind also attempts this default registration repair at runtime when
`codex mcp list` has no Playwright row and `@playwright/mcp` is installed. It
does not overwrite an existing Playwright row that is pending, disabled, or
customized; those states need direct MCP startup debugging.

### Running in Detached Mode

```bash
# Start a detached container with persistent auth mounts
docker run -dit --user box --name hive-worker --restart unless-stopped \
  -v /root/.hive-mind/claude:/home/box/.claude \
  -v /root/.hive-mind/codex:/home/box/.codex \
  -v /root/.hive-mind/claude.json:/home/box/.claude.json \
  -v /root/.hive-mind/gh:/home/box/.config/gh \
  konard/hive-mind:latest bash -l -c 'bash /home/box/start-bot.sh'

# Execute commands in the running container
docker exec -it hive-worker bash

# Inside the container, run your commands
codex exec --model gpt-5.4-mini "hi"
solve https://github.com/owner/repo/issues/123
```

### Using with Docker Compose

Create a `docker-compose.yml`:

```yaml
version: '3.8'
services:
  hive-mind:
    image: konard/hive-mind:latest
    volumes:
      - box-home:/home/box
    stdin_open: true
    tty: true

volumes:
  box-home:
```

Then run:

```bash
docker-compose run --rm hive-mind
```

## Troubleshooting

### GitHub Authentication Issues

```bash
# Inside the container, check authentication status
gh auth status

# Re-authenticate if needed
gh auth login -h github.com -s repo,workflow,user,read:org,gist
```

### Claude Authentication Issues

```bash
# Inside the container, re-run Claude to authenticate
claude
```

### Docker Issues

```bash
# Check Docker status on host
docker info

# Check that a dockerd restart will not kill running containers (expect true)
docker info -f '{{.LiveRestoreEnabled}}'

# Pull the latest image
docker pull konard/hive-mind:latest

# Rebuild from source
docker build -t hive-mind:local .
```

### Build Issues

If you encounter issues building the image locally:

1. Ensure you have enough disk space (at least 20GB free)
2. Check your internet connection
3. Try building with more verbose output:
   ```bash
   docker build -t hive-mind:local --progress=plain .
   ```

## CI/CD Configuration for Docker Hub Publishing

If you're maintaining a fork or want to publish to your own Docker Hub account, follow these steps to configure GitHub Actions:

### Step 1: Create a Docker Hub Account

1. Go to [hub.docker.com](https://hub.docker.com)
2. Sign up or log in to your account
3. Note your Docker Hub username (e.g., `konard`)

### Step 2: Generate a Docker Hub Access Token

1. Log in to [hub.docker.com](https://hub.docker.com)
2. Click on your username in the top-right corner
3. Select **Account Settings** → **Security**
4. Click **New Access Token**
5. Enter a description (e.g., "GitHub Actions - Hive Mind")
6. Set permissions to **Read, Write, Delete** (required for publishing)
7. Click **Generate**
8. **IMPORTANT:** Copy the token immediately - you won't be able to see it again!
   - Example format: `dckr_pat_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p`

### Step 3: Add Secrets to GitHub Repository

1. Go to your GitHub repository (e.g., `https://github.com/konard/hive-mind`)
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add the following two secrets:

   **Secret 1: DOCKERHUB_USERNAME**
   - Name: `DOCKERHUB_USERNAME`
   - Value: Your Docker Hub username (e.g., `konard`)
   - Click **Add secret**

   **Secret 2: DOCKERHUB_TOKEN**
   - Name: `DOCKERHUB_TOKEN`
   - Value: The access token you generated in Step 2
   - Click **Add secret**

### Step 4: Update Docker Image Name

If using a fork, update the image name in `.github/workflows/docker-publish.yml`:

```yaml
env:
  REGISTRY: docker.io
  IMAGE_NAME: YOUR_DOCKERHUB_USERNAME/hive-mind # Change this to your username
```

### Step 5: Verify the Configuration

1. Push changes to the `main` branch
2. Go to **Actions** tab in your GitHub repository
3. Find the "Docker Build and Publish" workflow
4. Check that it completes successfully
5. Verify the image appears on [hub.docker.com/r/YOUR_USERNAME/hive-mind](https://hub.docker.com/r/konard/hive-mind)

### How It Works

- **On Pull Requests:** The workflow tests building the Docker image without publishing
- **On Main Branch:** The workflow builds and publishes to Docker Hub with the `latest` tag
- **On Version Tags:** The workflow publishes with semantic version tags (e.g., `v0.37.0`, `0.37`, `0`)

### Troubleshooting CI/CD

**Build fails with authentication error:**

- Verify `DOCKERHUB_USERNAME` matches your Docker Hub username exactly
- Regenerate `DOCKERHUB_TOKEN` and update the secret

**Image published but can't pull:**

- Ensure the repository on Docker Hub is public (or you're authenticated)
- Check [hub.docker.com](https://hub.docker.com) → Your repositories → hive-mind → Settings → Make Public

**Build succeeds but image doesn't appear:**

- Check you're pushing to the `main` branch (pull requests only test, don't publish)
- Verify the workflow ran in the Actions tab
- Check Docker Hub rate limits haven't been exceeded

## Security Notes

- Each container maintains its own isolated authentication
- No credentials are shared between containers
- No credentials are stored in the Docker image itself
- Authentication happens inside the container after it starts
- Each GitHub/Claude account can have its own container instance
- Docker Hub access tokens should be stored only as GitHub Secrets, never committed to the repository
