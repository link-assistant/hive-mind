#!/usr/bin/env bash
# Entrypoint for dind-box images.
#
# Responsibilities:
#   1. Start the inner Docker daemon (dockerd) in the background with root
#      privileges, using scoped passwordless sudo when the image runs as box.
#   2. Wait for dockerd to be ready on /var/run/docker.sock.
#   3. Hand off to the standard /usr/local/bin/entrypoint.sh so all language
#      environments load exactly like in the regular box.
#
# This is the recommended pattern from docker:dind and cruizba/ubuntu-dind.
# See docs/case-studies/issue-80/CASE-STUDY.md for the full design rationale.
#
# Required runtime privileges (host side):
#   - Default:  docker run --privileged konard/<base>-dind
#   - Sysbox :  docker run --runtime=sysbox-runc konard/<base>-dind   (no --privileged)
#
# Environment overrides:
#   DIND_STORAGE_DRIVER  Override storage driver (default: auto-detected: overlay2,
#                        fuse-overlayfs, vfs). Note: vfs has NO copy-on-write — it
#                        stores every image layer as a full, independent copy, so
#                        large (multi-GB) images consume many times their size on
#                        disk and 'docker pull'/'docker run' can fail with 'no
#                        space left on device'. When the active driver ends up
#                        being vfs the entrypoint emits a one-time warning naming
#                        the fuse-overlayfs (copy-on-write) remediation. (issue #104)
#   DIND_DATA_ROOT       Override --data-root for dockerd (default: /var/lib/docker)
#   DIND_LOG_FILE        Where to write dockerd logs (default: /var/log/dockerd.log)
#   DIND_WAIT_SECONDS    How long to wait for dockerd to come up (default: 30)
#   DIND_SKIP_DAEMON     If set to "1", do not start the nested dockerd. This is
#                        the supported Docker-outside-of-Docker (DooD) switch:
#                        mount the host daemon's socket as the *real* runtime
#                        (`-v /var/run/docker.sock:/var/run/docker.sock`) and the
#                        in-container docker CLI talks to the host daemon, so
#                        isolated tasks `docker run` on the host with ZERO image
#                        copy and ZERO extra disk (the only no-copy option on a
#                        disk-constrained host). One image, two modes, chosen by
#                        run flags. The box user must be able to read that socket;
#                        the entrypoint chgrp's a writable socket into the image
#                        docker group, and otherwise prints the exact
#                        `--group-add <host-docker-gid>` to add. See the
#                        "DinD vs DooD" section in docs/dind/USAGE.md. (issue #110)
#   DIND_READY_FILE      Path written once the nested-daemon image preload/
#                        passthrough phase finishes, so consumers can wait for
#                        "images are seeded" deterministically instead of racing
#                        the asynchronous load against mere `docker info`
#                        readiness. The file contains `complete` on success or
#                        `warnings` when something was not seeded (default:
#                        /tmp/box-dind-ready; set empty to disable). (issue #110)
#   DIND_PRELOAD_TARBALL Space-separated list of image tarball files and/or
#                        directories to `docker load` into the nested daemon
#                        once it is ready. Directories load every *.tar inside.
#                        This is how you reuse host images without re-downloading
#                        them: `docker save img | ... ` on the host, mount the
#                        tarball, and point this at it. (issue #94)
#   DIND_PRELOAD_IMAGES  Space-separated list of image references to `docker pull`
#                        into the nested daemon once it is ready, but only when
#                        the image is not already present. Useful to warm the
#                        cache from a registry or pull-through mirror. (issue #94)
#   DIND_HOST_PASSTHROUGH
#                        Host-image passthrough mode (default: "public"). When a
#                        host Docker socket is mounted into the container at
#                        DIND_HOST_DOCKER_SOCK, images already present on the
#                        host are copied into the nested daemon at startup
#                        (docker save | docker load) so they are not re-pulled.
#                        Modes:
#                          public - (default) only pass host images that carry a
#                                   RepoDigest from an allowlisted public
#                                   registry (DIND_HOST_PASSTHROUGH_REGISTRIES).
#                                   These are freely re-pullable, so passing them
#                                   leaks no local build secrets or private
#                                   registry credentials.
#                          all    - pass every tagged host image, including
#                                   locally-built and private-registry images.
#                          off    - disable passthrough entirely.
#                        If no host socket is mounted this is a quiet no-op, so
#                        the default is safe for the normal --privileged run.
#                        (issue #94)
#   DIND_HOST_DOCKER_SOCK
#                        Path inside the container to the mounted *host* Docker
#                        socket used for passthrough (default:
#                        /var/run/host-docker.sock). Mount it read-only with
#                        `-v /var/run/docker.sock:/var/run/host-docker.sock:ro`.
#                        Note: deliberately NOT /var/run/docker.sock, so the
#                        inner daemon keeps its own isolated socket. (issue #94)
#   DIND_HOST_PASSTHROUGH_REGISTRIES
#                        Space-separated allowlist of registries treated as
#                        "public" in DIND_HOST_PASSTHROUGH=public mode (default:
#                        the common public registries: docker.io ghcr.io quay.io
#                        gcr.io registry.k8s.io public.ecr.aws mcr.microsoft.com).
#                        (issue #94)
#   DIND_HOST_PASSTHROUGH_IMAGES
#                        Space-separated allowlist of image references / globs.
#                        When non-empty, only host images whose reference matches
#                        at least one entry are passed through, composed with the
#                        mode filter (so "public" still gates on a public
#                        RepoDigest). Empty/unset keeps the current behavior
#                        (mode + registry filter only). Patterns are matched
#                        against several normalized forms of the reference, so
#                        "konard/hive-mind" matches "konard/hive-mind:latest" and
#                        "docker.io/konard/hive-mind:latest" alike, and globs work
#                        (e.g. "docker.io/konard/hive-mind*"). This narrows
#                        passthrough one level finer than the registry allowlist
#                        — to specific repositories / image names. (issue #97)
#                        After passthrough runs, every *concrete* entry here (an
#                        explicit tag or digest, no glob) is verified to actually
#                        be present in the nested daemon; a missing one triggers a
#                        loud warning instead of a false "complete", because the
#                        first nested 'docker run' would otherwise silently re-pull
#                        the multi-GB image from the registry (the lingering
#                        symptom of issues #94 / #102, still seen downstream in
#                        link-assistant/hive-mind#1914/#1946). (issue #106)

