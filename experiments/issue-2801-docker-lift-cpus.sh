#!/bin/sh
# Issue #2801: find a `docker update` sequence that lifts a CPU cap cleanly,
# and check what `docker stats` reports for a container that burns CPU.
set -u
NAME=issue-2801-cpu-lift-$$
IMAGE=${IMAGE:-alpine:3}
HOST_CPUS=$(nproc)
docker run -d --rm --name "$NAME" "$IMAGE" sh -c 'for i in 1 2 3; do (while :; do :; done) & done; sleep 600' >/dev/null || exit 1
show() { printf '%-34s NanoCpus=%s CpuQuota=%s cpu.max=%s\n' "$1" "$(docker inspect -f '{{.HostConfig.NanoCpus}}' "$NAME")" "$(docker inspect -f '{{.HostConfig.CpuQuota}}' "$NAME")" "$(docker exec "$NAME" cat /sys/fs/cgroup/cpu.max 2>/dev/null)"; }
show "initial (3 busy loops)"
sleep 3; docker stats --no-stream --format 'stats unlimited: {{.CPUPerc}}' "$NAME"
docker update --cpus 2 "$NAME" >/dev/null && show "after --cpus 2"
sleep 3; docker stats --no-stream --format 'stats capped at 2: {{.CPUPerc}}' "$NAME"
docker exec "$NAME" sh -c 'grep -E "usage_usec|nr_throttled|throttled_usec" /sys/fs/cgroup/cpu.stat'
docker update --cpus "$HOST_CPUS" "$NAME" >/dev/null 2>&1; echo "update --cpus $HOST_CPUS (host cores) exit=$?"; show "after --cpus host"
docker update --cpus "$((HOST_CPUS + 1))" "$NAME" 2>&1 | tail -1; echo "update --cpus host+1 exit=$?"
docker update --cpus 2 "$NAME" >/dev/null
docker update --cpu-quota -1 "$NAME" >/dev/null 2>&1; show "after --cpu-quota -1"
docker update --cpus 2 "$NAME" 2>&1 | tail -1; echo "re-cap --cpus 2 after quota -1 exit=$?"; show "after re-cap"
docker kill "$NAME" >/dev/null
