#!/usr/bin/env bash
# Issue #2187 / link-foundation/box#112 follow-up: is the fixed Box base pullable?
#
# box 2.5.0/2.6.0 carry the #112 fix (one current runtime per language). This
# script checks whether any registry actually serves them, which is what decides
# whether hive-mind's `FROM konard/box*:<tag>` pin can move forward.
#
# Read-only: it inspects manifests and registry auth endpoints, pulls nothing.
set -uo pipefail

probe_dockerhub() {
  local ref="$1"
  if docker manifest inspect "$ref" >/dev/null 2>&1; then
    echo "  PULLABLE   $ref"
  else
    echo "  MISSING    $ref  ($(docker manifest inspect "$ref" 2>&1 | head -1))"
  fi
}

# A public GHCR package answers an anonymous token request; a private one
# answers 401 "authentication required". This is the difference between
# "published" and "published where only the publishing job can see it".
probe_ghcr_public() {
  local repo="$1"
  local body
  body=$(curl -fsS "https://ghcr.io/token?scope=repository%3A${repo//\//%2F}%3Apull&service=ghcr.io" 2>/dev/null)
  if [[ "$body" == *'"token"'* ]]; then
    echo "  PUBLIC     ghcr.io/$repo"
  else
    echo "  NOT PUBLIC ghcr.io/$repo  ($(curl -s "https://ghcr.io/token?scope=repository%3A${repo//\//%2F}%3Apull&service=ghcr.io" | head -c 120))"
  fi
}

echo "Docker Hub (what hive-mind's Dockerfiles pin):"
for tag in 2.4.0 2.5.0 2.6.0 latest; do
  probe_dockerhub "konard/box:$tag"
  probe_dockerhub "konard/box-dind:$tag"
done

echo
echo "GHCR (box's registry of record since link-foundation/box#115):"
probe_ghcr_public link-foundation/box
probe_ghcr_public link-foundation/box-dind
echo "  control (a known-public package):"
probe_ghcr_public astral-sh/uv
