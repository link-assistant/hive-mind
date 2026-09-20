#!/usr/bin/env bash
# Issue #2198 / F11 — the minimal reproduction of the deadlock between zizmor's
# `self-repository` audit and actionlint's `uses:` parser.
#
# zizmor >= 1.30.0 asks for GitHub's `uses: $/<path>` self-repository syntax
# (shipped 2026-07-30) instead of `uses: ./<path>`. No released actionlint
# parses `$/` -- support is open upstream as rhysd/actionlint#711 and #732 --
# so a repository that runs both linters cannot satisfy them at once.
#
# This builds a twelve-line repository containing nothing but one workflow and
# one local composite action, and runs both linters over it.
#
#   ./actionlint-zizmor-self-repository-probe.sh
#
# Requires docker; zizmor is optional (installed with `pip install zizmor`).
set -euo pipefail

probe="$(mktemp -d)"
trap 'rm -rf "$probe"' EXIT

# mktemp gives 0700 and the actionlint image does not run as root, so without
# this the container cannot see the tree and reports "no project was found"
# instead of linting anything.
chmod 755 "$probe"

mkdir -p "$probe/.github/workflows" "$probe/.github/actions/demo"

cat > "$probe/.github/actions/demo/action.yml" <<'YML'
name: Demo
description: A local composite action, referenced two different ways.
runs:
  using: composite
  steps:
    - run: echo hi
      shell: bash
YML

# actionlint refuses to run outside a Git repository.
git -C "$probe" init -q

for form in './.github/actions/demo' '$/.github/actions/demo'; do
  cat > "$probe/.github/workflows/probe.yml" <<YML
name: Probe
on: [push]
permissions:
  contents: read
jobs:
  probe:
    runs-on: ubuntu-latest
    steps:
      - uses: $form
YML

  echo "############ uses: $form"

  for version in 1.7.7 1.7.12; do
    echo "--- actionlint $version"
    docker run --rm -v "$probe:/repo" -w /repo "rhysd/actionlint:$version" -color && echo "EXIT=0" || echo "EXIT=$?"
  done

  if command -v zizmor > /dev/null; then
    echo "--- zizmor $(zizmor --version | awk '{print $2}')"
    zizmor --min-confidence medium "$probe/.github/" && echo "EXIT=0" || echo "EXIT=$?"
  else
    echo "--- zizmor not installed, skipping"
  fi
done