set -eu

DIND_STORAGE_DRIVER="${DIND_STORAGE_DRIVER:-}"
DIND_DATA_ROOT="${DIND_DATA_ROOT:-/var/lib/docker}"
DIND_LOG_FILE="${DIND_LOG_FILE:-/var/log/dockerd.log}"
DIND_WAIT_SECONDS="${DIND_WAIT_SECONDS:-30}"
DIND_SKIP_DAEMON="${DIND_SKIP_DAEMON:-0}"
DIND_READY_FILE="${DIND_READY_FILE:-/tmp/box-dind-ready}"
DIND_PRELOAD_TARBALL="${DIND_PRELOAD_TARBALL:-}"
DIND_PRELOAD_IMAGES="${DIND_PRELOAD_IMAGES:-}"
DIND_HOST_PASSTHROUGH="${DIND_HOST_PASSTHROUGH:-public}"
DIND_HOST_DOCKER_SOCK="${DIND_HOST_DOCKER_SOCK:-/var/run/host-docker.sock}"
DIND_HOST_PASSTHROUGH_REGISTRIES="${DIND_HOST_PASSTHROUGH_REGISTRIES:-docker.io ghcr.io quay.io gcr.io registry.k8s.io public.ecr.aws mcr.microsoft.com}"
DIND_HOST_PASSTHROUGH_IMAGES="${DIND_HOST_PASSTHROUGH_IMAGES:-}"

log()  { echo "[dind-entrypoint] $*"; }
warn() { echo "[dind-entrypoint] WARN: $*" >&2; }

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -n "$@"
  else
    return 1
  fi
}

prepare_log_file() {
  log_dir="$(dirname "$DIND_LOG_FILE")"
  if [ -n "$log_dir" ] && [ "$log_dir" != "." ]; then
    as_root /usr/bin/mkdir -p "$log_dir" 2>/dev/null || true
  fi

  if ! (: >>"$DIND_LOG_FILE") 2>/dev/null; then
    warn "Cannot write dockerd log file at ${DIND_LOG_FILE}; falling back to /tmp/dockerd.log"
    DIND_LOG_FILE="/tmp/dockerd.log"
    if ! (: >>"$DIND_LOG_FILE") 2>/dev/null; then
      warn "Cannot write fallback dockerd log file at ${DIND_LOG_FILE}; using /dev/null"
      DIND_LOG_FILE="/dev/null"
    fi
  fi
}

# Numeric GID that owns a unix socket, or empty when it is not a socket.
socket_gid() {
  [ -S "$1" ] || return 1
  stat -c '%g' "$1" 2>/dev/null
}

