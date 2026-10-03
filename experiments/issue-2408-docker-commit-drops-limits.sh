#!/usr/bin/env bash
# Issue #2408 / link-foundation/start#176: a container rebuilt from `docker commit`
# (start-command's DOCKER_SNAPSHOT resume: commit + `docker run` with only the
# stored runtime args) does not inherit the original container's HostConfig
# limits — neither those given at create time nor those added by `docker update`.
# Uses `docker create` so it also works on hosts without a memory cgroup controller.
set -u
img=alpine:3
docker pull -q "$img" >/dev/null 2>&1
docker rm -f i2408-demo i2408-demo-resume-1 >/dev/null 2>&1
docker create --name i2408-demo --memory 256m --memory-swap 256m --cpus 0.5 "$img" sleep 600 >/dev/null
docker update --pids-limit 64 i2408-demo >/dev/null || echo "(docker update not supported here)"
fmt='Memory={{.HostConfig.Memory}} MemorySwap={{.HostConfig.MemorySwap}} NanoCpus={{.HostConfig.NanoCpus}} PidsLimit={{.HostConfig.PidsLimit}}'
echo "original: $(docker inspect -f "$fmt" i2408-demo)"
docker commit i2408-demo i2408-snapshot >/dev/null
docker create --name i2408-demo-resume-1 i2408-snapshot sh -c 'sleep 600' >/dev/null
echo "resumed:  $(docker inspect -f "$fmt" i2408-demo-resume-1)"
docker rm -f i2408-demo i2408-demo-resume-1 >/dev/null; docker rmi i2408-snapshot >/dev/null
