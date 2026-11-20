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

Keep the same profile for every update. The manager pulls and validates the selected image and checks Telegram configuration before stopping the previous container. It restores the previous container if startup fails and retains one stopped rollback container after a successful replacement. Readiness is based on the image health check when present and otherwise on the container staying running across consecutive checks. Inspect the running bot's logs for service-level problems. Rollback switches containers while keeping shared state as it exists at the time of rollback. If a rollout was interrupted and left a `.previous` container, run `deploy recover`.

To bring an existing Docker deployment under management, first identify its image variant, state mounts, configuration, and exact startup command. Back up that state and set the matching options in the profile. Import Git identity into the new instance with `gh-setup-git-identity` in its shell. Run `deploy --profile PROFILE --adopt --dry-run apply` to check the planned configuration and remove `--dry-run` to proceed. Preserve any existing named volumes or mounts beyond the default state paths with Compose.

## Maintenance and diagnostics

Each package operation is available locally and inside a managed deployment. Use the command's `--help` for its options.

| Purpose                   | Current shell                             | Managed instance                                 |
| ------------------------- | ----------------------------------------- | ------------------------------------------------ |
| Preview disk cleanup      | `hive-manager cleanup --dry-run`          | `hive-manager deploy cleanup --dry-run`          |
| Verify Claude settings    | `hive-manager configure-claude --verify`  | `hive-manager deploy configure-claude --verify`  |
| List Screen sessions      | `hive-manager screens --list`             | `hive-manager deploy screens --list`             |
| Inspect the model catalog | `hive-manager models --tool codex --json` | `hive-manager deploy models --tool codex --json` |
| Reconcile linked issues   | `hive-manager close-linked-issues --help` | `hive-manager deploy close-linked-issues --help` |
| Inspect task records      | `hive-manager tasks list --running`       | `hive-manager deploy tasks list --running`       |

`deploy status` summarizes the selected instance, `deploy logs` accepts Docker log options, and `deploy doctor` checks free space, Docker, and the package runtime. Use `deploy disk` for Docker storage details. `deploy start`, `stop` and `restart` manage the selected container. `deploy reboot --confirm` requests a systemd reboot of the host and requires host privileges.

`tasks status ID` reports one execution. Use `tasks attach ID --read-only` to follow a live task, `tasks resume ID` to restart the stored execution, or `tasks resume-all` to reconcile running records and watchers. Supported actions depend on the installed [start-command](https://github.com/link-foundation/start) version. `tasks upload-log ID` invokes its upload workflow. `archive-session FILE` writes a sanitized local copy to stdout for review. Session contents can include personal or proprietary material. Review the exported file before publishing it and choose the destination explicitly.

```bash
( umask 077; hive-manager --host hive-production deploy archive-session /home/box/.claude/projects/example/session.jsonl > session.redacted.jsonl )
```

## Backup and restore

Stop the instance first if an application-consistent snapshot is needed. Run backup with permission to read the state files. Files can be owned by the container user.

```bash
hive-manager deploy --profile ./production.conf backup --output ./hive-state.tar.gz
hive-manager deploy --state-dir ./restored-state restore --input ./hive-state.tar.gz

( umask 077; hive-manager --host hive-production deploy --profile ./hive/production.conf backup --output - > hive-state.tar.gz )
hive-manager --host replacement deploy --state-dir ./restored-state restore < hive-state.tar.gz
```

The backup is a private archive of the state directory. Keep configuration inside that directory if it should be included, and preserve separate files and Docker volumes independently. The state directory includes Claude, Codex, Agent skills, Git, GitHub CLI, Hive Mind session state and start-command records. Archives can contain credentials. Restore a trusted archive into a new directory and ensure its files are accessible by the `box` user before applying the profile.

## Telegram MTProto proxy

The classic proxy can run independently of the bot. `apply` creates or starts it, `update` replaces it, and `remove` keeps its data and secret. An existing proxy can be adopted by matching `--proxy-name` and importing its 32-digit hex secret from a private `--secret-file`. Use `link` only when you need to share the secret-bearing link.

```bash
hive-manager --host hive-production deploy proxy --port 8443 apply
hive-manager --host hive-production deploy proxy --port 8443 status
hive-manager --host hive-production deploy proxy --port 8443 verify
hive-manager deploy proxy --port 8443 --public-host proxy.example.net connect
hive-manager --host hive-production deploy proxy --port 8443 --public-host proxy.example.net link
```

`verify` checks Docker status and outbound TCP reachability from the proxy host to Telegram data centers. `connect` checks the TCP route from the process running the command. Use Telegram itself to verify authenticated messaging and media over that route. For an IPv4 path where measurements identify an MSS problem, `proxy --port 8443 --mss 1200 mss-unit` generates an optional systemd unit for review and installation on an iptables-based Docker host. Its rules match Docker DNAT by the original published port, in both directions.

## Compose and Helm

Existing Compose stacks and Helm releases can use the same SSH transport and manager entry point.

```bash
hive-manager --host hive-production deploy compose --env-file ./hive/stack.env -f ./hive/compose.yml up -d
hive-manager --host cluster-admin deploy helm list --all-namespaces
```

These commands use the target's Docker Compose files and Kubernetes configuration. See the [Docker guide](../DOCKER.md) and [Helm installation guide](../../README.md#helm-installation-kubernetes-experimental) for the corresponding deployment options.
