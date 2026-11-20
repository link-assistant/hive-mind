# Manual Hive Mind operations

Run these commands directly if the `hive-manager` launcher is unavailable. Deployment, Docker daemon and proxy commands run on the Docker host. For a remote host, first make a regular SSH connection, using its normal SSH configuration or `ssh -J gateway,edge-bastion deploy@hive.internal`. The commands below use Bash on Linux. Use the paths, image and name from your deployment profile. Relative paths in a profile are relative to that profile.

## Create and configure an instance

The example creates a **new** plain instance named `hive-mind`. To use an existing state directory, skip the initialization block. The state directory can contain credentials and should be private.

```bash
name=hive-mind
image=konard/hive-mind:latest
state="$HOME/.hive-mind"
docker pull "$image"
image_id=$(docker image inspect --format '{{.Id}}' "$image")

(
  set -e
  umask 077
  mkdir -- "$state"
  mkdir -- "$state"/{claude,codex,agents,gh,git,hive,start-command,start-logs}
  printf '{}\n' > "$state/claude.json"
  touch "$state/git/config"
  docker run --rm --pull never --network none --user root --entrypoint bash \
    --mount "type=bind,source=$state,target=/state" "$image_id" -c '
      set -e
      umask 077
      for config in claude/settings.json codex/config.toml; do
        if [ -f "/home/box/.$config" ]; then
          cp -- "/home/box/.$config" "/state/$config"
        fi
      done
      chown -R box:box /state/*
    '
)
```

Reuse this mount list for setup and subsequent replacements. Pulling the image is the equivalent of `deploy prepare`. A `docker create` call with the same options creates a stopped candidate so you can inspect its command and mounts before starting it.

```bash
state_mounts=(
  --mount "type=bind,source=$state/claude,target=/home/box/.claude"
  --mount "type=bind,source=$state/claude.json,target=/home/box/.claude.json"
  --mount "type=bind,source=$state/codex,target=/home/box/.codex"
  --mount "type=bind,source=$state/agents,target=/home/box/.agents"
  --mount "type=bind,source=$state/gh,target=/home/box/.config/gh"
  --mount "type=bind,source=$state/git,target=/home/box/.config/git"
  --mount "type=bind,source=$state/hive,target=/home/box/.hive-mind"
  --mount "type=bind,source=$state/start-command,target=/home/box/.start-command"
  --mount "type=bind,source=$state/start-logs,target=/tmp/start-command/logs"
  --env GIT_CONFIG_GLOBAL=/home/box/.config/git/config
)
runtime=(--env TELEGRAM_ISOLATION=screen)
docker run -d --pull never --name "$name" --restart unless-stopped --init --user box \
  "${state_mounts[@]}" "${runtime[@]}" "$image_id" sleep infinity
```

For DinD, use `konard/hive-mind-dind:latest` and replace the `runtime` array with `(--privileged --mount "type=volume,source=$name-dind-data,target=/var/lib/docker")`. To give a plain instance access to the host Docker daemon, set `runtime=(--group-add "$(stat -c '%g' /var/run/docker.sock)" --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock)`. For DinD host image passthrough, add the socket as a read-only bind at `/var/run/host-docker.sock`, add the socket group and set `DIND_HOST_PASSTHROUGH_IMAGES` and `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG` to the deployment image. See the [Docker guide](../DOCKER.md) for the permissions and storage implications.

## Sign in on the host or in the container

Run the commands inside the instance to keep each instance's credentials separate. Keep the command open while you complete the provider's browser flow. Claude accepts the browser's authorization code on stdin. Codex and GitHub display codes to enter in the browser.

```bash
docker exec -i --user box "$name" claude auth login
docker exec -i --user box "$name" codex login --device-auth
docker exec -i --user box "$name" env GH_BROWSER=true gh-setup-git-identity --web --skip-ssh-key
```

