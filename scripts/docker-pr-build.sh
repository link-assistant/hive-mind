#!/usr/bin/env bash
# docker-pr-build.sh
#
# Builds the hive-mind and hive-mind-dind images for the pull-request Docker
# check, and fails if the build logs contain errors that Docker itself does not
# surface as a non-zero exit code.
#
# PR builds install @link-assistant/hive-mind@latest — the currently published
# version, which may pre-date this PR — so the Dockerfile tolerates a missing
# configure-claude bin. Release builds install the exact version just published
# and enforce the bin strictly.
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

# Issue #3282: the hosted runner has stopped this step with SIGTERM (exit 143)
# while exporting the DinD image's layers, leaving no hint why. Sample memory
# and disk every DOCKER_PR_RESOURCE_SAMPLE_SECONDS (0 turns it off), and on
# failure print them with any OOM-killer lines from the kernel log.
log_resources() {
  echo "[resources $(date -u +%H:%M:%S)] $(free -m | awk '/^Mem:/ {printf "mem used=%sM available=%sM", $3, $7} /^Swap:/ {printf " swap used=%sM", $3}') $(df -h / | awk 'NR == 2 {printf "disk available=%s", $4}')"
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

echo "Building Docker image from ${BOX_BASE} base..."
echo "Note: General-purpose tools are inherited from pinned ${BOX_BASE}"
echo "This image adds AI-specific tools on top of the Box base."
echo "Installing @link-assistant/hive-mind@latest; configure-claude may not yet be present in the published package."
echo ""

docker build --progress=plain -t "${IMAGE_NAME}:test" . 2>&1 | tee build-output.log

echo ""
echo "Building Docker-in-Docker image from ${BOX_DIND_BASE} base..."
docker build --progress=plain -f Dockerfile.dind -t "${DIND_IMAGE_NAME}:test" . 2>&1 | tee build-dind-output.log

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
