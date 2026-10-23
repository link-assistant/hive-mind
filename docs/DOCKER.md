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

> **Before the first start:** enable Docker live-restore on the host, so a `dockerd` restart does not kill the bot and its running tasks. See [Host Docker daemon settings](#host-docker-daemon-settings).

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

The inner daemon starts with `--live-restore` (`DIND_LIVE_RESTORE=1`). The host daemon that runs this container needs the setting too: see [Host Docker daemon settings](#host-docker-daemon-settings).

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
- Before every start, a one-off container running as `box` (1001:1001) checks
  that it can write the memory volume. Only if it cannot is the volume
  `chown -R`-ed (as root) back to `box`, and the bot log records
  `[formal-ai] memory volume was owned by <uid:gid>; fixed`. A healthy volume
  is never chowned
  ([issue #3583](https://github.com/link-assistant/hive-mind/issues/3583)).
- Once `/health` answers, the first lines of the sidecar's stdout are read. A
  `logging_failure` record becomes a warning in the bot log and in the solve
  log of every task served by that sidecar: `Formal AI cannot write its logs or
memory (…): dialogs of this session will not be kept`.
- Before the sidecar container is removed (idle stop, replacing a stopped
  container, `/unload`), `docker logs --timestamps` is saved to
  `formal-ai-sidecar-<start time>.log` in the bot log directory
  (`HIVE_MIND_LOG_DIR`, default `~/.hive-mind/logs`). The newest
  `HIVE_MIND_FORMAL_AI_SIDECAR_LOG_KEEP` files are kept (default 50; `0` turns
  archiving off).

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

Telegram-launched Docker tasks get these limits unless you set them:

| Limit                     | Default         | Option                           | Environment variable                    |
| ------------------------- | --------------- | -------------------------------- | --------------------------------------- |
| CPU                       | 50% of host CPU | `--container-cpu`                | `TELEGRAM_CONTAINER_CPU`                |
| RAM hard limit            | 60% of host RAM | `--container-memory`             | `TELEGRAM_CONTAINER_MEMORY`             |
| RAM soft limit (reserved) | 25% of host RAM | `--container-memory-reservation` | `TELEGRAM_CONTAINER_MEMORY_RESERVATION` |
| Writable-layer disk       | none            | `--container-disk`               | `TELEGRAM_CONTAINER_DISK`               |

```bash
hive-telegram-bot --isolation docker \
  --container-cpu 50% \
  --container-memory 60% \
  --container-memory-reservation 25% \
  --container-disk 20GB
```

A CPU value is a fixed core count such as `1.5`, or a percentage of the host's
logical CPUs. Memory and disk accept decimal units (`MB`, `GB`, `TB`), binary
units (`MiB`, `GiB`, `TiB`), or percentages. Memory percentages use total host
RAM; disk percentages use the space available on the filesystem at task launch.
`unlimited` turns a limit off, including a default one (for example
`--container-cpu unlimited`).

**Memory (issue #3125).** The old default, a 25% hard cap, OOM-killed ordinary
builds on small hosts (2.9 GiB of 11.7 GiB) while the rest of the RAM was idle.
A task may now use up to 60% of host RAM. The 25% reservation is a soft limit
(`docker update --memory-reservation`): while the host has free RAM a task can
grow past it, and under host memory pressure the kernel reclaims tasks that are
above their reservation first. The reservation must be below the hard limit.
Setting `--container-memory` replaces the hard limit and drops the default
reservation; set `--container-memory-reservation` as well to keep one. Swap is
not added: `--memory-swap` equals the hard limit.

Inside every task, the bash shells the AI tool runs commands in raise their own
`oom_score_adj` to 500 through a `BASH_ENV` hook, so when the task's memory
runs out the kernel kills a build or test run before the AI CLI. The CLI keeps
its score, so the session survives and can retry with less parallelism.
`HIVE_MIND_TOOL_SHELL_OOM_SCORE_ADJ` changes the value (1-1000) or turns this
off (`off`). Shells that are not bash (`sh`, `zsh`) keep the default score.

**CPU (issue #3048).** Without a CPU limit, one multi-core task reads as 100%
host CPU, and the queue's CPU gate holds every tool queue until it ends. Each
task is now capped at 50% of the host CPUs. The queue also counts the CPU a
capped task is using as reserved for that task: it compares the rest of the
load with the CPUs the capped tasks cannot use. So a task busy at its own cap
does not block other tools, while uncapped load still does. The bot prints a
warning at startup when Docker tasks run without a CPU limit, and the queue's
`Starting:` log line shows the limits each task starts with, for example
`[limits: CPU=50% (3 CPUs), RAM=60% (7.2 GiB), reservation=25% (3.0 GiB), disk=unlimited]`.

Docker applies CPU and RAM limits with `docker update` while the task is held
behind its start gate, before the task command runs. start-command 0.38.0 has
`--memory` and `--cpus` launch flags but no `--memory-reservation`, so all
limits are applied the same way. Docker storage quotas are not portable across
storage drivers, so Hive Mind enforces the disk setting against the container's
writable layer on each session-monitor tick (30 seconds by default). When usage
exceeds the limit, the container is stopped and the completion message reports
the measured usage and configured limit. The Docker daemon must have the
relevant CPU and memory cgroup controllers delegated; if Docker cannot apply a
requested kernel limit, Hive Mind keeps the start gate closed, removes or stops
the container where possible, and reports the launch failure instead of
silently running the task unlimited.

**CPU penalty (issue #2801).** A Docker task that keeps all of its CPUs busy
for a long time is capped, then released once it calms down. This is on by
default for `--isolation docker`. The "CPUs it may use" are the Docker host's
CPUs (`docker info` NCPU, re-read every 5 minutes so a resized VM is picked up),
or its `--container-cpu` limit when that is lower.

1. If the task averages at least 95% of those CPUs for 15 minutes, the session
   monitor runs `docker update --cpus 2` on its container.
2. Once the task has averaged below 65% of the cap for 15 minutes (1.3 cores
   for a 2-CPU cap: each CPU at 65%, the issue's 32.5% + 32.5% of the total), the cap is lifted. It is
   restored to the `--container-cpu` limit, or to the host CPU count when
   there is no limit.
3. Observation then starts again from scratch. Another 15 minutes on all CPUs
   caps the task again.

```bash
hive-telegram-bot --isolation docker \
  --container-cpu-penalty-cpus 2 \
  --container-cpu-penalty-trigger 95% \
  --container-cpu-penalty-trigger-window 15m \
  --container-cpu-penalty-release 65% \
  --container-cpu-penalty-release-window 15m
```

`--no-container-cpu-penalty` (`TELEGRAM_CONTAINER_CPU_PENALTY=false`) turns it
off. The other options map to `TELEGRAM_CONTAINER_CPU_PENALTY_CPUS`, `_TRIGGER`,
`_TRIGGER_WINDOW`, `_RELEASE` and `_RELEASE_WINDOW`. Windows accept `ms`, `s`,
`m` or `h`; a bare number means minutes. Usage is sampled with one
`docker stats --no-stream` call per monitor tick. A window only counts once its
samples cover all of it, so a bot restart cannot penalize a task on a few fresh
samples. The penalty state survives bot restarts. A container resumed with a
penalty cap still in place is watched as penalized, so the cap is lifted later.
A task that was capped shows a `🐢 CPU penalty` section in its completion
message.

start-command 0.38.0 (the version in the Hive Mind images) has its own opt-in
`$ --cpu-penalty*` with the same options and defaults. Hive Mind does not pass
it: the bot's own monitor works with every start-command version and reports a
penalty in the completion message. Do not enable both penalties for the same
container, because they would fight over its CPU cap. See the
[issue #2801 case study](case-studies/issue-2801/README.md) for both checked
against a real Docker daemon.

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
2. **Internet Connection:** Required for pulling images and authentication

## Host Docker daemon settings

With Docker's default `"live-restore": false`, any restart of the host `dockerd`
— a crash, the kernel OOM killer, a package upgrade, `systemctl restart docker` —
force-kills every container: the bot container, every running
`--isolation docker` task and the bot's in-memory solve queue
([issue #2900](https://github.com/link-assistant/hive-mind/issues/2900)). With `"live-restore": true` the daemon re-attaches to
the running containers instead ([Docker documentation](https://docs.docker.com/engine/daemon/live-restore/)).

Check the setting (`true` is what you want):

```bash
docker info -f '{{.LiveRestoreEnabled}}'
```

The `--isolation docker` preflight runs the same check when the bot starts and
logs a warning when a daemon reports `false`. In the Docker-in-Docker image it
checks the nested daemon and, when the host socket is mounted, the host daemon
too. The warning never blocks startup.

Apply it on the Docker host (not inside a container):

```bash
# Merge "live-restore": true into /etc/docker/daemon.json, keeping every other key
sudo python3 -c 'import json,os
p="/etc/docker/daemon.json"
d=json.load(open(p)) if os.path.exists(p) and os.path.getsize(p) else {}
d["live-restore"]=True
os.makedirs("/etc/docker",exist_ok=True)
open(p,"w").write(json.dumps(d,indent=2)+"\n")'

# Reload (SIGHUP), never restart: a restart while live-restore is still off kills every container
sudo systemctl reload docker

# Verify: prints true
docker info -f '{{.LiveRestoreEnabled}}'
```

Limits:

- Live-restore does not survive a host reboot: every container stops. Keep
  `--restart unless-stopped` on the bot container so it comes back; a task ended
  by the reboot is reported as such ([issue #3533](https://github.com/link-assistant/hive-mind/issues/3533)).
- Containers keep running across daemon upgrades only between patch releases.
- Live-restore does not work in Swarm mode; it covers standalone containers.
- While the daemon is down, a container that fills its log pipe buffer (about
  64 KiB) blocks on writes until the daemon returns.
- The bot's queue of not-yet-started tasks lives in memory and is still lost when
  the bot itself restarts ([issue #2890](https://github.com/link-assistant/hive-mind/issues/2890)).
- No script in this repository installs Docker on a host, so this is a one-time
  manual step.
- The `konard/hive-mind-dind` image already starts its nested `dockerd` with
  `--live-restore` (`DIND_LIVE_RESTORE=1`, set `-e DIND_LIVE_RESTORE=0` to opt
  out). The host daemon still needs the setting above.

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

**Keep the Telegram bot's queue across restarts (issue #2890).** The bot saves its solve queue to `~/.hive-mind/state/` (`queue.json`, a `queue.lino` copy and, when the `clink` link-cli tool is installed, a `queue.links` doublets database). `HIVE_MIND_STATE_DIR` moves that directory. After a restart the bot puts every queued task back in its original order and tells each chat what came back. A task that was being launched is started again only when no container or tracked session runs it. To keep the queue when the bot's container is recreated, add `-v /root/.hive-mind/state:/home/box/.hive-mind/state` to the `docker run` command above (and `chown` the directory to `box`). If every store is lost, the bot rebuilds the queue from its own log in `~/.hive-mind/logs/`. Set `HIVE_MIND_QUEUE_CLINK=0` to skip the link-cli copy, or `HIVE_MIND_CLINK_PATH` to point to the `clink` binary (`dotnet tool install --global clink`).

**Running tasks count against the limits (issue #2917).** Under `--isolation docker` the queue counts the running task containers (`docker ps`), so a task the bot no longer tracks, for example after a bot restart, still counts for the one-at-a-time limits. `/limits` shows these as `N untracked`. The bot labels each task container with `hive-mind.*` labels (tool, URL, command, instance). Set `HIVE_MIND_INSTANCE_ID` when several bots share one Docker daemon, so each bot adopts only its own task containers.

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
