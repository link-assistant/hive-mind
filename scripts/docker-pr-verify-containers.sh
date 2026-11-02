#!/usr/bin/env bash
# docker-pr-verify-containers.sh
#
# Runs scripts/verify-docker-image.sh inside both freshly built images, plus the
# nested-Docker default checks against the DinD image.
#
# Verifies box user setup (/home/box access), development tools, AI tools, and
# configure-claude and the installed stock-runtime baseline (required).
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

for verified_image in "${IMAGE_NAME}:test" "${DIND_IMAGE_NAME}:test"; do
  echo "Checking installed Formal AI configuration and native Codex usage authority: ${verified_image}"
  docker run --rm --network none \
    -v "$(pwd)/experiments/issue-3785/probe-formal-ai-codex-auth.mjs:/probe-formal-ai-codex-auth.mjs:ro" \
    -v "$(pwd)/experiments/issue-3785/probe-codex-native-limits-generation.py:/probe-codex-native-limits-generation.py:ro" \
    -v "$(pwd)/experiments/issue-3785/probe-codex-native-auth-identity.py:/probe-codex-native-auth-identity.py:ro" \
    -v "$(pwd)/experiments/issue-3785:/hive-native-probes:ro" \
    --entrypoint bash "${verified_image}" -c '
      set -euo pipefail
      native_hive_root=$(dirname "$(dirname "$(readlink -f "$(command -v hive)")")")
      node --max-old-space-size=128 /probe-formal-ai-codex-auth.mjs "$(command -v formal-ai)" "$native_hive_root"
      python3 /probe-codex-native-auth-identity.py "$(command -v codex)"
      for mutation in none logout replace malformed; do
        python3 /probe-codex-native-limits-generation.py "$(command -v codex)" --mutation "$mutation"
      done
      for scenario in directory database; do
        python3 /hive-native-probes/probe-codex-native-sqlite-lifetime.py "$(command -v codex)" --case "$scenario"
      done
      for scenario in recovery peers startup; do
        python3 "/hive-native-probes/probe-codex-native-sqlite-$scenario.py" "$(command -v codex)"
        python3 "/hive-native-probes/probe-codex-native-sqlite-$scenario.py" "$(command -v codex)" --without-path-selector
      done
      python3 /hive-native-probes/probe-codex-native-sqlite-performance.py "$(command -v codex)"
    '
done

bash scripts/verify-dind-exec-defaults.sh "${DIND_IMAGE_NAME}:test"

node scripts/docker-pr-verify-mount-backing.mjs

echo ""
echo "All system, development, and nested Docker verification checks passed!"