# True when the current process already belongs to GID $1 (primary or
# supplementary). `id -G` lists every group of the running process, which is what
# actually governs whether box can open a group-readable socket — checking the
# socket's GID against this set tells us whether a `--group-add` is still needed.
current_user_in_gid() {
  gid="$1"
  [ -n "$gid" ] || return 1
  for g in $(id -G 2>/dev/null); do
    [ "$g" = "$gid" ] && return 0
  done
  return 1
}

# Make the box user able to talk to a Docker socket. (issue #110)
#
#   grant_socket_access <sock> <adopt>
#
# When box already belongs to the socket's owning GID (e.g. a `--group-add` was
# supplied) or runs as root, the socket is left completely untouched. Otherwise:
#
#   * adopt="adopt" — the socket is *private to this container* (the DinD inner
#     socket dockerd just created). chgrp it into the image `docker` group and
#     chmod 660 so box can use it. This is the long-standing inner-socket fix.
#   * adopt="keep"  — the socket is *shared* (the DooD host socket, or a `:ro`
#     passthrough mount). It must NEVER be chgrp'd: mutating the host's
#     /var/run/docker.sock changes host state and can lock other host users out
#     of Docker entirely. The only safe remedy is a host-side `--group-add
#     <gid>`, so emit that exact GID instead of touching the socket (finding #1).
#     A `:ro` mount could not be chgrp'd anyway (EROFS).
#
# Returns 0 when box can (now) reach the socket, non-zero when the operator must
# intervene with --group-add.
grant_socket_access() {
  sock="$1"
  adopt="${2:-adopt}"
  [ -S "$sock" ] || return 0   # nothing mounted at this path: nothing to do

  gid="$(socket_gid "$sock" || true)"

  # Already reachable (root, or a member of the owning group)? Leave it untouched
  # — never warn, and crucially never chgrp it. In DooD the runtime socket is the
  # *host's* shared /var/run/docker.sock; mutating its group when box can already
  # reach it (e.g. via --group-add) would needlessly change host state.
  if [ "$(id -u)" -eq 0 ] || current_user_in_gid "$gid"; then
    return 0
  fi

  # Adopt only a private socket into the image docker group. Refused for shared
  # sockets so the host's /var/run/docker.sock is never mutated under DooD.
  if [ "$adopt" = "adopt" ] \
     && as_root /usr/bin/chgrp docker "$sock" 2>/dev/null \
     && as_root /usr/bin/chmod 660 "$sock" 2>/dev/null; then
    log "adjusted ${sock} into the docker group so the box user can access it"
    return 0
  fi

  warn "the Docker socket at ${sock} is owned by GID ${gid:-unknown}, which the in-container box user is not a member of, so box cannot access it."
  if [ -n "$gid" ]; then
    warn "re-run the container with --group-add ${gid} so box can read the socket, e.g.: docker run ... --group-add ${gid} ... (issue #110)"
  fi
  return 1
}

# Make the runtime socket at /var/run/docker.sock usable by box. The safe action
# depends on the mode: in DinD that path is the *private* inner socket dockerd
# created (adopt it), while in DooD it is the *shared* host socket mounted there
# (never chgrp it — only guide with --group-add). Suppress the return value so
# the hot DinD readiness loop never trips `set -e` when the socket is not up yet.
fix_socket_permissions() {
  if [ "$DIND_SKIP_DAEMON" = "1" ]; then
    grant_socket_access /var/run/docker.sock keep || true
  else
    grant_socket_access /var/run/docker.sock adopt || true
  fi
}

storage_driver_candidates() {
  if [ -n "$DIND_STORAGE_DRIVER" ]; then
    printf '%s\n' "$DIND_STORAGE_DRIVER"
    return 0
  fi

  if grep -q overlay /proc/filesystems 2>/dev/null; then
    printf '%s\n' overlay2
  fi

  if command -v fuse-overlayfs >/dev/null 2>&1; then
    printf '%s\n' fuse-overlayfs
  fi

  printf '%s\n' vfs
}

launch_dockerd() {
  storage_driver="$1"

  if [ "$(id -u)" -eq 0 ]; then
    nohup /usr/bin/dockerd \
      --host=unix:///var/run/docker.sock \
      --data-root="$DIND_DATA_ROOT" \
      --storage-driver="$storage_driver" \
      >>"$DIND_LOG_FILE" 2>&1 &
  else
    nohup sudo -n /usr/bin/dockerd \
      --host=unix:///var/run/docker.sock \
      --data-root="$DIND_DATA_ROOT" \
      --storage-driver="$storage_driver" \
      >>"$DIND_LOG_FILE" 2>&1 &
  fi

  DIND_DOCKERD_PID="$!"
}

