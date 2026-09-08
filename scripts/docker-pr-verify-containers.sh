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

# Read the whole base reference, registry included. The bases moved from
# Docker Hub to `ghcr.io/link-foundation/...` in issue #2187 (only GHCR carries
# a multi-arch box 2.7.0 — link-foundation/box#119), and the old `konard/box:`
# greps would have silently produced an empty version string rather than
# failing. Matching `*/box:` keeps this working across registry moves.
BOX_BASE=$(sed -n 's|^FROM \(.*/box:[^[:space:]]*\).*|\1|p' Dockerfile)
BOX_DIND_BASE=$(sed -n 's|^FROM \(.*/box-dind:[^[:space:]]*\).*|\1|p' Dockerfile.dind)
[ -n "${BOX_BASE}" ] || { echo "ERROR: no box base image found in Dockerfile" >&2; exit 1; }
[ -n "${BOX_DIND_BASE}" ] || { echo "ERROR: no box-dind base image found in Dockerfile.dind" >&2; exit 1; }

echo "=== Verifying hive-mind Docker image ==="
echo "Base: ${BOX_BASE} (pinned) + AI-specific tools"
echo ""

docker run --rm \
  -v "$(pwd)/scripts/verify-docker-image.sh:/verify-docker-image.sh:ro" \
  "${IMAGE_NAME}:test" \
  bash /verify-docker-image.sh

echo ""
echo "=== Verifying hive-mind Docker-in-Docker image ==="
echo "Base: ${BOX_DIND_BASE} (pinned) + AI-specific tools"
docker run --rm --privileged \
  -v "$(pwd)/scripts/verify-docker-image.sh:/verify-docker-image.sh:ro" \
  "${DIND_IMAGE_NAME}:test" \
  bash /verify-docker-image.sh

bash scripts/verify-dind-exec-defaults.sh "${DIND_IMAGE_NAME}:test"

echo ""
echo "All system, development, and nested Docker verification checks passed!"
