# Hive Mind Manager

`hive-manager` runs on a local deployment host, over SSH from a developer machine, and inside Hive Mind images. It ships with `@link-assistant/hive-mind`. To use a single copy without installing the package, download the script or stream it into Bash.

```bash
npm install -g @link-assistant/hive-mind
hive-manager --help

curl -fsSL https://raw.githubusercontent.com/link-assistant/hive-mind/main/src/hive-manager.sh | bash
curl -fsSL https://raw.githubusercontent.com/link-assistant/hive-mind/main/src/hive-manager.sh | bash -s -- deploy --help
```

For interactive commands, redirects, or repeated use, save the file and invoke it with Bash. Replace `main` with a release reference or commit SHA to pin the download. Bash and standard Linux utilities are enough for deployment preparation and local backup. Docker operations also require a local Docker Engine on the deployment host and permission to access it. Install Node.js and Hive Mind to run package maintenance commands on the host, or use `deploy` to run them inside the image. When a standalone maintenance command is missing locally and npm is available, the manager uses `npm exec` with the published package. Set `HIVE_MANAGER_PACKAGE_VERSION` to pin that fallback.

## First deployment

Prepare the persistent state and open a shell to authenticate. Supply your usual GitHub and provider login details inside the shell.

```bash
hive-manager deploy --setup apply
hive-manager deploy --tty exec -- bash
# In the container
gh-setup-git-identity
claude
codex login --device-auth
exit
```

For a Telegram instance, create a private environment file with `TELEGRAM_BOT_TOKEN` and the appropriate allowlist/settings, or use an existing private LINO configuration with `--bot-config`. The Docker environment file accepts literal `KEY=value` lines. Use the format documented in [Telegram Bot Configuration](../CONFIGURATION.md) for the LINO file. The bind-mounted LINO file needs to be readable by the image's `box` user while remaining private on the host.

```bash
hive-manager deploy --env-file ./telegram.env --dry-run apply
hive-manager deploy --env-file ./telegram.env apply
hive-manager deploy logs --follow --tail 60
```

Choose `--variant dind` for an instance with its own Docker daemon. It uses a privileged container and a dedicated `<name>-dind-data` Docker volume for nested Docker state. Plain deployments default to Screen isolation. To use the host Docker daemon, select `--docker-socket /var/run/docker.sock` instead. A host socket gives the instance control of the host daemon. The DinD variant can also use that option for host image passthrough while keeping its own nested daemon. See [Docker deployment options](../DOCKER.md) for isolation and storage details.

Use `--image IMAGE` to select a tag, digest or compatible custom image. `--no-pull` uses an already present image. To run a service other than the Telegram bot, pass its startup command as `apply -- COMMAND ARG...`. Prepare an image without interrupting a running deployment with `deploy prepare`.

## Profiles and remote use

Create one profile per deployment on the target. Values are literal. Relative paths are resolved against the profile's directory. Put CLI overrides after `--profile`. The default container name is `hive-mind` and its state directory is `~/.hive-mind` on the target. Set separate names and state paths for multiple instances.

```ini
name=hive-production
variant=dind
state-dir=./state
env-file=./telegram.env
```

Use ordinary OpenSSH configuration for keys, host verification, DNS, and routing. The manager sends its own Bash script and flags to the host. There is no manager installation required on a deployment host reached through SSH. The profile, state files, credentials and Docker service are all on the target. SSH options go before the command.

```bash
hive-manager --host hive-production deploy --profile ./hive/production.conf update
hive-manager --host deploy@hive.internal --jump gateway,edge-bastion deploy status
hive-manager --host hive-production --tty deploy --tty exec -- bash
```