wait_for_dockerd_ready() {
  dockerd_pid="$1"
  storage_driver="$2"
  i=0

  while [ "$i" -lt "$DIND_WAIT_SECONDS" ]; do
    fix_socket_permissions
    if docker info >/dev/null 2>&1; then
      log "dockerd is ready after ${i}s"
      return 0
    fi

    if ! kill -0 "$dockerd_pid" 2>/dev/null; then
      wait "$dockerd_pid" 2>/dev/null || true
      warn "dockerd exited before becoming ready with storage-driver=${storage_driver}"
      return 1
    fi

    i=$((i + 1))
    sleep 1
  done

  return 2
}

# Device node fuse-overlayfs needs for copy-on-write. Overridable so the unit
# test can exercise both the "present" and "missing" remediation branches without
# a real device node; in production it is always /dev/fuse.
DIND_FUSE_DEVICE="${DIND_FUSE_DEVICE:-/dev/fuse}"

# When the active storage driver is vfs, emit a one-time warning explaining the
# copy-on-write footgun. vfs is a safe last-resort fallback (and a legitimate
# explicit pin for overlay-on-overlay compatibility), so this is observability,
# not a default change: it stores every image layer as a full, independent copy,
# so a multi-GB image's on-disk footprint becomes the SUM of all cumulative layer
# sizes — many times the image size — and 'docker pull'/'docker run' can fail with
# 'failed to register layer: no space left on device' on a disk far larger than
# the image. Without this breadcrumb the generic disk error is easily misdiagnosed
# as "not enough disk" instead of "wrong driver wastes the disk"
# (link-assistant/hive-mind#1914). The remediation depends on whether the
# copy-on-write fuse-overlayfs driver's device node is available. (issue #104)
warn_if_vfs_storage_driver() {
  [ "$1" = "vfs" ] || return 0

  warn "dockerd is using the 'vfs' storage driver, which has NO copy-on-write:"
  warn "every image layer is stored as a full copy, so a multi-GB image's on-disk"
  warn "footprint becomes the SUM of all cumulative layer sizes (many times the"
  warn "image size). 'docker pull'/'docker run' can then fail with 'failed to"
  warn "register layer: no space left on device' on a disk far larger than the image."
  if [ -e "$DIND_FUSE_DEVICE" ]; then
    warn "For copy-on-write here, set DIND_STORAGE_DRIVER=fuse-overlayfs (works"
    warn "overlay-on-overlay; ${DIND_FUSE_DEVICE} is present)."
  else
    warn "fuse-overlayfs (copy-on-write, works overlay-on-overlay) is unavailable"
    warn "because ${DIND_FUSE_DEVICE} is missing; run with --privileged or"
    warn "--device /dev/fuse, then set DIND_STORAGE_DRIVER=fuse-overlayfs."
  fi
}

start_dockerd() {
  if pgrep -x dockerd >/dev/null 2>&1; then
    log "dockerd already running (pid $(pgrep -x dockerd | head -n1))"
    fix_socket_permissions
    return 0
  fi

  if ! as_root /usr/bin/mkdir -p "$DIND_DATA_ROOT" /var/log /var/run; then
    warn "Cannot create dockerd runtime directories; sudo may not be configured for box"
    return 1
  fi
  prepare_log_file

  # iptables modules and overlay mounts depend on the outer runtime. Auto mode
  # retries conservative drivers only when dockerd exits before it is ready.
  explicit_storage_driver=0
  if [ -n "$DIND_STORAGE_DRIVER" ]; then
    explicit_storage_driver=1
  fi

  for storage_driver in $(storage_driver_candidates); do
    DIND_STORAGE_DRIVER="$storage_driver"
    log "Starting dockerd (storage-driver=${DIND_STORAGE_DRIVER}, data-root=${DIND_DATA_ROOT})"
    launch_dockerd "$DIND_STORAGE_DRIVER"

    if wait_for_dockerd_ready "$DIND_DOCKERD_PID" "$DIND_STORAGE_DRIVER"; then
      warn_if_vfs_storage_driver "$DIND_STORAGE_DRIVER"
      return 0
    else
      result="$?"
    fi

    if [ "$result" -eq 2 ]; then
      warn "dockerd did not become ready within ${DIND_WAIT_SECONDS}s"
      warn "Last 40 lines of ${DIND_LOG_FILE}:"
      tail -n 40 "$DIND_LOG_FILE" >&2 || true
      warn "Continuing anyway; the user shell will still start, but 'docker' may fail"
      return 0
    fi

    if [ "$explicit_storage_driver" -eq 1 ]; then
      break
    fi

    warn "Last 20 lines of ${DIND_LOG_FILE}:"
    tail -n 20 "$DIND_LOG_FILE" >&2 || true
    warn "Retrying dockerd with next storage driver"
  done

  warn "dockerd did not become ready with any configured storage driver"
  warn "Last 40 lines of ${DIND_LOG_FILE}:"
  tail -n 40 "$DIND_LOG_FILE" >&2 || true
  warn "Continuing anyway; the user shell will still start, but 'docker' may fail"
  return 0
}

