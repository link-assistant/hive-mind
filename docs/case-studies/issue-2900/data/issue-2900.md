# #2900 Recommend and preflight-check Docker "live-restore": true so a dockerd restart no longer kills the bot and every task
labels: []
## Incident context (2026-10-09)

Host: Ubuntu 24.04, 6 CPU, 11.7 GB RAM, Docker 29.6.1 (containerd image store), **no `/etc/docker/daemon.json`, so `live-restore` was off** (`docker info -f '{{.LiveRestoreEnabled}}'` → `false`). Root container `hive-mind` (DinD variant, `--restart unless-stopped`) runs `hive-telegram-bot` and launches tasks on the host daemon as `$ --isolated docker` containers. hive-mind 2.34.0.

At 12:11:39 UTC the kernel OOM-killed the **host dockerd**. systemd restarted it within seconds, and on restore dockerd force-killed every container (exit 137): the root container and all four running `/codex` tasks (link-assistant/router #724, #725, #727, #728). The in-memory solve queue (32 items) was lost (#2890), and kill recovery then hit #2887, #2888, #2889 and #2892.

```
14:11:39 kernel: Out of memory: Killed process 823 (dockerd) … anon-rss:7302520kB
14:11:41 systemd: docker.service: Main process exited, code=killed, status=9/KILL
14:11:45 dockerd: Loading containers: start.
14:11:55 dockerd: Container failed to exit within 10s of signal 15 - using the force container=…
```

## Problem

With the Docker default (`live-restore: false`), **any** dockerd restart kills every container: crash, OOM kill, `apt upgrade docker-ce`, `systemctl restart docker`. For hive-mind that is the worst possible failure. One daemon hiccup takes down the bot, every running task and the queue together, and then everything has to be recovered from snapshots.

Container processes do not depend on dockerd. They are children of `containerd-shim`. With [`"live-restore": true`](https://docs.docker.com/engine/daemon/live-restore/) dockerd re-attaches to them after a restart, and the bot and tasks keep running. That one setting would have prevented this whole incident.

Nothing in hive-mind mentions this today (no `live-restore` / `daemon.json` in `docs/` or `src/`), and the startup preflight (`preflightDockerIsolation` in `src/isolation-runner.lib.mjs`) already checks the storage driver and disk space but not this.

## Working example (applied on the incident host)

The setting can be turned on **without restarting dockerd**, because `live-restore` is a reloadable option (SIGHUP via `systemctl reload docker`). Restarting the daemon to apply it would itself kill every container. Verified on the live host with tasks running and a `docker commit` in progress. No container was affected:

```bash
python3 -c 'import json,os
p="/etc/docker/daemon.json"
d=json.load(open(p)) if os.path.exists(p) and os.path.getsize(p) else {}
changed=d.get("live-restore") is not True
d["live-restore"]=True
os.makedirs("/etc/docker",exist_ok=True)
changed and open(p,"w").write(json.dumps(d,indent=2)+"\n")
print("changed" if changed else "unchanged")'
systemctl reload docker        # NOT restart
docker info -f '{{.LiveRestoreEnabled}}'   # → true
```
```
dockerd: Got signal to reload configuration config-file=/etc/docker/daemon.json
dockerd: Reloaded configuration config="{… \"live-restore\":true, …}"
```

Our deploy script now does this on every deploy. It merges the key into an existing `daemon.json` and keeps the other keys, leaves invalid JSON alone with a warning, reloads, and verifies `LiveRestoreEnabled`.

## Suggested fix

1. **Startup preflight warning:** in `preflightDockerIsolation` (and/or at bot start when `--isolation docker`), read `docker info -f '{{.LiveRestoreEnabled}}'` from the daemon the bot launches tasks on. If it is `false`, warn loudly with the exact remediation above, including "use `systemctl reload docker`, never `restart`, while containers are running". This is diagnostic only and never blocks startup, like the existing storage-driver and disk checks. Add tests with an injectable probe, like `checkStorageDriver`.
2. **Docs:** add a "Host Docker daemon settings" section to `docs/DOCKER.md` (and the `zh`/`hi`/`ru` translations), referenced from the Quick Start / Option 3 instructions and the README install section. It should cover `live-restore: true`, why it matters for hive-mind (bot + all tasks + in-memory queue die together on a daemon restart), how to apply it without a restart, and its limits (it does not survive a host reboot; containers still need `--restart unless-stopped` and queue persistence from #2890).
3. **Any hive-mind install/deploy scripts** that install Docker on a host should write the setting the same way, merging rather than overwriting `daemon.json`.
4. **Optional, nested daemon:** the DinD entrypoint in link-foundation/box starts the inner dockerd with `nohup` and nothing restarts it, so `--live-restore` there only helps when the inner daemon is restarted by hand. It is low priority, but passing `--live-restore` would be harmless and consistent.

Related: #2892 (daemon-restart kills reported as OOM), #2890 (queue persistence), #2889 (snapshot recovery cost, which live-restore avoids entirely for daemon restarts), link-foundation/disk-space-saviour#22 (the trigger of the dockerd OOM).

---

We need to download all logs and data related about the issue to this repository, make sure we compile that data to `./docs/case-studies/issue-{id}` folder, and use it to do deep case study analysis (also make sure to search online for additional facts and data), in which we will reconstruct timeline/sequence of events, list of each and all requirements from the issue, find root causes of the each problem, and propose possible solutions and solution plans for each requirement (we should also check known existing components/libraries, that solve similar problem or can help in solutions).

If there is not enough data to find actual root cause, add debug output and verbose mode if not present, that will allow us to find root cause on next iteration.

If issue related to any other repository/project, where we can report issues on GitHub, please do so. Each issue must contain reproducible examples, workarounds and suggestions for fix the issue in code. Also double check to fully apply requirements to entire codebase, so if we have issue in multiple places, it should be fixed in all them.

Please plan and execute everything in this single pull request, you have unlimited time and context, as context auto-compacts and you can continue indefinitely, until it is each and every requirement fully addressed, and everything is totally done.



## comments

