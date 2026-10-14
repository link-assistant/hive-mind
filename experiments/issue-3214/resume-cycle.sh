#!/usr/bin/env bash
# Issue #3214: does the nested dockerd start again when a dind task container is
# resumed in place after being killed?
#
# Usage: experiments/issue-3214/resume-cycle.sh IMAGE [natural|forced]
#
# For IMAGE it starts a privileged dind container, waits for the nested dockerd,
# kills the container (SIGKILL, like the cgroup OOM killer), then resumes it the
# two ways start-command does:
#   docker-start     `docker start` of the same container (start-command >= 0.37)
#   docker-snapshot  `docker commit` + a new container from the snapshot
# and reports whether the nested dockerd becomes ready.
#
# `natural` keeps the pid file as the killed dockerd left it; whether its PID is
# taken in the new PID namespace depends on process start order. `forced`
# rewrites docker.pid to PID 1 before the kill, which is always alive in the new
# container: the deterministic form of the incident ("process with PID 25 is
# still running").
#
# Needs a Docker daemon that allows --privileged. Everything is bounded by
# timeouts and resource limits, and every container/image it creates is removed.
# RUN_OPTIONS replaces the default resource limits; a Docker daemon that itself
# runs nested in a threaded cgroup rejects cgroup limits, e.g.
#   RUN_OPTIONS="--cgroupns=host" experiments/issue-3214/resume-cycle.sh IMAGE
#
# Observed on 2026-10-14 (outer Docker 29.9.0, nested, RUN_OPTIONS as above):
#   box-essentials-dind:2.10.4 forced   docker-start=FAIL docker-snapshot=FAIL
#     "delete /var/run/docker.pid: process with PID 1 is still running"
#   box-essentials-dind:2.10.4 natural  docker-start=ok   docker-snapshot=ok
#     (dockerd had PID 200 after storage-driver retries; no PID reuse at boot)
#   experiments/issue-3214/Dockerfile forced and natural: both ok, logs show
#     "[hive-mind-dind] removed stale /var/run/docker.pid (pid 1 is not a
#     running dockerd)" and the same for docker/containerd/containerd.pid.
set -uo pipefail

image="${1:?Usage: resume-cycle.sh IMAGE [natural|forced]}"
mode="${2:-forced}"
id="hm3214-$$"
snapshot="hm3214-snapshot:$$"
read -r -a limits <<<"${RUN_OPTIONS:---memory 2g --memory-swap 2g --cpus 2 --pids-limit 2048}"
wait_seconds="${WAIT_SECONDS:-60}"

cleanup() {
  docker rm -f "$id" "$id-resume-1" >/dev/null 2>&1 || true
  docker rmi -f "$snapshot" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for_inner_docker() {
  local container="$1" i
  for i in $(seq 1 "$wait_seconds"); do
    if timeout 10 docker exec "$container" docker info >/dev/null 2>&1; then
      echo "  nested dockerd ready after ~${i}s"
      return 0
    fi
    sleep 1
  done
  echo "  nested dockerd NOT ready after ${wait_seconds}s"
  docker logs --tail 15 "$container" 2>&1 | sed 's/^/    | /'
  return 1
}

echo "== image: $image (mode: $mode)"
docker run -d --privileged "${limits[@]}" --name "$id" "$image" sleep infinity >/dev/null || exit 2
wait_for_inner_docker "$id" || exit 2
echo "  first run docker.pid: $(docker exec "$id" cat /var/run/docker.pid)"
if [ "$mode" = "forced" ]; then
  docker exec -u root "$id" sh -c 'echo 1 > /var/run/docker.pid'
fi
docker kill "$id" >/dev/null
docker commit "$id" "$snapshot" >/dev/null

echo "-- docker-start (same container)"
docker start "$id" >/dev/null
wait_for_inner_docker "$id"
start_result=$?
docker logs "$id" 2>&1 | grep -E 'hive-mind-dind|is still running' | tail -3 | sed 's/^/    | /'

echo "-- docker-snapshot (container from docker commit)"
docker run -d --privileged "${limits[@]}" --name "$id-resume-1" "$snapshot" sleep infinity >/dev/null
wait_for_inner_docker "$id-resume-1"
snapshot_result=$?
docker logs "$id-resume-1" 2>&1 | grep -E 'hive-mind-dind|is still running' | tail -3 | sed 's/^/    | /'

echo "RESULT image=$image mode=$mode docker-start=$([ "$start_result" -eq 0 ] && echo ok || echo FAIL) docker-snapshot=$([ "$snapshot_result" -eq 0 ] && echo ok || echo FAIL)"
[ "$start_result" -eq 0 ] && [ "$snapshot_result" -eq 0 ]
