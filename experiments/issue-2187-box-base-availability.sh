#!/usr/bin/env bash
# Issue #2187 / link-foundation/box#112 follow-up: is the fixed Box base
# pullable, and for BOTH architectures this repository builds?
#
# box 2.7.0 carries the #112 fix (one current runtime per language). Whether
# hive-mind's `FROM .../box*:<tag>` pin can use it is not answered by "does the
# tag resolve" — the release publishes `linux/amd64` on `ubuntu-latest` and
# `linux/arm64` natively on `ubuntu-24.04-arm`, so a tag that resolves to amd64
# alone is as unusable as a tag that is missing. This script therefore reports
# the PLATFORM LIST behind each reference, not just its existence.
#
# Last run 2026-09-07 (recorded here because these are the facts the base pin
# and link-foundation/box#119 rest on):
#
#   ghcr.io/link-foundation/box:2.7.0        amd64 arm64   <- the new pin
#   ghcr.io/link-foundation/box-dind:2.7.0   amd64 arm64   <- the new pin
#   konard/box:2.7.0                         amd64         (amd64 only)
#   konard/box:latest                        amd64         (regression: 2.4.0 was multi-arch)
#   konard/box:2.4.0                         amd64 arm64   (the old pin)
#   konard/box-dind:2.7.0                    MISSING
#   konard/box-dind:latest                   amd64 arm64   (2026-06-21 image, pre-#112)
#
# Read-only: it inspects manifests, pulls nothing.
set -uo pipefail

# The references this repository actually pins, read the same registry-agnostic
# way scripts/docker-pr-build.sh reads them.
PINNED_BOX=$(sed -n 's|^FROM \(.*/box:[^[:space:]]*\).*|\1|p' Dockerfile)
PINNED_BOX_DIND=$(sed -n 's|^FROM \(.*/box-dind:[^[:space:]]*\).*|\1|p' Dockerfile.dind)

probe() {
  local ref="$1" label="${2:-}" out platforms
  if ! out=$(docker manifest inspect "$ref" 2>&1); then
    printf '  %-42s MISSING      %s\n' "$ref" "$(head -1 <<<"$out")"
    return
  fi
  # Both a Docker manifest list and an OCI index list their platforms here; a
  # single-platform manifest lists none, which is itself the answer.
  platforms=$(grep -o '"architecture": *"[^"]*"' <<<"$out" |
    sed 's/.*"architecture": *"//; s/"//' | grep -v '^unknown$' | sort -u | tr '\n' ' ')
  printf '  %-42s %-12s %s\n' "$ref" "${platforms:-single-arch}" "$label"
}

echo "Pinned by this repository:"
probe "$PINNED_BOX" "<- Dockerfile / coolify/Dockerfile"
probe "$PINNED_BOX_DIND" "<- Dockerfile.dind"

echo
echo "GHCR (box's registry of record since link-foundation/box#115):"
for tag in 2.4.0 2.7.0 latest; do
  probe "ghcr.io/link-foundation/box:$tag"
  probe "ghcr.io/link-foundation/box-dind:$tag"
done

echo
echo "Docker Hub (mirror; broken for 2.7.0 — link-foundation/box#119):"
for tag in 2.4.0 2.7.0 latest; do
  probe "konard/box:$tag"
  probe "konard/box-dind:$tag"
done

echo
echo "A base is usable here only if it lists BOTH linux/amd64 and linux/arm64."
