#!/usr/bin/env bash
# enable-docker-live-restore.sh
#
# Turn on Docker "live-restore" on a host WITHOUT stopping any container, so a
# later dockerd restart (crash, OOM kill, `apt upgrade docker-ce`,
# `systemctl restart docker`) no longer kills the Hive Mind bot container,
# every running task and the in-memory solve queue. See issue #2900 and
# docs/DOCKER.md#host-docker-daemon-settings.
#
# What it does:
#   1. Exits early when the running daemon already reports
#      LiveRestoreEnabled=true (this also covers a dockerd started with the
#      `--live-restore` flag: adding the key to daemon.json as well would make
#      the next dockerd start fail with "directives are specified both as a
#      flag and in the configuration file").
#   2. Merges "live-restore": true into daemon.json, keeping every other key.
#      An existing file is backed up first and replaced atomically. Invalid
#      JSON is left untouched and the script fails with a warning.
#   3. Validates the result with `dockerd --validate` when available.
#   4. RELOADS the daemon (`systemctl reload docker`, or SIGHUP to dockerd).
#      `live-restore` is a reloadable option. It NEVER restarts dockerd: the
#      restart itself would kill every container that has no live-restore yet.
#   5. Verifies `docker info -f '{{.LiveRestoreEnabled}}'` prints true.
#
# Usage (on the HOST, as root):
#   curl -fsSL https://raw.githubusercontent.com/link-assistant/hive-mind/main/scripts/enable-docker-live-restore.sh | sudo bash
#   sudo bash scripts/enable-docker-live-restore.sh [--config PATH] [--no-reload] [--dry-run] [--allow-swarm]
#
# Options:
#   --config PATH   daemon.json to edit (default: $DOCKER_DAEMON_JSON or /etc/docker/daemon.json)
#   --no-reload     only edit the file: no daemon checks, no reload, no verification
#   --dry-run       print what would change, write nothing, reload nothing
#   --allow-swarm   proceed even when this daemon is a swarm node (older Docker
#                   releases refuse swarm mode with live-restore on)
#
# Exit codes: 0 = enabled (or already enabled), 1 = failed, 2 = usage error.
# Requires python3 or jq to edit the JSON safely.

set -euo pipefail

CONFIG="${DOCKER_DAEMON_JSON:-/etc/docker/daemon.json}"
RELOAD=1
DRY_RUN=0
ALLOW_SWARM=0
DOCKER="${DOCKER:-docker}"

log() { printf '[live-restore] %s\n' "$*"; }
warn() { printf '[live-restore] WARNING: %s\n' "$*" >&2; }
die() {
  printf '[live-restore] ERROR: %s\n' "$*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --config)
      [ "$#" -ge 2 ] || {
        echo "--config needs a path" >&2
        exit 2
      }
      CONFIG="$2"
      shift 2
      ;;
    --config=*)
      CONFIG="${1#--config=}"
      shift
      ;;
    --no-reload)
      RELOAD=0
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --allow-swarm)
      ALLOW_SWARM=1
      shift
      ;;
    -h | --help)
      sed -n '2,/^set -euo/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $1 (see --help)" >&2
      exit 2
      ;;
  esac
done

# Prints true/false, or nothing when the daemon is unreachable. docker then
# still renders the template with zero values ("false" and an empty ID); CLI
# 28+ exits non-zero, older CLIs exit 0, so an empty daemon ID means unknown.
daemon_live_restore() {
  local out flag id
  out="$("$DOCKER" info --format '{{.LiveRestoreEnabled}} {{.ID}}' 2>/dev/null)" || return 0
  read -r flag id _ <<<"$out" || true
  [ -n "${id:-}" ] || return 0
  printf '%s' "$flag"
}

# Prints "changed" or "unchanged" and writes the merged JSON to $2; exits 3 when
# $1 is not a JSON object (the caller then leaves the original untouched).
merge_live_restore() {
  local source="$1" target="$2"
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$source" "$target" <<'PY'
import json, os, sys
source, target = sys.argv[1], sys.argv[2]
data = {}
if os.path.exists(source) and os.path.getsize(source) and open(source).read().strip():
    try:
        data = json.load(open(source))
    except ValueError as error:
        print(f"invalid JSON: {error}", file=sys.stderr)
        sys.exit(3)
if not isinstance(data, dict):
    print("invalid JSON: top level is not an object", file=sys.stderr)
    sys.exit(3)
changed = data.get("live-restore") is not True
data["live-restore"] = True
with open(target, "w") as handle:
    handle.write(json.dumps(data, indent=2) + "\n")
print("changed" if changed else "unchanged")
PY
  elif command -v jq >/dev/null 2>&1; then
    local input='{}'
    if [ -s "$source" ] && grep -q '[^[:space:]]' "$source"; then input="$(cat "$source")"; fi
    if ! printf '%s' "$input" | jq -e 'type == "object"' >/dev/null 2>&1; then
      echo "invalid JSON (or top level is not an object)" >&2
      return 3
    fi
    printf '%s' "$input" | jq '.["live-restore"] = true' >"$target"
    if printf '%s' "$input" | jq -e '.["live-restore"] == true' >/dev/null; then echo unchanged; else echo changed; fi
  else
    die "need python3 or jq to edit ${CONFIG} safely"
  fi
}