load_one_tarball() {
  tarball="$1"
  if [ ! -r "$tarball" ]; then
    warn "preload tarball is not readable: ${tarball}"
    return 1
  fi
  log "Loading images from tarball ${tarball}"
  if docker load -i "$tarball"; then
    return 0
  fi
  warn "docker load failed for tarball ${tarball}"
  return 1
}

preload_tarballs() {
  [ -n "$DIND_PRELOAD_TARBALL" ] || return 0

  for entry in $DIND_PRELOAD_TARBALL; do
    if [ -d "$entry" ]; then
      loaded_any=0
      for tarball in "$entry"/*.tar; do
        [ -e "$tarball" ] || continue
        loaded_any=1
        load_one_tarball "$tarball" || true
      done
      if [ "$loaded_any" -eq 0 ]; then
        warn "preload directory has no *.tar files: ${entry}"
      fi
    elif [ -e "$entry" ]; then
      load_one_tarball "$entry" || true
    else
      warn "preload tarball path does not exist: ${entry}"
    fi
  done
}

preload_images() {
  [ -n "$DIND_PRELOAD_IMAGES" ] || return 0

  for image in $DIND_PRELOAD_IMAGES; do
    if docker image inspect "$image" >/dev/null 2>&1; then
      log "preload image already present, skipping pull: ${image}"
      continue
    fi
    log "Pulling preload image ${image}"
    if ! docker pull "$image"; then
      warn "docker pull failed for preload image ${image}"
    fi
  done
}

host_passthrough_enabled() {
  case "$DIND_HOST_PASSTHROUGH" in
    off|0|false|no|"") return 1 ;;
    *) return 0 ;;
  esac
}

# The host docker CLI invocation, if a usable host socket is mounted. Returns
# non-zero (so passthrough is a quiet no-op) when no host socket is present or
# the socket cannot be reached.
host_docker_available() {
  [ -n "$DIND_HOST_DOCKER_SOCK" ] || return 1
  [ -S "$DIND_HOST_DOCKER_SOCK" ] || return 1
  docker -H "unix://$DIND_HOST_DOCKER_SOCK" version >/dev/null 2>&1 || return 1
  return 0
}

# Extract the registry host from an image reference or repo-digest. Docker Hub
# refs ("alpine", "library/alpine", "user/repo") have no host component and map
# to docker.io. A first path segment containing '.' or ':' (or "localhost") is
# treated as an explicit registry host.
image_registry() {
  first="${1%%/*}"
  case "$first" in
    localhost|*.*|*:*) printf '%s\n' "$first" ;;
    *) printf '%s\n' "docker.io" ;;
  esac
}

registry_is_public() {
  for allowed in $DIND_HOST_PASSTHROUGH_REGISTRIES; do
    [ "$1" = "$allowed" ] && return 0
  done
  return 1
}

# When DIND_HOST_PASSTHROUGH_IMAGES is non-empty, a host image is eligible only
# if its reference matches at least one space-separated pattern (shell glob).
# Patterns are matched against several normalized forms of the reference so that
# an entry like "konard/hive-mind" matches "konard/hive-mind:latest" and the
# docker.io-qualified "docker.io/konard/hive-mind[:latest]" alike, keeping the
# allowlist ergonomic. An empty list always passes (filter disabled). (issue #97)
host_image_matches_images_filter() {
  ref="$1"
  [ -n "$DIND_HOST_PASSTHROUGH_IMAGES" ] || return 0

  repo="${ref%:*}"   # strip the :tag -> repository (handles host:port/path too)

  # Candidate forms to test patterns against: the tagged ref, the bare repo, and
  # — for Docker Hub refs — the same two with an explicit docker.io/ prefix (or,
  # if already docker.io-qualified, with that prefix stripped).
  set -- "$ref" "$repo"
  case "$ref" in
    docker.io/*)
      set -- "$@" "${ref#docker.io/}" "${repo#docker.io/}" ;;
    *)
      if [ "$(image_registry "$ref")" = "docker.io" ]; then
        set -- "$@" "docker.io/$ref" "docker.io/$repo"
      fi ;;
  esac

  for pattern in $DIND_HOST_PASSTHROUGH_IMAGES; do
    for cand in "$@"; do
      # shellcheck disable=SC2254  # intentional glob match against the pattern
      case "$cand" in
        $pattern) return 0 ;;
      esac
    done
  done
  return 1
}

# Decide whether a host image should be passed through under the current mode.
# "all"    -> every tagged image qualifies.
# "public" -> the image must carry a RepoDigest from an allowlisted public
#             registry, proving it was pulled from a public registry and is
#             freely re-pullable. Locally-built images (no RepoDigest) and
#             private-registry images are excluded, so passthrough never copies
#             local build secrets or images that required a credential.
host_image_passes_filter() {
  ref="$1"; repo_digests="$2"

  # Repository/name allowlist, composed with the mode gate below: when set, the
  # image must additionally match at least one pattern. (issue #97)
  host_image_matches_images_filter "$ref" || return 1

  case "$DIND_HOST_PASSTHROUGH" in
    all) return 0 ;;
    public)
      [ -n "$repo_digests" ] || return 1
      for rd in $repo_digests; do
        if registry_is_public "$(image_registry "${rd%@*}")"; then
          return 0
        fi
      done
      return 1 ;;
    *) return 1 ;;
  esac
}

passthrough_host_images() {
  host_passthrough_enabled || return 0

  if ! host_docker_available; then
    if [ -n "$DIND_HOST_DOCKER_SOCK" ] && [ -e "$DIND_HOST_DOCKER_SOCK" ]; then
      # A socket file exists but is unreachable: surface it. The most common
      # cause on a real host is a socket owned by the *host's* docker GID that
      # the in-container box user is not a member of (finding #1), so when it is
      # a genuine socket detect that GID and print the exact --group-add to add
      # rather than leaving the operator to reverse-engineer it.
      warn "host docker socket at ${DIND_HOST_DOCKER_SOCK} is not accessible; skipping passthrough"
      sock_gid=""
      if [ -S "$DIND_HOST_DOCKER_SOCK" ]; then
        sock_gid="$(socket_gid "$DIND_HOST_DOCKER_SOCK" || true)"
      fi
      if [ -n "$sock_gid" ] && ! current_user_in_gid "$sock_gid"; then
        warn "the socket is owned by GID ${sock_gid}, which the in-container box user is not a member of; re-run the container with --group-add ${sock_gid} so box can read it (issue #110)"
      fi
      # A mounted-but-unreachable socket is a real error, not a quiet no-op:
      # return non-zero so the terminal marker is honest ("WITH WARNINGS")
      # instead of falsely printing "complete" over a skipped passthrough. (#2)
      return 1
    elif [ -n "$DIND_HOST_PASSTHROUGH_IMAGES" ]; then
      # Operator opted in via an allowlist but no host socket is mounted: the
      # nested daemon will NOT be seeded and the first nested 'docker run' will
      # re-pull from the registry. Surface it instead of failing silently. (issue #102)
      warn "host-image passthrough is enabled and DIND_HOST_PASSTHROUGH_IMAGES is set, but no host docker socket is mounted at ${DIND_HOST_DOCKER_SOCK}; the nested daemon will NOT be seeded from the host (first 'docker run' will pull from the registry). Mount it with: -v /var/run/docker.sock:${DIND_HOST_DOCKER_SOCK}:ro"
      # No socket mounted at all: the marker is still governed by the per-image
      # concrete verification below (issue #106), so a concrete allowlist entry
      # that is missing still flips it to "WITH WARNINGS" while a non-concrete
      # glob/bare repo does not — keep returning 0 here so we do not double-warn.
      return 0
    fi
    # Otherwise (no opt-in signal) the common "no host socket mounted" case stays
    # silent so plain box-dind containers are not spammed.
    return 0
  fi

  hostdocker="docker -H unix://$DIND_HOST_DOCKER_SOCK"
  if [ -n "$DIND_HOST_PASSTHROUGH_IMAGES" ]; then
    log "host-image passthrough (mode=${DIND_HOST_PASSTHROUGH}, images=${DIND_HOST_PASSTHROUGH_IMAGES}) from ${DIND_HOST_DOCKER_SOCK}"
  else
    log "host-image passthrough (mode=${DIND_HOST_PASSTHROUGH}) from ${DIND_HOST_DOCKER_SOCK}"
  fi

  $hostdocker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | sort -u \
    | while IFS= read -r ref; do
        [ -n "$ref" ] || continue
        case "$ref" in *'<none>'*) continue ;; esac

        repo_digests="$($hostdocker image inspect "$ref" \
          --format '{{range .RepoDigests}}{{.}} {{end}}' 2>/dev/null || true)"

        if ! host_image_passes_filter "$ref" "$repo_digests"; then
          log "passthrough skip (filtered by mode=${DIND_HOST_PASSTHROUGH}): ${ref}"
          continue
        fi

        if docker image inspect "$ref" >/dev/null 2>&1; then
          log "passthrough skip (already present): ${ref}"
          continue
        fi

        log "passthrough loading host image: ${ref}"
        if ! $hostdocker save "$ref" | docker load; then
          warn "passthrough failed for ${ref}"
        fi
      done

  # The save|load above runs synchronously, so by the time this returns every
  # eligible host image has finished streaming into the nested daemon — the
  # handoff to the workload only happens after preload_into_daemon completes, so
  # the load can never still be running in the background when the workload
  # starts (finding #2). A reachable socket means passthrough ran: success.
  return 0
}

# True when a reference is concrete enough to verify by name: it carries an
# explicit tag or digest and contains no glob metacharacters. A bare repository
# ("konard/hive-mind") or a glob ("konard/hive-mind*") is NOT concrete — it has
# no single deterministic ref to inspect in the nested daemon (the host may hold
# it under any tag), so verification skips it rather than risk a false alarm.
# Note: a ':' is only a tag separator in the LAST path segment; "host:5000/repo"
# is a registry port, not a tag, and is correctly treated as non-concrete.
ref_is_concrete() {
  case "$1" in
    *'*'*|*'?'*|*'['*) return 1 ;;   # glob pattern
  esac
  case "$1" in
    *@*) return 0 ;;                 # explicit digest (…@sha256:…)
  esac
  case "${1##*/}" in
    *:*) return 0 ;;                 # explicit tag in the final segment
  esac
  return 1
}

