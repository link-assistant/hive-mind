#!/usr/bin/env bash
set -euo pipefail

image="${1:?Usage: verify-dind-exec-defaults.sh IMAGE}"
container_name="hive-mind-dind-verify"

echo ""
echo "=== Verifying Docker-in-Docker exec defaults ==="
docker rm -f "$container_name" >/dev/null 2>&1 || true
docker run -d --privileged --name "$container_name" "$image" sleep infinity

cleanup_dind_verify() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup_dind_verify EXIT

dind_ready=0
for attempt in $(seq 1 60); do
  if docker exec "$container_name" docker info >/dev/null 2>&1; then
    dind_ready=1
    break
  fi
  echo "Waiting for inner dockerd to become ready (attempt ${attempt}/60)..."
  sleep 1
done

if [ "$dind_ready" != "1" ]; then
  echo "ERROR: inner dockerd did not become ready"
  docker logs "$container_name" || true
  exit 1
fi

dind_exec_user=$(docker exec "$container_name" whoami)
echo "docker exec user: ${dind_exec_user}"
if [ "$dind_exec_user" != "box" ]; then
  echo "ERROR: docker exec should default to box, got ${dind_exec_user}"
  exit 1
fi

dind_exec_home=$(docker exec "$container_name" bash -lc 'echo $HOME')
echo "docker exec HOME: ${dind_exec_home}"
if [ "$dind_exec_home" != "/home/box" ]; then
  echo "ERROR: docker exec HOME should be /home/box, got ${dind_exec_home}"
  exit 1
fi

docker exec "$container_name" docker ps
docker exec "$container_name" pgrep -x dockerd
docker exec "$container_name" claude --version
docker exec "$container_name" bun --version
docker exec "$container_name" bash -lc 'docker info && docker run hello-world'
