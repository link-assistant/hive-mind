#!/usr/bin/env bash
# Issue #2900 — does dockerd refuse to start when live-restore is set BOTH as
# the --live-restore flag and in daemon.json? (Why enable-docker-live-restore.sh
# exits early when the running daemon already reports true, and why box should
# pass the flag only when daemon.json does not set it.) Runs in a throwaway
# privileged docker:dind container.
set -euo pipefail
IMAGE="${1:-docker:29-dind}"
NAME="hm2900-conflict-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --privileged --name "$NAME" --entrypoint sh "$IMAGE" -c 'sleep 600' >/dev/null
docker exec -i "$NAME" sh -s <<'INNER'
mkdir -p /etc/docker && printf '{ "live-restore": true }\n' >/etc/docker/daemon.json
echo "== dockerd --live-restore + daemon.json {\"live-restore\": true} =="
timeout 20 dockerd --live-restore --storage-driver=vfs >/tmp/d1.log 2>&1; echo "exit=$?"; tail -1 /tmp/d1.log
echo "== dockerd --live-restore, no daemon.json key =="
printf '{}\n' >/etc/docker/daemon.json
dockerd --live-restore --storage-driver=vfs >/tmp/d2.log 2>&1 &
i=0; until docker info >/dev/null 2>&1 || [ "$i" -ge 40 ]; do i=$((i+1)); sleep 0.5; done
echo "LiveRestoreEnabled=$(docker info -f '{{.LiveRestoreEnabled}}')"
INNER