# Assert that every concrete DIND_HOST_PASSTHROUGH_IMAGES entry actually landed
# in the nested daemon after passthrough ran. Setting the allowlist is an
# unambiguous "seed these" request; if a named image is still absent, the first
# nested 'docker run' will silently re-pull it (multi-GB, ~1h downstream — the
# exact #94/#102 symptom). Rather than print a misleading "complete", surface a
# loud, actionable warning naming the missing image(s) and the likely cause.
# Returns 0 when everything expected is present (or there is nothing concrete to
# check), non-zero when at least one named image is missing. (issue #106)
verify_passthrough_images() {
  host_passthrough_enabled || return 0
  [ -n "$DIND_HOST_PASSTHROUGH_IMAGES" ] || return 0

  missing=""
  for entry in $DIND_HOST_PASSTHROUGH_IMAGES; do
    ref_is_concrete "$entry" || continue
    if ! docker image inspect "$entry" >/dev/null 2>&1; then
      missing="${missing:+$missing }$entry"
    fi
  done

  [ -n "$missing" ] || return 0

  warn "host-image passthrough did NOT seed expected image(s) into the nested daemon: ${missing}"
  warn "the first nested 'docker run' will re-pull each from its registry (multi-GB, slow)."
  if host_docker_available; then
    warn "the host socket at ${DIND_HOST_DOCKER_SOCK} is reachable, so the host most likely does not"
    warn "have the image under that exact reference, or mode=${DIND_HOST_PASSTHROUGH} filtered it out"
    warn "(public passes only images with a public RepoDigest; use DIND_HOST_PASSTHROUGH=all for"
    warn "locally-built or private images)."
  else
    warn "no usable host docker socket at ${DIND_HOST_DOCKER_SOCK}; mount it read-only with"
    warn "-v /var/run/docker.sock:${DIND_HOST_DOCKER_SOCK}:ro so passthrough can copy the image."
  fi
  return 1
}

