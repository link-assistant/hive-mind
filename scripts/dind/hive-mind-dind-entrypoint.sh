#!/bin/sh
# Entrypoint of the hive-mind-dind image. It runs at every container start,
# including `docker start` of a stopped task container and containers created
# from `docker commit` (in-place resume). It removes the nested dockerd's stale
# pid files, then hands off to box-dind's entrypoint, which starts dockerd and
# runs the command (issue #3214).

cleanup=/usr/local/sbin/hive-mind-dind-clear-stale-pids

if [ "${DIND_SKIP_DAEMON:-0}" != "1" ] && [ -x "$cleanup" ]; then
  if [ "$(id -u)" -eq 0 ]; then
    "$cleanup" || true
  elif command -v sudo >/dev/null 2>&1; then
    sudo -n "$cleanup" || true
  fi
fi

exec /usr/local/bin/dind-entrypoint.sh "$@"
