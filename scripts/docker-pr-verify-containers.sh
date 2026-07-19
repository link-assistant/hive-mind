#!/usr/bin/env bash
# docker-pr-verify-containers.sh
#
# Runs scripts/verify-docker-image.sh inside both freshly built images, plus the
# nested-Docker default checks against the DinD image.
#
# Verifies box user setup (/home/box access), development tools, AI tools, and
# configure-claude (tolerantly, for PR builds — see docker-pr-build.sh).
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

echo "=== Verifying hive-mind Docker image ==="
echo "Base: konard/box:${BOX_VERSION} (pinned) + AI-specific tools"
echo ""

docker run --rm \
  -v "$(pwd)/scripts/verify-docker-image.sh:/verify-docker-image.sh:ro" \
  "${IMAGE_NAME}:test" \
  bash /verify-docker-image.sh

echo ""
echo "=== Verifying hive-mind Docker-in-Docker image ==="
echo "Base: konard/box-dind:${BOX_DIND_VERSION} (pinned) + AI-specific tools"
docker run --rm --privileged \
  -v "$(pwd)/scripts/verify-docker-image.sh:/verify-docker-image.sh:ro" \
  "${DIND_IMAGE_NAME}:test" \
  bash /verify-docker-image.sh

bash scripts/verify-dind-exec-defaults.sh "${DIND_IMAGE_NAME}:test"

echo ""
echo "All system, development, and nested Docker verification checks passed!"
