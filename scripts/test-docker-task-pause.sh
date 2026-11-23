#!/usr/bin/env bash
# Use the same Bun and start-command versions as the production Docker image.
set -euo pipefail

start_version=$(sed -n 's/.* start-command@\([0-9.]*\) .*/\1/p' Dockerfile)
bun_version=$(sed -n 's/^ARG HIVE_MIND_BUN_VERSION=//p' Dockerfile)
test_prefix=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/hive-task-pause.XXXXXX")
trap 'rm -rf -- "$test_prefix"' EXIT
node scripts/npm-install-with-retry.mjs install --prefix "$test_prefix" --no-audit --no-fund "bun@$bun_version" "start-command@$start_version"
PATH="$test_prefix/node_modules/.bin:$PATH" node experiments/issue-2530-pause-resume.mjs
