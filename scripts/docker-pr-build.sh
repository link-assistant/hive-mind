#!/usr/bin/env bash
# docker-pr-build.sh
#
# Builds the hive-mind and hive-mind-dind images for the pull-request Docker
# check, and fails if the build logs contain errors that Docker itself does not
# surface as a non-zero exit code.
#
# PR builds pack and install the checked-out branch through the same npm file
# allowlist as a release. Both images require the installed runtime verifier.
# Release builds continue installing the exact version just published.
#
# Multi-platform builds (amd64+arm64) are exercised by docker-publish during a
# release. PR checks validate amd64 only, using plain `docker build` rather than
# buildx, so the image is loaded into the local daemon and can be run for the
# container verification step.
#
# Environment:
#   IMAGE_NAME       Tag for the main image      (default: konard/hive-mind)
#   DIND_IMAGE_NAME  Tag for the DinD image      (default: konard/hive-mind-dind)
#
# Extracted from .github/workflows/release.yml to keep that file under the
# 1500-line limit enforced by scripts/check-file-line-limits.sh (issue #2082).

set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-konard/hive-mind}"
DIND_IMAGE_NAME="${DIND_IMAGE_NAME:-konard/hive-mind-dind}"

# Read the whole base reference, registry included. The bases moved from
# Docker Hub to `ghcr.io/link-foundation/...` in issue #2187 while box#119
# blocked a usable mirror. The mirror is repaired, but the old `konard/box:`
# greps would still silently produce an empty version string after a registry
# move. Matching `*/box:` keeps this working across registries.
BOX_BASE=$(sed -n 's|^FROM \(.*/box:[^[:space:]]*\).*|\1|p' Dockerfile)
BOX_DIND_BASE=$(sed -n 's|^FROM \(.*/box-dind:[^[:space:]]*\).*|\1|p' Dockerfile.dind)
[ -n "${BOX_BASE}" ] || { echo "ERROR: no box base image found in Dockerfile" >&2; exit 1; }
[ -n "${BOX_DIND_BASE}" ] || { echo "ERROR: no box-dind base image found in Dockerfile.dind" >&2; exit 1; }

# Issue #3282: the hosted runner stopped this step with SIGTERM (exit 143) while
# exporting the DinD image's layers. The kernel log showed why: exporting the
# main image took dockerd to ~13.6 GB of the runner's 16 GB, it kept ~12 GB
# after that export, and the DinD export then ran the runner out of memory
# ("dockerd invoked oom-killer"). Sample memory, disk and the largest processes
# every DOCKER_PR_RESOURCE_SAMPLE_SECONDS (0 turns it off), and on failure print
# them with the OOM-killer lines from the kernel log.
log_resources() {
  echo "[resources $(date -u +%H:%M:%S)] $(free -m | awk '/^Mem:/ {printf "mem used=%sM available=%sM", $3, $7} /^Swap:/ {printf " swap used=%sM", $3}') $(df -h / | awk 'NR == 2 {printf "disk available=%s", $4}') top rss: $(ps -eo comm=,rss= --sort=-rss | head -n 3 | awk '{printf "%s=%dM ", $1, $2 / 1024}')"
}
SAMPLE_SECONDS="${DOCKER_PR_RESOURCE_SAMPLE_SECONDS:-30}"
if [ "${SAMPLE_SECONDS}" != "0" ]; then
  # The sampler kills its sleep on exit, so no orphan keeps the step's stdout open.
  (trap 'kill "${SLEEP_PID:-}" 2>/dev/null; exit 0' TERM; while :; do sleep "${SAMPLE_SECONDS}" & SLEEP_PID=$!; wait "${SLEEP_PID}"; log_resources; done) &
  SAMPLER_PID=$!
fi
on_exit() {
  local status=$?
  [ -z "${SAMPLER_PID:-}" ] || kill "${SAMPLER_PID}" 2>/dev/null || true
  if [ "${status}" -ne 0 ]; then
    log_resources
    sudo -n dmesg 2>/dev/null | grep -iE 'out of memory|oom-kill|killed process' | tail -n 20 || true
  fi
}
trap on_exit EXIT
trap 'echo "docker-pr-build.sh received SIGTERM"; exit 143' TERM

# On GitHub Actions only, give the exports headroom: extra swap
# (DOCKER_PR_EXTRA_SWAP_GB, 0 turns it off) and, between the two builds, a
# dockerd restart that hands back what the first export kept. Images and the
# build cache are on disk and survive the restart.
ON_ACTIONS=false
[ "${GITHUB_ACTIONS:-}" = "true" ] && sudo -n true 2>/dev/null && ON_ACTIONS=true
EXTRA_SWAP_GB="${DOCKER_PR_EXTRA_SWAP_GB:-12}"
if [ "${ON_ACTIONS}" = "true" ] && [ "${EXTRA_SWAP_GB}" != "0" ]; then
  SWAP_FILE=/docker-pr-build.swap
  if sudo fallocate -l "${EXTRA_SWAP_GB}G" "${SWAP_FILE}" && sudo chmod 600 "${SWAP_FILE}" && sudo mkswap "${SWAP_FILE}" >/dev/null && sudo swapon "${SWAP_FILE}"; then
    echo "Added ${EXTRA_SWAP_GB} GB of swap at ${SWAP_FILE}"
  else
    # shell-lint: allow-nonfatal — swap is only headroom; a build that then runs out of memory fails on its own.
    echo "Warning: could not add swap at ${SWAP_FILE}; building without it"
  fi
fi
restart_dockerd() {
  [ "${ON_ACTIONS}" = "true" ] || return 0
  echo "Restarting dockerd to release the memory the previous export kept..."
  log_resources
  sudo systemctl restart docker
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null
  log_resources
}

echo "Building Docker image from ${BOX_BASE} base..."
echo "Note: General-purpose tools are inherited from pinned ${BOX_BASE}"
echo "This image adds AI-specific tools on top of the Box base."
echo "Installing the checked-out branch as an npm package; all runtime checks are required."
echo ""

docker build --progress=plain --build-arg HIVE_MIND_INSTALL_SOURCE=true -t "${IMAGE_NAME}:test" . 2>&1 | tee build-output.log

echo ""
restart_dockerd
echo "Building Docker-in-Docker image from ${BOX_DIND_BASE} base..."
docker build --progress=plain -f Dockerfile.dind --build-arg HIVE_MIND_INSTALL_SOURCE=true -t "${DIND_IMAGE_NAME}:test" . 2>&1 | tee build-dind-output.log

echo ""
echo "Docker images built successfully"
docker images | grep -E "${IMAGE_NAME}|${DIND_IMAGE_NAME}|REPOSITORY"

echo ""
echo "Checking build logs for critical errors..."
if grep -E 'unbound variable' build-output.log build-dind-output.log; then
  echo "ERROR: Unbound variable error detected in Docker build"
  exit 1
fi

echo "Build log check completed"
