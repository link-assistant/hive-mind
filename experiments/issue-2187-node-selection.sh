#!/usr/bin/env bash
# Experiment for issue #2187, item B: which node version does the Dockerfile's
# symlink step select when two versions are installed?
#
# Usage: bash experiments/issue-2187-node-selection.sh
set -euo pipefail

root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/v20.20.2/bin" "$root/v22.23.2/bin" "$root/v9.11.2/bin"

echo "installed versions:"; ls "$root"

echo -n "current image logic (ls | head -1):  "
ls -d "$root"/v* 2>/dev/null | head -1

echo -n "proposed logic (ls | sort -V | tail -1): "
ls -d "$root"/v* 2>/dev/null | sort -V | tail -1
