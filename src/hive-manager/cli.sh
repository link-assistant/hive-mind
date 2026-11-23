#!/usr/bin/env bash

# Keep the complete program in one shell command so Bash reads the whole file
# before an action can run, including when the entry point is piped from curl.
exec bash -c "$(cat <<'HIVE_MANAGER_PROGRAM'
set -eo pipefail

fail() {
  printf 'hive-manager: %s\n' "$*" >&2
  exit 1
}

require() {
  command -v "$1" >/dev/null || fail "Required command: $1"
}

need_value() {
  [[ ${2-} ]] || fail "$1 requires a value"
}

usage() {
  cat <<'HELP'
Usage: hive-manager [--host HOST] [SSH options] COMMAND [ARGS]

  deploy                Configure, deploy and maintain a Hive Mind instance
  auth                  Sign in to Claude, Codex or GitHub without opening the agent UI
  cleanup               Reclaim stale task state, processes and Docker resources
  configure-claude      Apply or verify Hive Mind Claude settings
  audit-config          Check global agent settings and optionally repair them
  screens               List, attach to or close finished Screen sessions
  models                Inspect the live model catalogue
  tasks                 Inspect or recover start-command task executions
  archive-session       Sanitize a session file and write it to stdout
  archive-sessions      Stage sanitized sessions associated with a public repository
  archive-publish       Publish a reviewed session archive to GitHub
  archive-overview      Render a source inventory from local archive manifests
  proxy-test            Verify Telegram text and media on a client network
  proxy-pcap            Summarize and compare bounded proxy packet captures
  close-linked-issues   Reconcile issues linked from merged pull requests

SSH options (before COMMAND):
  --host [USER@]HOST    Use an OpenSSH destination or SSH config alias
  --jump HOSTS         Comma-separated OpenSSH jump hosts (-J)
  --ssh-config FILE    Read an alternate SSH configuration (-F)
  --ssh-option OPTION  Pass an OpenSSH option (-o), repeatable
  --ssh-port PORT      SSH port (-p)
  --tty                Request a terminal for interactive remote commands
Run hive-manager deploy --help for deployment options.
HELP
}

deploy_usage() {
  cat <<'HELP'
Usage: hive-manager deploy [OPTIONS] ACTION [ARGS]

  prepare               Pull the selected image before a rollout
  apply | update        Deploy or replace the instance, keeping a rollback
  rollback              Switch back to the previous container
  recover               Complete or undo an interrupted rollout
  status | logs         Show instance status or stream Docker logs
  start | stop | restart
                        Control the instance
  remove                Remove a stopped container and retain its state
  exec [--] COMMAND     Run a command as box in the instance
  auth PROVIDER [login|status]
                        Sign in or check login in the instance
  update-dependencies   Preview or apply Bun global dependency updates as box
  global-tools          Audit or quarantine shared Claude and Codex extensions
  tool-services         Check or stop idle vendor helper processes
  doctor                Check host disk space and instance/runtime status
  diagnose [--since TIME | --task UUID [--attempt NUMBER]] [--resources] [--process PID]
                        Show host resources, container exit facts and optional journal evidence
  disk [--budget SECONDS | --docker-summary]
                        Report host storage and per-task Docker writable layers
  cleanup --scoped      Preview or apply detached host and task cache cleanup
  backup [--output FILE|-]
                        Save a private archive of deployment state
  restore [--input FILE|-]
                        Extract an archive into a new state directory
  reboot --confirm      Reboot the deployment host
  docker-service        Check or start Docker, or enable daemon live restore
  proxy                 Manage an optional Telegram MTProto proxy
  compose ARGS          Run Docker Compose on the target (supports -f, --env-file)
  helm ARGS             Run Helm on the target (uses its kubeconfig)
  cleanup | configure-claude | audit-config | screens | models | tasks
  archive-session | archive-sessions | archive-publish | archive-overview | proxy-test | proxy-pcap | close-linked-issues
                        Run a maintenance command inside the instance

Options (before ACTION):
  --profile FILE        Read target deployment options as key=value lines
  --name NAME           Container name (default: hive-mind)
  --state-dir PATH      Persistent state (default: ~/.hive-mind on the target)
  --variant plain|dind  Image variant (default: plain)
  --image IMAGE         Override the image tag or digest
  --env-file PATH       Private Docker environment file on the target
  --bot-config PATH     Private Telegram LINO configuration on the target
  --tool-policy PATH    Global tool policy JSON on the Docker host
  --docker-socket PATH  Connect plain mode to the specified host Docker socket
                        or use it for host image passthrough in dind mode
  --adopt               Allow replacement of a container created outside the manager
  --setup               Keep the container running for interactive setup
  --no-pull             Use the locally available image during apply
  --dry-run             Print the apply plan without changing the target
  --tty                 Allocate a terminal for Docker exec and inside commands

Apply and update also accept -- COMMAND [ARGS] as the container startup command.
HELP
}

# OpenSSH passes its command through the account's shell. Use POSIX single
# quoting for every word, including the program. Stdin remains available for
# commands such as restore, or for an interactive session.
shell_quote() {
  local escaped=${1//\'/\'\\\'\'}
  printf "'%s'" "$escaped"
}

over_ssh() {
  require ssh
  [[ $host =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.@:+-]*$ || $host =~ ^:[a-fA-F0-9:]+$ ]] || fail "Invalid SSH destination: $host"
  local remote='exec bash -c' word
  for word in "$BASH_EXECUTION_STRING" hive-manager "$@"; do
    remote+=" $(shell_quote "$word")"
  done
  exec ssh "${ssh_options[@]}" "$ssh_terminal" -- "$host" "$remote"
}
maintenance_spec() {
  case "$1" in
    cleanup|hive-cleanup) bin=hive-cleanup; module=cleanup.mjs ;;
    deploy-storage) bin=hive-manager; module=hive-manager/storage/main.mjs ;;
    configure-claude) bin=configure-claude; module=configure-claude.mjs ;;
    screens|hive-screens) bin=hive-screens; module=hive-screens.mjs ;;
    models|hive-models) bin=hive-models; module=hive-models.mjs ;;
    archive-session) bin=hive-manager; module=hive-manager/archive/session.mjs ;;
    archive-sessions) bin=hive-manager; module=hive-manager/archive/sessions.mjs ;;
    archive-publish) bin=hive-manager; module=hive-manager/archive/publish.mjs ;;
    archive-overview) bin=hive-manager; module=hive-manager/archive/overview.mjs ;;
    proxy-test) bin=hive-manager; module=hive-manager/proxy/test.mjs ;;
    proxy-pcap) bin=hive-manager; module=hive-manager/proxy/pcap.mjs ;;
    proxy-legacy) bin=hive-manager; module=hive-manager/proxy/legacy.mjs ;;
    audit-config) bin=hive-manager; module=hive-manager/audit-config.mjs ;;
    update-dependencies) bin=hive-manager; module=hive-manager/maintenance/update-dependencies.mjs ;;
    task-report) bin=hive-manager; module=hive-manager/task/report.mjs ;;
    task-check-browser) bin=hive-manager; module=hive-manager/task/check-browser.mjs ;;
    task-check-uploads) bin=hive-manager; module=hive-manager/task/check-uploads.mjs ;;
    task-recover-failed) bin=hive-manager; module=hive-manager/task/recover-failed.mjs ;;
    task-recover-queue) bin=hive-manager; module=hive-manager/task/recover-queue.mjs ;;
    task-repair-records) bin=hive-manager; module=hive-manager/task/repair-records.mjs ;;
    close-linked-issues) bin=close-linked-issues; module=close-linked-issues.mjs ;;
    *) return 1 ;;
  esac
}
package_source() {
  local entry=${1:-$0} link source_dir
  if [[ $entry != */* ]]; then
    entry=$(command -v hive-manager) || return 1
  fi
  while [[ -L $entry ]]; do
    link=$(readlink "$entry") || return 1
    case "$link" in
      /*) entry=$link ;;
      *) entry=${entry%/*}/$link ;;
    esac
  done
  source_dir=${entry%/*}
  if [[ $entry == */hive-manager/cli.sh ]]; then
    source_dir=${source_dir%/*}
  fi
  [[ -f $source_dir/../package.json && -f $source_dir/hive.mjs ]] || return 1
  cd -- "$source_dir" && pwd -P
}
run_maintenance() {
  local bin module source_path action=$1
  maintenance_spec "$1" || fail "Unknown maintenance command: $1"
  shift
  if source_path=$(package_source) && [[ -f $source_path/$module ]]; then
    require node
    exec node --import "$source_path/hive-manager/lib/terminal.mjs" "$source_path/$module" "$@"
  fi
  if [[ $bin != hive-manager ]] && command -v "$bin" >/dev/null; then
    exec "$bin" "$@"
  fi
  if [[ $bin == hive-manager ]] && source_path=$(package_source "$(command -v hive)") && [[ -f $source_path/$module ]]; then
    require node
    exec node --import "$source_path/hive-manager/lib/terminal.mjs" "$source_path/$module" "$@"
  fi
  require node
  require npm
  # The package provides the same entry points for standalone use and older images.
  local version=${HIVE_MANAGER_PACKAGE_VERSION:-latest}
  [[ $version =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail "Invalid Hive Mind package version"
  if [[ $action == deploy-storage ]]; then
    local subcommand=() storage_action=$1 socket=$2 name=$3 state_dir=$4
    shift 4
    case "$storage_action" in
      disk) subcommand=(disk) ;;
      scoped) subcommand=(cleanup --scoped) ;;
      preserve) subcommand=(tasks preserve-layer) ;;
      cleanup-preserved) subcommand=(tasks cleanup-preserved) ;;
    esac
    local deploy_flags=(--name "$name" --state-dir "$state_dir")
    if [[ $socket ]]; then deploy_flags+=(--docker-socket "$socket"); fi
    exec npm exec --yes --package "@link-assistant/hive-mind@$version" -- hive-manager deploy "${deploy_flags[@]}" "${subcommand[@]}" "$@"
  fi
  if [[ $action == task-* ]]; then
    exec npm exec --yes --package "@link-assistant/hive-mind@$version" -- hive-manager tasks "${action#task-}" "$@"
  fi
  if [[ $bin == hive-manager ]]; then
    exec npm exec --yes --package "@link-assistant/hive-mind@$version" -- hive-manager "$action" "$@"
  fi
  exec npm exec --yes --package "@link-assistant/hive-mind@$version" -- "$bin" "$@"
}

run_host_maintenance() {
  local action=$1 source_path entry
  shift
  if source_path=$(package_source) || source_path=$(package_source "$(command -v hive)"); then
    entry=$source_path/hive-manager/maintenance/$action.py
    if [[ -f $entry ]]; then
      require python3
      exec python3 -I -B -c '
import os, runpy, sys
sys.argv.pop(0)
sys.path.insert(0, os.path.dirname(sys.argv[0]))
runpy.run_path(sys.argv[0], run_name="__main__")
' "$entry" "$@" --container "$name"
    fi
  fi
  fail "Install a Hive Mind package with $action on the Linux Docker host"
}

auth_args() {
  if [[ ! ${1-} || $1 == --help || $1 == -h || ${2-} == --help || ${2-} == -h ]]; then
    cat <<'HELP'
Usage: hive-manager [deploy [OPTIONS]] auth claude|codex|github [login|status]

login (default) prints the provider's browser instructions. For Claude,
paste the browser's authorization code into the running command. For Codex
and GitHub, enter the displayed one-time code in the browser.
Use status to check the selected environment's sign-in.
HELP
    return
  fi
  (( $# <= 2 )) || fail "Unexpected auth arguments. Enter one-time codes at the provider prompt."
  case "$1 ${2-login}" in
    'claude login') auth_command=(claude auth login) ;;
    'claude status') auth_command=(claude auth status) ;;
    'codex login') auth_command=(codex login --device-auth) ;;
    'codex status') auth_command=(codex login status) ;;
    'github login') auth_command=(env GH_BROWSER=true gh-setup-git-identity --web --skip-ssh-key) ;;
    # github-retry-ok: interactive status reports the provider response and exit status directly
    'github status') auth_command=(gh auth status --hostname github.com) ;;
    *) fail "Unknown auth provider or action. Run hive-manager auth --help." ;;
  esac
}

task_args() {
  local action=${1-}
  if [[ ! $action || $action == --help || $action == -h ]]; then
    printf 'Usage: hive-manager tasks ACTION [ARGS]\n\n'
    printf 'Inspect: list, status, attach, report, check-browser, check-uploads, recover-queue\n'
    printf 'Manage: resume, resume-all, recover-failed, repair-records, stop, terminate, pause, unpause, alias, rename\n'
    printf 'Maintain: cleanup-dry-run, cleanup, backup-container, cleanup-backed-up, upload-log\n'
    return
  fi
  case "$action" in
    list|status|attach|resume|resume-all|stop|terminate|pause|unpause|alias|rename|cleanup-dry-run|cleanup|upload-log)
      task_command=('$' "--$action" "${@:2}") ;;
    *) fail "Unknown task action: $action" ;;
  esac
}

absolute_path() {
  case "$1" in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$PWD" "$1" ;; esac
}

task_backup_identity() {
  local inventory id name status code started finished uuid session
  local uuid_pattern='^[[:xdigit:]]{8}(-[[:xdigit:]]{4}){3}-[[:xdigit:]]{12}$'
  local fields='{{.Id}}|{{.Name}}|{{.State.Status}}|{{.State.ExitCode}}|{{.State.StartedAt}}|{{.State.FinishedAt}}|{{index .Config.Labels "start-command.uuid"}}|{{index .Config.Labels "start-command.session"}}'
  inventory=$(docker container inspect --format "$fields" -- "$1") || fail "Cannot inspect task container: $1"
  IFS='|' read -r id name status code started finished uuid session <<<"$inventory"
  [[ $id =~ ^[a-f0-9]{64}$ && $name =~ ^/[a-zA-Z0-9][a-zA-Z0-9_.-]*$ && $inventory != *$'\n'* ]] || fail "Invalid Docker container identity"
  [[ $status == exited && $code =~ ^[1-9][0-9]*$ ]] || fail "Only stopped task containers with a nonzero exit code can be backed up or cleaned up"
  if [[ $uuid ]]; then
    [[ $uuid =~ $uuid_pattern && $session == "${name#/}" && ( ! $2 || $uuid == "$2" ) ]] || fail "Docker task labels do not match the execution"
  else
    [[ $2 =~ $uuid_pattern ]] || fail "For a container without task labels, provide the exact stored execution with --execution"
    require '$'
    require jq
    '$' --status "$2" --output-format json | jq -e --arg uuid "$2" --arg id "$id" --arg name "${name#/}" --argjson code "$code" '
      .uuid == $uuid and .options.isolated == "docker" and (
        (.status == "executed" and .exitCode == $code and .options.containerId == $id and .options.sessionName == $name)
        or any(.attemptHistory[]?; .exitCode == $code and .containerId == $id and .sessionName == $name)
      )' >/dev/null || fail "The stored execution does not match this failed container"
    uuid=$2
  fi
  printf '%s|%s|%s|%s|%s|%s\n' "$id" "$name" "$uuid" "$code" "$started" "$finished"
}

task_container_backup() (
  if [[ ${1-} == --help || ${1-} == -h ]]; then
    printf 'Usage: hive-manager tasks backup-container CONTAINER --output NEW_DIRECTORY [--execution UUID]\n'
    printf 'Export a flattened filesystem. Preserve mounted data and task logs separately.\n'
    return
  fi
  local container=${1-} output='' execution='' identity stage digest
  [[ $container =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail "Specify a task container name or ID"
  shift
  while (( $# )); do
    need_value "$@"
    case "$1" in
      --output) output=$2 ;;
      --execution) execution=$2 ;;
      *) fail "Unknown backup-container option: $1" ;;
    esac
    shift 2
  done
  [[ $output && $output != / && $output != */ ]] || fail "Specify a new backup directory with --output"
  output=$(absolute_path "$output")
  [[ ! -e $output && ! -L $output ]] || fail "Backup output already exists: $output"
  require docker
  require sha256sum
  require gzip
  require tar
  identity=$(task_backup_identity "$container" "$execution") || return
  umask 077
  stage=$(mktemp -d "$output.part.XXXXXX") || return
  trap 'rm -rf -- "$stage"' EXIT
  docker container export -- "${identity%%|*}" | gzip -n >"$stage/filesystem.tar.gz" || fail "Could not export the stopped task filesystem"
  tar -tzf "$stage/filesystem.tar.gz" >/dev/null || fail "The exported filesystem archive could not be read"
  [[ $(task_backup_identity "${identity%%|*}" "$execution") == "$identity" ]] || fail "The task container changed during backup"
  digest=$(sha256sum <"$stage/filesystem.tar.gz") || return
  printf 'hive-manager-task-backup-v1\n%s\n%s\n' "$identity" "${digest%% *}" >"$stage/receipt.txt"
  mv -nT -- "$stage" "$output" || return
  [[ ! -e $stage ]] || fail "Backup output already exists: $output"
  printf 'Verified flattened task filesystem export: %s\n' "$output"
)

