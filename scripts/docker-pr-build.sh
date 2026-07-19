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

BOX_VERSION=$(grep '^FROM konard/box:' Dockerfile | sed 's/FROM konard\/box://')
BOX_DIND_VERSION=$(grep '^FROM konard/box-dind:' Dockerfile.dind | sed 's/FROM konard\/box-dind://')

echo "Building Docker image from konard/box:${BOX_VERSION} base..."
echo "Note: General-purpose tools are inherited from pinned konard/box:${BOX_VERSION}"
echo "This image adds AI-specific tools on top of the Box base."
echo "Installing @link-assistant/hive-mind@latest; configure-claude may not yet be present in the published package."
echo ""

docker build --progress=plain -t "${IMAGE_NAME}:test" . 2>&1 | tee build-output.log

echo ""
echo "Building Docker-in-Docker image from konard/box-dind:${BOX_DIND_VERSION} base..."
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
