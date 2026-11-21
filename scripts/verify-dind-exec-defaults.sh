#!/usr/bin/env bash
set -euo pipefail

image="${1:?Usage: verify-dind-exec-defaults.sh IMAGE}"
container_name="hive-mind-dind-verify"
snapshot_container="hive-mind-dind-verify-snapshot"
snapshot_image="hive-mind-dind-verify-snapshot:$$"

echo ""
echo "=== Verifying Docker-in-Docker exec defaults ==="
docker rm -f "$container_name" "$snapshot_container" >/dev/null 2>&1 || true
docker run -d --privileged --name "$container_name" "$image" sleep infinity

cleanup_dind_verify() {
  docker rm -f "$container_name" "$snapshot_container" >/dev/null 2>&1 || true
  docker rmi -f "$snapshot_image" >/dev/null 2>&1 || true
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

# Issue #3214: an in-place resume starts the killed container again with the
# previous run's /var/run/docker.pid. Point it at PID 1, which is always alive
# after the restart, so the check does not depend on PID reuse.
echo ""
echo "=== Verifying the nested dockerd starts again after a kill and restart ==="
docker exec -u root "$container_name" sh -c 'echo 1 > /var/run/docker.pid'
docker kill "$container_name" >/dev/null
docker start "$container_name" >/dev/null

restart_ready=0
for attempt in $(seq 1 60); do
  if docker exec "$container_name" docker info >/dev/null 2>&1; then
    restart_ready=1
    break
  fi
  echo "Waiting for inner dockerd after restart (attempt ${attempt}/60)..."
  sleep 1
done

if [ "$restart_ready" != "1" ]; then
  echo "ERROR: inner dockerd did not start after the container was killed and started again"
  docker logs --tail 60 "$container_name" || true
  exit 1
fi
docker logs "$container_name" 2>&1 | grep '\[hive-mind-dind\] removed stale /var/run/docker.pid'

# Issue #3214: start-command also resumes from a snapshot, `docker commit` of
# the killed container plus a new container from it. The snapshot keeps
# /var/run from the running dind, so the stale pid file reaches the new
# container's fresh PID namespace. PID 1 again stands in for a reused PID.
echo ""
echo "=== Verifying the nested dockerd starts in a new container from a commit ==="
docker exec -u root "$container_name" sh -c 'echo 1 > /var/run/docker.pid'
docker kill "$container_name" >/dev/null
docker commit "$container_name" "$snapshot_image" >/dev/null
docker run -d --privileged --name "$snapshot_container" "$snapshot_image" sleep infinity >/dev/null

snapshot_ready=0
for attempt in $(seq 1 60); do
  if docker exec "$snapshot_container" docker info >/dev/null 2>&1; then
    snapshot_ready=1
    break
  fi
  echo "Waiting for inner dockerd in the snapshot container (attempt ${attempt}/60)..."
  sleep 1
done

if [ "$snapshot_ready" != "1" ]; then
  echo "ERROR: inner dockerd did not start in a new container created from a commit of the killed one"
  docker logs --tail 60 "$snapshot_container" || true
  exit 1
fi
docker logs "$snapshot_container" 2>&1 | grep '\[hive-mind-dind\] removed stale /var/run/docker.pid'