reload_daemon() {
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet docker 2>/dev/null; then
    log "reloading dockerd: systemctl reload docker (NOT restart)"
    systemctl reload docker
  elif command -v pkill >/dev/null 2>&1 && pkill -0 -x dockerd 2>/dev/null; then
    log "reloading dockerd: SIGHUP (NOT restart)"
    pkill -HUP -x dockerd
  else
    die "cannot find a running dockerd to reload; reload it yourself (never restart it while containers run)"
  fi
}

if [ "$RELOAD" = "1" ] && [ "$DRY_RUN" = "0" ]; then
  command -v "$DOCKER" >/dev/null 2>&1 || die "docker CLI not found; run this on the Docker host (or pass --no-reload to only edit ${CONFIG})"
  current="$(daemon_live_restore || true)"
  if [ "$current" = "true" ]; then
    log "live-restore is already enabled on the running daemon; nothing to do"
    exit 0
  fi
  [ -n "$current" ] || die "cannot reach the Docker daemon with '${DOCKER} info' (run as root or a docker-group user)"
  swarm="$("$DOCKER" info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || true)"
  if [ "$swarm" = "active" ] && [ "$ALLOW_SWARM" = "0" ]; then
    die "this daemon is a swarm node; older Docker releases refuse swarm mode with live-restore on. Re-run with --allow-swarm if you accept that"
  fi
fi

tmp="$(mktemp "${TMPDIR:-/tmp}/daemon.json.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
set +e
status="$(merge_live_restore "$CONFIG" "$tmp")"
merge_exit=$?
set -e
if [ "$merge_exit" = "3" ]; then
  warn "${CONFIG} is not a valid JSON object; leaving it untouched. Fix it by hand and add \"live-restore\": true"
  exit 1
fi
[ "$merge_exit" = "0" ] || die "could not merge live-restore into ${CONFIG}"

if [ "$status" = "unchanged" ]; then
  log "${CONFIG} already has \"live-restore\": true"
elif [ "$DRY_RUN" = "1" ]; then
  log "dry run: would write ${CONFIG}:"
  cat "$tmp"
else
  if command -v dockerd >/dev/null 2>&1 && dockerd --help 2>/dev/null | grep -q -- '--validate'; then
    dockerd --validate --config-file="$tmp" >/dev/null || die "dockerd --validate rejected the merged config; ${CONFIG} left untouched"
  fi
  mkdir -p "$(dirname "$CONFIG")"
  if [ -e "$CONFIG" ]; then
    backup="${CONFIG}.bak-$(date +%Y%m%d%H%M%S)"
    cp -p "$CONFIG" "$backup"
    log "backed up ${CONFIG} to ${backup}"
    # Keep the original owner and mode on the replacement.
    cp -p "$CONFIG" "${CONFIG}.new"
    cat "$tmp" >"${CONFIG}.new"
  else
    install -m 0644 "$tmp" "${CONFIG}.new"
  fi
  mv -f "${CONFIG}.new" "$CONFIG"
  log "wrote \"live-restore\": true to ${CONFIG}"
fi

if [ "$DRY_RUN" = "1" ]; then
  log "dry run: would reload dockerd (systemctl reload docker), never restart it"
  exit 0
fi
if [ "$RELOAD" = "0" ]; then
  log "--no-reload: run 'systemctl reload docker' (NOT restart) to apply it"
  exit 0
fi

reload_daemon
for _ in $(seq 1 20); do
  if [ "$(daemon_live_restore || true)" = "true" ]; then
    log "verified: docker info reports LiveRestoreEnabled=true"
    exit 0
  fi
  sleep 0.5
done
die "dockerd did not report LiveRestoreEnabled=true after the reload; check 'journalctl -u docker' for 'Reloaded configuration' or an error"
