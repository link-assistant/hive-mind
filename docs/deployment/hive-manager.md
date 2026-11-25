# Hive Mind Manager

`hive-manager` runs on a local deployment host, over SSH from a developer machine, and inside Hive Mind images. It ships with `@link-assistant/hive-mind`. To use a single copy without installing the package, download the script or stream it into Bash.

```bash
npm install -g @link-assistant/hive-mind
hive-manager --help

curl -fsSL https://raw.githubusercontent.com/link-assistant/hive-mind/main/src/hive-manager/cli.sh | bash
curl -fsSL https://raw.githubusercontent.com/link-assistant/hive-mind/main/src/hive-manager/cli.sh | bash -s -- deploy --help
```

For interactive commands, redirects, or repeated use, save the file and invoke it with Bash. Replace `main` with a release reference or commit SHA to pin the download. Bash and standard Linux utilities are enough for deployment preparation and basic `deploy backup`. Docker operations also require a local Docker Engine on the deployment host and permission to access it. Packaged maintenance on the host requires Node.js and a Hive Mind installation or npm. See [Pinning the CLI, host package, and image](#pinning-the-cli-host-package-and-image).

## JavaScript library

Install `@link-assistant/hive-mind` in your project and import the public `@link-assistant/hive-mind/hive-manager` entry point from Node.js 24 or later. The package includes TypeScript declarations. Importing the entry point runs no commands, writes no files, and produces no output.

```js
import { HiveManagerError, previewTaskRecordRepair } from '@link-assistant/hive-mind/hive-manager';

try {
  const preview = await previewTaskRecordRepair({
    uuids: ['40950000-1111-4000-8000-000000000001'],
  });
  console.log(preview.outcomes);
} catch (error) {
  if (!(error instanceof HiveManagerError)) throw error;
  console.error(error.code, error.message);
}
```

| Function                                        | Data and result                                                                                                                                                                                       | CLI equivalent                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `inspectTasks(tasks, { limit })`                | Counts tasks by state and summarizes recent failures from an array of start-command execution records.                                                                                                | `tasks report [--limit NUMBER]`  |
| `groupTaskFailures(tasks, { limit })`           | Groups failed attempts by backend, failure kind and exit code. Both report functions default to 25 results and accept limits from 1 to 1000.                                                          | `tasks report --group`           |
| `inspectTaskWindow(tasks, { uuid, attempt })`   | Returns `startedAt` and `finishedAt` in UTC. A running attempt has a `null` finish time.                                                                                                              | `tasks report --window UUID`     |
| `collectTaskEvidence(tasks, { uuid, attempt })` | Returns a bounded attempt log summary. Omit `attempt` in either selection function to use the latest attempt.                                                                                         | `tasks report --collect UUID`    |
| `previewTaskRecordRepair({ uuids, appFolder })` | Reads the start-command store and inspects running Docker snapshots. Returns `eligible` with a container name or `ambiguous` per matching UUID. No eligible snapshot yields no outcome for that UUID. | `tasks repair-records [UUID...]` |

Pass the `executions` array from start-command's JSON task list or an existing snapshot to the inspection functions. `collectTaskEvidence` reads the `logPath` provided by the selected record. Give it trusted records from your task host. Record repair preview requires the start-command 0.44.0 or 0.45.0 executable (`$`) and Docker on `PATH`. `appFolder` defaults to `START_APP_FOLDER` or `~/.start-command`. An empty or omitted `uuids` array considers all records.

Use the `HiveManagerError.code` property to handle invalid selections (`INVALID_INPUT`, `TASK_NOT_FOUND`, `ATTEMPT_NOT_FOUND`, `TASK_WINDOW_UNAVAILABLE`) and repair dependencies or read failures (`START_COMMAND_UNAVAILABLE`, `TASK_RECORDS_UNAVAILABLE`, `DOCKER_INSPECTION_FAILED`). An ambiguous match is a preview outcome. Only `tasks repair-records --apply` adopts a snapshot and attaches a watcher, after rechecking eligibility. Operators continue to own deployment profiles, schedules, incident routes and secrets. Deployment apply, adoption and publication approval use their existing CLI flags.

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

DinD and host-socket instances run Docker isolation tasks with a task image. The manager passes its full reference as `HIVE_MIND_DOCKER_ISOLATION_IMAGE`. By default, tasks reuse the deployment image, so the dind image is stored once. When the deployment uses a mutable tag such as `latest`, the manager pins tasks to the image's baked release tag, for example `konard/hive-mind-dind:2.49.0`. It pins only when that tag refers to the same image. `deploy prepare` and `apply` pull the release tag if it is missing. Select a different task image with `--task-image IMAGE`, the profile key `task-image=`, or `HIVE_MIND_DOCKER_ISOLATION_IMAGE` in the environment file. `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG` in the environment file must be a tag such as `2.49.0`. It is combined with the deployment image's repository. A DinD instance with a host socket allows only the task image through the host image passthrough. Containers show the selected image in the `io.github.link-assistant.hive-manager.task-image` label.

## Profiles and remote use

Create one profile per deployment on the target. Values are literal. Relative paths are resolved against the profile's directory. Put CLI overrides after `--profile`. The default container name is `hive-mind` and its state directory is `~/.hive-mind` on the target. Set separate names and state paths for multiple instances.

```ini
name=hive-production
variant=dind
state-dir=./state
env-file=./telegram.env
```

Use ordinary OpenSSH configuration for keys, host verification, DNS, and routing. The manager sends its own Bash script and flags to the host. Bash operations such as basic `deploy backup` can run on a target without a Hive Mind installation. The profile, state files, credentials and Docker service are all on the target. SSH options go before the command.

```bash
hive-manager --host hive-production deploy --profile ./hive/production.conf update
hive-manager --host deploy@hive.internal --jump gateway,edge-bastion deploy status
hive-manager --host hive-production --tty deploy --tty exec -- bash
```

Set `ProxyJump` on the destination alias, configure `ProxyCommand` for an SSH transport proxy, or use an already connected VPN. Use `--ssh-config`, `--ssh-port`, and repeated `--ssh-option` for OpenSSH options supplied on the command line. Pass `--tty` on both sides of `deploy` for interactive remote Docker exec. Omit both for pipes and file transfers. See [OpenSSH client configuration](https://man.openbsd.org/ssh_config).

### Pinning the CLI, host package, and image

Install the operator CLI from an exact npm release or save the script from that release's Git tag. The operator's CLI supplies the Bash program for every SSH invocation. For packaged maintenance on the host, set `HIVE_MANAGER_PACKAGE_VERSION` to an exact version such as `2.48.0`. The manager carries that value in the SSH command, so OpenSSH environment forwarding requires no configuration. The executing host uses an installed `@link-assistant/hive-mind` only if its package manifest matches the pin and the command's module is present. Otherwise, Node-based maintenance requests that version through npm and verifies it before executing the module. The host's Python actions require a matching installed package. These include `deploy global-tools`, `deploy tool-services`, reviewed backups and bundle restores. With no pin configured, the manager prefers the installed implementation and uses the npm `latest` tag for fallback. Values such as npm dist-tags resolve through npm and can change over time.

After installing the desired release on the operator machine and the target, verify both installations and the effective host dispatch. `HIVE_MANAGER_PACKAGE_DIAGNOSTICS=1` reports the selected package name and version and whether it came from an installation or npm. It travels across SSH with the pin and writes to stderr, keeping command output on stdout available to scripts.

```bash
release=2.48.0 # Example host package version
hive-manager --version
ssh hive-production hive-manager --version
HIVE_MANAGER_PACKAGE_VERSION="$release" HIVE_MANAGER_PACKAGE_DIAGNOSTICS=1 \
  hive-manager --host hive-production deploy disk --help
```

Select the deployment image independently with `image=` in the profile or `--image`. Use a release tag or digest. Published release images ship the manager wrapper and install the corresponding Hive Mind package. Commands that run inside the container, such as `deploy tasks report`, use its installed tools. The host pin applies to maintenance on the host. Inspect the deployed package separately with `hive-manager --host hive-production deploy exec -- hive-manager --version`.

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

### Profile-scoped auto-fix

Run `deploy auto-fix` on the Linux Docker daemon host with Node.js 24+ and a local Docker Unix socket. Use the same manager release on the host and in the existing deployment. The task checks run as the deployment's `box` user. Docker task recovery needs access to the task daemon and its storage from that instance. Record repair also needs start-command 0.44.0 or 0.45.0. Run apply and status as root with `flock`. The optional daemon startup needs systemd and the default system socket. Pass your deployment profile and any OpenSSH routing options as usual. The profile file is read on the selected host.

The preview returns JSON and reads host uptime, bounded journal counts and Docker state. It checks host memory and available blocks and inodes on the host, deployment state, receipt and daemon filesystems. It inventories tasks from the saved execution store, including observed watchers and previously recorded attachments, and shows active Docker task containers with missing records. Watcher observation is a point-in-time process check. An unobserved watcher on an executing record calls for operator review. The lifecycle leaves existing task containers and watchers in place.

Supply the policy for each run. By default, auto-fix only observes. The optional mutations run in this order:

1. `--start-docker` allows an inactive systemd Docker service to start. `--start-instance` allows the existing stopped deployment container to start. Each startup is a separate approval when later phases cannot be inspected. Preview again after startup to review newly visible work.
2. `--cleanup-preview UUID` authorizes the reviewed file list from the latest completed `deploy cleanup --scoped --instance-only --dry-run` for this profile and container incarnation. This scope considers only eligible APT archive cache files in the selected instance's writable layer. The scoped worker checks memory and rescans file identity before unlinking. Review the cleanup status and its preview file before including its UUID. Use root for the auto-fix preview with this option so it can read the private cleanup receipt.
3. Repeat `--repair-record UUID` for exact detached resumes whose saved record can be repaired safely. Auto-fix rechecks the running container and skips a repair if it observes an existing watcher. Check `tasks status UUID` for the current attempt before approving repair.
4. `--recover-limit COUNT` reviews up to 10 first retries for confirmed memory failures. Use `--recover-execution UUID --recover-attempt NUMBER [--max-resumes COUNT]` for a known Telegram alias failure or a later eligible attempt. Recovery skips active and paused families, bot-tracked tasks, watched failures, and superseded failures. It verifies the stopped container attribution and space for the snapshot before each launch. The receipt records acceptance of the resume and its attempt number. Use `deploy tasks status UUID` for the attempt's eventual exit.

Use the same policy flags for preview and apply. Review `phases`, `blockers`, and `actions` before using the approval digest. A null approval means no mutation is currently proposed. A digest binds the deployment, boot, and reviewed mutations. Apply recomputes the plan and checks the instance and resources before each mutation. A blocked recovery candidate can coexist with a different eligible action. Check the full blockers list even if an apply completes.

```sh
hive-manager deploy --profile /etc/hive/staging.profile auto-fix --recover-limit 2
sudo hive-manager deploy --profile /etc/hive/staging.profile auto-fix --recover-limit 2 --apply sha256:PLAN_SHA256
sudo hive-manager deploy --profile /etc/hive/staging.profile auto-fix --status
sudo hive-manager deploy --profile /etc/hive/staging.profile auto-fix --status --run RUN_UUID
```

Apply returns a run ID while the worker keeps running on the host. The worker holds an exclusive lock per instance name and writes private, durable receipts under `/var/lib/hive-manager/auto-fix/<name>/`. After an SSH disconnect, check status before submitting another apply. After a worker or host interruption, a `running` action in an `interrupted` receipt may have taken effect. An `uncertain` receipt means a mutation could not be confirmed. Compare the recorded Docker identity, cleanup job, task attempt and watcher against live state. After reconciling the interrupted run, generate a fresh preview and apply it with `--after-interruption RUN_UUID`. Completed actions stay in the original receipt. A repeated submission of the latest completed digest returns the existing receipt.

For rollback, preserve a deployment backup before repair or cleanup if you need to restore state or cache contents. A started instance can be stopped explicitly after confirming that doing so will preserve active work. Review daemon changes separately on a shared host. Leave a repaired execution and its watcher together while it runs. Use the retained task container and attempt history to investigate a resumed task, and use the existing task pause or stop procedures if necessary. Cleanup removes the approved cache files. Restore a retained copy or repopulate the cache if needed.

Keep host selection, deployment policy, schedules, and incident destinations in the caller. Authorize incident publication separately with the single-incident or batch reporting commands below. JavaScript callers on the deployment host can import `previewAutoFix(options)`, `applyAutoFix(options, approval, { afterInterruption })`, and `getAutoFixStatus({ name }, { runId })` from `@link-assistant/hive-mind/hive-manager`.

### Scoped tool maintenance

Each action previews by default and writes a JSON receipt to stdout. Save the receipt if a scheduler or an incident report needs it. Add `--apply` after the action once you have reviewed the plan.

```bash
hive-manager deploy --profile PROFILE update-dependencies gh-upload-log
hive-manager deploy --profile PROFILE update-dependencies --apply gh-upload-log
hive-manager deploy --profile PROFILE update-dependencies --all
```

The dependency command runs Bun in the selected deployment as `box`. It uses `BUN_INSTALL_GLOBAL_DIR` when set, or the global install directory under `BUN_INSTALL` or `~/.bun`. The preview shows Bun's proposed versions. Apply backs up the original `package.json`, `bun.lock` and `bun.lockb` when present under `~/.hive-mind/state/tool-maintenance/dependency-backups/` before invoking Bun. The receipt includes the backup path, before and after versions and file checksums, and Bun output. A failed update retains its backup. To roll it back, restore the saved manifest and lockfile format in the original Bun global directory, remove any lockfile generated in the failed update whose original checksum was null, and reinstall from the restored manifest and lockfile. Keep this directory on the deployment's persistent state mount.

Run the other two actions as root on the Linux Docker host using an installed Hive Mind Manager and Python 3.11 or later. For SSH, select an authorized root destination with `--host`. `tool-services` also requires Linux pidfd support.

```bash
hive-manager deploy --profile PROFILE global-tools --policy /etc/hive-mind/stage-tools.json
hive-manager deploy --profile PROFILE global-tools --policy /etc/hive-mind/stage-tools.json --apply
hive-manager deploy --profile PROFILE tool-services --tools codex,claude
hive-manager deploy --profile PROFILE tool-services --tools codex,claude --apply
```

Store the allowlist on the Docker host. A deployment profile can supply `tool-policy=stage-tools.json` relative to that profile. Each of the `codexMcp` and `claudeMcp` objects maps an approved name to its exact registration in that tool's format. For instance, this file approves Playwright for both tools using the published Control Center arguments.

```json
{
  "codexMcp": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest", "--isolated", "--headless", "--no-sandbox", "--timeout-action=600000", "--viewport-size", "1920x1080"]
    }
  },
  "claudeMcp": {
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest", "--isolated", "--headless", "--no-sandbox", "--timeout-action=600000", "--viewport-size", "1920x1080"]
    }
  }
}
```

Use `{}` for an empty allowlist. A deployment running the Hive Mind task-launch policy must also satisfy that policy before admitting tasks. On a shared host, align the policy across deployments for the shared root and system layers. The audit covers the bot user, bot root and host root homes, and managed Codex and Claude configuration on the host and in the deployment. It preserves stock Codex system skills, credentials, session history, task-scoped settings and managed permission constraints. Apply records original configurations and moved extensions in root-only quarantine under `/var/lib/hive-manager/tool-maintenance/quarantine/`. Single-file bind-mounted configs are rewritten in place. An audit exits nonzero on drift or an unsafe configuration. An apply exits nonzero if violations remain.

Service cleanup selects the deployment's known managed Codex app-server, its updater, and orphaned Claude browser helpers. Add `--include-host` to consider eligible helpers in the host scope as well. The receipt lists blockers such as active or unclassified tasks, foreground tool processes, controlling terminals, owners and worker children. It reads the current start-command store without reconciling tasks or refreshing its cache. Each signal checks the current deployment identity, task state and process incarnation. Apply stops the updater first, sends SIGTERM to eligible helpers, and rechecks before escalating to SIGKILL if necessary.

Control Center schedulers can switch their focused dependency, global-tool and service maintenance calls to these commands once the deployment and its host package run the supporting release. Compare each JSON preview with the existing runbook on staging, then verify the backups, preserved scopes and service blockers before switching callers. A pinned image rollout restores the image's pinned dependencies. The [queue work classifier](../../tests/queue-work-accounting-4021.test.mjs) discounts idle daemons for queue admission.

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

`tasks recover-failed` previews first retries for detached Docker tasks with confirmed memory exhaustion. It skips active or paused families, tasks still tracked by the Telegram bot, operator stops recorded by start-command, and failures superseded by newer successes. Let the bot reconcile after a restart and use `tasks status UUID` to check the latest attempt before applying a plan.

Select a known Telegram solve alias that exited 127 or a later confirmed memory failure by execution UUID and failed attempt number. Choose `--max-resumes` to match the deployment policy. The default is 1, and the maximum is 10. Recorded automatic restarts count toward the cap. These commands review a second attempt and allow one more retry.

```bash
hive-manager tasks status UUID
hive-manager tasks recover-failed --execution UUID --attempt 2 --max-resumes 2
hive-manager tasks recover-failed --execution UUID --attempt 2 --max-resumes 2 --apply --wait 60
```

The `snapshot` result shows the stopped container's writable-layer bytes, required bytes (twice the layer size plus 10 GiB), and the lowest available bytes across the Docker image-store filesystems. Run recovery where the local Docker daemon's storage paths are visible, using `deploy tasks` when the daemon runs inside the deployment. `--apply` rechecks the attempt, container, and headroom immediately before handing off to start-command. An alias recovery launches `solve` with the stored arguments and alias tool selection. If the attempt log has a tool session ID in its bounded tail, it replaces any stale `--resume` argument. `--wait SECONDS` tracks the specific attempt launched, and a blocked, failed, or unfinished retry makes the command exit nonzero.

Keep the deployment's [Control Center recovery and reporting runbook](https://github.com/link-assistant/hive-mind-control-center/issues/1) for historical records that still need operator review. Check the native previews and `tasks status` before taking action on these records.

`tasks check-uploads` samples same-user Linux upload and sanitization processes. The defaults flag processes at least 30 minutes old, averaging at least 80% of one CPU over three seconds, with no observed I/O progress. `--terminate PID` signals the selected process after rechecking its identity and progress.

Run `tasks repair-records [UUID]` when a detached Docker resume is running and its stored execution still shows an older terminal attempt. The preview checks the exact labels, start timestamp, snapshot and original command. Apply with `--apply` to adopt an eligible snapshot and attach a completion watcher. This repair supports the execution stores from start-command 0.44.0 and 0.45.0. Use `tasks resume-all` for records already marked executing.

`tasks report --group` counts recurring failures across recorded attempts, including failures from tasks that later succeeded. It groups by execution backend, failure classification and exit code. `tasks report --incident UUID --attempt NUMBER --destination OWNER/REPO` previews an incident for one confirmed failure. The default attempt is the latest. Add `--follow-up ISSUE_NUMBER` when the failure belongs on an existing open issue. Use `--publish REVIEW_DIGEST` after reviewing the JSON output to create the issue or post the approved comment. The report contains the execution ID, times, backend, exit status and classification. Upload an execution log separately with `tasks upload-log ID` if needed.

`tasks report --group --by-signature` also groups by known solver outcomes, such as an empty repository, a dirty checkout, an exhausted restart budget or a Codex output limit. It reads up to 512 KiB from the end of each attempt and returns groups without a signature when a cause cannot be established from the available evidence.

`tasks report --collect UUID [--attempt NUMBER]` inspects up to 4 MiB of the selected attempt's log. It reports short success runs, retry and reconnection counts, and repeated commands, MCP calls or messages. The result contains counts and classifications without raw log lines. Historical collection needs stored log offsets to distinguish one attempt from the next.

For repeat failures, use `--routes /path/to/routes.json` in place of `--follow-up`. The file is read in the environment that runs the command, so put it inside the container when using `deploy tasks`. Copy the `backend`, `kind` and `exitCode` values from `tasks report --group` and add the issue number in the selected destination repository. To route to a cause-specific issue, also copy the optional `signature` from `tasks report --group --by-signature`.

```json
[{ "backend": "docker", "kind": "Memory exhaustion", "exitCode": 137, "issue": 318 }]
```

A failure routed to an open issue previews a comment. An unmatched failure previews a new issue. An optional `signature` from `--collect`, such as `codex-oom` or `stream-close-timeout`, takes precedence over a group-only match. For a signal-range Docker exit, add `--host-signature NAME` after reviewing the corresponding attempt's journal correlation on the Docker host. The report includes the selected correlation and can route by that signature. Changes to the selected issue or its preview evidence after review invalidate the digest.

Use `--reconcile` to review historical reports. It checks the exact execution and attempt markers in GitHub issues and comments for the selected repository. Supply `--legacy-ledger FILE` to check a Control Center `auto-fix-reports.json` export as well. A reconciliation preview has no publication digest.

```bash
hive-manager tasks report --incident UUID --attempt 2 --destination OWNER/REPO \
  --routes /path/to/routes.json --reconcile --legacy-ledger /path/to/auto-fix-reports.json
```

For a closed route, the preview links the issue and compares its close time with the installed Hive Mind release's publication time. Use `--installed-version VERSION` when reviewing a deployment that runs a different release. A closure after that version was released indicates that the fix may still need to be deployed. A closure before or at release time marks a possible regression for review. Use the batch workflow below to review multiple closed routes and approve eligible regression issues. Publication returns the existing GitHub report URL when the attempt has already been reported.

### Incident batch planning and publication

Save an execution snapshot with `$ --list --output-format json` and keep its logs on the machine that owns the execution records. Use a selection file with either a fixed completion window or a list of exact execution UUIDs and attempt numbers.

```json
{
  "window": { "from": "2026-11-20T00:00:00Z", "to": "2026-11-21T00:00:00Z" },
  "installedVersion": "2.48.0",
  "limit": 20
}
```

The lower boundary is inclusive and the upper boundary is exclusive. A window can also include an `executions` array of UUIDs. To select exact attempts, use `"attempts": [{ "uuid": "12345678-1234-1234-1234-123456789abc", "attempt": 2 }]` in place of `window`. Record the version that ran the attempt. An exact selection can override `installedVersion` and include a reviewed `hostSignature` from `deploy diagnose` for a signal-range Docker exit. The default limit is 20 and the maximum is 100. If the window exceeds the limit, narrow it before saving the plan.

```bash
umask 077
hive-manager tasks report-batch plan --records executions.json --selection window.json --output preview.json
```

The default plan is a local, owner-only file with no publication digest. Omit `--records` to read the current execution store. The plan includes confirmed nonzero exits, including failed historical attempts of executions that later succeeded. For each attempt the manager examines at most 512 KiB of its log within the stored offsets and retains classifications and counts. Raw execution logs, commands, and conversation text stay out of the plan and report.

For GitHub reconciliation, supply a policy file naming the approved repository, its expected visibility, and the allowed actions. An empty `allow` array makes the policy review-only. An open route can produce a `comment`, an unmatched attempt can produce a `create-issue`, and an eligible closed route can produce a `regression-issue`. Add routes from the failure groups as for single incident reporting. By default the report includes the failure signature when available. Set `includeLogEvidence` to include the bounded log's aggregate evidence in the outbound report.

```json
{
  "destination": "OWNER/REPO",
  "visibility": "private",
  "allow": ["comment", "create-issue"],
  "routes": [{ "backend": "docker", "kind": "Memory exhaustion", "exitCode": 137, "issue": 318 }],
  "includeLogEvidence": true
}
```

```bash
hive-manager tasks report-batch plan --records executions.json --selection window.json \
  --policy policy.json --legacy-ledger auto-fix-reports.json --output reviewed.json
hive-manager tasks report-batch apply --plan reviewed.json --approve REVIEWED_DIGEST \
  --legacy-ledger auto-fix-reports.json
```

Review each proposed action, destination and report body in `reviewed.json` before copying its `sha256:` digest into the apply command. The ledger is an optional read-only export of Control Center's `auto-fix-reports.json`. If it was used in planning, pass the current ledger again on apply. Deduplication uses the destination and exact execution and attempt markers in issues and comments, the historical ledger, and receipts in the manager's state directory.

A closed route shows the recorded release's publication date and the issue's closure date. If the issue closed after that release, or either date is unavailable, hold the report for review. A closure at or before the release date can be a possible regression. To approve a linked new issue for such cases, include `regression-issue` in the policy and review the fresh plan. The manager rechecks the route and release evidence before writing.

Keep the approved plan and the manager state directory together for retries. Batch receipts are stored under `HIVE_MIND_STATE_DIR` or `~/.hive-mind/state` and are shared by plans targeting the same repository. If apply stops after a partial success, rerun it with the same plan and digest. It reuses confirmed receipts and looks for exact markers to reconcile a write whose response was lost. An unresolved write blocks that attempt and later actions. Check the issue or comment directly and reapply when its marker is visible. If an authorized operator confirms GitHub did not accept the write, move only the identified pending record to a private backup before retrying. Keep all confirmed receipts.

Operators integrating a Control Center caller can use `planIncidentBatch` and `applyIncidentBatch` from `@link-assistant/hive-mind/hive-manager`. Store plan files and policy in the deployment that owns the records and use one shared state directory for its batch publishers.

### Telegram queue recovery review

After a restart, save the previous and current verbose logs in a private directory. Use `deploy logs --timestamps` with `--until` and `--since` around the restart. Both files need the queue initialization line. Run `tasks recover-queue --previous previous.log --current current.log` after the bot has reconciled. Review candidates against the live queue, execution records, and dependency state.

Keep the original request in the authorized chat or a restricted local copy. For local review, rerun the command with `--include-commands` and, if saving its output, create the file with `umask 077`. Compare the matched text against the originating message and confirm the target, tool, arguments, prompt, and intended dependencies with the request owner. If the original is missing or ambiguous, retrieve it from the authorized chat or have the owner confirm the complete request before resubmission. Resubmit once through that chat and confirm it appears in the queue or execution store. Use execution and attempt identifiers and sanitized evidence in incident reports. Keep raw requests and queue logs in the restricted review materials.

On a Linux Docker host, `deploy docker-service live-restore` checks whether the local daemon keeps containers running when the daemon is unavailable. Run it with `--apply` as root on a systemd host with `jq` and `flock`. The command validates and backs up `/etc/docker/daemon.json`, reloads `docker.service`, and checks the running daemon. It restores the previous file if the setting fails to take effect. [Docker live restore](https://docs.docker.com/engine/daemon/live-restore/)

Use `deploy diagnose --since '1 hour ago'` to include bounded Docker service and kernel memory-failure history where the target account can read the systemd journal. The journal remains available when the managed container or its daemon is down. Use `deploy diagnose --task UUID --attempt NUMBER` on a running instance to use the selected task's recorded time window for both journal queries. The results show events overlapping the task, with up to 80 records per query. Near a completed attempt's exit, the command correlates a recorded Docker stop and start as `daemon-restart`. With `jq` and a retained journal from the previous boot, it can identify a `host-reboot` when shutdown is recorded or a possible `host-reset` when the journal ends abruptly. Review the events and the completeness of the journal before using a correlation in an incident. On a running Linux instance, `deploy diagnose --resources` adds cgroup v2 memory, CPU, pressure and PID counters, thread wait channels, a bounded browser process table, and shared-memory usage where the Docker host exposes them.

To inspect a blocked browser or agent process, get its container PID with `deploy exec -- ps -eo pid,comm` and run `deploy diagnose --process PID`. The command samples read and write byte and operation counters, the current syscall number and queued bytes for connected Unix stream sockets at both ends of the sample. It runs as `box` within the selected container. Socket queue sampling uses the Linux kernel diagnostic interface through Python 3. The command identifies readings that the kernel or container makes unavailable. For a separate Docker task container, select that container with `deploy --name TASK_CONTAINER diagnose --process PID`.

Run `tasks check-browser PID` as the browser's user in the same Linux process namespace to sample a headless Chromium tree. For a task container on the selected Docker daemon, use `deploy --name TASK_CONTAINER tasks check-browser PID`. To inspect a child of a Docker-in-Docker deployment, use `deploy exec -- docker exec --user box TASK_CONTAINER hive-manager tasks check-browser PID`. Add `--transcript SESSION.jsonl` to check the corresponding Claude session for an idle, CPU-intensive Playwright browser, including recent calls from subagents. Approval requires complete, bounded transcripts. `--detached` checks whether init adopted the browser. Review the reported activity and pass `--terminate sha256:HEX` with the approval shown for the selected browser. The manager samples again and sends SIGTERM when the process and evidence still match. Closing an idle browser discards its open page.

Packaged maintenance commands use Hive Mind's terminal credential filter. Operations such as `deploy logs`, `deploy exec`, and backup streams carry the underlying service output, so review that output before sharing it.

`archive-session FILE` writes a sanitized local copy to stdout. `archive-sessions --repo OWNER/REPO --output NEW_DIRECTORY` discovers inactive Claude and Codex sessions, verifies the repository is public, and stages sanitized files and a manifest. It uses Codex session metadata and Claude checkout origins to attribute sessions. A Claude subagent without its own working directory inherits its parent’s repository. Use `--only claude` or `--only codex` to export one format. The default export limit is 20. Use `--min-age MINUTES` to carry over the scheduler's idle threshold for transcripts and attachments. The default is 10 minutes since modification. Set a shorter threshold only when the operator can ensure the session has ended. Transcripts over 40 MiB are sanitized in a stream and staged as numbered JSONL parts of up to 40 MiB each, cut at record boundaries. A numbered transcript has one manifest entry and one revision marker for the complete set. A single record that exceeds the limit is reported by tool on stderr and in the manifest as `omissions.oversized-record`. Other limiting conditions, including exhausted batch capacity, also appear under `omissions`. Add `--lino` with the Conversation CLI installed to add a Links Notation copy for each transcript or part. [Conversation CLI](https://github.com/link-assistant/conversation/tree/e548823507862f237ce58cb2915bf336f29a725c) Session files can include personal or proprietary material. Review the staged files before publishing.

Use `--tool-results` to include sanitized Claude attachments associated with the staged transcripts. This selects inactive, regular `.txt`, `.log`, `.json`, and `.jsonl` files up to 4 MiB each, with a shared limit of 100 attachments or 40 MiB of input per export.

```bash
( umask 077; hive-manager --host hive-production deploy archive-session /home/box/.claude/projects/example/session.jsonl > session.redacted.jsonl )
hive-manager archive-sessions --repo link-assistant/hive-mind --output ./session-review --tool-results
```

`archive-publish` lists the exact files to be committed and returns a review digest tied to the destination's visibility and default branch. After reviewing every file, pass the digest with `--apply` to publish one normal Git commit. The destination must already contain a default branch and allow your configured Git identity and credentials to push to it. The manager rechecks source visibility and scans the reviewed files before pushing. It redacts recognizable identity-document details while staging and excludes the repository identified in the Control Center's known data exposure. Each publication accepts a manifest and up to 300 artifacts, with a 256 MiB total limit and a 64 MiB limit per file. Numbered JSONL parts have a 40 MiB limit and always require reviewed publication to a private destination.

```bash
hive-manager archive-publish ./session-review --destination example/session-archive
hive-manager archive-publish ./session-review --destination example/session-archive --apply REVIEW_DIGEST
```

To create a destination with an initial branch and README, run `hive-manager archive-publish --initialize --destination example/session-archive --visibility private` with GitHub CLI credentials that can create repositories. Choose `public` or `internal` explicitly when required.

Use `archive-sessions --published-in example/session-archive` when working through a backlog or staging batches on a schedule. The manager reads the destination's Git index for this source without downloading existing session logs. It skips an already published transcript revision with the same export options and selected attachments, so the next batch can advance through the backlog. A changed transcript or attachment is eligible again. The Git commit publishes the revision index and its reviewed archive together.

For a scheduler such as cron or a systemd timer, use `archive-sessions --repo example/project --publish-private example/session-archive`. It stages a batch of up to three new revisions by default, scans them for residual credentials and identity data, verifies that the destination remains private before pushing, then removes the temporary files. Run it as the account that owns the session directories and has Git and GitHub access to the destination. Use a separate scheduled invocation for each source repository you intend to archive. Existing archive files stay in place when using an existing destination. The manager counts revisions published through its own index.

When the scheduler reports `review-required`, stage a batch using the same export options as the scheduled command. Pass `--published-in` to skip revisions already indexed in the private archive.

```bash
hive-manager archive-sessions --repo example/project --published-in example/session-archive --output ./numbered-review
hive-manager archive-publish ./numbered-review --destination example/session-archive --private
```

Review the listed files and pass the returned digest with `--apply` to publish the batch. The scheduler can then skip the numbered revision using its marker.

Pass `--known-secrets-file /path/to/private-literals.txt` to `archive-sessions` for source-specific redactions. Carry over the literals configured for that source in the scheduler and keep the file outside the archive, readable only by the scheduler account. Use one UTF-8 literal per line. Surrounding whitespace and blank lines are ignored, and regex characters match literally. The same literal set is required for `archive-publish` preview and apply of a staged batch that uses it. Both reviewed and scheduled publication require a private destination when extra literals are supplied. A match anywhere in the final artifacts, including a converted file, blocks publication.

### Import an existing private archive

Pause the archive scheduler and record the current destination commit. Run the import with the same source roots, `--only`, `--lino`, `--tool-results`, `--min-age` and `--known-secrets-file` settings you intend to use for the incremental export. For example:

```bash
hive-manager archive-sessions --repo example/project --import-legacy example/session-archive --lino --known-secrets-file /path/to/private-literals.txt
hive-manager archive-sessions --repo example/project --import-legacy example/session-archive --lino --known-secrets-file /path/to/private-literals.txt --apply REVIEW_DIGEST
hive-manager archive-sessions --repo example/project --published-in example/session-archive --output ./first-increment --lino --known-secrets-file /path/to/private-literals.txt
hive-manager archive-publish ./first-increment --destination example/session-archive --private --known-secrets-file /path/to/private-literals.txt
```

The import preview lists the matched legacy metadata and corresponding revision markers, skipped candidates by reason, and the destination commit bound to the review digest. Inspect the listed legacy output before approving it as the baseline. The import verifies the transcript SHA-256 against the inactive source, checks the declared archived files and their checksums, and verifies that the requested Links Notation and attachment choices match the available evidence. For a split transcript, the import checks the contiguous numbered sequence, every declared part's byte count and checksum, and the Links Notation counterpart for each part when requested. Each selected Claude attachment needs its own matching source hash and verified artifact or parts. The preview counts missing or changed evidence, unverified artifacts, ambiguous attachment policies, and residual configured literals. It also lists up to `--limit` unverified archive paths. These revisions remain eligible for fresh export under the selected options and size limits. Changing the Links Notation option, attachment selection, or extra literals produces a distinct revision. Use `--limit` to bound each import, and repeat preview and apply until the eligible index batch is empty.

Apply adds only revision markers in a normal Git commit on the existing private branch. If the destination or plan changed, generate a fresh preview. Review and apply the first incremental batch with `archive-publish --private` before resuming the scheduler. Keep the archive private because its history remains intact. To roll back an import, pause the scheduler and revert the import commit on the existing branch. Keep a copy of the legacy README as the source inventory baseline. To regenerate a source overview, use a local checkout of the archive and redirect the command's Markdown output to a separate file.

```bash
hive-manager archive-overview ./session-archive --legacy-readme ./legacy-archive-readme.md > ./source-overview.md
```

The overview keeps the legacy table's columns and source links and adds counts and source sizes from the published batch manifests. It counts each manager revision once, including revisions with multiple parts. Size totals that include rounded legacy sizes are approximate. Use the same historical README as the baseline for subsequent runs.

## Backup and restore

Stop the instance first if an application-consistent snapshot is needed. Run backup with permission to read the state files. Files can be owned by the container user.

```bash
hive-manager deploy --profile ./production.conf backup --output ./hive-state.tar.gz
hive-manager deploy --state-dir ./restored-state restore --input ./hive-state.tar.gz

( umask 077; hive-manager --host hive-production deploy --profile ./hive/production.conf backup --output - > hive-state.tar.gz )
hive-manager --host replacement deploy --state-dir ./restored-state restore < hive-state.tar.gz
```

The backup is a private archive of the state directory. Keep configuration inside that directory if it should be included, and preserve separate files and Docker volumes independently. The state directory includes Claude, Codex, Agent skills, Git, GitHub CLI, Hive Mind session state, and start-command records and logs. Archives can contain credentials. Restore a trusted archive into a new directory and ensure its files are accessible by the `box` user before applying the profile.

### Reviewed private bundles

Use a reviewed bundle to select provider data and extra sources. Install Hive Mind Manager with bundle support and Python 3.10 or later on the Linux host running each command. Stop the deployment and any other writers to shared sources. The backup uses the target's Docker CLI to inspect the deployment and copy selected Docker paths. The restore can run offline with Python and GNU coreutils.

- `--provider claude` selects `claude/` and `claude.json` when present. `--provider codex` selects `codex/`. Repeat the option to select both.
- `--state` selects managed non-provider state from `agents`, `gh`, `git`, `hive`, `start-command`, and `start-logs`. Other top-level entries are excluded.
- `--path NAME=/absolute/path` selects an additional host file or directory outside the state directory. Use it for separate configuration or another explicitly reviewed path.
- `--mount NAME=/container/path` selects a Docker bind or volume by its exact destination on the deployment container. Use `NAME=CONTAINER:/container/path` to select a mount on another stopped container. Select nested mounts individually. A bind overlapping the configured state directory belongs to the state or provider scope.
- `--legacy NAME=CONTAINER:/absolute/path` selects a file or directory recorded as added or changed in a stopped container's writable layer. Paths overlapping Docker mounts are excluded from this selection.

The plan records the selected paths, source ownership and modes, container identities, mount bindings and scope exclusions. The capture re-resolves the plan before reading payloads. The receipt also records skipped symbolic links, special files, nested host mounts and Docker archive link entries. Keep the plan private along with the bundle and receipt.

```bash
umask 077
set -o noclobber
hive-manager --host hive-production deploy --profile ./hive/production.conf backup --plan \
  --provider claude --mount settings=/run/operator-settings \
  --legacy old-codex=legacy-bot:/home/box/.codex > backup-plan.json
# Review backup-plan.json, then stream the bundle to operator-owned storage.
hive-manager --host hive-production deploy --profile ./hive/production.conf backup \
  --plan-file - --output - < backup-plan.json > hive-private.bundle
hive-manager --host replacement deploy --state-dir ./restored-backup restore \
  --bundle --input - < hive-private.bundle
```

Pass local paths in place of `--plan-file -`, `--output -`, or `--input -` to read or write files on the command's target host. With SSH, use stdin and stdout without a TTY to stream between the target and your machine. A named bundle output is created with mode `0600` and refuses to overwrite a file. For stdout, use restrictive permissions on the receiving side and check the SSH command's exit status before retaining the bundle.

The restore verifies each file's SHA-256 and the archive metadata against its manifest before publishing the new directory. It installs provider and common state under `state/`, named extra sources under `additional/`, and the private receipt at `MANIFEST.json`. Directories are `0700`. Files are `0600`, with owner execute permission retained where present. The default payload owner is the restoring user. A privileged operator can use `--owner UID:GID` to assign the payloads to the replacement deployment user. Review the receipt and use the restored `state/` as the replacement profile's state path. Rebind extra sources explicitly after review.

The bundle can contain provider credentials, transcripts and configuration. The deployment chooses the destination, encryption and keys, retention, and schedule. Keep the bundle in access-controlled storage or stream it through deployment-owned authenticated encryption. For a public transcript export, use the session archive commands and review their redactions.

## Telegram MTProto proxy

The proxy can run independently of the bot. Use `apply` to create or start a managed classic proxy. Use `deploy --adopt proxy --proxy-name NAME apply` to recreate a legacy classic proxy with the manager ownership label. When the legacy container has a classic `/data` bind mount, the manager reads its key. You can also supply a private `--secret-file`. A supplied key must agree with the mounted key and any saved manager key. The legacy container and its configuration stay available for rollback.

```bash
hive-manager --host hive-production deploy proxy --port 8443 apply
hive-manager --host hive-production deploy proxy --port 8443 verify
hive-manager deploy proxy --port 8443 --public-host proxy.example.net connect
```

`verify` checks running status, the selected binding and TCP connectivity to each Telegram data center from the selected container's network namespace. Run it on the Linux Docker host with permission to enter Docker namespaces. A connection failure is reported as `unreachable`. A missing namespace, inaccessible namespace or nonlocal Docker endpoint is reported as `unavailable`. Both cause verification to fail. `connect` checks public TCP reachability from the caller.

Use `snapshot` to record the image, restart policy, workers, published bindings and a SHA-256 hash of the supplied or persisted key. Add `--check-egress` and `--check-mss` to include namespace connectivity and installed IPv4 TCPMSS rules. With `--secret-file`, snapshot and compare can read the legacy key in place. The path is on the Docker host. `compare` accepts a baseline on the target or `-` for stdin over SSH.

```bash
proxy=(hive-manager --host hive-production deploy proxy --port 8443 --proxy-name mtproxy-classic-8443)
observations=(--secret-file /root/.hive-mtproxy-classic-8443/secret --check-egress --check-mss)
"${proxy[@]}" "${observations[@]}" snapshot > proxy.baseline
"${proxy[@]}" "${observations[@]}" compare - < proxy.baseline
```

Run `proxy-test` on the affected client network with a pre-authorized Telegram StringSession and private API credentials. It verifies a text round trip in Saved Messages and deletes its test messages. `--media` adds a byte-for-byte document round trip. `--roundtrip-photo` uploads a deterministic 128 × 128 test image. `--photo FILE` accepts a selected JPEG or PNG of at most 256 KiB. Both options compare decoded dimensions and pixels with a tolerance for recompression. Use `--direct` to run the same checks without a proxy.

```bash
hive-manager proxy-test --credentials ./telegram-api.json --session-file ./telegram.session \
  --proxy-host proxy.example.net --proxy-port 8443 --secret-file ./mtproxy.secret \
  --media --roundtrip-photo
```

### Compare routes on the same client network

`--matrix routes.json` runs the selected tests sequentially against existing routes. Store secret files relative to the matrix, including the hexadecimal FakeTLS key if applicable. When multiple candidates share a port, run one matrix entry at a time with `--route NAME` after activating the matching candidate.

```json
[
  { "name": "direct", "direct": true },
  { "name": "baseline", "host": "proxy.example.net", "port": 8443, "secretFile": "baseline.secret" },
  { "name": "candidate", "host": "proxy.example.net", "port": 8443, "secretFile": "candidate.secret" }
]
```

Run the baseline client probe first. For a managed classic configuration change, `proxy update` activates the new image and/or worker setting and retains the predecessor. For other configurations, such as FakeTLS, create a stopped candidate with `docker create`, `--restart unless-stopped`, and the same selected host port mapped to TCP 443, using its own reviewed configuration. Review the two container IDs, image IDs and bindings before applying the plan. Use the same target, deployment name, state directory, port and proxy name throughout the rollout.

```bash
rollout=(hive-manager --host hive-production deploy --adopt proxy --port 8443 --proxy-name mtproxy-classic-8443)
trial=(--candidate staged-faketls)
"${rollout[@]}" "${trial[@]}" trial-plan > trial.plan
cat trial.plan
"${rollout[@]}" "${trial[@]}" trial - < trial.plan
```

Run the candidate client probe with the same account, client network and media options. Save each `proxy-test` JSON result. Use the same route name across reports if you want numeric deltas for that route. To restore the predecessor, run `"${rollout[@]}" rollback`. Rollback restores its original running or stopped state and returns a staged candidate to its original name for another run. If activation is interrupted, use the same rollback command to restore the recorded predecessor. After the selected candidate passes the live text, document and photo checks, run `"${rollout[@]}" accept` to remove the retained predecessor. Keep the local data directories and image if needed for subsequent trials.

### Capture and compare TCP and application results

Collect bounded classic pcap files on both external interfaces during the same probe window. `proxy-pcap` reports payload bytes, retransmitted segments and bytes, duplicate ACKs, resets and per-direction ACK gaps. Its comparable flow count shows where both payload and peer ACKs were observed. Interface offloading and capture loss can affect the measurements. Attach the `proxy-test` JSON with `--probe` to record the application outcome alongside the packet counts. `--compare` compares two saved reports or two standalone probe results.

```bash
( umask 077; hive-manager --host hive-production deploy proxy --port 8443 --interface eth0 --seconds 15 --client-ip 192.0.2.12 capture > server.pcap )
hive-manager proxy-pcap --port 8443 --probe candidate-probe.json client.pcap server.pcap > candidate.json
hive-manager proxy-pcap --compare baseline.json candidate.json
```

### Stop or remove legacy proxy resources

Run `proxy inventory` for recognized unowned containers, including `mtproxy`, `mtproxy-classic`, `mtproxy-classic-old`, `mtproxy-classic-PORT` and `mtproxy-classic-PORT-old`. Add `--legacy-mss` on the Docker host with systemd and iptables access to inspect the original `mtproxy-mss.service` and the rules installed by its script. Selecting the MSS hook includes the whole unit and the rules attributed to its configured ports and MSS. Review all resources in the plan before applying.

```bash
cleanup=(hive-manager --host hive-production deploy proxy)
"${cleanup[@]}" --legacy-mss inventory
"${cleanup[@]}" --select mtproxy --select mtproxy-classic-8443-old --legacy-mss cleanup-plan stop > cleanup.json
cat cleanup.json
hive-manager --host hive-production deploy --adopt proxy cleanup - < cleanup.json
```

Use `cleanup-plan stop` to retain the selected containers and disable the legacy MSS hook while keeping its files. Use `cleanup-plan remove` to remove those containers and the selected hook files. Both actions preserve the Docker images, configuration and keys. Apply rejects stale plans and verifies the resulting Docker and MSS state. Generate a fresh plan after any partial failure. A temporary stop can be resumed by starting the preserved containers and re-enabling the reviewed MSS service if needed.

For a manager-owned IPv4 clamp, `proxy --port 8443 --mss 1200 mss-unit` generates a systemd unit. Its rules match Docker DNAT by the original published port in both directions.

## Compose and Helm

Existing Compose stacks and Helm releases can use the same SSH transport and manager entry point.

```bash
hive-manager --host hive-production deploy compose --env-file ./hive/stack.env -f ./hive/compose.yml up -d
hive-manager --host cluster-admin deploy helm list --all-namespaces
```

These commands use the target's Docker Compose files and Kubernetes configuration. See the [Docker guide](../DOCKER.md) and [Helm installation guide](../../README.md#helm-installation-kubernetes-experimental) for the corresponding deployment options.
