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
  cleanup               Reclaim stale task state, processes and Docker resources
  configure-claude      Apply or verify Hive Mind Claude settings
  screens               List, attach to or close finished Screen sessions
  models                Inspect the live model catalogue
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
  status | logs         Show instance status or stream Docker logs
  start | stop | restart
                        Control the instance
  exec [--] COMMAND     Run a command as box in the instance
  doctor                Check host disk space and instance/runtime status
  disk                  Report Docker storage, images, volumes and build cache
  backup [--output FILE|-]
                        Save a private archive of deployment state
  restore [--input FILE|-]
                        Extract an archive into a new state directory
  reboot --confirm      Reboot the deployment host
  proxy                 Manage an optional Telegram MTProto proxy
  compose ARGS          Run Docker Compose on the target (supports -f, --env-file)
  helm ARGS             Run Helm on the target (uses its kubeconfig)
  cleanup | configure-claude | screens | models | close-linked-issues
                        Run a maintenance command inside the instance

Options (before ACTION):
  --profile FILE        Read target deployment options as key=value lines
  --name NAME           Container name (default: hive-mind)
  --state-dir PATH      Persistent state (default: ~/.hive-mind on the target)
  --variant plain|dind  Image variant (default: plain)
  --image IMAGE         Override the image tag or digest
  --env-file PATH       Private Docker environment file on the target
  --bot-config PATH     Private Telegram LINO configuration on the target
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
    configure-claude) bin=configure-claude; module=configure-claude.mjs ;;
    screens|hive-screens) bin=hive-screens; module=hive-screens.mjs ;;
    models|hive-models) bin=hive-models; module=hive-models.mjs ;;
    close-linked-issues) bin=close-linked-issues; module=close-linked-issues.mjs ;;
    *) return 1 ;;
  esac
}