preload_into_daemon() {
  # Tarball/registry preload only run when their vars are set; host passthrough
  # is on by default, so we still proceed to give it a chance to find a socket.
  if [ -z "$DIND_PRELOAD_TARBALL" ] && [ -z "$DIND_PRELOAD_IMAGES" ] \
     && ! host_passthrough_enabled; then
    return 0
  fi

  if ! docker info >/dev/null 2>&1; then
    warn "Skipping image preload/passthrough because the nested dockerd is not ready"
    return 0
  fi

  preload_tarballs
  passthrough_status=0
  passthrough_host_images || passthrough_status=1
  preload_images
  # Emit a terminal marker once every preload path has finished so consumers
  # (and tests) can synchronize on "images are seeded" rather than racing the
  # asynchronous load against mere dockerd readiness. (issue #94) The wording is
  # honest about the outcome: only claim "complete" when every concrete
  # allowlisted image is actually present AND passthrough itself was able to run
  # (a mounted-but-unreachable socket is a failure, not a success); otherwise say
  # so loudly instead of papering over a silent re-pull. (issues #106, #110)
  if verify_passthrough_images && [ "$passthrough_status" -eq 0 ]; then
    log "image preload/passthrough complete"
    write_ready_file complete
  else
    warn "image preload/passthrough finished WITH WARNINGS: expected host image(s) were not seeded (see above)"
    write_ready_file warnings
  fi
}

