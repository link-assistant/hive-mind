# Case study: issue #2900, Docker `live-restore` preflight and host daemon settings

- Issue: https://github.com/link-assistant/hive-mind/issues/2900
- Issue text and comments: [data/issue-2900.md](./data/issue-2900.md)
- Related: #2892 (the same kills reported as OOM, see
  [its case study](../issue-2892/README.md)), #2890 (queue persistence), #2889
  (snapshot recovery cost), #3533 (host reboot),
  link-foundation/disk-space-saviour#22 (the trigger of the dockerd OOM).

## Summary

On 2026-10-09 one restart of the host dockerd killed the Hive Mind bot
container, four running `/codex` tasks and the 32-item in-memory solve queue at
once. The host had no `/etc/docker/daemon.json`, so `live-restore` was off (the
Docker default). With `"live-restore": true`, dockerd re-attaches to running
containers after a restart, and none of them would have been killed.

## Timeline (UTC, from the host journal quoted in the issue)

| Time     | Event                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------- |
| 12:11:39 | Kernel OOM-kills the host `dockerd` (anon-rss about 7.3 GB, from about 22 concurrent `docker diff` calls) |
| 12:11:41 | systemd: `docker.service: Main process exited, code=killed, status=9/KILL`                                |
| 12:11:45 | The new dockerd logs `Loading containers: start.`                                                         |
| 12:11:55 | `Container failed to exit within 10s of signal 15 - using the force` for each container; all exit 137     |
| 13:31    | The root container is started by hand; the bot runs kill recovery (hitting #2887, #2888, #2889, #2892)    |
| later    | The operator merges `"live-restore": true` and runs `systemctl reload docker`; no container is affected   |

## Root causes

1. With `live-restore: false`, dockerd treats the containers it finds on start
   as orphans and stops them (SIGTERM, then SIGKILL after 10 s). Container
   processes are children of `containerd-shim`, so they could have kept
   running. The kill is a dockerd policy, not a technical necessity.
2. Nothing in Hive Mind mentioned the setting: no `live-restore` or
   `daemon.json` in `docs/` or `src/`, and `preflightDockerIsolation` checked
   only image presence, the socket mount, the storage driver and disk space.

## Requirements and status

| #   | Requirement (issue body)                                                                                                   | Status                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Startup preflight reads `docker info -f '{{.LiveRestoreEnabled}}'` and warns on `false` with the reload-not-restart fix    | Done. `src/docker-live-restore.lib.mjs` (`checkDockerLiveRestore`, `preflightLiveRestore`, `buildLiveRestoreWarning`), called from `preflightDockerIsolation` in `src/isolation-runner.lib.mjs`. Never throws and never blocks; an unknown answer is silent.            |
| 1   | Tests with an injectable probe, like `checkStorageDriver`                                                                  | Done. `checkLiveRestore` option; `tests/issue-2900-live-restore.test.mjs`. The two issue #1914 preflight tests stub it so they stay hermetic.                                                                                                                           |
| 2   | "Host Docker daemon settings" in `docs/DOCKER.md` and the zh/hi/ru translations, linked from Quick Start, Option 3, README | Done in all four languages: why it matters, the check, the merge-and-reload commands, the limits (host reboot and `--restart unless-stopped`, #2890, Swarm, patch-only upgrades, the log FIFO). Linked from Option 1, Option 3 and the README "Installing Docker" part. |
| 3   | Install/deploy scripts that install Docker merge the setting into `daemon.json`                                            | Not applicable: no script in this repository installs Docker on a host (`docker-solve.sh` only checks for it). The docs and the preflight warning carry the same merge command (`LIVE_RESTORE_MERGE_COMMAND`, checked by a test).                                       |
| 4   | Optional: `--live-restore` for the nested DinD dockerd                                                                     | Done. box-dind's `/usr/local/bin/dind-entrypoint.sh` passes `--live-restore` when `DIND_LIVE_RESTORE=1` (its default, unless `daemon.json` already has the key; box issue #131). `Dockerfile.dind` now pins `ENV DIND_LIVE_RESTORE="1"`, covered by a test.             |

## Solution

### Which daemons are probed

- The ambient daemon (`docker info`): the one isolated tasks are launched on.
- In the DinD image with the host socket mounted (`DIND_HOST_DOCKER_SOCK`,
  default `/var/run/host-docker.sock`), also the host daemon, via
  `docker -H unix://<sock> info`. That daemon runs the bot container itself, so
  it is the one whose restart killed everything on 2026-10-09. Without the host
  socket the bot cannot see the host daemon; only the docs can help there.

The result carries `liveRestore` and `hostLiveRestore` (true, false or null) next
to the existing preflight fields, and each `false` adds one warning.

### Applying the setting without a restart

`live-restore` is reloadable (SIGHUP). The issue's working example, verified on
the incident host with tasks running and a `docker commit` in progress:

```bash
sudo python3 -c 'import json,os
p="/etc/docker/daemon.json"
d=json.load(open(p)) if os.path.exists(p) and os.path.getsize(p) else {}
d["live-restore"]=True
os.makedirs("/etc/docker",exist_ok=True)
open(p,"w").write(json.dumps(d,indent=2)+"\n")'
sudo systemctl reload docker                # NOT restart
docker info -f '{{.LiveRestoreEnabled}}'    # true
```

An invalid `daemon.json` makes `json.load` fail before anything is written, so
the file is left alone. `systemctl restart docker` would itself kill every
container while the setting is still off.

## Tests

`tests/issue-2900-live-restore.test.mjs` (10 tests, no Docker needed):

- parsing of the `docker info` template output;
- the exact `docker info` / `docker -H` command lines, via an injected runner;
- an unreachable daemon or unexpected output gives `null`, never an exception;
- the warning text carries the reload-not-restart fix and the limits;
- the preflight warns on `false`, stays silent on `true`, `null` or a throwing
  probe, and never sets `ok` to false;
- DinD with the host socket probes both daemons; DinD without it probes one;
- `Dockerfile.dind` pins `DIND_LIVE_RESTORE="1"`;
- all four `docs/DOCKER*.md` carry the section, the same merge command as the
  warning, the DinD opt-out and two links to the section; all four READMEs link
  it.

## Limits (from https://docs.docker.com/engine/daemon/live-restore/)

- It does not survive a host reboot: keep `--restart unless-stopped` on the bot
  container. A task ended by a reboot is reported as such (#3533).
- Across a Docker upgrade it covers patch releases only.
- It does not apply in Swarm mode.
- If dockerd stays down long enough for a container's stdout/stderr FIFO buffer
  (about 64 KiB) to fill, that container's writes block until dockerd returns.
- The in-memory queue is still lost on any bot restart; that is #2890.
- The bot can only warn. Changing `/etc/docker/daemon.json` on the host needs
  root on the host, which the bot container does not have.

## Upstream

Nothing to report: live-restore behaves as documented. The nested-daemon part
is already handled in link-foundation/box (`DIND_LIVE_RESTORE`, box issue #131
for the flag versus `daemon.json` conflict).
