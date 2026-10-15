#!/bin/sh
# Issue #2801: verify how `docker update --cpus` applies, lifts and reports a CPU cap.
set -u
NAME=issue-2801-cpu-probe-$$
IMAGE=${IMAGE:-alpine:3}
docker run -d --rm --name "$NAME" "$IMAGE" sh -c 'sleep 600' >/dev/null || exit 1
show() { printf '%-28s NanoCpus=%s CpuQuota=%s CpuPeriod=%s cpu.max=%s\n' "$1" "$(docker inspect -f '{{.HostConfig.NanoCpus}}' "$NAME")" "$(docker inspect -f '{{.HostConfig.CpuQuota}}' "$NAME")" "$(docker inspect -f '{{.HostConfig.CpuPeriod}}' "$NAME")" "$(docker exec "$NAME" cat /sys/fs/cgroup/cpu.max 2>/dev/null)"; }
show "initial"
docker update --cpus 2 "$NAME" >/dev/null && show "after --cpus 2"
docker update --cpus 3.5 "$NAME" >/dev/null && show "after --cpus 3.5"
docker update --cpus 0 "$NAME" >/dev/null 2>&1; echo "update --cpus 0 exit=$?"; show "after --cpus 0"
docker update --cpus 2 "$NAME" >/dev/null
docker update --cpu-quota -1 "$NAME" >/dev/null 2>&1; echo "update --cpu-quota -1 exit=$?"; show "after --cpu-quota -1"
echo "--- docker stats one-shot formats"
docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}' "$NAME"
docker stats --no-stream --format '{{json .}}' "$NAME"
docker kill "$NAME" >/dev/null