package_source() {
  local entry=$0 link
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
  [[ -f ${entry%/*}/../package.json ]] || return 1
  cd -- "${entry%/*}" && pwd -P
}

run_maintenance() {
  local bin module source_path
  maintenance_spec "$1" || fail "Unknown maintenance command: $1"
  shift
  if source_path=$(package_source) && [[ -f $source_path/$module ]]; then
    require node
    exec node "$source_path/$module" "$@"
  fi
  if command -v "$bin" >/dev/null; then
    exec "$bin" "$@"
  fi
  require node
  require npm
  # The package provides the same entry points for standalone use and older images.
  local version=${HIVE_MANAGER_PACKAGE_VERSION:-latest}
  [[ $version =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail "Invalid Hive Mind package version"
  exec npm exec --yes --package "@link-assistant/hive-mind@$version" -- "$bin" "$@"
}

absolute_path() {
  case "$1" in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$PWD" "$1" ;; esac
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
  local lock_root=${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/hive-manager-$(id -u)
  (umask 077 && mkdir -p -- "$lock_root")
  [[ ! -L $lock_root && -O $lock_root ]] || fail "Unsafe lock directory: $lock_root"
  local lock_path=$lock_root/${1:-$name}
  if command -v flock >/dev/null; then
    exec 9>"$lock_path"
    flock -n 9 || fail "Deployment ${1:-$name} is already being changed"
  else
    mkdir -- "$lock_path.lock" || fail "Deployment ${1:-$name} is locked at $lock_path.lock"
    trap "rmdir -- $(shell_quote "$lock_path.lock")" EXIT
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
    for item in claude codex agents gh git hive start-command; do
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

check_rollout_names() {
  if container_id "$name.previous" >/dev/null; then
    fail "Reserved rollout name exists: $name.previous"
  fi
  local container
  for container in "$@"; do
    if [[ $container && $(instance_owner "$container") != "$name" ]]; then
      (( adopt )) || fail "Container $container belongs to another deployment. Use --adopt only for your existing instance."
    fi
  done
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

  candidate=$(docker create --pull never "${docker_args[@]}" "$image_id" "${startup[@]}")
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

backup_state() {
  local output='' part
  if (( $# )); then
    [[ $# == 2 && $1 == --output ]] || fail "Usage: deploy backup [--output FILE|-]"
    output=$2
  fi
  [[ -d $state_dir ]] || fail "State directory not found: $state_dir"
  output=${output:-$PWD/$name-$(date -u +%Y%m%dT%H%M%SZ).tar.gz}
  if [[ $output == - ]]; then
    exec tar -czf - -C "$state_dir" .
  fi
  output=$(absolute_path "$output")
  local state_path output_dir
  state_path=$(cd -- "$state_dir" && pwd -P)
  output_dir=$(cd -- "${output%/*}" && pwd -P)
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
      node "${hive_source%/*}/verify-agent-runtime.mjs"
    '
  fi
}

proxy_usage() {
  cat <<'HELP'
Usage: hive-manager deploy proxy [OPTIONS] ACTION

  apply       Create or start the proxy
  update      Pull a new image and replace the proxy
  status      Check the running proxy, published port and restart policy
  verify      Check status and TCP connectivity to Telegram data centers
  stop        Stop the proxy
  remove      Remove the container, retaining its secret
  link        Print the private Telegram link (requires --public-host)

  --port PORT         Published TCP port (default: 443)
  --workers COUNT     Classic MTProto workers from 1 to 6 (default: 4)
  --image IMAGE       Classic MTProto image (default: mtproxy/mtproxy:latest)
  --secret-file PATH  Import a 32-digit hex key when creating proxy state
  --public-host HOST  Public DNS name or IPv4 address used by link
HELP
}

proxy_status() {
  container_running "$proxy" || fail "Proxy is not running: $proxy"
  [[ $(docker container inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$proxy") == unless-stopped ]] ||
    fail "Unexpected restart policy for $proxy"
  docker port "$proxy" 443/tcp
}

proxy_deploy() {
  local port=443 workers=4 proxy_image=mtproxy/mtproxy:latest secret_input='' public_host=''
  while (( $# )); do
    case "$1" in
      -h|--help) proxy_usage; return ;;
      --port|--workers|--image|--secret-file|--public-host)
        need_value "$@"
        case "$1" in
          --port) port=$2 ;;
          --workers) workers=$2 ;;
          --image) proxy_image=$2 ;;
          --secret-file) secret_input=$2 ;;
          --public-host) public_host=$2 ;;
        esac
        shift 2 ;;
      *) break ;;
    esac
  done
  if (( $# == 0 )); then proxy_usage; return; fi
  (( $# == 1 )) || fail "Unexpected arguments for deploy proxy $1"
  [[ $port =~ ^[1-9][0-9]{0,4}$ ]] && (( port <= 65535 )) || fail "Invalid proxy port: $port"
  [[ $workers =~ ^[1-6]$ ]] || fail "Proxy workers must be between 1 and 6"
  [[ $proxy_image != -* ]] || fail "Invalid proxy image: $proxy_image"
  local proxy=$name-mtproxy-$port proxy_state=$state_dir/mtproxy-$port key
  local action=$1
  if [[ $action == link ]]; then
    [[ $public_host =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || fail "Supply a public DNS name or IPv4 address with --public-host"
    key=$(<"$proxy_state/secret") || fail "Proxy secret not found: $proxy_state/secret"
    [[ $key =~ ^[a-fA-F0-9]{32}$ ]] || fail "Invalid saved proxy secret"
    printf 'tg://proxy?server=%s&port=%s&secret=dd%s\n' "$public_host" "$port" "$key"
    return
  fi
  require docker
  case "$action" in
    status|verify)
      proxy_status
      if [[ $action == verify ]]; then
        require timeout
        local dc
        for dc in 149.154.161.144:8888 149.154.161.184:8888 91.105.192.110:443; do
          timeout 5 bash -c 'exec 3<>"/dev/tcp/${1%:*}/${1##*:}"' _ "$dc" ||
            fail "Cannot reach Telegram data center $dc"
        done
      fi ;;
    apply|update|stop|remove)
      # Lock proxy changes by their host port, independent of Hive Mind rollouts.
      lock_deployment "mtproxy-port-$port"
      local old='' old_running=false candidate owner
      old=$(container_id "$proxy") || old=''
      if [[ $old ]]; then
        owner=$(docker container inspect --format '{{index .Config.Labels "io.github.link-assistant.hive-manager.proxy"}}' "$old")
        [[ $owner == "$name" ]] || fail "Proxy container name is used by another deployment: $proxy"
        if container_running "$old"; then old_running=true; fi
      fi
      case "$action" in
        stop|remove)
          [[ $old ]] || fail "Proxy container not found: $proxy"
          if [[ $old_running == true ]]; then docker stop "$old" >/dev/null; fi
          if [[ $action == remove ]]; then docker rm "$old" >/dev/null; fi
          return ;;
        apply)
          if [[ $old ]]; then
            if [[ $old_running == false ]]; then docker start "$old" >/dev/null; fi
            proxy_status
            return
          fi ;;
      esac
      [[ $proxy_state != *','* && $proxy_state != *'"'* ]] || fail "Invalid proxy state directory"
      (umask 077 && mkdir -p -- "$proxy_state")
      if [[ ! -f $proxy_state/secret ]]; then
        if [[ $secret_input ]]; then
          key=$(<"$secret_input") || fail "Cannot read proxy secret file"
        else
          require openssl
          key=$(openssl rand -hex 16)
        fi
        [[ $key =~ ^[a-fA-F0-9]{32}$ ]] || fail "Expected a 32-digit hex proxy secret"
        (umask 077 && set -o noclobber && printf '%s\n' "$key" > "$proxy_state/secret")
      fi
      key=$(<"$proxy_state/secret")
      [[ $key =~ ^[a-fA-F0-9]{32}$ ]] || fail "Invalid saved proxy secret"
      docker pull "$proxy_image"
      if container_id "$proxy.previous" >/dev/null; then fail "Reserved proxy name exists: $proxy.previous"; fi
      candidate=$(docker create --label io.github.link-assistant.hive-manager.proxy="$name" --restart unless-stopped \
        --ulimit nofile=524288:524288 --env "WORKERS=$workers" \
        --publish "$port:443" --mount "type=bind,source=$proxy_state,target=/data" "$proxy_image")
      activate_candidate "$proxy" "$candidate" "$old" "$old_running"
      if [[ $old ]]; then docker rm "$old" >/dev/null; fi
      proxy_status ;;
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
  local name=hive-mind state_dir='' variant=plain image='' env_file='' bot_config='' socket=''
  local setup=0 pull_image=1 dry_run=0 tty=0 adopt=0
  while (( $# )); do
    case "$1" in
      -h|--help) deploy_usage; return ;;
      --profile|--name|--state-dir|--variant|--image|--env-file|--bot-config|--docker-socket)
        need_value "$@"
        case "$1" in
          --profile) load_deploy_profile "$2" ;;
          --name) name=$2 ;;
          --state-dir) state_dir=$2 ;;
          --variant) variant=$2 ;;
          --image) image=$2 ;;
          --env-file) env_file=$2 ;;
          --bot-config) bot_config=$2 ;;
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
    reboot)
      [[ $# == 1 && $1 == --confirm ]] || fail "Usage: deploy reboot --confirm"
      require systemctl
      exec systemctl reboot ;;
    proxy) proxy_deploy "$@"; return ;;
  esac
  case "$action" in
    apply|update)
      if (( ! dry_run )); then require docker; fi
      if [[ ${1-} == -- ]]; then shift
      elif (( $# )); then fail "Pass the startup command after --"; fi
      apply_deployment "$@" ;;
    prepare|rollback|status|doctor|disk|start|stop|restart)
      (( $# == 0 )) || fail "Unexpected arguments for deploy $action"
      require docker
      case "$action" in
        prepare) exec docker pull "$image" ;;
        rollback) rollback_deployment ;;
        status) deploy_status ;;
        doctor) doctor ;;
        disk) exec docker system df -v ;;
        *) lock_deployment; docker "$action" "$name" ;;
      esac ;;
    logs) require docker; exec docker logs "$@" "$name" ;;
    exec)
      if [[ ${1-} == -- ]]; then shift; fi
      (( $# )) || fail "Provide a command to execute"
      require docker
      inside "$@" ;;
    *)
      local bin module
      maintenance_spec "$action" || fail "Unknown deployment action: $action"
      require docker
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
    --version)
      local source_path
      if source_path=$(package_source); then
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