# Write the readiness sentinel so external consumers can block on "images are
# seeded" deterministically (e.g. `until grep -q complete /tmp/box-dind-ready`)
# instead of racing the asynchronous passthrough load against `docker info`,
# which returns ready long before a multi-GB load finishes (finding #2). Best
# effort: never fail the entrypoint over a sentinel write. (issue #110)
write_ready_file() {
  status="$1"
  [ -n "$DIND_READY_FILE" ] || return 0
  ready_dir="$(dirname "$DIND_READY_FILE")"
  if [ -n "$ready_dir" ] && [ ! -d "$ready_dir" ]; then
    mkdir -p "$ready_dir" 2>/dev/null || as_root /usr/bin/mkdir -p "$ready_dir" 2>/dev/null || true
  fi
  printf '%s\n' "$status" >"$DIND_READY_FILE" 2>/dev/null || true
}

# Allow the unit tests to source this file for the function definitions without
# running the startup/handoff flow below.
if [ "${DIND_ENTRYPOINT_SOURCE_ONLY:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

if [ "$DIND_SKIP_DAEMON" != "1" ]; then
  if ! start_dockerd; then
    warn "dockerd startup failed. Use --user root, check /etc/sudoers.d/box-dind, or set DIND_SKIP_DAEMON=1 to silence."
  fi
  preload_into_daemon
else
  # Docker-outside-of-Docker (DooD) / daemon-skipped mode. When the host daemon's
  # socket is mounted as the real runtime, the in-container docker CLI talks to
  # the host daemon directly — zero image copy, zero extra disk — instead of a
  # nested daemon. This is a supported mode, not just a Sysbox setup hook;
  # announce it so logs make the active model obvious. (issue #110)
  if [ -S /var/run/docker.sock ]; then
    log "DIND_SKIP_DAEMON=1: not starting a nested dockerd; using the Docker socket mounted at /var/run/docker.sock (Docker-outside-of-Docker / DooD)"
  else
    log "DIND_SKIP_DAEMON=1: not starting a nested dockerd"
  fi
  if [ -n "$DIND_PRELOAD_TARBALL" ] || [ -n "$DIND_PRELOAD_IMAGES" ] \
     || { host_passthrough_enabled && [ -n "$DIND_HOST_DOCKER_SOCK" ] && [ -e "$DIND_HOST_DOCKER_SOCK" ]; }; then
    warn "DIND_PRELOAD_*/host passthrough requested but DIND_SKIP_DAEMON=1; nothing will be preloaded (DooD reuses the host daemon's images directly, so no seeding is needed)"
  fi
fi

# Ensure the runtime docker socket is usable by the box user. In DinD this is the
# private inner socket dockerd just created (safe to adopt into the docker group);
# in DooD it is the *shared* host socket mounted at /var/run/docker.sock, which is
# never mutated — if box is not already in its group the entrypoint prints the
# exact --group-add to re-run with (findings #1 and #4).
fix_socket_permissions

# Hand off via the existing entrypoint, which sources all the language
# environment managers. If no upstream entrypoint exists (e.g. base image is
# the bare js box), exec the command directly. Keep the root fallback for
# explicit --user root runs.
if [ "$#" -eq 0 ]; then
  set -- /bin/bash
fi

INNER_ENTRYPOINT=""
if [ -x /usr/local/bin/entrypoint.sh ]; then
  INNER_ENTRYPOINT="/usr/local/bin/entrypoint.sh"
fi

if [ "$(id -u)" -eq 0 ] && id box >/dev/null 2>&1; then
  if [ -n "$INNER_ENTRYPOINT" ]; then
    if command -v runuser >/dev/null 2>&1; then
      exec runuser -u box -- "$INNER_ENTRYPOINT" "$@"
    else
      exec su - box -c "$INNER_ENTRYPOINT $(printf '%q ' "$@")"
    fi
  else
    if command -v runuser >/dev/null 2>&1; then
      exec runuser -u box -- "$@"
    else
      exec su - box -c "$(printf '%q ' "$@")"
    fi
  fi
fi

if [ -n "$INNER_ENTRYPOINT" ]; then
  exec "$INNER_ENTRYPOINT" "$@"
fi
exec "$@"
