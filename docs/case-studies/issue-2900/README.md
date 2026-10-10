# Issue 2900 Case Study: a dockerd restart kills the bot, every task and the queue

> Status: **addressed in PR #2902**. The startup preflight now checks Docker
> `live-restore` and warns loudly, with the exact host-side fix, when it is off.
> A merge-only host script (`scripts/enable-docker-live-restore.sh`) turns it on
> with a reload, never a restart. `docs/DOCKER.md` (and the `zh`/`hi`/`ru`
> translations), the READMEs and the compose/Coolify deployments now point to a
> new **Host Docker daemon settings** section. The optional nested-daemon change
> was reported upstream as
> [link-foundation/box#131](https://github.com/link-foundation/box/issues/131).
>
> Data captured under [`./data`](./data):
>
> - `issue-2900.json`, `issue-2900-comments.json`: the issue and its comments (none yet).
> - `issue-2887.json`, `issue-2888.json`, `issue-2889.json`, `issue-2890.json`,
>   `issue-2892.json`: the related issues filed from the same incident.
> - `box-dind-entrypoint-3e613a79.sh`: the box DinD entrypoint at commit
>   `3e613a79`, which starts the nested dockerd.
> - `box-issue-131.json`: the upstream issue filed against link-foundation/box.
> - `live-restore-dind-repro.log`: the reproduction of the incident in a
>   throwaway DinD daemon (see [Experiments](#experiments)).
> - `live-restore-flag-config-conflict.log`: proof that setting `live-restore`
>   both as a flag and in `daemon.json` stops dockerd from starting.
> - `docker-cli-unreachable-daemon.log`: what Docker CLIs 24 to 29 print and
>   return for an unreachable daemon.

## Timeline (2026-10-09)

Journal times in the issue are CEST (UTC+2); they are given in UTC below.
The host ran Ubuntu 24.04 with 6 CPUs, 11.7 GB RAM and Docker 29.6.1. It had no
`/etc/docker/daemon.json`, so `live-restore` was off. The root container
`hive-mind` (DinD variant, `--restart unless-stopped`) ran `hive-telegram-bot`
(hive-mind 2.34.0) and launched tasks as `$ --isolated docker` containers.

| Time                 | Event                                                                                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12:11:39 UTC         | The kernel OOM-kills the **host dockerd** (`anon-rss:7302520kB`, about 7.3 GB). The memory spike came from about 22 concurrent `docker diff` calls ([link-foundation/disk-space-saviour#22](https://github.com/link-foundation/disk-space-saviour/issues/22)). |
| 12:11:41 UTC         | systemd: `docker.service: Main process exited, code=killed, status=9/KILL`; systemd restarts dockerd.                                                                                                                                                          |
| 12:11:45 UTC         | dockerd: `Loading containers: start.`                                                                                                                                                                                                                          |
| 12:11:55 UTC         | dockerd: `Container failed to exit within 10s of signal 15 - using the force`. Every container exits with code 137: the root container and the four running `/codex` tasks (link-assistant/router #724, #725, #727, #728).                                     |
| after the restart    | The in-memory solve queue (32 items) is gone (#2890). Kill recovery then hits #2887, #2888, #2889 and #2892.                                                                                                                                                   |
| 13:31 UTC            | The operator restarts the root container by hand.                                                                                                                                                                                                              |
| same day             | The operator enables `live-restore` on the live host with `systemctl reload docker`, while tasks are running and a `docker commit` is in progress. No container is affected.                                                                                   |
| 2026-10-09 15:18 UTC | Issue #2900 is filed, together with #2887, #2888, #2889, #2890 and #2892.                                                                                                                                                                                      |

## Requirements

| #   | Requirement (from the issue)                                                                                                                                            | Status                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `preflightDockerIsolation` reads `docker info -f '{{.LiveRestoreEnabled}}'` from the daemon the bot launches tasks on.                                                  | Done: `checkDockerLiveRestore` in `src/docker-live-restore.lib.mjs`. It also probes the mounted host socket in DinD deployments.                                                 |
| R2  | When it is `false`, warn loudly with the exact remediation, including "use `systemctl reload docker`, never `restart`".                                                 | Done: `assessDockerLiveRestore` builds the warning with `buildLiveRestoreRemediation()`.                                                                                         |
| R3  | Diagnostic only; never blocks startup.                                                                                                                                  | Done: the probe never throws, and the result only adds to `warnings`/`liveRestoreOk`, like the storage-driver and disk checks.                                                   |
| R4  | Tests with an injectable probe, like `checkStorageDriver`.                                                                                                              | Done: `checkLiveRestore` option on `preflightDockerIsolation`; `tests/test-issue-2900-docker-live-restore.mjs`.                                                                  |
| R5  | "Host Docker daemon settings" section in `docs/DOCKER.md` and the `zh`/`hi`/`ru` translations.                                                                          | Done.                                                                                                                                                                            |
| R6  | Reference it from Quick Start / Option 3 and the README install section.                                                                                                | Done in all four `DOCKER*.md` files and all four `README*.md` files.                                                                                                             |
| R7  | Docs cover what the setting does, why it matters, how to apply it without a restart, and its limits (host reboot, `--restart unless-stopped`, #2890 queue persistence). | Done: "What live-restore does not cover" list.                                                                                                                                   |
| R8  | Install/deploy scripts write the setting by merging into `daemon.json`, never overwriting it.                                                                           | Done: `scripts/enable-docker-live-restore.sh`. The repository has no script that installs Docker on a host, so this script is what the docs, READMEs and Coolify guide point to. |
| R9  | Optional: `--live-restore` in the box DinD entrypoint.                                                                                                                  | Reported upstream: [link-foundation/box#131](https://github.com/link-foundation/box/issues/131), with a repro, a workaround and a fix that avoids the flag/file conflict.        |
| R10 | Case study with data, timeline, root causes, solutions, online research; debug output; upstream reports; apply the fix everywhere.                                      | This document; `--verbose` logs the raw probe output per daemon; compose and Coolify files now point at the host setting.                                                        |

## Root causes

1. **Docker's default is `"live-restore": false`.** With it off, dockerd stops
   every container when the daemon itself stops, and on start it cleans up
   whatever is left. An OOM kill of dockerd is a daemon stop like any other.
   Container processes are children of `containerd-shim`, not of dockerd, so
   nothing forces this: with `live-restore` on, dockerd re-attaches to them.
   The [reproduction](#experiments) shows exactly this on Docker 29.9.0.
2. **Hive Mind never mentioned the setting.** There was no `live-restore` or
   `daemon.json` anywhere in `docs/` or `src/`, and the startup preflight
   checked the storage driver and disk space but not this. Operators had no
   reason to change the default.
3. **Everything sits on one daemon.** The bot container, the tasks and the
   in-memory queue all depend on the same host dockerd, so one daemon restart
   takes all of them down together. Recovery then relies on snapshot and
   resume paths that have their own bugs (#2887, #2888, #2889, #2892).

The trigger, the dockerd OOM, is a separate bug tracked in
link-foundation/disk-space-saviour#22. `live-restore` does not stop dockerd from
crashing; it stops the crash from killing the containers.

## Solution

### Startup preflight (R1–R4)

`preflightDockerIsolation` (`src/isolation-runner.lib.mjs`) calls
`assessDockerLiveRestore` from the new `src/docker-live-restore.lib.mjs`. The new
module keeps `isolation-runner.lib.mjs` under its line limit.

- One call, `docker info --format '{{.LiveRestoreEnabled}} {{.ID}}'`, returns both
  the setting and the daemon ID. The preflight probes the CLI's default daemon
  (the one that runs tasks) and, when it is mounted, the host socket
  (`DIND_HOST_DOCKER_SOCK`, default `/var/run/host-docker.sock`).
- Equal IDs mean one daemon (Docker-outside-of-Docker, or a bot directly on the
  host): that daemon gets **one** warning.
- Different IDs mean DinD: the host daemon's setting decides whether the bot
  container survives. A disabled nested daemon only gets an `ℹ️` note, because
  the box entrypoint starts it with `nohup` and nothing restarts it.
- Without a host socket, the module falls back to the deployment mode. DinD
  without `DIND_SKIP_DAEMON=1` and without a `DOCKER_HOST` pointing elsewhere
  means the CLI talks to the nested daemon. The preflight cannot see the host
  then, so it prints a note with the host-side check and the fix.
- An unreachable daemon is **unknown**, not disabled. `docker info --format`
  against a dead socket still prints the zero-value template (`false ` with an
  empty ID). Docker CLI 28 and 29 then exit 1, but CLI 24, 26 and 27 exit **0**
  (`data/docker-cli-unreachable-daemon.log`). The first CI run of this PR hit
  exactly that on the GitHub runner. So the probe and the host script trust a
  report only when the command succeeded **and** returned a daemon ID; every
  reachable daemon reports one.
- `--verbose` logs, per daemon, the exit code, the raw output, the parsed setting
  and the daemon ID (`[VERBOSE] docker-live-restore: …`).

The warning text contains everything an operator needs mid-incident: the
one-line `curl … | sudo bash` command, the manual `daemon.json` edit, `sudo
systemctl reload docker`, **never** `systemctl restart docker`, the
`docker info -f '{{.LiveRestoreEnabled}}'` check, and a link to the docs.

### Host script (R8)

`scripts/enable-docker-live-restore.sh` follows the procedure from the issue:

1. Exit early when the running daemon already reports `true`. This also covers a
   dockerd started with the `--live-restore` flag, where adding the key to
   `daemon.json` as well would stop the next dockerd start (see
   `live-restore-flag-config-conflict.log`).
2. Refuse a swarm node unless `--allow-swarm` is given.
3. Merge `"live-restore": true` into `daemon.json` with python3 (jq as a
   fallback), keeping every other key. Back up the existing file and replace it
   atomically, keeping its owner and mode. Leave invalid JSON or a non-object
   top level untouched and exit 1.
4. Validate with `dockerd --validate` when available.
5. Reload with `systemctl reload docker` or SIGHUP. It never restarts dockerd.
6. Verify that `docker info` reports `true`.

`--dry-run` and `--no-reload` let an operator review the change first.

### Docs (R5–R7)

The new **Host Docker daemon settings** section in `docs/DOCKER.md` (anchors:
`#host-docker-daemon-settings`, `#宿主机-docker-守护进程设置`,
`#होस्ट-docker-डेमन-सेटिंग्स`, `#настройки-демона-docker-на-хосте`) covers what
the setting does, the incident, the script, the manual steps, the
reload-not-restart rule, the preflight, the limits and the nested-daemon note.
It is linked from Option 1, Option 3, the startup preflight description, the
prerequisites and troubleshooting. All four READMEs add the enable step to
"Installing Docker" plus an "Already running Docker?" paragraph.
`docker-compose.yml`, `coolify/docker-compose.yml` and `coolify/README.md` point
at the same host setting next to their restart policies.

### Upstream (R9)

[link-foundation/box#131](https://github.com/link-foundation/box/issues/131)
asks the DinD entrypoint (`data/box-dind-entrypoint-3e613a79.sh`,
`launch_dockerd()`) to start the nested daemon with live-restore. It includes the
reproduction, a workaround (a `daemon.json` in the nested daemon's config path)
and a fix that adds `--live-restore` only when no `daemon.json` sets the key, to
avoid the flag/file conflict above. This is low priority, because nothing
restarts the nested daemon automatically.

## Experiments

| Script                                               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `experiments/issue-2900-live-restore-dind-repro.sh`  | In a throwaway `docker:29-dind` daemon (Docker 29.9.0): **A.** with the default, a dockerd restart leaves the container `exited exit=137`, the incident in miniature. **B.** writing `daemon.json` and sending SIGHUP flips `LiveRestoreEnabled` to `true` while the container keeps running with the same PID. **C.** With live-restore on, the container survives a dockerd restart with the same PID. Log: `data/live-restore-dind-repro.log`. |
| `experiments/issue-2900-flag-config-conflict.sh`     | `dockerd --live-restore` plus `"live-restore": true` in `daemon.json` exits 1: `the following directives are specified both as a flag and in the configuration file: live-restore`. Log: `data/live-restore-flag-config-conflict.log`.                                                                                                                                                                                                            |
| `experiments/issue-2900-unreachable-daemon.mjs`      | An unreachable socket: command-stream does not throw, `docker info --format` prints `false ` and exits 1 (Docker CLI 29). Older CLIs exit 0 (`data/docker-cli-unreachable-daemon.log`), so the probe also requires a daemon ID.                                                                                                                                                                                                                   |
| `experiments/issue-2900-command-stream-versions.mjs` | command-stream 1.6.2 and 2.0.0 (the latest, which `use-m` loads in CI) both report exit code 1 for the same failing call, ruling out the library as the cause of the CI difference.                                                                                                                                                                                                                                                               |
| `experiments/issue-2900-live-restore-probe.mjs`      | Runs the real probe and the preflight against the local daemon(s); pass `--verbose` for the raw output.                                                                                                                                                                                                                                                                                                                                           |

## Online research

- [Docker docs: Live restore](https://docs.docker.com/engine/daemon/live-restore/)
  - Enable it with `"live-restore": true` in `daemon.json`, then reload the
    daemon (SIGHUP or `systemctl reload docker`) to avoid stopping containers.
  - Live restore is only supported across patch releases. A major or minor
    upgrade, or a change to some daemon options (such as the bridge IP or the
    graph driver), may still stop containers.
  - It does not apply to swarm services. Older Docker releases refused to start
    swarm mode with live-restore on.
  - Containers write their output into a FIFO buffer of 64K. When the buffer
    fills while dockerd is down, the container blocks until dockerd comes back
    and drains it.
  - On Docker Desktop the setting is changed in the engine configuration and
    applied with an engine restart.
- [dockerd reference: configuration reload behavior](https://docs.docker.com/reference/cli/dockerd/#configuration-reload-behavior)
  lists `live-restore` among the options that a SIGHUP reload applies.
- [dockerd reference: daemon configuration file](https://docs.docker.com/reference/cli/dockerd/#daemon-configuration-file):
  an option set both as a flag and in the file stops the daemon from starting.
  The flag/file experiment confirms this for `live-restore`.

## Existing components

- `preflightDockerIsolation` already had injectable diagnostics
  (`checkStorageDriver`, disk space). The live-restore probe uses the same
  pattern and the same never-throw, never-block rules.
- `getCommandStreamDollar` (`src/start-command-cli.lib.mjs`) runs `docker info`
  in the same way as the other preflight probes.
- The operator's own deploy script already merged and reloaded. Its python3
  snippet from the issue is the basis of the host script.
- No library is needed. The setting is a single `daemon.json` key, and
  `docker info` reports it directly.

## Limits and open questions

- **A host reboot** still stops every container. Containers still need
  `--restart unless-stopped`, and the queue still needs the persistence from
  #2890.
- **Minor and major Docker upgrades** may still stop containers (see the Docker
  docs above). Patch upgrades and crashes are covered.
- **Topology.** The issue says the bot "launches tasks on the host daemon", but
  the production deploy script captured in
  [`../issue-1914/data/deploy-docker.mjs`](../issue-1914/data/deploy-docker.mjs)
  runs the DinD image with `DIND_SKIP_DAEMON=0` and mounts no host socket, which
  would put tasks on the nested daemon. Either way the host dockerd restart
  killed the root container, and the tasks with it. The preflight therefore
  handles every wiring it can observe:
  - a mounted host socket (probed directly);
  - DooD with `DIND_SKIP_DAEMON=1` (warns about the default daemon);
  - `DOCKER_HOST` pointing away from the nested socket (warns about the default
    daemon);
  - a nested daemon without a host socket (cannot see the host, so it prints a
    note with the host-side check).

  Mounting the host socket at `DIND_HOST_DOCKER_SOCK` lets the preflight warn
  about the host in DinD deployments too.

- **The jq fallback** in the host script is untested here, because jq is not
  installed in this environment. The python3 path is covered by the tests.
