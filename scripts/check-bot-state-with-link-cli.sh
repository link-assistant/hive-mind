#!/usr/bin/env bash
set -euo pipefail

version=$(sed -n 's/^ARG LINK_CLI_VERSION=//p' Dockerfile)
install_dir="$RUNNER_TEMP/link-cli"
CARGO_BUILD_JOBS=2 CARGO_PROFILE_RELEASE_OPT_LEVEL=1 cargo install link-cli --version "=$version" --locked --root "$install_dir"

export HIVE_MIND_CLINK="$install_dir/bin/clink"
export HIVE_MIND_REQUIRE_CLINK=1
node --test --test-concurrency=1 --experimental-test-coverage \
  --test-coverage-include='src/bot-instance-*.lib.mjs' \
  --test-coverage-include='src/bot-state-*.lib.mjs' \
  --test-coverage-include='src/state-lock.lib.mjs' tests/test-issue-4143-*.test.mjs
