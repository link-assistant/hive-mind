#!/usr/bin/env bash
# Issue #2900 — reproduce, inside a throwaway privileged docker:dind container
# (we are root over ITS dockerd, so the host is never touched):
#   A. live-restore off (Docker default): restarting dockerd kills a running
#      container (exit 137 / Exited) — the 2026-10-09 incident in miniature.
#   B. live-restore enabled WITHOUT a restart: write daemon.json, send SIGHUP
#      (what `systemctl reload docker` does); the running container survives
#      and `docker info` flips to true.
#   C. live-restore on: restarting dockerd leaves the container running.
#
# Usage: bash experiments/issue-2900-live-restore-dind-repro.sh [image]
# Output is also saved to docs/case-studies/issue-2900/data/ by the caller.
set -euo pipefail
IMAGE="${1:-docker:29-dind}"
NAME="hm2900-repro-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker pull -q "$IMAGE" >/dev/null
docker run -d --privileged --name "$NAME" --entrypoint sh "$IMAGE" -c 'sleep 3600' >/dev/null

docker exec -i "$NAME" sh -s <<'INNER'
set -eu
LOG=/tmp/dockerd.log
start_dockerd() {
  dockerd --storage-driver=vfs >>"$LOG" 2>&1 &
  echo $! >/tmp/dockerd.pid
  i=0; until docker info >/dev/null 2>&1; do i=$((i+1)); [ "$i" -lt 60 ] || { tail -20 "$LOG"; exit 1; }; sleep 0.5; done
}
stop_dockerd() {
  pid="$(cat /tmp/dockerd.pid)"
  kill -TERM "$pid"
  i=0; while kill -0 "$pid" 2>/dev/null; do i=$((i+1)); [ "$i" -lt 60 ] || { echo "dockerd did not stop"; exit 1; }; sleep 0.5; done
}
state() { docker inspect -f '{{.State.Status}} exit={{.State.ExitCode}} pid={{.State.Pid}}' "$1"; }

echo "dockerd $(dockerd --version)"
start_dockerd
# Load a tiny image without registry access: an empty rootfs plus the
# busybox (plus the musl loader it links against) from docker:dind is enough.
mkdir -p /tmp/rootfs/bin /tmp/rootfs/lib && cp -a /lib/ld-musl-* /tmp/rootfs/lib/ && cp /bin/busybox /tmp/rootfs/bin/busybox && ln -sf busybox /tmp/rootfs/bin/sleep
tar -C /tmp/rootfs -c . | docker import - hm2900/sleeper >/dev/null

echo "== A. live-restore=$(docker info -f '{{.LiveRestoreEnabled}}') (Docker default) =="
docker run -d --name task-a hm2900/sleeper /bin/sleep 3600 >/dev/null
echo "before dockerd restart: $(state task-a)"
stop_dockerd; start_dockerd
echo "after  dockerd restart: $(state task-a)"

echo "== B. enable live-restore with SIGHUP (reload), no restart =="
docker run -d --name task-b hm2900/sleeper /bin/sleep 3600 >/dev/null
echo "before reload: $(state task-b) live-restore=$(docker info -f '{{.LiveRestoreEnabled}}')"
mkdir -p /etc/docker && printf '{\n  "live-restore": true\n}\n' >/etc/docker/daemon.json
kill -HUP "$(cat /tmp/dockerd.pid)"; sleep 1
echo "after  reload: $(state task-b) live-restore=$(docker info -f '{{.LiveRestoreEnabled}}')"
grep -E 'Reloaded configuration|live-restore|LiveRestore' "$LOG" | tail -2 || true

echo "== C. live-restore on: restart dockerd again =="
pid_before="$(docker inspect -f '{{.State.Pid}}' task-b)"
stop_dockerd; start_dockerd
echo "after  dockerd restart: $(state task-b) (pid before restart: $pid_before)"
INNER
