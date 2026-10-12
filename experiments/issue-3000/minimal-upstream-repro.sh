#!/usr/bin/env bash
# Issue #3000: minimal reproduction filed upstream (moby/moby, containerd/continuity).
#
# One container creates and deletes files in /tmp. On the containerd image store,
# every `GET /containers/json?size=1` (`docker ps --size`, `--format '{{json .}}'`)
# and `GET /system/df` races its writable-layer walk and the whole request fails.
#
# Usage: experiments/issue-3000/minimal-upstream-repro.sh [iterations]
set -u
N="${1:-50}"
SOCK="${DOCKER_HOST#unix://}"
SOCK="${SOCK:-/var/run/docker.sock}"
[ "$SOCK" = "${DOCKER_HOST:-}" ] && SOCK=/var/run/docker.sock

echo "# docker $(docker version --format '{{.Server.Version}}'), driver: $(docker info --format '{{.Driver}} {{json .DriverStatus}}')"
docker rm -f issue3000-churn >/dev/null 2>&1
docker run -d --name issue3000-churn alpine:3.20 sh -c 'while true; do mkdir -p /tmp/cc; for i in $(seq 300); do : > /tmp/cc/f$i; done; rm -rf /tmp/cc; done' >/dev/null
trap 'docker rm -f issue3000-churn >/dev/null 2>&1' EXIT
sleep 2

errors=$(mktemp)
count() {
  local label="$1" failed=0
  shift
  for _ in $(seq "$N"); do "$@" >/dev/null 2>>"$errors" || failed=$((failed + 1)); done
  printf '%-28s failed %d/%d\n' "$label" "$failed" "$N"
}
count 'docker ps -a --size' docker ps -a --size
count "docker ps -a --format '{{json .}}'" docker ps -a --format '{{json .}}'
count 'docker ps -a' docker ps -a
count 'docker system df' docker system df
echo "# GET /containers/json?all=1&size=1 status codes:"
for _ in $(seq "$N"); do curl -s -o /dev/null -w '%{http_code}\n' --unix-socket "$SOCK" 'http://localhost/v1.47/containers/json?all=1&size=1'; done | sort | uniq -c
echo "# daemon errors:"
sed -E 's/f[0-9]+:/fN:/' "$errors" | sort | uniq -c
rm -f "$errors"