Set `ProxyJump` on the destination alias, configure `ProxyCommand` for an SSH transport proxy, or use an already connected VPN. Use `--ssh-config`, `--ssh-port`, and repeated `--ssh-option` for OpenSSH options supplied on the command line. Pass `--tty` on both sides of `deploy` for interactive remote Docker exec. Omit both for pipes and file transfers. See [OpenSSH client configuration](https://man.openbsd.org/ssh_config).

## Updates and recovery

```bash
hive-manager deploy --profile ./production.conf doctor
hive-manager deploy --profile ./production.conf prepare
hive-manager deploy --profile ./production.conf update
hive-manager deploy --profile ./production.conf rollback
```

Keep the same profile for every update. The manager pulls and validates the selected image and checks Telegram configuration before stopping the previous container. It restores the previous container if startup fails and retains one stopped rollback container after a successful replacement. Readiness is based on the image health check when present and otherwise on the container staying running across consecutive checks. Inspect the running bot's logs for service-level problems. Rollback switches containers while keeping shared state as it exists at the time of rollback. Run `deploy recover` after an interrupted rollout. It handles containers left at the `.candidate` and `.previous` stages.

To bring an existing Docker deployment under management, identify its image variant, state mounts, configuration, and startup command. Back up its state and point the profile at the same state directory if it uses the documented `.hive-mind` layout. Copy any state stored only in the old container before replacing it. Import Git identity into the new instance with `gh-setup-git-identity` in its shell. Run `deploy --profile PROFILE --adopt --dry-run apply` to check the configuration and remove `--dry-run` to proceed. The manager records the original container ID for subsequent rollbacks and updates. Use Compose to preserve custom volumes or mounts.

## Maintenance and diagnostics

Each package operation is available locally and inside a managed deployment. Use the command's `--help` for its options.

| Purpose                   | Current shell                             | Managed instance                                 |
| ------------------------- | ----------------------------------------- | ------------------------------------------------ |
| Preview disk cleanup      | `hive-manager cleanup --dry-run`          | `hive-manager deploy cleanup --dry-run`          |
| Verify Claude settings    | `hive-manager configure-claude --verify`  | `hive-manager deploy configure-claude --verify`  |
| Audit agent settings      | `hive-manager audit-config`               | `hive-manager deploy audit-config`               |
| List Screen sessions      | `hive-manager screens --list`             | `hive-manager deploy screens --list`             |
| Inspect the model catalog | `hive-manager models --tool codex --json` | `hive-manager deploy models --tool codex --json` |
| Reconcile linked issues   | `hive-manager close-linked-issues --help` | `hive-manager deploy close-linked-issues --help` |
| Inspect task records      | `hive-manager tasks list --running`       | `hive-manager deploy tasks list --running`       |

`deploy status` summarizes the selected instance, `deploy logs` accepts Docker log options, and `deploy doctor` checks free space, Docker, and the package runtime. Use `deploy disk` for Docker storage details and `deploy diagnose` for resource usage, exit status and OOM information. `deploy start`, `stop` and `restart` manage the selected container. On systemd hosts, `deploy docker-service status` checks the host daemon and `deploy docker-service start` starts it. `deploy reboot --confirm` requests a systemd reboot of the host and requires host privileges. `audit-config --repair` applies Hive Mind's existing global agent settings repair and quarantines supported non-baseline additions.

`tasks status ID` reports one execution. `tasks report` tallies execution states and lists recent failures with exit and memory evidence in JSON. Use `tasks attach ID --read-only` to follow a live task, `tasks resume ID` to restart the stored execution, or `tasks resume-all` to reconcile running records and watchers. `tasks cleanup-dry-run [ID]` previews stale record or task container cleanup and `tasks cleanup [ID]` performs it. `tasks alias` and `tasks rename` manage task names. `tasks upload-log ID` invokes the sanitized upload workflow. The installed [start-command](https://github.com/link-foundation/start) version determines which actions and arguments are supported.

`tasks recover-failed` previews retries for confirmed memory-related failures. `--apply` rechecks the records and Docker state before resuming eligible tasks. The manager skips active executions, recorded retries, and failures superseded by a newer success in the same task family. `tasks check-uploads` samples same-user Linux upload and sanitization processes. The defaults flag processes at least 30 minutes old, averaging at least 80% of one CPU over three seconds, with no observed I/O progress. `--terminate PID` signals the selected process after rechecking its identity and progress.

Run `tasks repair-records [UUID]` when a detached Docker resume is running and its stored execution still shows an older terminal attempt. The preview checks the exact labels, start timestamp, snapshot and original command. Apply with `--apply` to adopt an eligible snapshot and attach a completion watcher. This repair uses the store format from the image's pinned start-command 0.44.0. Use `tasks resume-all` for records already marked executing.

`tasks report --incident UUID --attempt NUMBER --destination OWNER/REPO` previews an incident for one confirmed failure. The default attempt is the latest. Use `--publish REVIEW_DIGEST` after reviewing the JSON output to create the GitHub issue. The report contains the execution ID, times, backend, exit status and classification. Upload an execution log separately with `tasks upload-log ID` if needed.

After a Telegram bot restart, save the previous and current verbose logs locally. Use `deploy logs --timestamps` with `--until` and `--since` around the restart. Run `tasks recover-queue --previous previous.log --current current.log` to list requests from the last pre-restart run that never reached launch, excluding requests the current run already queued or began launching. Both files need their queue initialization line. `--include-commands` includes matching raw Telegram text for local review when available. Review dependency-based requests before submitting them again.

On a Linux Docker host, `deploy docker-service live-restore` checks whether the local daemon keeps containers running when the daemon is unavailable. Run it with `--apply` as root on a systemd host with `jq` and `flock`. The command validates and backs up `/etc/docker/daemon.json`, reloads `docker.service`, and checks the running daemon. It restores the previous file if the setting fails to take effect. [Docker live restore](https://docs.docker.com/engine/daemon/live-restore/)

Use `deploy diagnose --since '1 hour ago'` to include bounded Docker service and kernel memory-failure history where the target account can read the systemd journal. The journal remains available when the managed container or its daemon is down.

`archive-session FILE` writes a sanitized local copy to stdout. `archive-sessions --repo OWNER/REPO --output NEW_DIRECTORY` discovers inactive Claude and Codex sessions, verifies the repository is public, and stages sanitized files and a manifest. It uses Codex session metadata and Claude checkout origins to attribute sessions. The default export limit is 20 and individual files are capped at 40 MiB. Add `--lino` with the [Conversation CLI](https://github.com/link-assistant/conversation/tree/e548823507862f237ce58cb2915bf336f29a725c) installed to add Links Notation copies. Session files can include personal or proprietary material. Review the staged files before publishing.

Use `--tool-results` to include sanitized Claude attachments associated with the staged transcripts. This selects inactive, regular `.txt`, `.log`, `.json`, and `.jsonl` files up to 4 MiB each, with a shared limit of 100 attachments or 40 MiB of input per export.

```bash
( umask 077; hive-manager --host hive-production deploy archive-session /home/box/.claude/projects/example/session.jsonl > session.redacted.jsonl )
hive-manager archive-sessions --repo link-assistant/hive-mind --output ./session-review --tool-results
```

`archive-publish` lists the exact files to be committed and returns a review digest tied to the destination's visibility and default branch. After reviewing every file, pass the digest with `--apply` to publish one normal Git commit. The destination must already contain a default branch and allow your configured Git identity and credentials to push to it. The manager rechecks source visibility and scans the reviewed files before pushing. It redacts recognizable identity-document details while staging and excludes the repository identified in the Control Center's known data exposure. Each publication accepts up to 256 MiB total and 64 MiB per file.

```bash
hive-manager archive-publish ./session-review --destination example/session-archive
hive-manager archive-publish ./session-review --destination example/session-archive --apply REVIEW_DIGEST
```

## Backup and restore

Stop the instance first if an application-consistent snapshot is needed. Run backup with permission to read the state files. Files can be owned by the container user.

```bash
hive-manager deploy --profile ./production.conf backup --output ./hive-state.tar.gz
hive-manager deploy --state-dir ./restored-state restore --input ./hive-state.tar.gz

( umask 077; hive-manager --host hive-production deploy --profile ./hive/production.conf backup --output - > hive-state.tar.gz )
hive-manager --host replacement deploy --state-dir ./restored-state restore < hive-state.tar.gz
```

The backup is a private archive of the state directory. Keep configuration inside that directory if it should be included, and preserve separate files and Docker volumes independently. The state directory includes Claude, Codex, Agent skills, Git, GitHub CLI, Hive Mind session state, and start-command records and logs. Archives can contain credentials. Restore a trusted archive into a new directory and ensure its files are accessible by the `box` user before applying the profile.

## Telegram MTProto proxy

The classic proxy can run independently of the bot. `apply` creates or starts it, `update` replaces it, and `remove` keeps its data and secret. An existing proxy can be adopted by matching `--proxy-name` and importing its 32-digit hex secret from a private `--secret-file`. Use `link` only when you need to share the secret-bearing link.

```bash
hive-manager --host hive-production deploy proxy --port 8443 apply
hive-manager --host hive-production deploy proxy --port 8443 status
hive-manager --host hive-production deploy proxy --port 8443 verify
hive-manager deploy proxy --port 8443 --public-host proxy.example.net connect
hive-manager --host hive-production deploy proxy --port 8443 --public-host proxy.example.net link
```

`verify` checks Docker status and outbound TCP reachability from the proxy host to Telegram data centers. `connect` checks the TCP route from the process running the command. `snapshot` records the running configuration, including the published ports, workers, and a hash of the secret. Use `compare` with a baseline file on the deployment host or pass `-` to read it over SSH.

```bash
hive-manager --host hive-production deploy proxy snapshot > proxy.baseline
hive-manager --host hive-production deploy proxy compare - < proxy.baseline
```

Run `proxy-test` on the affected client network with a pre-authorized Telegram StringSession and private API credentials. The probe uses the session's Saved Messages, verifies a text round trip, and deletes its test messages. `--media` adds a byte-for-byte document round trip. `--photo FILE` adds a JPEG or PNG upload and download. Use `--direct` to run the same checks against Telegram without the proxy.

```bash
hive-manager proxy-test --credentials ./telegram-api.json --session-file ./telegram.session \
  --proxy-host proxy.example.net --proxy-port 8443 --secret-file ./mtproxy.secret \
  --media --photo ./probe.png
```

For comparison on the same network, pass `--matrix routes.json` instead of the single-route options. The manager runs the selected tests sequentially for every profile and reports each result. Start proxy candidates ahead of time on distinct ports, and store each secret in a file next to the matrix. The matrix can include an existing FakeTLS proxy with its hexadecimal secret.

```json
[
  { "name": "direct", "direct": true },
  { "name": "baseline", "host": "proxy.example.net", "port": 443, "secretFile": "baseline.secret" },
  { "name": "candidate", "host": "proxy.example.net", "port": 8443, "secretFile": "candidate.secret" }
]
```

If packet-level evidence is needed, stream a bounded `capture` from a host where the account can run `tcpdump`. Collect the client and server files on their external interfaces during the same probe window. `proxy-pcap` reads classic pcap files, summarizes unfragmented TCP traffic matching the published port and compares bytes observed on both sides. Repeat counts and gaps are diagnostic indicators. Capture loss and interface offloading can affect the measurements.

```bash
( umask 077; hive-manager --host hive-production deploy proxy --port 8443 --interface eth0 --seconds 15 --client-ip 192.0.2.12 capture > server.pcap )
hive-manager proxy-pcap --port 8443 client.pcap server.pcap
```

For an IPv4 path where measurements identify an MSS problem, `proxy --port 8443 --mss 1200 mss-unit` generates an optional systemd unit for review and installation on an iptables-based Docker host. Its rules match Docker DNAT by the original published port, in both directions.

## Compose and Helm

Existing Compose stacks and Helm releases can use the same SSH transport and manager entry point.

```bash
hive-manager --host hive-production deploy compose --env-file ./hive/stack.env -f ./hive/compose.yml up -d
hive-manager --host cluster-admin deploy helm list --all-namespaces
```

These commands use the target's Docker Compose files and Kubernetes configuration. See the [Docker guide](../DOCKER.md) and [Helm installation guide](../../README.md#helm-installation-kubernetes-experimental) for the corresponding deployment options.