Use `claude auth status`, `codex login status` and `gh auth status --hostname github.com` with the same `docker exec` prefix. For the host account, run the provider commands directly. For remote sign-in from a workstation, `ssh -T hive-production 'docker exec -i --user box hive-mind claude auth login'` keeps Claude's stdin connected. For a provider that needs a terminal, open `docker exec -it --user box "$name" bash`, or add `ssh -t` when connecting remotely. If the Git identity helper is unavailable, run `gh auth login --hostname github.com --git-protocol https --scopes repo,workflow,user,read:org,gist --web` followed by `gh auth setup-git` and set your `git config --global user.name` and `user.email` to the account's chosen commit identity. Use [GitHub device activation](https://github.com/login/device) for the displayed code.

If Codex device code login is unavailable, its native fallbacks are browser login with a forwarded callback on a plain SSH host, or local browser login followed by copying the resulting credential cache to the target account's private Codex directory. In a container with the documented mounts, that cache belongs in `$state/codex`, readable by `box`. [Codex sign-in fallbacks](https://learn.chatgpt.com/docs/auth?surface=cli#login-on-headless-devices)

## Start the bot, update or roll back

Put the bot token and settings in a private `telegram.env` file. To use an existing LINO configuration instead, replace the `bot` array with `(--mount "type=bind,source=$PWD/telegram-manager.lino,target=/home/box/telegram-manager.lino,readonly" --env HIVE_MIND_CONFIGURATION_FILE=/home/box/telegram-manager.lino)`. Make it readable by `box`. See [Telegram configuration](../CONFIGURATION.md).

```bash
bot=(--env-file "$PWD/telegram.env")
docker pull "$image"
image_id=$(docker image inspect --format '{{.Id}}' "$image")
docker run --rm --pull never --network none --user box --entrypoint bash "$image_id" -ec '
  source_path=$(dirname "$(readlink -f "$(command -v hive)")")
  node "$source_path/verify-agent-runtime.mjs"
'
docker run --rm --pull never --network none --user box "${state_mounts[@]}" \
  "${bot[@]}" --entrypoint hive-telegram-bot "$image_id" --dry-run
docker create --pull never --name "$name.candidate" --restart unless-stopped --init --user box \
  "${state_mounts[@]}" "${runtime[@]}" "${bot[@]}" "$image_id" hive-telegram-bot
```

Proceed after both checks succeed and while no other rollout is running. Review the exact container IDs with `docker ps -a --format '{{.ID}} {{.Names}} {{.Status}}'`. With no earlier `.previous` container, stop the old instance, rename it to `$name.previous`, rename the candidate to `$name`, and start it.

```bash
docker stop "$name" &&
  docker rename "$name" "$name.previous" &&
  docker rename "$name.candidate" "$name" &&
  docker start "$name"
docker inspect --format '{{.State.Status}}{{if .State.Health}} {{.State.Health.Status}}{{end}}' "$name"
docker logs --tail 60 "$name"
```

Run the inspection again to confirm readiness. To undo the replacement after it reaches the active name, stop it, rename it to an unused name, then rename `$name.previous` back and start it. An interrupted update can leave a stopped `.candidate` and `.previous` with no active name. In that case return `.previous` to the active name and start it, or promote the validated candidate if you intend to finish the rollout. For a manager-created deployment, the last good container may be named `$name.rollback`. Confirm its ID before renaming. All replacements use the same state directory. Before removing a stopped rollback container, check its ID and confirm you no longer need it.

| Operation                                      | Native command                                                                                                                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status and logs                                | `docker inspect --format '{{.State.Status}}' "$name"` and `docker logs --follow --tail 60 "$name"`                                                                                                                      |
| Start, stop or restart                         | `docker start "$name"`, `docker stop "$name"` or `docker restart "$name"`                                                                                                                                               |
| Remove a stopped instance and keep bind mounts | `docker container rm "$name"`                                                                                                                                                                                           |
| Execute as the instance user                   | `docker exec -i --user box "$name" COMMAND ARG`                                                                                                                                                                         |
| Check disk and runtime                         | `df -h "$state"`, `docker version`, `docker system df -v`, and `docker exec --user box "$name" hive --version`                                                                                                          |
| Docker daemon status or start                  | `systemctl status docker.service` or `sudo systemctl start docker.service`                                                                                                                                              |
| Reboot a systemd host                          | `sudo systemctl reboot`                                                                                                                                                                                                 |
| Compose or Helm                                | `docker compose -f compose.yaml --env-file telegram.env up -d` or `helm upgrade --install hive-mind CHART -f values.yaml`. See the [chart guide](../../README.md#helm-installation-kubernetes-experimental) for values. |

## Back up, restore and diagnose

Stop the instance before taking a consistent backup of all its bind-mounted state. Capture the DinD volume or any custom mounts separately. Store the private archive outside the state directory and restore only a trusted archive into a new directory. Preserve ownership when restoring across systems with different users.

```bash
archive="$PWD/hive-mind-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
(umask 077; set -o noclobber; tar -czf - -C "$state" . > "$archive")
tar -tzf "$archive" >/dev/null

restore="$HOME/.hive-mind-restored"
(umask 077; mkdir -- "$restore" && tar -xzf "$archive" -C "$restore")
```

Use `docker stats --no-stream "$name"`, `docker inspect --format '{{.State.OOMKilled}} {{.State.ExitCode}} {{.State.StartedAt}} {{.State.FinishedAt}}' "$name"`, and `journalctl -u docker.service --since '1 hour ago' -n 80` and `journalctl -k --since '1 hour ago' -n 80` on the host. Use a task's start and finish times as the journal bounds for an incident. For an earlier boot, check `journalctl --list-boots` and select the matching boot with `-b`. In the container, inspect `/sys/fs/cgroup/memory.events`, `cpu.stat`, `pids.current` and the pressure files where available. Run `docker exec --user box "$name" ps -eLo pid,tid,stat,wchan:32,comm` and `docker exec --user box "$name" df -h /dev/shm` for threads and shared memory. For a selected PID, sample `/proc/PID/io` and `/proc/PID/syscall` in the container twice and compare the counters. With iproute2 and sufficient permissions, `ss -xnp` shows connected Unix stream socket queues in that process namespace.

Check daemon live restore with `docker info --format '{{.LiveRestoreEnabled}}'`. On a systemd host, as root, save a private copy of `/etc/docker/daemon.json` if present. Set `"live-restore": true` in a candidate copy, preserving other settings. Start from an empty JSON object if there is no file. Validate with `dockerd --config-file CANDIDATE --validate`, install it at the original path and run `systemctl reload docker.service`. Confirm `docker info --format '{{.LiveRestoreEnabled}}'` reports `true`. If it fails, restore the backup or remove the newly created file and reload again. [Docker live restore](https://docs.docker.com/engine/daemon/live-restore/)

## Maintenance and task operations

Run the original package executables on the host, or prefix commands with `docker exec -i --user box "$name"` to use the image. Add `-t` for an interactive Screen attachment.

| Manager command                                                                                                                                                  | Direct executable                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cleanup`                                                                                                                                                        | `hive-cleanup --dry-run`                                                                                                                                                                                            |
| `configure-claude`                                                                                                                                               | `configure-claude --verify`                                                                                                                                                                                         |
| `screens`                                                                                                                                                        | `hive-screens --list`                                                                                                                                                                                               |
| `models`                                                                                                                                                         | `hive-models --tool codex --json`                                                                                                                                                                                   |
| `close-linked-issues`                                                                                                                                            | `close-linked-issues --help`                                                                                                                                                                                        |
| `tasks list`, `status`, `attach`, `resume`, `resume-all`, `stop`, `terminate`, `pause`, `unpause`, `alias`, `rename`, `cleanup-dry-run`, `cleanup`, `upload-log` | Run the installed start-command executable `'$'` with the corresponding flag. For example, `'$' --status UUID`, `'$' --attach UUID --read-only`, or `'$' --cleanup-dry-run`. Use `'$' --help` for argument details. |

For `tasks backup-container` and `tasks cleanup-backed-up`, first identify an exited task with a nonzero exit code. Check its Docker labels against the execution ID and session in `'$' --status UUID --output-format json`. For older unlabeled containers, compare the exact Docker ID, session and exit code with the current record or a stored attempt. Back up bind mounts and volumes separately from the root filesystem.

```bash
task=FAILED_TASK_CONTAINER
backup="$PWD/failed-task-backup"
format='{{.Id}} {{.Name}} {{.State.Status}} {{.State.ExitCode}} {{.State.StartedAt}} {{.State.FinishedAt}}'
(
  set -eo pipefail
  umask 077
  mkdir -- "$backup"
  docker inspect --format "$format" "$task" > "$backup/identity"
  read -r id container status code rest < "$backup/identity"
  [ "$status" = exited ] && [ "$code" -ne 0 ] || exit 1
  docker export "$id" | gzip -n > "$backup/filesystem.tar.gz"
  tar -tzf "$backup/filesystem.tar.gz" >/dev/null
  (cd "$backup" && sha256sum identity filesystem.tar.gz > SHA256SUMS)
)
```

Before removal, review the archive and identity. Run `(cd "$backup" && sha256sum -c SHA256SUMS)` and `docker inspect --format "$format" EXACT_DOCKER_ID | diff - "$backup/identity"`. Only remove the verified stopped ID with `docker container rm EXACT_DOCKER_ID` after both checks succeed.

The following feature modules can run independently of the Bash launcher. From a checkout, set `source_path="$PWD/src"`. With a global package on Linux, set `source_path=$(dirname "$(readlink -f "$(command -v hive)")")`. If running inside Docker, resolve the path there. Use the same arguments as in the [manager guide](hive-manager.md#maintenance-and-diagnostics), including any review and apply flags. The `--import` preloads the same terminal credential filter used by the launcher.

```bash
node --import "$source_path/hive-manager/lib/terminal.mjs" "$source_path/hive-manager/audit-config.mjs" --help
```

| Manager command                                               | Module under `$source_path/hive-manager`                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `audit-config`                                                | `audit-config.mjs`                                                             |
| `tasks report` and its incident, collect and grouping options | `task/report.mjs`                                                              |
| `tasks check-browser`, `check-uploads`                        | `task/check-browser.mjs`, `task/check-uploads.mjs`                             |
| `tasks recover-failed`, `recover-queue`, `repair-records`     | `task/recover-failed.mjs`, `task/recover-queue.mjs`, `task/repair-records.mjs` |
| `archive-session`, `archive-sessions`, `archive-publish`      | `archive/session.mjs`, `archive/sessions.mjs`, `archive/publish.mjs`           |
| `proxy-test`, `proxy-pcap`                                    | `proxy/test.mjs`, `proxy/pcap.mjs`                                             |

## Telegram MTProto proxy

Use the same port and state directory as the deployment. This example uses classic MTProto. If you have an existing proxy, preserve its 32-hex-digit secret. If the secret has to be initialized, run `(umask 077; openssl rand -hex 16 > "$proxy_state/secret")` in a new state directory, or copy an approved existing secret there with mode `0600`.

```bash
port=443
proxy="$name-mtproxy-$port"
proxy_state="$state/mtproxy-$port"
proxy_image=mtproxy/mtproxy:latest
(umask 077; mkdir -p -- "$proxy_state")
# Initialize or import the secret before starting the proxy.
docker pull "$proxy_image"
docker run -d --name "$proxy" --restart unless-stopped --ulimit nofile=524288:524288 \
  --env WORKERS=4 --publish "$port:443" \
  --mount "type=bind,source=$proxy_state,target=/data" "$proxy_image"
```

Start an existing proxy with `docker start "$proxy"`. To update, pull the image, stop and rename the old container, then use the same `docker run` command. Keep the old container available until the new one passes the checks. Use `docker stop "$proxy"` and `docker rm "$proxy"` to stop and remove the container while keeping its secret. Inspect status and the restart policy with `docker inspect --format '{{.State.Status}} {{.HostConfig.RestartPolicy.Name}}' "$proxy"`, get the port with `docker port "$proxy" 443/tcp`, and view logs with `docker logs --tail 100 "$proxy"`.

- **Verify or connect**. Check outbound TCP from the proxy host with `nc -z -w 5 149.154.161.144 8888`, `nc -z -w 5 149.154.161.184 8888` and `nc -z -w 5 91.105.192.110 443`. From the client network, run `nc -z -w 5 proxy.example.org "$port"`, then test a real Telegram message and attachment over that route.
- **Capture**. Run `(umask 077; sudo timeout --preserve-status --signal=INT --kill-after=5 15 tcpdump -p -n -i any -s 96 -c 10000 -w - tcp port "$port" > proxy.pcap)`. Restrict to a client with `and host CLIENT_IP` where possible.
- **Snapshot and compare**. In a private file, record the Docker image ID, running status, restart policy and ulimits from `docker inspect`, worker count, published port from `docker port` and `sha256sum "$proxy_state/secret"`. Use `diff -u OLD NEW` to compare two snapshots. Select only the `WORKERS` environment key if reading worker count from Docker.
- **MSS clamp**. For a systemd-managed IPv4 clamp, use a oneshot unit tied to `docker.service`. For both `ORIGINAL` and `REPLY` directions, use `iptables -w -t mangle -C FORWARD -p tcp --tcp-flags SYN,RST SYN -m conntrack --ctstate DNAT --ctorigdstport "$port" --ctdir DIRECTION -j TCPMSS --set-mss 1200` to check each rule and replace `-C` with `-I` to install it if absent. Set `RemainAfterExit=yes` and remove each exact rule with `-D` when the unit stops. Review existing firewall management before enabling the service. [iptables TCPMSS](https://www.man7.org/linux/man-pages/man8/iptables-extensions.8.html)
- **Private connection link**. With the intended public DNS name in place of `proxy.example.org`, run `printf 'tg://proxy?server=proxy.example.org&port=%s&secret=dd%s\n' "$port" "$(< "$proxy_state/secret")"` in a private terminal.
