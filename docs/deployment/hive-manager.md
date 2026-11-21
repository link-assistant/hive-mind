# Hive Mind Manager

`hive-manager` runs on a local deployment host, over SSH from a developer machine, and inside Hive Mind images. It ships with `@link-assistant/hive-mind`. To use a single copy without installing the package, download the script or stream it into Bash.

```bash
npm install -g @link-assistant/hive-mind
hive-manager --help

curl -fsSL https://raw.githubusercontent.com/link-assistant/hive-mind/main/src/hive-manager/cli.sh | bash
curl -fsSL https://raw.githubusercontent.com/link-assistant/hive-mind/main/src/hive-manager/cli.sh | bash -s -- deploy --help
```

For interactive commands, redirects, or repeated use, save the file and invoke it with Bash. Replace `main` with a release reference or commit SHA to pin the download. Bash and standard Linux utilities are enough for deployment preparation and local backup. Docker operations also require a local Docker Engine on the deployment host and permission to access it. Install Node.js and Hive Mind to run package maintenance commands on the host, or use `deploy` to run them inside the image. When a standalone maintenance command is missing locally and npm is available, the manager uses `npm exec` with the published package. Set `HIVE_MANAGER_PACKAGE_VERSION` to pin that fallback.

## First deployment

Prepare the persistent state and start the setup container. Run each sign-in separately so it can use your terminal.

```bash
hive-manager deploy --setup apply
hive-manager deploy auth github
hive-manager deploy auth claude
hive-manager deploy auth codex
```

For a setup-only invocation on a Docker host, run `curl -fsSL https://raw.githubusercontent.com/link-assistant/hive-mind/main/src/hive-manager/cli.sh | bash -s -- deploy --setup apply`. Install with npm or Bun, or save the Bash script, before signing in so the command can read your response from stdin.

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

## Headless sign-in

Use `auth` for the current account on the selected host and `deploy auth` for the container's `box` account. Sign-in uses the selected environment's Claude, Codex or GitHub CLI. The GitHub flow also requires `gh-setup-git-identity`. Hive Mind images include these tools. For a managed deployment, select the same profile or container name you use for updates so credentials persist in its state mounts. The sign-in commands work over SSH with ordinary stdin and stdout, including through jump hosts.

```bash
hive-manager --host hive-production deploy --profile ./hive/production.conf auth claude
hive-manager --host hive-production deploy --profile ./hive/production.conf auth codex
hive-manager --host hive-production deploy --profile ./hive/production.conf auth github
hive-manager --host hive-production deploy --profile ./hive/production.conf auth claude status
```