task_cleanup_backed_up() {
  if [[ ${1-} == --help || ${1-} == -h ]]; then
    printf 'Usage: hive-manager tasks cleanup-backed-up BACKUP_DIRECTORY [--apply SHA256]\n'
    printf 'Verify a flattened filesystem export before removing the stopped container.\n'
    return
  fi
  local directory=${1-} approval=${3-} sum receipt output identity id name execution marker archive_digest extra
  [[ $directory && ( $# == 1 || ( $# == 3 && $2 == --apply && $approval =~ ^[a-f0-9]{64}$ ) ) ]] || fail "Supply a backup directory and optionally --apply with the reviewed SHA-256"
  require docker
  require sha256sum
  receipt=$directory/receipt.txt
  [[ -d $directory && ! -L $directory && -f $receipt && ! -L $receipt && -f $directory/filesystem.tar.gz && ! -L $directory/filesystem.tar.gz ]] || fail "A task backup archive and receipt are required"
  [[ $(wc -c <"$receipt") -le 1024 ]] || fail "Invalid task backup receipt"
  sum=$(sha256sum <"$receipt") || return
  sum=${sum%% *}
  [[ ! $approval || $approval == "$sum" ]] || fail "The reviewed task backup receipt changed"
  {
    if ! IFS= read -r marker || ! IFS= read -r identity || ! IFS= read -r archive_digest; then
      fail "Invalid task backup receipt"
    fi
    if IFS= read -r extra || [[ $extra ]]; then fail "Invalid task backup receipt"; fi
  } <"$receipt"
  [[ $marker == hive-manager-task-backup-v1 && $archive_digest =~ ^[a-f0-9]{64}$ ]] || fail "Invalid task backup receipt"
  output=$(sha256sum <"$directory/filesystem.tar.gz") || return
  [[ ${output%% *} == "$archive_digest" ]] || fail "The saved filesystem SHA-256 does not match the receipt"
  IFS='|' read -r id name execution _ <<<"$identity"
  [[ $id =~ ^[a-f0-9]{64}$ && $(task_backup_identity "$id" "$execution") == "$identity" ]] || fail "The stopped task container does not match the backup receipt"
  output=$(sha256sum <"$receipt") || return
  [[ ${output%% *} == "$sum" ]] || fail "The task backup receipt changed during verification"
  if [[ $approval ]]; then
    docker container rm -- "$id"
  else
    printf 'Stopped task container eligible for cleanup: %s (%s)\nExecution: %s\nApproval SHA-256: %s\n' "${name#/}" "$id" "$execution" "$sum"
  fi
}

container_id() {
  docker container inspect --format '{{.Id}}' "$1" 2>/dev/null
}

container_running() {
  [[ $(docker container inspect --format '{{.State.Running}}' "$1") == true ]]
}

container_ready() {
  local attempt running consecutive=0
  for ((attempt = 0; attempt < 40; attempt++)); do
    running=$(docker container inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1") || return
    case "$running" in
      healthy) return 0 ;;
      running)
        consecutive=$((consecutive + 1))
        if (( consecutive >= 3 )); then return 0; fi ;;
      exited|dead|unhealthy|restarting) return 1 ;;
    esac
    sleep 1
  done
  return 1
}

lock_deployment() {
  # The lock is outside the backed-up state and shared by custom state paths
  # for the same container. Docker enforces name uniqueness across hosts.
  local user_id lock_root
  user_id=$(id -u)
  lock_root=${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/hive-manager-$user_id
  (umask 077 && mkdir -p -- "$lock_root")
  [[ ! -L $lock_root && -O $lock_root ]] || fail "Unsafe lock directory: $lock_root"
  local lock_path=$lock_root/${1:-$name}
  if command -v flock >/dev/null; then
    exec 9>"$lock_path"
    flock -n 9 || fail "Deployment ${1:-$name} is already being changed"
  else
    deployment_lock_directory=$lock_path.lock
    mkdir -- "$deployment_lock_directory" || fail "Deployment ${1:-$name} is locked at $deployment_lock_directory"
    trap 'rmdir -- "$deployment_lock_directory"' EXIT
  fi
}

inside() {
  local flags=(--user box -i)
  if (( tty )); then flags+=(-t); fi
  exec docker exec "${flags[@]}" "$name" "$@"
}

init_state() {
  (umask 077 && mkdir -p -- "$state_dir")
  (
    local item stage
    local missing=()
    for item in claude codex agents gh git hive start-command start-logs; do
      if [[ ! -e $state_dir/$item && ! -L $state_dir/$item ]]; then
        missing+=("$item")
      else
        [[ -d $state_dir/$item ]] || fail "Expected directory: $state_dir/$item"
      fi
    done
    if [[ ! -e $state_dir/claude.json && ! -L $state_dir/claude.json ]]; then
      missing+=(claude.json)
    else
      [[ -f $state_dir/claude.json ]] || fail "Expected file: $state_dir/claude.json"
    fi
    if (( ${#missing[@]} == 0 )); then return; fi
    stage=$(mktemp -d "$state_dir/.init.XXXXXX")
    trap 'rm -rf -- "$stage"' EXIT
    for item in "${missing[@]}"; do
      if [[ $item == claude.json ]]; then
        (umask 077 && printf "{}\n" > "$stage/$item")
      else
        (umask 077 && mkdir -- "$stage/$item")
      fi
    done
    docker run --pull never --rm --network none --user root --entrypoint bash \
      --mount "type=bind,source=$stage,target=/mnt" "$image_id" -c '
        set -e
        umask 077
        for config in claude/settings.json codex/config.toml; do
          if [[ -d /mnt/${config%/*} && -f /home/box/.$config ]]; then
            cp -- "/home/box/.$config" "/mnt/$config"
          fi
        done
        if [[ -d /mnt/git ]]; then touch /mnt/git/config; fi
        chown -R box:box /mnt/*
      '
    for item in "${missing[@]}"; do
      mv -nT -- "$stage/$item" "$state_dir/$item"
      [[ ! -e $stage/$item ]] || fail "State appeared during initialization: $state_dir/$item"
    done
  )
}

deployment_args() {
  local source
  [[ $state_dir != *','* && $state_dir != *'"'* && $state_dir != *$'\n'* ]] || fail "Unsupported characters in state directory"
  admission_flags=(
    --user box
    --mount "type=bind,source=$state_dir/claude,target=/home/box/.claude"
    --mount "type=bind,source=$state_dir/claude.json,target=/home/box/.claude.json"
    --mount "type=bind,source=$state_dir/codex,target=/home/box/.codex"
    --mount "type=bind,source=$state_dir/agents,target=/home/box/.agents"
    --mount "type=bind,source=$state_dir/gh,target=/home/box/.config/gh"
    --mount "type=bind,source=$state_dir/git,target=/home/box/.config/git"
    --mount "type=bind,source=$state_dir/hive,target=/home/box/.hive-mind"
    --mount "type=bind,source=$state_dir/start-command,target=/home/box/.start-command"
    --mount "type=bind,source=$state_dir/start-logs,target=/tmp/start-command/logs"
    --env GIT_CONFIG_GLOBAL=/home/box/.config/git/config
  )
  if [[ $variant == plain && ! $socket ]]; then
    admission_flags+=(--env TELEGRAM_ISOLATION=screen)
  fi
  if [[ $env_file ]]; then
    [[ -f $env_file && -r $env_file ]] || fail "Cannot read environment file: $env_file"
    admission_flags+=(--env-file "$env_file")
  fi
  if [[ $bot_config ]]; then
    source=$(absolute_path "$bot_config")
    [[ -f $source && $source != *','* && $source != *'"'* ]] || fail "Invalid bot configuration file: $bot_config"
    admission_flags+=(--mount "type=bind,source=$source,target=/home/box/telegram-manager.lino,readonly"
      --env HIVE_MIND_CONFIGURATION_FILE=/home/box/telegram-manager.lino)
  fi
  docker_args=(--label io.github.link-assistant.hive-manager.instance="$name"
    --label io.github.link-assistant.hive-manager.image="$image"
    --restart unless-stopped --init "${admission_flags[@]}")
  if [[ $variant == dind ]]; then
    docker_args+=(--privileged --mount "type=volume,source=$name-dind-data,target=/var/lib/docker")
  fi
  if [[ $socket ]]; then
    [[ -S $socket && $socket != *','* && $socket != *'"'* ]] || fail "Invalid Docker socket: $socket"
    local group
    group=$(stat -c '%g' -- "$socket" 2>/dev/null || stat -f '%g' "$socket")
    docker_args+=(--group-add "$group")
    if [[ $variant == dind ]]; then
      docker_args+=(--mount "type=bind,source=$socket,target=/var/run/host-docker.sock,readonly"
        --env DIND_HOST_PASSTHROUGH_IMAGES="$image" --env HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG="$image")
    else
      docker_args+=(--mount "type=bind,source=$socket,target=/var/run/docker.sock")
    fi
  fi
}

instance_owner() {
  docker container inspect --format '{{index .Config.Labels "io.github.link-assistant.hive-manager.instance"}}' "$1"
}

owns_container() {
  local container=$1 witness=$2
  if [[ $(instance_owner "$container") == "$name" ]]; then return 0; fi
  [[ $witness && $(instance_owner "$witness") == "$name" &&
    $(docker container inspect --format '{{index .Config.Labels "io.github.link-assistant.hive-manager.adopted"}}' "$witness") == "$container" ]]
}

check_rollout_names() {
  local suffix
  for suffix in previous candidate; do
    if container_id "$name.$suffix" >/dev/null; then
      fail "Reserved rollout name exists: $name.$suffix. Inspect the instance or run deploy recover."
    fi
  done
  local current=$1 rollback=$2
  if [[ $current ]] && ! owns_container "$current" "$rollback"; then
    (( adopt )) || fail "Container $current belongs to another deployment. Use --adopt only for your existing instance."
  fi
  if [[ $rollback ]] && ! owns_container "$rollback" "$current"; then
    (( adopt )) || fail "Container $rollback belongs to another deployment. Use --adopt only for your existing instance."
  fi
}

activate_candidate() {
  local target=$1 candidate=$2 old=$3 old_running=$4
  if [[ $old ]]; then
    if [[ $old_running == true ]] && ! docker stop "$old" >/dev/null; then
      docker rm "$candidate" >/dev/null
      fail "Could not stop $target"
    fi
    if ! docker rename "$old" "$target.previous"; then
      docker rm "$candidate" >/dev/null
      if [[ $old_running == true ]]; then docker start "$old" >/dev/null; fi
      fail "Could not reserve the old container: $target"
    fi
  fi
  if ! docker rename "$candidate" "$target" || ! docker start "$candidate" >/dev/null || ! container_ready "$candidate"; then
    docker rm -f "$candidate" >/dev/null
    if [[ $old ]]; then
      docker rename "$old" "$target"
      if [[ $old_running == true ]]; then docker start "$old" >/dev/null; fi
    fi
    fail "Deployment failed to start: $target"
  fi
}

apply_deployment() {
  local docker_args admission_flags startup=("$@")
  if (( setup )); then
    (( $# == 0 )) || fail "Choose --setup or a custom startup command"
    startup=(sleep infinity)
  elif (( $# == 0 )); then
    [[ $env_file || $bot_config ]] || fail "Supply --bot-config, --env-file, a startup command, or --setup"
    startup=(hive-telegram-bot)
  fi
  deployment_args

  if (( dry_run )); then
    printf 'Instance %s\nImage %s\nState %s\n' "$name" "$image" "$state_dir"
    printf 'Docker options:'
    printf ' %q' "${docker_args[@]}"
    printf '\nStartup executable: %q\n' "${startup[0]}"
    return
  fi

  lock_deployment
  local old prior candidate image_id old_running=false
  old=$(container_id "$name") || old=''
  prior=$(container_id "$name.rollback") || prior=''
  check_rollout_names "$old" "$prior"
  if [[ $prior ]] && container_running "$prior"; then fail "Rollback container is running: $name.rollback"; fi
  if [[ $old ]]; then
    container_running "$old" && old_running=true
    if [[ $(instance_owner "$old") != "$name" ]]; then
      docker_args+=(--label io.github.link-assistant.hive-manager.adopted="$old")
    fi
  fi
  if (( pull_image )); then docker pull "$image"; fi
  image_id=$(docker image inspect --format '{{.Id}}' "$image")
  init_state

  # Validate stock binaries and the image baseline without mounting live state.
  # Validate bot configuration separately before stopping the active instance.
  docker run --pull never --rm --network none --user box --entrypoint bash "$image_id" -c '
    set -e
    hive_source=$(readlink -f "$(command -v hive)")
    verifier=${hive_source%/*}/verify-agent-runtime.mjs
    if [[ -f $verifier ]]; then exec node "$verifier"; fi
    exec hive --version
  '
  if [[ ${startup[0]} == hive-telegram-bot ]]; then
    docker run --pull never --rm --network none "${admission_flags[@]}" --entrypoint hive-telegram-bot "$image_id" --dry-run
  fi

  candidate=$(docker create --pull never --name "$name.candidate" "${docker_args[@]}" \
    --label io.github.link-assistant.hive-manager.predecessor="$old" \
    --label io.github.link-assistant.hive-manager.predecessor-running="$old_running" \
    "$image_id" "${startup[@]}")
  activate_candidate "$name" "$candidate" "$old" "$old_running"
  if [[ $old ]]; then
    # Retain the previous rollback until the candidate starts.
    if [[ $prior ]]; then docker rm "$prior" >/dev/null; fi
    docker rename "$old" "$name.rollback"
  fi
  printf 'Deployed %s using %s\n' "$name" "$image"
}

rollback_deployment() {
  lock_deployment
  local current previous current_running=false
  current=$(container_id "$name") || fail "Container not found: $name"
  previous=$(container_id "$name.rollback") || fail "Rollback container not found: $name.rollback"
  check_rollout_names "$current" "$previous"
  if container_running "$previous"; then fail "Rollback container is running: $name.rollback"; fi
  if container_running "$current"; then
    current_running=true
    docker stop "$current" >/dev/null
  fi
  if ! docker rename "$current" "$name.previous"; then
    if [[ $current_running == true ]]; then docker start "$current" >/dev/null; fi
    fail "Could not reserve the current container"
  fi
  if docker rename "$previous" "$name" && docker start "$previous" >/dev/null && container_ready "$previous"; then
    docker rename "$current" "$name.rollback"
    printf 'Rolled back %s\n' "$name"
  else
    docker stop "$previous" >/dev/null 2>&1 || :
    docker rename "$previous" "$name.rollback" 2>/dev/null || :
    docker rename "$current" "$name"
    if [[ $current_running == true ]]; then docker start "$current" >/dev/null; fi
    fail "Rollback failed to start: $name"
  fi
}

recover_deployment() {
  lock_deployment
  local previous current prior candidate predecessor was_running
  previous=$(container_id "$name.previous") || previous=''
  current=$(container_id "$name") || current=''
  prior=$(container_id "$name.rollback") || prior=''
  candidate=$(container_id "$name.candidate") || candidate=''
  [[ $previous || $candidate ]] || fail "No interrupted rollout for $name"
  if [[ $candidate ]]; then
    predecessor=$(docker container inspect --format '{{index .Config.Labels "io.github.link-assistant.hive-manager.predecessor"}}' "$candidate")
    was_running=$(docker container inspect --format '{{index .Config.Labels "io.github.link-assistant.hive-manager.predecessor-running"}}' "$candidate")
    [[ $(instance_owner "$candidate") == "$name" && $predecessor == "${previous:-$current}" &&
      ( $was_running == true || $was_running == false ) ]] || fail "Unexpected rollout candidate: $name.candidate"
    if container_running "$candidate"; then fail "Rollout candidate is running: $name.candidate"; fi
  else
    # Older rollouts have no marker for the original running state.
    was_running=true
  fi
  if [[ $previous ]] && ! owns_container "$previous" "${candidate:-$current}" && ! owns_container "$previous" "$prior"; then
    (( adopt )) || fail "Use --adopt to recover the previous externally managed container"
  fi
  if [[ $candidate ]]; then
    if [[ ! $previous && ! $current ]]; then
      docker rm "$candidate" >/dev/null
      printf 'Discarded incomplete first deployment of %s\n' "$name"
      return
    fi
    if [[ ! $previous ]]; then
      owns_container "$current" "$candidate" || fail "Current container is owned by another deployment: $name"
      if [[ $was_running == true ]] && ! container_running "$current"; then docker start "$current" >/dev/null; fi
      docker rm "$candidate" >/dev/null
      deploy_status
      return
    fi
    [[ ! $current ]] || fail "Unexpected current container beside interrupted rollout: $name"
  fi
  if [[ $current ]] && ! owns_container "$current" "$previous"; then
    fail "Current container is owned by another deployment: $name"
  fi
  if [[ $current ]] && container_ready "$current"; then
    if [[ $prior ]]; then
      if ! owns_container "$prior" "$current" && ! owns_container "$prior" "$previous"; then
        (( adopt )) || fail "Use --adopt to replace the externally managed rollback container"
      fi
      docker rm "$prior" >/dev/null
    fi
    docker rename "$previous" "$name.rollback"
  else
    if [[ $current ]]; then docker rm -f "$current" >/dev/null; fi
    docker rename "$previous" "$name"
    if [[ $was_running == true ]]; then docker start "$previous" >/dev/null; fi
    if [[ $candidate ]]; then docker rm "$candidate" >/dev/null; fi
  fi
  deploy_status
}

backup_state() {
  local output='' part
  if (( $# )); then
    [[ $# == 2 && $1 == --output ]] || fail "Usage: deploy backup [--output FILE|-]"
    output=$2
  fi
  lock_deployment
  [[ -d $state_dir ]] || fail "State directory not found: $state_dir"
  output=${output:-$PWD/$name-$(date -u +%Y%m%dT%H%M%SZ).tar.gz}
  if [[ $output == - ]]; then
    tar -czf - -C "$state_dir" .
    return
  fi
  output=$(absolute_path "$output")
  local state_path output_dir
  state_path=$(cd -- "$state_dir" && pwd -P)
  output_dir=${output%/*}
  output_dir=$(cd -- "${output_dir:-/}" && pwd -P)
  [[ "$output_dir/" != "$state_path/"* ]] || fail "Choose an archive outside the state directory"
  (
    umask 077
    part=$(mktemp "$output.part.XXXXXX")
    trap 'rm -f -- "$part"' EXIT
    tar -czf "$part" -C "$state_dir" .
    ln -T -- "$part" "$output"
  )
  printf '%s\n' "$output"
}

restore_state() {
  local input=- stage
  if (( $# )); then
    [[ $# == 2 && $1 == --input ]] || fail "Usage: deploy restore [--input FILE|-]"
    input=$2
  fi
  lock_deployment
  [[ ! -e $state_dir && ! -L $state_dir ]] || fail "Restore requires a new state directory: $state_dir"
  (
    umask 077
    stage=$(mktemp -d "$state_dir.part.XXXXXX")
    trap 'rm -rf -- "$stage"' EXIT
    tar -xzf "$input" -C "$stage"
    # Rename without replacing a directory created since the initial check.
    mv -nT -- "$stage" "$state_dir"
    [[ ! -e $stage ]] || fail "State directory already exists: $state_dir"
  )
  printf 'Restored %s\n' "$state_dir"
}

deploy_status() {
  docker container inspect --format '{{.Name}} {{.State.Status}} image={{or (index .Config.Labels "io.github.link-assistant.hive-manager.image") .Config.Image}}{{if .State.Health}} health={{.State.Health.Status}}{{end}}' "$name"
}

doctor() {
  local probe_path=$state_dir
  while [[ ! -d $probe_path && $probe_path != / ]]; do
    probe_path=${probe_path%/*}
    probe_path=${probe_path:-/}
  done
  df -h -- "$probe_path"
  docker version --format 'Docker server {{.Server.Version}}'
  deploy_status
  if container_running "$name"; then
    docker exec --user box "$name" bash -c '
      set -e
      hive_source=$(readlink -f "$(command -v hive)")
      hive --version
      verifier=${hive_source%/*}/verify-agent-runtime.mjs
      if [[ -f $verifier ]]; then exec node "$verifier"; fi
    '
  fi
}

sample_container_process() {
  docker exec --user box -i "$name" bash -s -- "$1" <<'PROCESS_SAMPLE'
set -o pipefail
proc=/proc/$1
process_start() {
  awk '{ sub(/^.*\) /, ""); print $20 }' "$proc/stat" 2>/dev/null
}

socket_sample() {
  timeout 4 python3 -I - "$proc/fd" <<'UNIX_QUEUES'
import errno
import itertools
import os
import re
import socket
import struct
import sys
from functools import lru_cache

# Linux uapi/linux/{netlink,sock_diag,unix_diag}.h. Query socket inodes
# individually so the sample reads only the selected process and its peers.
NETLINK_SOCK_DIAG = 4
SOCK_DIAG_BY_FAMILY = 20
NLM_F_REQUEST = 1
NLMSG_ERROR = 2
UDIAG_SHOW_PEER, UDIAG_SHOW_RQLEN = 0x04, 0x10
UNIX_DIAG_PEER, UNIX_DIAG_RQLEN = 2, 4
TCP_ESTABLISHED = 1
NO_COOKIE = 0xFFFFFFFF
header = struct.Struct("=IHHII")
message = struct.Struct("=BBBBIII")
attribute = struct.Struct("=HH")

@lru_cache(maxsize=1024)
def queues(inode):
    request = struct.pack("=BBHIIIII", socket.AF_UNIX, 0, 0, 0, inode,
                          UDIAG_SHOW_PEER | UDIAG_SHOW_RQLEN, NO_COOKIE, NO_COOKIE)
    diagnostic.send(header.pack(header.size + len(request), SOCK_DIAG_BY_FAMILY, NLM_F_REQUEST, 1, 0) + request)
    response, (sender, groups) = diagnostic.recvfrom(4096)
    length, kind, _, sequence, _ = header.unpack_from(response)
    if sender or groups or sequence != 1 or not header.size <= length <= len(response):
        raise ValueError("Invalid socket diagnostic response")
    if kind == NLMSG_ERROR:
        error, = struct.unpack_from("=i", response, header.size)
        if error == -errno.ENOENT:
            return None
        raise OSError(-error, "Unix socket diagnostic query failed")
    family, socket_type, state, _, reported_inode, _, _ = message.unpack_from(response, header.size)
    if (kind, family, reported_inode) != (SOCK_DIAG_BY_FAMILY, socket.AF_UNIX, inode):
        raise ValueError("Unexpected socket diagnostic response")
    if socket_type != socket.SOCK_STREAM or state != TCP_ESTABLISHED:
        return None
    peer, counters = None, None
    offset = header.size + message.size
    while offset + attribute.size <= length:
        size, tag = attribute.unpack_from(response, offset)
        if size < attribute.size or offset + size > length:
            raise ValueError("Invalid socket diagnostic attribute")
        value = offset + attribute.size
        if tag == UNIX_DIAG_PEER and size == attribute.size + 4:
            peer, = struct.unpack_from("=I", response, value)
        if tag == UNIX_DIAG_RQLEN and size == attribute.size + 8:
            counters = struct.unpack_from("=II", response, value)
        offset += (size + 3) & ~3
    return (*counters, peer) if counters else None

try:
    with socket.socket(socket.AF_NETLINK, socket.SOCK_RAW, NETLINK_SOCK_DIAG) as diagnostic, os.scandir(sys.argv[1]) as descriptors:
        diagnostic.settimeout(1)
        diagnostic.connect((0, 0))
        for descriptor in itertools.islice(descriptors, 512):
            try:
                target = os.readlink(descriptor.path)
            except FileNotFoundError:
                continue
            match = re.fullmatch(r"socket:\[(\d+)\]", target)
            if not match:
                continue
            inode = int(match[1])
            if not 0 < inode <= 0xFFFFFFFF:
                continue
            result = queues(inode)
            if result:
                received, sent, peer = result
                peer_queues = queues(peer) if peer else None
                print(inode, descriptor.name, received, sent, peer_queues[1] if peer_queues else "unknown")
except (OSError, ValueError, struct.error):
    sys.exit(1)
UNIX_QUEUES
}

started=$(process_start)
if [[ ! $started ]]; then
  printf 'Process %s is unavailable in the container\n' "$1" >&2
  exit 1
fi
socket_evidence=false
if command -v python3 >/dev/null && command -v timeout >/dev/null && first_queues=$(socket_sample); then socket_evidence=true; fi
first_io=$(cat "$proc/io" 2>/dev/null)
sleep 2
last_io=$(cat "$proc/io" 2>/dev/null)
if $socket_evidence && ! last_queues=$(socket_sample); then socket_evidence=false; fi
syscall=''
if { read -r syscall _ < "$proc/syscall"; } 2>/dev/null; then
  [[ $syscall =~ ^(-?[0-9]+|running)$ ]] || syscall=''
fi
if [[ $(process_start) != "$started" ]]; then
  printf 'Process %s exited or changed during sampling\n' "$1" >&2
  exit 1
fi

printf '\nContainer process %s I/O over a two-second sample\n' "$1"
if [[ $first_io && $last_io ]]; then
  printf '%s\n--\n%s\n' "$first_io" "$last_io" | awk '
    $0 == "--" { after = 1; next }
    $1 ~ /^(rchar:|wchar:|syscr:|syscw:)$/ && $2 ~ /^[0-9]+$/ {
      if (!after) start[$1] = $2
      else if ($1 in start && $2 >= start[$1]) printf "%s +%.0f\n", $1, $2 - start[$1]
    }
  '
else
  printf 'Process I/O counters unavailable\n'
fi
printf 'Current syscall: %s\n' "${syscall:-unavailable}"
if $socket_evidence; then
  printf 'Unix stream socket backlog (bytes, up to 20 endpoints)\n'
  printf '%s\n--\n%s\n' "$first_queues" "$last_queues" | awk '
    $0 == "--" { after = 1; next }
    NF == 5 && !after { recv[$1] = $3; send[$1] = $4; peer[$1] = $5; next }
    NF == 5 && ($3 > 0 || $4 > 0 || ($5 != "unknown" && $5 > 0)) && count++ < 20 {
      printf "fd %s receive %s -> %s, send %s -> %s, peer send %s -> %s\n",
        $2, ($1 in recv ? recv[$1] : "unknown"), $3,
        ($1 in send ? send[$1] : "unknown"), $4, ($1 in peer ? peer[$1] : "unknown"), $5
    }
    END { if (!count) print "No queued bytes found on sampled Unix stream sockets" }
  '
else
  printf 'Unix socket queues unavailable\n'
fi
PROCESS_SAMPLE
}

diagnose_restart() {
  local started finished boot tail_journal daemon_events
  started=$(date -d "$1" +%s) || return 0
  finished=$(date -d "$2" +%s) || return 0
  # A task's exit may be recorded after Docker comes back following a reboot.
  if command -v jq >/dev/null && boot=$(journalctl --list-boots --lines=30 --output=json --no-pager 2>/dev/null | jq -r --argjson start "$started" --argjson end "$finished" '
    select(type == "array") as $boots
    | [range(0; ($boots | length) - 1) as $i
       | $boots[$i] as $old | $boots[$i + 1] as $new
       | (($old.last_entry | tonumber?) / 1000000) as $last
       | (($new.first_entry | tonumber?) / 1000000) as $next
       | select($last >= $start and $last <= $end + 120 and $next >= $last and $next >= $end - 120 and $next <= $end + 300)
       | $old.boot_id] | last // empty'); then
    if [[ $boot =~ ^[a-f0-9]{32}$ ]] && tail_journal=$(journalctl --boot="$boot" --lines=20 --output=cat --no-pager 2>/dev/null) && [[ $tail_journal && $tail_journal != '-- No entries --' ]]; then
      if grep -Eq 'Journal stopped|systemd-shutdown|Reached target .*(Shutdown|Power-Off|Reboot)' <<< "$tail_journal"; then
        printf '\nJournal correlation: host-reboot (shutdown recorded before the next boot)\n'
      else
        printf '\nJournal correlation: host-reset (previous boot ends without a recorded shutdown)\n'
      fi
      return
    fi
  fi
  # A daemon startup on its own may be the consequence of a host reboot.
  daemon_events=$(journalctl --unit=docker.service --since="@$((finished - 120))" --until="@$((finished + 120))" --lines=80 --output=cat --no-pager 2>/dev/null) || return 0
  if awk '/Main process exited|Stopped Docker|Processing signal.*terminated/ { stopped = 1 }
    stopped && tolower($0) ~ /started docker|loading containers: start|starting up/ { started = 1 }
    END { exit !started }' <<< "$daemon_events"; then
    printf '\nJournal correlation: daemon-restart (Docker stop and start recorded near task exit)\n'
  fi
}

diagnose() {
  local usage='Usage: deploy diagnose [--since TIME | --task UUID [--attempt NUMBER]] [--resources] [--process PID]'
  local since='' until='' task='' attempt='' window process='' resources=false
  while (( $# )); do
    case $1 in
      --since) need_value "$@"; since=$2; shift 2 ;;
      --task) need_value "$@"; task=$2; shift 2 ;;
      --attempt) need_value "$@"; attempt=$2; shift 2 ;;
      --resources) resources=true; shift ;;
      --process)
        need_value "$@"
        [[ $2 =~ ^[1-9][0-9]{0,6}$ ]] || fail "Use a positive container process ID"
        process=$2
        shift 2 ;;
      --help|-h) printf '%s\n' "$usage"; return ;;
      *) fail "$usage" ;;
    esac
  done
  [[ ! $task || ! $since ]] && [[ ! $attempt || $task ]] || fail "$usage"
  if [[ $task ]]; then
    local -a selector=(--window "$task")
    if [[ $attempt ]]; then selector+=(--attempt "$attempt"); fi
    window=$(docker exec --user box "$name" hive-manager tasks report "${selector[@]}") || fail "Could not read the task window from $name"
    IFS=$'\t' read -r since until <<< "$window"
    [[ $since && $until ]] || fail "The task report did not return a time window"
    printf 'Task %s window: %s through %s\n' "$task" "$since" "$until"
  fi
  uptime
  if command -v free >/dev/null; then free -h; fi
  df -h -- "$PWD"
  docker info --format 'Docker {{.ServerVersion}} | Live restore: {{.LiveRestoreEnabled}} | Root: {{.DockerRootDir}}' || printf 'Docker daemon unavailable\n'
  if container_id "$name" >/dev/null; then
    docker container inspect --format '{{.Name}} {{.State.Status}} | Exit: {{.State.ExitCode}} | OOM: {{.State.OOMKilled}} | Restarts: {{.RestartCount}} | Finished: {{.State.FinishedAt}}' "$name"
    if container_running "$name"; then
      docker stats --no-stream "$name" || printf 'Container statistics unavailable\n'
      if $resources; then
        printf '\nContainer cgroup counters\n'
        docker exec "$name" sh -c '
          proc_group=$(grep "^0::" /proc/self/cgroup) || exit 1
          group=${proc_group#0::}
          for key in memory.current memory.peak memory.max memory.events cpu.stat cpu.pressure memory.pressure io.pressure pids.current pids.max; do
            metric=/sys/fs/cgroup${group%/}/$key
            if [ -r "$metric" ]; then printf "%s\n" "$key"; cat "$metric"; fi
          done
        ' || printf 'Container cgroup v2 counters unavailable\n'
        printf '\nContainer threads and wait channels (first 80 rows by CPU use)\n'
        docker top "$name" -eLo pid,lwp,ppid,stat,pcpu,wchan:24,comm --sort=-pcpu | awk 'NR <= 81' || printf 'Container process table unavailable\n'
        printf '\nBrowser processes (first 40 rows by CPU use) and shared memory\n'
        docker top "$name" -eo pid,ppid,stat,pcpu,wchan:24,comm --sort=-pcpu |
          awk 'NR == 1 { header=$0; next } tolower($NF) ~ /^(chrome|chromium|firefox|headless_shell|msedge)/ { if (count++ == 0) print header; if (count <= 40) print } END { print "Matching browser processes: " count+0 }' ||
          printf 'Container browser process table unavailable\n'
        docker exec "$name" df -h /dev/shm || printf 'Container shared memory information unavailable\n'
      fi
    fi
  else
    printf 'Container unavailable: %s\n' "$name"
  fi
  if [[ $since ]]; then
    require journalctl
    local -a period=(--since="$since")
    if [[ $until ]]; then period+=(--until="$until"); fi
    printf '\nDocker service events\n'
    journalctl --unit=docker.service "${period[@]}" --lines=80 --no-pager
    printf '\nKernel memory failures\n'
    # With --grep, journalctl uses exit 1 for an empty selection.
    local result=0
    journalctl _TRANSPORT=kernel "${period[@]}" --lines=80 --no-pager --case-sensitive=no --grep='out of memory|oom-kill|killed process' || result=$?
    (( result <= 1 )) || return "$result"
    if [[ $task && $until != now ]]; then diagnose_restart "$since" "$until"; fi
  fi
  if [[ $process ]]; then
    container_running "$name" || fail "Process diagnostics require a running container: $name"
    sample_container_process "$process"
  fi
}

docker_live_restore() (
  [[ $# == 0 || ( $# == 1 && $1 == --apply ) ]] || fail "Usage: deploy docker-service live-restore [--apply]"
  require docker
  local config=/etc/docker/daemon.json changed backup='' original='' unit current
  local -a info=(docker --host unix:///var/run/docker.sock info --format '{{.LiveRestoreEnabled}}')
  current=$("${info[@]}") || fail "Could not query the local Docker daemon"
  if [[ $current == true ]]; then printf 'Docker live restore is enabled\n'; return; fi
  if (( $# == 0 )); then
    printf 'Docker live restore is disabled. Use --apply to enable it on an active systemd Docker service.\n'
    return
  fi
  [[ $current == false ]] || fail "Could not read the daemon's live-restore setting"
  (( EUID == 0 )) || fail "Run with root privileges to enable Docker live restore"
  require dockerd; require systemctl; require jq; require flock
  systemctl is-active --quiet docker.service || fail "The local Docker service must be active"
  unit=$(systemctl show --property=ExecStart --value docker.service) || fail "Cannot inspect docker.service"
  [[ $unit == *dockerd* && $unit != *--config-file* && $unit != *--live-restore* ]] || fail "Docker must use the standard daemon configuration file and set live restore there"
  lock_deployment docker-daemon-config
  [[ ! -L $config && ( ! -e $config || -f $config ) ]] || fail "Expected a regular Docker daemon configuration file"
  mkdir -p -- "${config%/*}"
  changed=$(mktemp -- "$config.hive-manager.XXXXXX")
  trap 'rm -f -- "$changed" "${original:-$changed}"' EXIT
  if [[ -e $config ]]; then
    original=$(mktemp -- "$config.original.XXXXXX")
    cp -p -- "$config" "$original"
    jq -e 'select(type == "object") | .["live-restore"] = true' "$original" > "$changed" || fail "Invalid Docker daemon JSON configuration"
    chmod --reference="$original" "$changed"
    chown --reference="$original" "$changed"
  else
    printf '{"live-restore":true}\n' > "$changed"
  fi
  dockerd --config-file "$changed" --validate >/dev/null 2>&1 || fail "Docker rejected the updated configuration"
  if [[ $original ]]; then
    backup=$(mktemp -- "$config.backup.XXXXXX")
    cat -- "$original" > "$backup"
  fi
  mv -f -- "$changed" "$config"
  if systemctl reload docker.service; then
    local attempt
    for ((attempt = 0; attempt < 10; attempt++)); do
      if [[ $("${info[@]}") == true ]]; then
        printf 'Enabled Docker live restore by reloading docker.service\n'
        if [[ $backup ]]; then printf 'Previous configuration saved in %s\n' "$backup"; fi
        return
      fi
      sleep 1
    done
  fi
  if [[ $original ]]; then mv -f -- "$original" "$config"; else rm -f -- "$config"; fi
  systemctl reload docker.service || fail "Restored the configuration file but could not reload docker.service"
  fail "Docker live restore could not be enabled. Restored the previous configuration."
)

proxy_usage() {
  cat <<'HELP'
Usage: hive-manager deploy proxy [OPTIONS] ACTION

  apply       Create or start the proxy
  update      Replace the proxy and keep its predecessor for review
  rollback    Restore the predecessor of an update or same-port trial
  accept      Remove the retained predecessor after client verification
  trial-plan  Preview a switch to the stopped container named by --candidate
  trial FILE  Switch to --candidate using the reviewed plan (target path or - for stdin)
  inventory   List legacy proxy containers and optional MSS resources
  cleanup-plan stop|remove
              Preview changes to --select NAME and/or --legacy-mss resources
  cleanup FILE
              Apply a reviewed legacy cleanup with deploy --adopt (target path or -)
  status      Check the running proxy, published port and restart policy
  verify      Check status and TCP connectivity to Telegram data centers
  connect     Check TCP from the caller to --public-host and --port
  capture     Capture TCP headers for this port to stdout as a pcap
  snapshot    Record configuration and the secret's SHA-256 hash without writing state
  compare FILE
              Check configuration against a snapshot on the target or - for stdin
  logs        Show the last 100 proxy log lines
  mss-unit    Generate a systemd unit for the proxy port's IPv4 MSS clamp
  stop        Stop the proxy
  remove      Remove the container, retaining its secret
  link        Print the private Telegram link (requires --public-host)

  --port PORT         Published TCP port (default: 443)
  --workers COUNT     Classic MTProto workers from 1 to 6 (default: 4)
  --image IMAGE       Classic MTProto image (default: mtproxy/mtproxy:latest)
  --secret-file PATH  Read a baseline secret or import a classic key during apply/update
  --check-egress      Include namespace TCP checks in snapshot/compare
  --check-mss         Include installed IPv4 TCPMSS rules in snapshot/compare
  --public-host HOST  Public DNS name or IPv4 address used by link
  --proxy-name NAME   Use an existing proxy container name
  --candidate NAME    Staged container for a same-port trial
  --select NAME       Include this legacy container in cleanup (repeatable)
  --legacy-mss        Include the installed legacy MSS unit, script and rules
  --mss BYTES         MSS clamp used by mss-unit (default: 1200)
  --seconds SECONDS   Capture for 1 to 60 seconds (default: 15)
  --interface NAME    Capture interface (default: any)
  --client-ip IP      Restrict capture to a client IPv4 or IPv6 address
HELP
}

proxy_status() {
  local id=${1:-$proxy}
  container_running "$id" || { printf 'Proxy is not running: %s\n' "$proxy" >&2; return 1; }
  [[ $(docker container inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$id") == unless-stopped ]] ||
    { printf 'Unexpected restart policy for %s\n' "$proxy" >&2; return 1; }
  docker port "$id" 443/tcp
}

proxy_bindings() {
  docker container inspect --format '{{range $port, $bindings := .HostConfig.PortBindings}}{{range $bindings}}{{printf "%s %s %s\n" $port .HostPort .HostIp}}{{end}}{{end}}' "$1"
}

proxy_check_binding() {
  local bindings
  bindings=$(proxy_bindings "$1") || return
  # A trial must never stop a container that publishes any other port.
  [[ $bindings && $(awk -v port="$port" '$1 != "443/tcp" || $2 != port' <<< "$bindings") == '' ]] ||
    fail "Container $1 must publish only TCP $port to container port 443"
}

proxy_find() {
  local containers
  containers=$(docker container ls -a --no-trunc --format '{{.ID}} {{.Names}}') || return
  awk -v name="$1" '$2 == name { print $1 }' <<< "$containers"
}

proxy_secret() {
  local value
  [[ -f $1 ]] || fail "Proxy secret file is unavailable: $1"
  value=$(head -c 1025 -- "$1" && printf '.') || fail "Cannot read proxy secret file"
  value=${value%.}
  value=${value%$'\n'}
  value=${value%$'\r'}
  value=${value,,}
  [[ $value =~ ^([a-f0-9]{32}|dd[a-f0-9]{32}|ee[a-f0-9]{32}([a-f0-9]{2}){1,253})$ ]] ||
    fail "Invalid MTProto proxy secret file"
  printf '%s' "$value"
}

proxy_docker_endpoint() {
  if [[ ${DOCKER_CONTEXT-} || ! ${DOCKER_HOST-} ]]; then
    docker context inspect --format '{{.Endpoints.docker.Host}}'
  else
    printf '%s\n' "$DOCKER_HOST"
  fi
}

proxy_namespace_egress() {
  local id=$1 metadata pid sandbox context dc address output result=0
  local observations=()
  local endpoints=(149.154.161.144:8888 149.154.161.184:8888 91.105.192.110:443)
  metadata=$(docker container inspect --format '{{.State.Pid}} {{.NetworkSettings.SandboxKey}}' "$id") || return 3
  read -r pid sandbox <<< "$metadata"
  context=$(proxy_docker_endpoint) || return 3
  # SandboxKey is assigned by Docker on the daemon host. Pin the namespace and
  # confirm its identity before using host tooling inside it.
  if [[ $context == unix://* && $pid =~ ^[1-9][0-9]*$ && $sandbox == /* &&
        $sandbox -ef /proc/$pid/ns/net ]] && command -v timeout >/dev/null && command -v nsenter >/dev/null &&
     { exec 8<"$sandbox"; } 2>/dev/null; then
    local pinned
    pinned=$(docker container inspect --format '{{.State.Pid}} {{.NetworkSettings.SandboxKey}}' "$id") || return 3
    if [[ $metadata == "$pinned" &&
          $sandbox -ef /proc/self/fd/8 && $sandbox -ef /proc/$pid/ns/net ]]; then
      for dc in "${endpoints[@]}"; do
        address=${dc%:*}
        # The marker is emitted only by a shell that nsenter has started.
        if output=$(timeout -k 1 7 nsenter --net=/proc/self/fd/8 -- bash -c '
          if timeout -k 1 5 bash -c '\''exec 3<>"/dev/tcp/$1/$2"'\'' _ "$1" "$2" 2>/dev/null; then
            printf reachable
          else
            printf unreachable
          fi' _ "$address" "${dc##*:}" 2>/dev/null); then
          observations+=("egress $dc=$output")
          if [[ $output != reachable && $result == 0 ]]; then result=1; fi
        else
          observations+=("egress $dc=unavailable")
          result=2
        fi
      done
      exec 8<&-
      pinned=$(docker container inspect --format '{{.State.Pid}} {{.NetworkSettings.SandboxKey}}' "$id") || return 3
      if [[ $metadata == "$pinned" ]]; then
        printf '%s\n' "${observations[@]}"
        return "$result"
      fi
    fi
    exec 8<&-
  fi
  for dc in "${endpoints[@]}"; do printf 'egress %s=unavailable\n' "$dc"; done
  return 2
}

proxy_snapshot_mss() {
  local context rules
  context=$(proxy_docker_endpoint) || return
  if [[ $context != unix://* ]] || ! rules=$(iptables -w -t mangle -S FORWARD 2>/dev/null); then
    printf 'mss=unavailable\n'
    return
  fi
  printf 'mss=observed\n'
  # Compare only the generated manager and legacy port-scoped TCPMSS rules.
  awk -v port="$port" '
    $0 ~ ("^-A FORWARD -p tcp -m tcp --(sport|dport) " port " --tcp-flags SYN,RST SYN -j TCPMSS --set-mss [0-9]+$") ||
    $0 ~ (" --ctorigdstport " port " .*--comment \"?hive-manager-mtproxy-" port "\"? -j TCPMSS --set-mss [0-9]+$") { print "mss-rule=" $0 }
  ' <<< "$rules" | LC_ALL=C sort
}

proxy_snapshot() {
  require sha256sum
  local digest workers_setting id key egress_status=0
  id=$(container_id "$proxy") || fail "Proxy container not found: $proxy"
  key=$(proxy_secret "${secret_input:-$proxy_state/secret}") || return
  digest=$(printf '%s\n' "$key" | sha256sum) || fail "Cannot hash proxy secret"
  docker container inspect --format '{{printf "image=%s\nrunning=%t\nrestart=%s\nnetwork=%s\n" .Image .State.Running .HostConfig.RestartPolicy.Name .HostConfig.NetworkMode}}{{range .HostConfig.Ulimits}}{{if eq .Name "nofile"}}{{printf "nofile=%d:%d\n" .Soft .Hard}}{{end}}{{end}}' "$id" || return
  workers_setting=$(docker container inspect --format '{{range .Config.Env}}{{if eq (index (split . "=") 0) "WORKERS"}}{{println .}}{{end}}{{end}}' "$id") || return
  [[ $workers_setting =~ ^WORKERS=[1-6]$ ]] || workers_setting=WORKERS=unknown
  printf '%s\n' "$workers_setting"
  printf 'secret-sha256=%s\n' "${digest%% *}"
  docker port "$id" 443/tcp | LC_ALL=C sort || return
  if (( observe_egress )); then
    proxy_namespace_egress "$id" || egress_status=$?
    # A failed connection is evidence for a snapshot. A Docker error is not.
    (( egress_status <= 2 )) || return "$egress_status"
  fi
  if (( observe_mss )); then proxy_snapshot_mss; fi
}

proxy_mss_unit() {
  local port=$1 mss=$2 direction rule removes=()
  cat <<'UNIT'
[Unit]
Description=Clamp TCP MSS for a Docker-published Telegram MTProto port
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
UNIT
  for direction in ORIGINAL REPLY; do
    rule="FORWARD -p tcp --tcp-flags SYN,RST SYN -m conntrack --ctstate DNAT --ctorigdstport $port --ctdir $direction -m comment --comment hive-manager-mtproxy-$port -j TCPMSS --set-mss $mss"
    printf "ExecStart=/bin/sh -ec 'iptables -w -t mangle -C %s || iptables -w -t mangle -I %s'\n" "$rule" "$rule"
    removes+=("ExecStopPost=/bin/sh -ec 'if iptables -w -t mangle -C $rule; then iptables -w -t mangle -D $rule; fi'")
  done
  printf '%s\n' "${removes[@]}" '' '[Install]' 'WantedBy=docker.service'
}

proxy_owner() {
  docker container inspect --format '{{with index .Config.Labels "io.github.link-assistant.hive-manager.proxy"}}{{.}}{{end}}' "$1"
}

proxy_authorize() {
  local owner
  owner=$(proxy_owner "$1") || return
  [[ $owner == "$name" || ( ! $owner && $adopt == 1 ) ]] ||
    fail "Container $1 needs --adopt or belongs to a different manager deployment"
}

proxy_running_state() {
  local running
  running=$(docker container inspect --format '{{.State.Running}}' "$1") || return
  [[ $running == true || $running == false ]] || fail "Unexpected proxy running state"
  printf '%s\n' "$running"
}

proxy_restore() {
  local active previous staged
  active=$(proxy_find "$proxy") || return
  previous=$(proxy_find "$proxy.previous") || return
  staged=$(proxy_find "$candidate_name") || return
  if [[ ( $active != "$candidate" || $staged ) && ( $active && $active != "$old" ) ||
        ( $previous && $previous != "$old" ) || ( $staged && $staged != "$candidate" ) ||
        ( $previous != "$old" && $active != "$old" ) ]]; then
    fail "Proxy identities changed. Inspect the rollout before retrying rollback: $proxy_journal"
  fi
  if [[ $active == "$candidate" || $staged == "$candidate" ]]; then
    local running
    running=$(proxy_running_state "$candidate") || return
    if [[ $running == true ]]; then docker stop "$candidate" >/dev/null || return; fi
    if [[ $active == "$candidate" ]]; then docker rename "$candidate" "$candidate_name" || return; fi
  elif [[ $kind == trial ]]; then
    fail "The trial candidate is missing: $candidate"
  fi
  if [[ $previous == "$old" ]]; then docker rename "$old" "$proxy" || return; fi
  local running
  running=$(proxy_running_state "$old") || return
  if [[ $old_running == true && $running == false ]]; then
    docker start "$old" >/dev/null && container_ready "$old" || return
  elif [[ $old_running == false && $running == true ]]; then
    docker stop "$old" >/dev/null || return
  fi
  if [[ $kind == update && ( $active == "$candidate" || $staged == "$candidate" ) ]]; then
    docker rm "$candidate" >/dev/null || return
  fi
  rm -- "$proxy_journal"
}

proxy_switch() {
  local kind=$1
  (
    umask 077
    mkdir -p -- "$state_dir" || exit
    local record
    record=$(mktemp "$proxy_journal.XXXXXXXX") || exit
    trap 'rm -f -- "$record"' EXIT
    printf '%s\n' "$kind" "$old" "$old_running" "$candidate" "$candidate_name" > "$record" &&
      ln -T -- "$record" "$proxy_journal"
  ) || return
  if { [[ $old_running == false ]] || docker stop "$old" >/dev/null; } &&
    docker rename "$old" "$proxy.previous" && docker rename "$candidate" "$proxy" &&
    docker start "$candidate" >/dev/null && container_ready "$candidate" && proxy_status "$candidate"; then
    printf 'Rollback retained for %s. Run the client probe before accepting.\n' "$proxy"
    return
  fi
  proxy_restore || fail "Could not restore the predecessor. Retry proxy rollback with the same deployment options."
  fail "Proxy candidate failed to start. Restored the predecessor."
}

proxy_read_rollout() {
  local record=()
  [[ -f $proxy_journal && ! -L $proxy_journal ]] || fail "No proxy rollout recorded at $proxy_journal"
  mapfile -t record < "$proxy_journal"
  kind=${record[0]-} old=${record[1]-} old_running=${record[2]-} candidate=${record[3]-} candidate_name=${record[4]-}
  [[ ${#record[@]} == 5 && ( $kind == update || $kind == trial ) &&
    $old =~ ^[a-f0-9]{64}$ && $candidate =~ ^[a-f0-9]{64}$ && $old != "$candidate" &&
    ( $old_running == true || $old_running == false ) && $candidate_name =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ &&
    $candidate_name != "$proxy" && $candidate_name != "$proxy.previous" ]] || fail "Invalid proxy rollout record: $proxy_journal"
}

proxy_trial_plan() {
  [[ $candidate_name =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ && $candidate_name != "$proxy" &&
    $candidate_name != "$proxy.previous" && $candidate_name != "$proxy.candidate" ]] ||
    fail "Supply a distinct staged container with --candidate"
  [[ $old ]] || fail "No proxy baseline container exists: $proxy"
  [[ $candidate && $candidate != "$old" ]] || fail "No staged candidate exists: $candidate_name"
  proxy_authorize "$candidate" || return
  proxy_check_binding "$candidate" || return
  [[ $(proxy_running_state "$candidate") == false ]] || fail "The staged proxy candidate must be stopped"
  [[ $(docker container inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$candidate") == unless-stopped ]] ||
    fail "The staged proxy candidate must use --restart unless-stopped"
  printf 'manager=%s\nport=%s\n' "$name" "$port"
  docker container inspect --format 'container={{.Name}} id={{.Id}} image={{.Image}} running={{.State.Running}}{{range $port, $bindings := .HostConfig.PortBindings}}{{range $bindings}}{{printf " binding=%s:%s:%s" .HostIp .HostPort $port}}{{end}}{{end}}' "$old" "$candidate"
}

proxy_init_key() {
  local source='' saved=''
  if [[ $secret_input ]]; then
    source=$(proxy_secret "$secret_input") || return
    if [[ $source == dd* && ${#source} == 34 ]]; then source=${source:2}; fi
    [[ ${#source} == 32 ]] || fail "A classic proxy requires a 32-digit hex key"
  fi
  if [[ $legacy_data ]]; then
    local legacy_key
    legacy_key=$(proxy_secret "$legacy_data/secret") || return
    [[ ${#legacy_key} == 32 && ( ! $source || $source == "$legacy_key" ) ]] ||
      fail "The imported key must match the key in the legacy /data mount"
    source=$legacy_key
  fi
  if [[ -f $proxy_state/secret ]]; then
    saved=$(proxy_secret "$proxy_state/secret") || return
    [[ ${#saved} == 32 && ( ! $source || $source == "$saved" ) ]] || fail "The supplied key differs from the saved classic key"
    return
  fi
  if [[ ! $source ]]; then
    require openssl
    source=$(openssl rand -hex 16) || return
  fi
  (umask 077 && mkdir -p -- "$proxy_state" && set -o noclobber && printf '%s\n' "$source" > "$proxy_state/secret")
}

proxy_deploy() {
  local port=443 workers=4 proxy_image=mtproxy/mtproxy:latest secret_input='' public_host='' proxy='' mss=1200
  local seconds=15 interface=any client_ip='' observe_egress=0 observe_mss=0
  local candidate_name='' legacy_mss=0 legacy_names=()
  while (( $# )); do
    case "$1" in
      -h|--help) proxy_usage; return ;;
      --check-egress) observe_egress=1; shift ;;
      --check-mss) observe_mss=1; shift ;;
      --legacy-mss) legacy_mss=1; shift ;;
      --select|--candidate|--port|--workers|--image|--secret-file|--public-host|--proxy-name|--mss|--seconds|--interface|--client-ip)
        need_value "$@"
        case "$1" in
          --select) legacy_names+=("$2") ;;
          --candidate) candidate_name=$2 ;;
          --port) port=$2 ;;
          --workers) workers=$2 ;;
          --image) proxy_image=$2 ;;
          --secret-file) secret_input=$2 ;;
          --public-host) public_host=$2 ;;
          --proxy-name) proxy=$2 ;;
          --mss) mss=$2 ;;
          --seconds) seconds=$2 ;;
          --interface) interface=$2 ;;
          --client-ip) client_ip=$2 ;;
        esac
        shift 2 ;;
      *) break ;;
    esac
  done
  if (( $# == 0 )); then proxy_usage; return; fi
  case "$1" in
    compare|trial|cleanup) [[ $# == 2 && $2 ]] || fail "Usage: deploy proxy $1 FILE|-" ;;
    cleanup-plan) [[ $# == 2 && ( $2 == stop || $2 == remove ) ]] || fail "Usage: deploy proxy cleanup-plan stop|remove" ;;
    *) (( $# == 1 )) || fail "Unexpected arguments for deploy proxy $1" ;;
  esac
  [[ $port =~ ^[1-9][0-9]{0,4}$ ]] && (( port <= 65535 )) || fail "Invalid proxy port: $port"
  [[ $workers =~ ^[1-6]$ ]] || fail "Proxy workers must be between 1 and 6"
  [[ $proxy_image != -* ]] || fail "Invalid proxy image: $proxy_image"
  proxy=${proxy:-$name-mtproxy-$port}
  [[ $proxy =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail "Invalid proxy name: $proxy"
  local proxy_state=$state_dir/mtproxy-$port key
  local action=$1
  if [[ $action == mss-unit ]]; then
    [[ $mss =~ ^[1-9][0-9]{2,4}$ ]] && (( mss >= 536 && mss <= 65535 )) || fail "Invalid MSS: $mss"
    proxy_mss_unit "$port" "$mss"
    return
  fi
  if [[ $action == capture ]]; then
    [[ $seconds =~ ^[1-9][0-9]?$ ]] && (( seconds <= 60 )) || fail "Capture duration must be between 1 and 60 seconds"
    [[ $interface =~ ^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$ ]] || fail "Invalid capture interface"
    local capture_filter=(tcp port "$port")
    if [[ $client_ip ]]; then
      [[ $client_ip =~ ^[a-fA-F0-9:.]+$ && $client_ip == *[.:]* ]] || fail "Expected a client IP address"
      capture_filter+=(and host "$client_ip")
    fi
    require timeout
    require tcpdump
    # Stop tcpdump with SIGINT so it flushes the capture. Bound packets as well as time.
    exec timeout --preserve-status --signal=INT --kill-after=5 "$seconds" \
      tcpdump -p -n -i "$interface" -s 96 -c 10000 -w - "${capture_filter[@]}"
  fi
  if [[ $action == link || $action == connect ]]; then
    [[ $public_host =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || fail "Supply a public DNS name or IPv4 address with --public-host"
    if [[ $action == connect ]]; then
      require timeout
      timeout 5 bash -c 'exec 3<>"/dev/tcp/$1/$2"' _ "$public_host" "$port" || fail "Cannot reach $public_host:$port"
      printf 'TCP connection to %s:%s succeeded\n' "$public_host" "$port"
      return
    fi
    key=$(proxy_secret "${secret_input:-$proxy_state/secret}") || return
    if [[ ${#key} == 32 ]]; then key=dd$key; fi
    printf 'tg://proxy?server=%s&port=%s&secret=%s\n' "$public_host" "$port" "$key"
    return
  fi
  require docker
  case "$action" in
    logs) exec docker logs --tail 100 "$proxy" ;;
    snapshot) proxy_snapshot ;;
    compare)
      local snapshot
      snapshot=$(proxy_snapshot) || return
      require diff
      diff -q -- "$2" <(printf '%s\n' "$snapshot") >/dev/null || fail "Proxy configuration differs from the supplied snapshot or the snapshot could not be read"
      if [[ $snapshot == *'=unavailable'* ]]; then fail "Requested proxy observations are unavailable"; fi
      printf 'Proxy configuration matches the supplied snapshot\n' ;;
    status) proxy_status ;;
    verify)
      local id egress_status=0
      id=$(container_id "$proxy") || fail "Proxy container not found: $proxy"
      proxy_status "$id"
      proxy_check_binding "$id"
      proxy_namespace_egress "$id" || egress_status=$?
      if (( egress_status == 2 )); then fail "Proxy namespace observations are unavailable. Run on the Docker host with network namespace access."; fi
      if (( egress_status == 1 )); then fail "Cannot reach all Telegram data centers from the proxy namespace"; fi
      return "$egress_status" ;;
    inventory|cleanup-plan|cleanup)
      local legacy_args=()
      if (( dry_run )) && [[ $action == cleanup ]]; then fail "Use proxy cleanup-plan to preview cleanup"; fi
      if [[ $action == cleanup ]]; then
        (( adopt )) || fail "Use --adopt to apply a reviewed legacy cleanup plan"
        legacy_args+=(--adopt)
      fi
      if (( legacy_mss )); then legacy_args+=(--legacy-mss); fi
      local selected
      for selected in "${legacy_names[@]}"; do legacy_args+=(--select "$selected"); done
      run_maintenance proxy-legacy "${legacy_args[@]}" "$@" ;;
    apply|update|stop|remove|trial-plan|trial|rollback|accept)
      if (( dry_run )) && [[ $action != trial-plan ]]; then
        printf 'Proxy action: %s\nContainer: %s\nPort: %s\nImage: %s\n' "$action" "$proxy" "$port" "$proxy_image"
        return
      fi
      if [[ $action != trial-plan ]]; then lock_deployment mtproxy; fi
      local old old_running=false candidate owner proxy_image_id kind previous legacy_data='' staged
      local proxy_journal=$state_dir/.mtproxy-$port.$proxy.rollout
      if [[ $action == rollback || $action == accept ]]; then
        proxy_read_rollout
        if [[ $action == rollback ]]; then proxy_restore; return; fi
        [[ $(proxy_find "$proxy") == "$candidate" ]] || fail "The recorded candidate is not active"
        container_ready "$candidate" || fail "The candidate is not ready"
        proxy_status "$candidate"
        previous=$(proxy_find "$proxy.previous") || return
        [[ ! $previous || $previous == "$old" ]] || fail "The retained container does not match the recorded predecessor"
        if [[ $previous ]]; then docker rm "$old" >/dev/null; fi
        rm -- "$proxy_journal"
        return
      fi
      [[ ! -e $proxy_journal && ! -L $proxy_journal ]] || fail "Accept or roll back the outstanding proxy rollout first"
      previous=$(proxy_find "$proxy.previous") || return
      [[ ! $previous ]] || fail "Reserved proxy name exists: $proxy.previous"
      old=$(proxy_find "$proxy") || return
      if [[ $old ]]; then
        proxy_authorize "$old"
        proxy_check_binding "$old"
        owner=$(proxy_owner "$old") || return
        old_running=$(proxy_running_state "$old") || return
      fi
      case "$action" in
        stop|remove)
          [[ $old ]] || fail "Proxy container not found: $proxy"
          if [[ $old_running == true ]]; then docker stop "$old" >/dev/null; fi
          if [[ $action == remove ]]; then docker rm "$old" >/dev/null; fi
          return ;;
        trial-plan|trial)
          local reviewed
          candidate=$(proxy_find "$candidate_name") || return
          reviewed=$(proxy_trial_plan) || return
          if [[ $action == trial-plan ]]; then
            printf '%s\n' "$reviewed"
            return
          fi
          diff -q -- "$2" <(printf '%s\n' "$reviewed") >/dev/null ||
            fail "Proxy trial differs from the supplied plan or the plan could not be read"
          proxy_switch trial
          return ;;
        apply)
          if [[ $old && $owner ]]; then
            if [[ $old_running == false ]]; then docker start "$old" >/dev/null; fi
            proxy_status "$old"
            return
          fi ;;
      esac
      [[ $proxy_state != *','* && $proxy_state != *'"'* ]] || fail "Invalid proxy state directory"
      local binding bindings ip workers_setting publish=()
      if [[ $old ]]; then
        bindings=$(proxy_bindings "$old") || return
        while read -r binding _ ip; do
          if [[ $ip == *:* ]]; then ip="[$ip]"; fi
          publish+=(--publish "${ip:+$ip:}$port:${binding%/tcp}")
        done <<< "$bindings"
        legacy_data=$(docker container inspect --format '{{range .Mounts}}{{if and (eq .Destination "/data") (eq .Type "bind")}}{{.Source}}{{end}}{{end}}' "$old") || return
        if [[ ! $owner ]]; then
          if [[ $action == apply ]]; then
            [[ $legacy_data || $secret_input ]] || fail "Supply the legacy classic proxy key with --secret-file"
            proxy_image=$(docker container inspect --format '{{.Image}}' "$old") || return
            workers_setting=$(docker container inspect --format '{{range .Config.Env}}{{if eq (index (split . "=") 0) "WORKERS"}}{{println .}}{{end}}{{end}}' "$old") || return
            if [[ $workers_setting =~ ^WORKERS=([1-6])$ ]]; then workers=${BASH_REMATCH[1]}; fi
          elif [[ ! $legacy_data && ! $secret_input ]]; then
            fail "Supply an existing classic key with --secret-file when replacing an unmanaged proxy"
          fi
        fi
      else
        publish=(--publish "$port:443")
      fi
      proxy_init_key
      candidate_name=$proxy.candidate
      staged=$(proxy_find "$candidate_name") || return
      [[ ! $staged ]] || fail "Reserved proxy name exists: $candidate_name"
      if (( pull_image )) && [[ ! ( $old && ! $owner && $action == apply ) ]]; then docker pull "$proxy_image"; fi
      proxy_image_id=$(docker image inspect --format '{{.Id}}' "$proxy_image") || return
      candidate=$(docker create --name "$candidate_name" --pull never --label io.github.link-assistant.hive-manager.proxy="$name" \
        --restart unless-stopped --ulimit nofile=524288:524288 --env "WORKERS=$workers" \
        "${publish[@]}" --mount "type=bind,source=$proxy_state,target=/data" "$proxy_image_id") || return
      if [[ $old ]]; then
        proxy_switch update
      else
        activate_candidate "$proxy" "$candidate" '' false
        proxy_status "$candidate"
      fi ;;
    *) fail "Unknown proxy action: $action" ;;
  esac
}

load_deploy_profile() {
  local profile=$1 line base
  [[ -f $profile && -r $profile ]] || fail "Cannot read deployment profile: $profile"
  profile=$(absolute_path "$profile")
  base=${profile%/*}
  while IFS= read -r line || [[ $line ]]; do
    line=${line%$'\r'}
    case "$line" in
      ''|'#'*) ;;
      name=*) name=${line#*=} ;;
      state-dir=*) state_dir=$(profile_path "$base" "${line#*=}") ;;
      variant=*) variant=${line#*=} ;;
      image=*) image=${line#*=} ;;
      env-file=*) env_file=$(profile_path "$base" "${line#*=}") ;;
      bot-config=*) bot_config=$(profile_path "$base" "${line#*=}") ;;
      tool-policy=*) tool_policy=$(profile_path "$base" "${line#*=}") ;;
      docker-socket=*) socket=$(profile_path "$base" "${line#*=}") ;;
      setup=true) setup=1 ;;
      setup=false) setup=0 ;;
      *) fail "Unknown deployment profile setting: ${line%%=*}" ;;
    esac
  done < "$profile"
}

profile_path() {
  case "$2" in
    ''|/*) printf '%s' "$2" ;;
    *) printf '%s/%s' "$1" "$2" ;;
  esac
}

deploy() {
  local name=hive-mind state_dir='' variant=plain image='' env_file='' bot_config='' socket='' tool_policy=''
  local setup=0 pull_image=1 dry_run=0 tty=0 adopt=0
  while (( $# )); do
    case "$1" in
      -h|--help) deploy_usage; return ;;
      --profile|--name|--state-dir|--variant|--image|--env-file|--bot-config|--docker-socket|--tool-policy)
        need_value "$@"
        case "$1" in
          --profile) load_deploy_profile "$2" ;;
          --name) name=$2 ;;
          --state-dir) state_dir=$2 ;;
          --variant) variant=$2 ;;
          --image) image=$2 ;;
          --env-file) env_file=$2 ;;
          --bot-config) bot_config=$2 ;;
          --tool-policy) tool_policy=$2 ;;
          --docker-socket) socket=$2 ;;
        esac
        shift 2 ;;
      --setup) setup=1; shift ;;
      --adopt) adopt=1; shift ;;
      --no-pull) pull_image=0; shift ;;
      --dry-run) dry_run=1; shift ;;
      --tty) tty=1; shift ;;
      *) break ;;
    esac
  done
  if (( $# == 0 )); then deploy_usage; return; fi
  local action=$1
  shift
  [[ $name =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail "Invalid container name: $name"
  state_dir=$(absolute_path "${state_dir:-$HOME/.hive-mind}")
  state_dir=${state_dir%/}
  [[ $state_dir ]] || fail "State directory cannot be the filesystem root"
  [[ $socket != -* ]] || fail "Invalid Docker socket: $socket"
  if [[ $socket ]]; then socket=$(absolute_path "$socket"); fi
  case "$variant" in
    plain) image=${image:-konard/hive-mind:latest} ;;
    dind) image=${image:-konard/hive-mind-dind:latest} ;;
    *) fail "Unknown image variant: $variant" ;;
  esac
  [[ $image != -* ]] || fail "Invalid image: $image"
  if (( dry_run )) && [[ $action != apply && $action != update ]]; then
    fail "--dry-run is available for deploy apply and update"
  fi
  case "$action" in
    compose) require docker; exec docker compose "$@" ;;
    helm) require helm; exec helm "$@" ;;
    backup) backup_state "$@"; return ;;
    restore) restore_state "$@"; return ;;
    diagnose) require docker; diagnose "$@"; return ;;
    reboot)
      [[ $# == 1 && $1 == --confirm ]] || fail "Usage: deploy reboot --confirm"
      require systemctl
      exec systemctl reboot ;;
    docker-service)
      if [[ ${1-} == live-restore ]]; then docker_live_restore "${@:2}"; return; fi
      [[ $# == 1 && ( $1 == status || $1 == start ) ]] || fail "Usage: deploy docker-service status|start|live-restore [--apply]"
      require systemctl
      exec systemctl "$1" docker.service ;;
    proxy) proxy_deploy "$@"; return ;;
    update-dependencies)
      if [[ ${1-} == --help || ${1-} == -h ]]; then run_maintenance "$action" "$@"; fi
      require docker
      inside hive-manager "$action" "$@" ;;
    global-tools)
      local policy_args=()
      if [[ $tool_policy ]]; then policy_args=(--policy "$tool_policy"); fi
      run_host_maintenance "$action" "${policy_args[@]}" "$@" ;;
    tool-services) run_host_maintenance "$action" "$@" ;;
    disk)
      if [[ $# == 1 && $1 == --docker-summary ]]; then
        require docker
        if [[ $socket ]]; then exec docker --host "unix://$socket" system df -v; fi
        exec docker system df -v
      fi
      run_maintenance deploy-storage disk "$socket" "$name" "$state_dir" "$@" ;;
    cleanup)
      if [[ ${1-} == --scoped ]]; then run_maintenance deploy-storage scoped "$socket" "$name" "$state_dir" "${@:2}"; fi
      if [[ ${1-} == --help || ${1-} == -h ]]; then
        printf 'Usage: hive-manager deploy cleanup [IN_INSTANCE_OPTIONS]\n'
        printf '       hive-manager deploy cleanup --scoped [--dry-run | --status | --apply PREVIEW_ID]\n'
        printf 'Run in-instance cleanup with --dry-run or run deploy cleanup --scoped --help.\n'
        return
      fi
      require docker
      inside hive-cleanup "$@" ;;
    auth)
      local auth_command=()
      auth_args "$@"
      if (( ${#auth_command[@]} )); then require docker; inside "${auth_command[@]}"; fi
      return ;;
  esac
  case "$action" in
    apply|update)
      if (( ! dry_run )); then require docker; fi
      if [[ ${1-} == -- ]]; then shift
      elif (( $# )); then fail "Pass the startup command after --"; fi
      apply_deployment "$@" ;;
    prepare|rollback|recover|status|doctor|start|stop|restart|remove)
      (( $# == 0 )) || fail "Unexpected arguments for deploy $action"
      require docker
      case "$action" in
        prepare) exec docker pull "$image" ;;
        rollback) rollback_deployment ;;
        recover) recover_deployment ;;
        status) deploy_status ;;
        doctor) doctor ;;
        remove) lock_deployment; docker rm "$name" ;;
        *) lock_deployment; docker "$action" "$name" ;;
      esac ;;
    logs) require docker; exec docker logs "$@" "$name" ;;
    exec)
      if [[ ${1-} == -- ]]; then shift; fi
      (( $# )) || fail "Provide a command to execute"
      require docker
      inside "$@" ;;
    tasks)
      case "${1-}" in
        preserve-layer) run_maintenance deploy-storage preserve "$socket" "$name" "$state_dir" "${@:2}" ;;
        cleanup-preserved) run_maintenance deploy-storage cleanup-preserved "$socket" "$name" "$state_dir" "${@:2}" ;;
      esac
      case "${1-}" in report|check-browser|check-uploads|recover-failed|repair-records|recover-queue|backup-container|cleanup-backed-up) require docker; inside hive-manager tasks "$@" ;; esac
      local task_command=()
      task_args "$@"
      if (( ${#task_command[@]} )); then require docker; inside "${task_command[@]}"; fi ;;
    *)
      local bin module
      maintenance_spec "$action" || fail "Unknown deployment action: $action"
      require docker
      if [[ $bin == hive-manager ]]; then inside hive-manager "$action" "$@"; fi
      inside "$bin" "$@" ;;
  esac
}

main() {
  local host='' ssh_terminal=-T ssh_options=()
  while (( $# )); do
    case "$1" in
      --host|--jump|--ssh-config|--ssh-option|--ssh-port)
        need_value "$@"
        case "$1" in
          --host) host=$2 ;;
          --jump) ssh_options+=(-J "$2") ;;
          --ssh-config) ssh_options+=(-F "$2") ;;
          --ssh-option) ssh_options+=(-o "$2") ;;
          --ssh-port) ssh_options+=(-p "$2") ;;
        esac
        shift 2 ;;
      --tty) ssh_terminal=-t; shift ;;
      *) break ;;
    esac
  done
  if (( $# == 0 )) || [[ $1 == -h || $1 == --help ]]; then usage; return; fi
  if [[ $host ]]; then over_ssh "$@"; fi
  [[ ${#ssh_options[@]} == 0 && $ssh_terminal == -T ]] || fail "SSH options require --host"
  case "$1" in
    deploy) shift; deploy "$@" ;;
    auth)
      shift
      local auth_command=()
      auth_args "$@"
      if (( ${#auth_command[@]} )); then
        require "${auth_command[0]}"
        exec "${auth_command[@]}"
      fi ;;
    tasks)
      shift
      case "${1-}" in
        report|check-browser|check-uploads|recover-failed|repair-records|recover-queue) run_maintenance "task-$1" "${@:2}" ;;
        backup-container) task_container_backup "${@:2}"; return ;;
        cleanup-backed-up) task_cleanup_backed_up "${@:2}"; return ;;
      esac
      local task_command=()
      task_args "$@"
      if (( ${#task_command[@]} )); then require '$'; exec "${task_command[@]}"; fi ;;
    --version)
      local source_path
      if source_path=$(package_source) || source_path=$(package_source "$(command -v hive)"); then
        require node
        exec node -p 'require(process.argv[1]).version' "$source_path/../package.json"
      fi
      printf 'hive-manager (standalone)\n' ;;
    *) run_maintenance "$@" ;;
  esac
}

main "$@"
HIVE_MANAGER_PROGRAM
)" "${BASH_SOURCE[0]:-hive-manager}" "$@"
