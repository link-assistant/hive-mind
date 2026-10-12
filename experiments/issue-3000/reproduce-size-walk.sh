#!/usr/bin/env bash
# Issue #3000 reproduction: `docker ps --format '{{json .}}'` asks dockerd for
# every container's size, which walks each writable layer. It is slow on big
# layers and fails when a file disappears mid-walk.
#
# Usage: experiments/issue-3000/reproduce-size-walk.sh [containers] [files-per-container] [iterations]
# Needs a local docker daemon; creates containers named issue3000-* and removes them on exit.
set -u
CONTAINERS="${1:-4}"
FILES="${2:-20000}"
ITERATIONS="${3:-30}"
IMAGE="${IMAGE:-alpine:3.20}"
EXPLICIT_FORMAT='{"ID":{{json .ID}},"Names":{{json .Names}},"Image":{{json .Image}},"State":{{json .State}},"Status":{{json .Status}},"Labels":{{json .Labels}}}'

cleanup() { docker rm -f $(docker ps -aq --filter name=issue3000-) >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "# docker $(docker version --format '{{.Server.Version}}'), storage: $(docker info --format '{{.Driver}}')"
for i in $(seq 1 "$CONTAINERS"); do
  # A big writable layer: many small files, like a node_modules or build tree.
  docker run -d --name "issue3000-layer-$i" "$IMAGE" sh -c "mkdir -p /work && cd /work && i=0; while [ \$i -lt $FILES ]; do echo \$i > f\$i; i=\$((i+1)); done; sleep 3600" >/dev/null || { echo "cannot start containers on this daemon"; exit 2; }
done
# A "compiler": creates and deletes temp files in /tmp as fast as it can.
docker run -d --name issue3000-churn "$IMAGE" sh -c 'while true; do mkdir -p /tmp/cc; n=0; while [ $n -lt 300 ]; do : > /tmp/cc/ccCBK$n.s; n=$((n+1)); done; rm -rf /tmp/cc; done' >/dev/null

echo "# waiting for layers to fill"
for i in $(seq 1 60); do
  done_count=$(for c in $(seq 1 "$CONTAINERS"); do docker exec "issue3000-layer-$c" sh -c "[ -f /work/f$((FILES-1)) ] && echo y" 2>/dev/null; done | grep -c y)
  [ "$done_count" -ge "$CONTAINERS" ] && break
  sleep 1
done

time_it() { local start end; start=$(date +%s%N); "$@" >/dev/null 2>>/tmp/issue3000-errors.log; local rc=$?; end=$(date +%s%N); echo "$(( (end-start)/1000000 )) $rc"; }

: > /tmp/issue3000-errors.log
# Every docker call hive-mind makes that could walk container layers.
run_case() {
  case "$1" in
    ps-json) docker ps -a --format '{{json .}}' ;;
    ps-explicit) docker ps -a --format "$EXPLICIT_FORMAT" ;;
    ps-json-size-false) docker ps -a --size=false --format '{{json .}}' ;;
    image-ls-json) docker image ls --format '{{json .}}' ;;
    system-df) docker system df ;;
  esac
}
CASES="${CASES:-ps-json ps-explicit ps-json-size-false image-ls-json system-df}"
for label in $CASES; do
  total=0; failures=0
  for _ in $(seq 1 "$ITERATIONS"); do
    out=$(time_it run_case "$label")
    ms=${out% *}; rc=${out#* }; total=$((total+ms)); [ "$rc" != 0 ] && failures=$((failures+1))
  done
  printf '%-20s avg %6d ms over %d runs, %d failed\n' "$label:" "$((total/ITERATIONS))" "$ITERATIONS" "$failures"
done
echo "# daemon errors seen:"
sed -E 's/(snapshots\/[0-9]+\/fs\/tmp\/cc\/ccCBK)[0-9]+/\1N/; s/for [0-9a-f]{64}/for <container>/' /tmp/issue3000-errors.log | sort | uniq -c | sed 's/^/  /' | head -5