- **Claude**. Open the authorization URL in your browser. Paste the authorization code from the browser into the running command and press Enter when prompted.
- **Codex**. Enable device code sign-in in your ChatGPT security settings or workspace permissions. Open the supplied URL and enter the displayed code in your browser. The command waits for approval. [Codex authentication](https://learn.chatgpt.com/docs/auth?surface=cli#login-on-headless-devices)
- **GitHub**. Enter the displayed one-time code at [GitHub device activation](https://github.com/login/device). The command also sets up the Git identity and HTTPS credentials in the target environment.

Append `status` to any sign-in command to check the selected environment. Use a private terminal when working with one-time codes. For provider-native commands and deployments without the manager, see the [manual operations guide](hive-manager-manual.md).

## Updates and recovery

```bash
hive-manager deploy --profile ./production.conf doctor
hive-manager deploy --profile ./production.conf prepare
hive-manager deploy --profile ./production.conf update
hive-manager deploy --profile ./production.conf rollback
```

Keep the same profile for every update. The manager pulls and validates the selected image and checks Telegram configuration before stopping the previous container. It restores the previous container if startup fails and retains one stopped rollback container after a successful replacement. Readiness is based on the image health check when present and otherwise on the container staying running across consecutive checks. Inspect the running bot's logs for service-level problems. Rollback switches containers while keeping shared state as it exists at the time of rollback. Run `deploy recover` after an interrupted rollout. It handles containers left at the `.candidate` and `.previous` stages.

To bring an existing Docker deployment under management, identify its image variant, state mounts, configuration, and startup command. Back up its state and point the profile at the same state directory if it uses the documented `.hive-mind` layout. Copy any state stored only in the old container before replacing it. Run `hive-manager deploy --profile PROFILE --adopt --dry-run apply` to check the configuration and remove `--dry-run` to proceed. The manager records the original container ID for subsequent rollbacks and updates. Set up GitHub credentials with `hive-manager deploy --profile PROFILE auth github` if they need to be recreated. Use Compose to preserve custom volumes or mounts.

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

`deploy status` summarizes the selected instance, `deploy logs` accepts Docker log options, and `deploy doctor` checks free space, Docker, and the package runtime. Use `deploy disk` for bounded host and task storage accounting and `deploy diagnose` for resource usage, exit status and OOM information. `deploy start`, `stop` and `restart` manage the selected container. On systemd hosts, `deploy docker-service status` checks the host daemon and `deploy docker-service start` starts it. `deploy reboot --confirm` requests a systemd reboot of the host and requires host privileges. `audit-config --repair` applies Hive Mind's existing global agent settings repair and quarantines supported non-baseline additions.

`tasks status ID` reports one execution. `tasks report` tallies execution states and lists recent failures with exit and memory evidence in JSON. Use `tasks attach ID --read-only` to follow a live task, `tasks resume ID` to restart the stored execution, or `tasks resume-all` to reconcile running records and watchers. `tasks cleanup-dry-run [ID]` previews stale record or task container cleanup and `tasks cleanup [ID]` performs it. `tasks alias` and `tasks rename` manage task names. `tasks upload-log ID` invokes the sanitized upload workflow. The installed [start-command](https://github.com/link-foundation/start) version determines which actions and arguments are supported.

To preserve a failed Docker task before removing its container, run `tasks backup-container CONTAINER --output NEW_DIRECTORY`, then preview removal with `tasks cleanup-backed-up NEW_DIRECTORY`. Supply `--apply SHA256` with the preview’s approval digest to remove the exact stopped container after rechecking the backup checksum and container identity. For an older container without task labels, add `--execution UUID` to the backup command. The manager checks that the stored Docker task recorded the same container, session and exit code. With `deploy tasks`, choose a directory on a persistent mount with enough free space. The private backup is a flattened Docker filesystem export. Inspect it with `tar -tzf NEW_DIRECTORY/filesystem.tar.gz`. Preserve mounted data and task logs separately. [Docker export](https://docs.docker.com/reference/cli/docker/container/export/)

### Host storage reporting and cleanup

`hive-manager deploy disk` reports filesystem capacity and inodes, Docker images and volumes, selected daemon metadata and host directories, and individual writable layers and Docker logs. It includes paused and stopped tasks. Pass `--name` and the deployment profile before `disk` to match Docker containers to the bot's saved start-command records and issue or pull request URLs. The report reads the execution store directly, with a 16 MiB read limit. Use `--budget SECONDS` to set the total measurement budget (60 seconds by default, up to 180). The JSON lists unavailable measurements as `null` and explains them in `issues`. Run on the Linux daemon host with read access to its storage for layer and volume measurements. Use `disk --docker-summary` for Docker's separate verbose storage walk.

Run scoped cleanup as root on the Linux daemon host. It uses Node.js 24+, a local Docker Unix socket and `flock`. A task needs Node.js 24+, a verified overlay writable layer, and a verifiable cgroup v2 freezer for removal. The worker verifies the pinned disk-space-saviour archive before scanning and does one scope at a time.

```sh
hive-manager deploy cleanup --scoped --dry-run
hive-manager deploy cleanup --scoped --status
hive-manager deploy cleanup --scoped --apply PREVIEW_ID
hive-manager deploy cleanup --scoped --status
```

The default is a preview. Review the completed status and the recorded `previewFile` before applying. Apply rescans and considers only approved files that still match the preview. It skips paused and stopped tasks, mounted data, Docker and containerd storage, active files detected by the scanner, and files that only exist in the image. It leaves directory ownership intact. The host worker holds a lock and records status under `/var/lib/hive-manager/scoped-cleanup`. Reconnect and check `--status` after an SSH interruption. A pressure stop, interrupted worker, or partial apply requires a fresh preview. Limits include 1,536 MiB of available host memory, 2,560 MiB maximum Docker daemon RSS, and 256 MiB of headroom in a bounded worker or daemon cgroup. Inspect each scope's outcome in the status before relying on its estimates.

### Failed task preservation

For stopped overlay task containers on the daemon host, use `hive-manager deploy tasks preserve-layer CONTAINER --output NEW_DIRECTORY` as root. Supply `--execution UUID` for an older unlabelled container. The private receipt covers the native writable-layer tar with numeric owners, modes, ACLs and extended attributes, original container facts, the matching start-command record and task log, and retained Docker stdout and stderr. Save mounted data independently using the mount inventory in `container.json`. Keep the original image if you need to interpret the layer over its base filesystem. A layer archive can contain whiteouts and overlay metadata. It needs an overlay-aware restore procedure.

Run `hive-manager deploy tasks cleanup-preserved NEW_DIRECTORY` to verify the stored files and check the live container identity. Pass `--apply SHA256` with the preview's approval digest to remove only that stopped container. Use `tasks backup-container` when you need a flattened filesystem export.

`tasks recover-failed` previews retries for confirmed memory-related failures. `--apply` rechecks the records and Docker state before resuming eligible tasks. The manager skips active executions, recorded retries, and failures superseded by a newer success in the same task family. Add `--wait SECONDS` to track the launched attempts and report their exit codes. A failed or unfinished retry makes the command exit nonzero. `tasks check-uploads` samples same-user Linux upload and sanitization processes. The defaults flag processes at least 30 minutes old, averaging at least 80% of one CPU over three seconds, with no observed I/O progress. `--terminate PID` signals the selected process after rechecking its identity and progress.

Run `tasks repair-records [UUID]` when a detached Docker resume is running and its stored execution still shows an older terminal attempt. The preview checks the exact labels, start timestamp, snapshot and original command. Apply with `--apply` to adopt an eligible snapshot and attach a completion watcher. This repair uses the store format from the image's pinned start-command 0.44.0. Use `tasks resume-all` for records already marked executing.

`tasks report --group` counts recurring failures across recorded attempts, including failures from tasks that later succeeded. It groups by execution backend, failure classification and exit code. `tasks report --incident UUID --attempt NUMBER --destination OWNER/REPO` previews an incident for one confirmed failure. The default attempt is the latest. Add `--follow-up ISSUE_NUMBER` when the failure belongs on an existing open issue. Use `--publish REVIEW_DIGEST` after reviewing the JSON output to create the issue or post the approved comment. The report contains the execution ID, times, backend, exit status and classification. Upload an execution log separately with `tasks upload-log ID` if needed.

`tasks report --collect UUID [--attempt NUMBER]` inspects up to 4 MiB of the selected attempt's log. It reports short success runs, retry and reconnection counts, and repeated commands, MCP calls or messages. The result contains counts and classifications without raw log lines. Historical collection needs stored log offsets to distinguish one attempt from the next.

For repeat failures, use `--routes /path/to/routes.json` in place of `--follow-up`. The file is read in the environment that runs the command, so put it inside the container when using `deploy tasks`. Copy the `backend`, `kind` and `exitCode` values from `tasks report --group` and add the open issue number in the selected destination repository.

```json
[{ "backend": "docker", "kind": "Memory exhaustion", "exitCode": 137, "issue": 318 }]
```

A matching failure previews a comment for the configured issue. An unmatched failure previews a new issue. An optional `signature` from `--collect`, such as `codex-oom` or `stream-close-timeout`, takes precedence over a group-only match. For a signal-range Docker exit, add `--host-signature NAME` after reviewing the corresponding attempt's journal correlation on the Docker host. The report includes the selected correlation and can route by that signature. Changes to the selected issue or its preview evidence after review invalidate the digest.

After a Telegram bot restart, save the previous and current verbose logs locally. Use `deploy logs --timestamps` with `--until` and `--since` around the restart. Run `tasks recover-queue --previous previous.log --current current.log` to list requests from the last pre-restart run that never reached launch, excluding requests the current run already queued or began launching. Both files need their queue initialization line. `--include-commands` includes matching raw Telegram text for local review when available. Review dependency-based requests before submitting them again.

On a Linux Docker host, `deploy docker-service live-restore` checks whether the local daemon keeps containers running when the daemon is unavailable. Run it with `--apply` as root on a systemd host with `jq` and `flock`. The command validates and backs up `/etc/docker/daemon.json`, reloads `docker.service`, and checks the running daemon. It restores the previous file if the setting fails to take effect. [Docker live restore](https://docs.docker.com/engine/daemon/live-restore/)

Use `deploy diagnose --since '1 hour ago'` to include bounded Docker service and kernel memory-failure history where the target account can read the systemd journal. The journal remains available when the managed container or its daemon is down. Use `deploy diagnose --task UUID --attempt NUMBER` on a running instance to use the selected task's recorded time window for both journal queries. The results show events overlapping the task, with up to 80 records per query. Near a completed attempt's exit, the command correlates a recorded Docker stop and start as `daemon-restart`. With `jq` and a retained journal from the previous boot, it can identify a `host-reboot` when shutdown is recorded or a possible `host-reset` when the journal ends abruptly. Review the events and the completeness of the journal before using a correlation in an incident. On a running Linux instance, `deploy diagnose --resources` adds cgroup v2 memory, CPU, pressure and PID counters, thread wait channels, a bounded browser process table, and shared-memory usage where the Docker host exposes them.

To inspect a blocked browser or agent process, get its container PID with `deploy exec -- ps -eo pid,comm` and run `deploy diagnose --process PID`. The command samples read and write byte and operation counters, the current syscall number and queued bytes for connected Unix stream sockets at both ends of the sample. It runs as `box` within the selected container. Socket queue sampling uses the Linux kernel diagnostic interface through Python 3. The command identifies readings that the kernel or container makes unavailable. For a separate Docker task container, select that container with `deploy --name TASK_CONTAINER diagnose --process PID`.

Run `tasks check-browser PID` as the browser's user in the same Linux process namespace to sample a headless Chromium tree. For a task container on the selected Docker daemon, use `deploy --name TASK_CONTAINER tasks check-browser PID`. To inspect a child of a Docker-in-Docker deployment, use `deploy exec -- docker exec --user box TASK_CONTAINER hive-manager tasks check-browser PID`. Add `--transcript SESSION.jsonl` to check the corresponding Claude session for an idle, CPU-intensive Playwright browser, including recent calls from subagents. Approval requires complete, bounded transcripts. `--detached` checks whether init adopted the browser. Review the reported activity and pass `--terminate sha256:HEX` with the approval shown for the selected browser. The manager samples again and sends SIGTERM when the process and evidence still match. Closing an idle browser discards its open page.

Packaged maintenance commands use Hive Mind's terminal credential filter. Operations such as `deploy logs`, `deploy exec`, and backup streams carry the underlying service output, so review that output before sharing it.

`archive-session FILE` writes a sanitized local copy to stdout. `archive-sessions --repo OWNER/REPO --output NEW_DIRECTORY` discovers inactive Claude and Codex sessions, verifies the repository is public, and stages sanitized files and a manifest. It uses Codex session metadata and Claude checkout origins to attribute sessions. A Claude subagent without its own working directory inherits its parent’s repository. Use `--only claude` or `--only codex` to export one format. The default export limit is 20. Use `--min-age MINUTES` to carry over the scheduler's idle threshold for transcripts and attachments. The default is 10 minutes since modification. Set a shorter threshold only when the operator can ensure the session has ended. The manager reports attributed inactive transcripts above 40 MiB by tool on stderr and in `manifest.json` under `omissions.oversized`, including when the export is empty. Those transcripts need a separate reviewed export. Add `--lino` with the [Conversation CLI](https://github.com/link-assistant/conversation/tree/e548823507862f237ce58cb2915bf336f29a725c) installed to add Links Notation copies. Session files can include personal or proprietary material. Review the staged files before publishing.

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

To create a destination with an initial branch and README, run `hive-manager archive-publish --initialize --destination example/session-archive --visibility private` with GitHub CLI credentials that can create repositories. Choose `public` or `internal` explicitly when required.

Use `archive-sessions --published-in example/session-archive` when working through a backlog or staging batches on a schedule. The manager reads the destination's Git index for this source without downloading existing session logs. It skips an already published transcript revision with the same export options and selected attachments, so the next batch can advance through the backlog. A changed transcript or attachment is eligible again. The Git commit publishes the revision index and its reviewed archive together.

For a scheduler such as cron or a systemd timer, use `archive-sessions --repo example/project --publish-private example/session-archive`. It stages a batch of up to three new revisions by default, scans them for residual credentials and identity data, verifies that the destination remains private before pushing, then removes the temporary files. Run it as the account that owns the session directories and has Git and GitHub access to the destination. Use a separate scheduled invocation for each source repository you intend to archive. Existing archive files stay in place when using an existing destination. The manager counts revisions published through its own index.

Pass `--known-secrets-file /path/to/private-literals.txt` to `archive-sessions` for source-specific redactions. Carry over the literals configured for that source in the scheduler and keep the file outside the archive, readable only by the scheduler account. Use one UTF-8 literal per line. Surrounding whitespace and blank lines are ignored, and regex characters match literally. The same literal set is required for `archive-publish` preview and apply of a staged batch that uses it. Both reviewed and scheduled publication require a private destination when extra literals are supplied. A match anywhere in the final artifacts, including a converted file, blocks publication.

### Import an existing private archive

Pause the archive scheduler and record the current destination commit. Run the import with the same source roots, `--only`, `--lino`, `--tool-results`, `--min-age` and `--known-secrets-file` settings you intend to use for the incremental export. For example:

```bash
hive-manager archive-sessions --repo example/project --import-legacy example/session-archive --lino --known-secrets-file /path/to/private-literals.txt
hive-manager archive-sessions --repo example/project --import-legacy example/session-archive --lino --known-secrets-file /path/to/private-literals.txt --apply REVIEW_DIGEST
hive-manager archive-sessions --repo example/project --published-in example/session-archive --output ./first-increment --lino --known-secrets-file /path/to/private-literals.txt
hive-manager archive-publish ./first-increment --destination example/session-archive --private --known-secrets-file /path/to/private-literals.txt
```

The import preview lists the matched legacy metadata and corresponding revision markers, skipped candidates by reason, and the destination commit bound to the review digest. Inspect the listed legacy output before approving it as the baseline. The import verifies the transcript SHA-256 against the inactive source, checks the declared archived files and their checksums, and verifies that the requested Links Notation and attachment choices match the available evidence. Each selected Claude attachment needs its own matching source hash and archived file. Split artifacts, missing or changed evidence, ambiguous attachment policies, and archived artifacts containing configured literals remain eligible for a fresh export under the selected options and size limit. Changing the Links Notation option, attachment selection, or extra literals produces a distinct revision. Use `--limit` to bound each import, and repeat preview and apply until the eligible index batch is empty.

Apply adds only revision markers in a normal Git commit on the existing private branch. If the destination or plan changed, generate a fresh preview. Review and apply the first incremental batch with `archive-publish --private` before resuming the scheduler. Keep the archive private because its history remains intact. To roll back an import, pause the scheduler and revert the import commit on the existing branch. The manager preserves the legacy README as a historical inventory. New batches record their inventory in their own `manifest.json`, and deployments that need a regenerated overview can build it from those manifests alongside the historical README.

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
