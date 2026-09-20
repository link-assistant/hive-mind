#!/usr/bin/env bash
#
# Issue #2186 — evidence that Formal AI 0.345.0 is a safe bootstrap pin.
#
# The images build Formal AI with `cargo install formal-ai --locked` on a stock
# `rust:*-slim-bookworm` builder, and `src/formal-ai-version.lib.mjs` refuses any
# image below the persisted-memory contract of 0.336.0. Moving the bootstrap pin
# from 0.339.1 to 0.345.0 therefore has to answer two questions from the crate
# itself rather than from a changelog:
#
#   1. Does the locked dependency graph still avoid `openssl-sys`? (It pulls in a
#      C toolchain + libssl headers that the slim builder does not have —
#      formal-ai#988 is exactly that regression.)
#   2. Is the memory contract Hive Mind's updater relies on unchanged?
#
# Usage: experiments/issue-2186/verify-formal-ai-bootstrap.sh [workdir]
set -euo pipefail

from="${FROM_VERSION:-0.339.1}"
to="${TO_VERSION:-0.345.0}"
workdir="${1:-$(mktemp -d)}"
mkdir -p "$workdir"
cd "$workdir"

for version in "$from" "$to"; do
  if [ ! -d "formal-ai-$version" ]; then
    curl -fsSL "https://static.crates.io/crates/formal-ai/formal-ai-$version.crate" -o "formal-ai-$version.crate"
    tar -xzf "formal-ai-$version.crate"
  fi
done

echo "== 1. openssl-sys in the locked graph =="
for version in "$from" "$to"; do
  count="$(grep -c 'name = "openssl-sys"' "formal-ai-$version/Cargo.lock" || true)"
  rust="$(grep -m1 'rust-version' "formal-ai-$version/Cargo.toml" || echo 'rust-version = <unset>')"
  printf '%s: openssl-sys entries=%s, %s\n' "$version" "$count" "$rust"
done

echo
echo "== 2. memory-contract sources =="
for file in src/cli_memory.rs src/server.rs src/shared_memory.rs src/memory/upgrade.rs; do
  if diff -q "formal-ai-$from/$file" "formal-ai-$to/$file" >/dev/null 2>&1; then
    printf '%s: identical\n' "$file"
  else
    printf '%s: CHANGED\n' "$file"
    diff -u "formal-ai-$from/$file" "formal-ai-$to/$file" | head -60 || true
  fi
done

echo
echo "Working copy kept in: $workdir"
