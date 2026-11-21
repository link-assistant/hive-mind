#!/bin/sh
# Remove dockerd/containerd pid files left behind by an earlier run of this
# container, so the nested dockerd can start (issue #3214).
#
# `docker start` of a stopped task container and a container created from
# `docker commit` both keep /var/run from the previous run. The new run has a
# fresh PID namespace, so the recorded PID usually names an unrelated process,
# and dockerd then refuses to start: "delete /var/run/docker.pid: process with
# PID 25 is still running". A stale containerd.pid makes dockerd wait for a
# containerd that is not there.
#
# A pid file is kept only when its PID is a running process with the expected
# name (/proc/<pid>/comm). The image runs this as root before box-dind's
# entrypoint starts dockerd; see scripts/dind/hive-mind-dind-entrypoint.sh.
#
# Workaround until box-dind's own entrypoint clears them:
# https://github.com/link-foundation/box/issues/133
#
# HIVE_MIND_DIND_STATE_ROOT prefixes /var/run and /proc for tests.

state_root="${HIVE_MIND_DIND_STATE_ROOT:-}"

clear_stale_pid_file() {
  pid_file="$1"
  expected="$2"
  path="${state_root}${pid_file}"
  [ -f "$path" ] || return 0

  pid="$(tr -d '[:space:]' <"$path" 2>/dev/null)" || pid=""
  case "$pid" in
    '' | *[!0-9]*) ;;
    *)
      comm="$(cat "${state_root}/proc/${pid}/comm" 2>/dev/null)" || comm=""
      [ "$comm" = "$expected" ] && return 0
      ;;
  esac

  if rm -f "$path"; then
    echo "[hive-mind-dind] removed stale ${pid_file} (pid ${pid:-none} is not a running ${expected})"
  else
    echo "[hive-mind-dind] WARN: cannot remove stale ${pid_file}" >&2
  fi
}

clear_stale_pid_file /var/run/docker.pid dockerd
clear_stale_pid_file /var/run/docker/containerd/containerd.pid containerd
clear_stale_pid_file /var/run/containerd/containerd.pid containerd
exit 0
