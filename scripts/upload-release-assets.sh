#!/usr/bin/env bash
# Upload files as assets of an existing GitHub release.
#
# Replaces softprops/action-gh-release@v2, which is a Node 20 JavaScript action.
# GitHub deprecated Node 20 on its runners, so every workflow run using it emits:
#
#   Node.js 20 is deprecated. The following actions target Node.js 20 but are
#   being forced to run on Node.js 24: softprops/action-gh-release@v2.
#   https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
#
# `gh` ships with the runner image and is not a JavaScript action, so it cannot
# go stale the same way (issue #2175).
#
# Usage: bash scripts/upload-release-assets.sh <tag> <file>...
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <tag> <file>..." >&2
  exit 1
fi

tag="$1"
shift

# The release is created earlier in the pipeline (scripts/create-github-release.mjs),
# but a manual/instant release may reach this step first.
if ! gh release view "$tag" >/dev/null 2>&1; then
  echo "Release $tag does not exist yet; creating it."
  gh release create "$tag" --title "$tag" --generate-notes
fi

# --clobber makes re-runs idempotent: without it, re-uploading an existing asset
# fails and turns a retried release into a red pipeline.
echo "Uploading $# asset(s) to release $tag..."
gh release upload "$tag" "$@" --clobber
echo "Uploaded $# asset(s) to release $tag."
