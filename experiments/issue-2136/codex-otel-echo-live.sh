#!/usr/bin/env bash
# Issue #2136 — recipe for reproducing the UPSTREAM behaviour (codex CLI) that
# made the incident possible: under RUST_LOG=debug, `codex exec --json` traces
# each tool result on stderr with the tool's raw, unescaped, multi-line stdout
# spliced in, so a command that prints NDJSON is replayed as if it were codex's
# own protocol.
#
# Requires an authenticated codex CLI (`codex login`). Without credentials the
# model never reaches a tool call, so no `codex.tool_result` record is emitted.
set -euo pipefail

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

RUST_LOG=debug codex exec --json --skip-git-repo-check -C "$workdir" \
  'Run exactly this shell command, then reply DONE: printf "%s\n" "{\"type\":\"turn.started\"}"' \
  >"$workdir/stdout.ndjson" 2>"$workdir/stderr.log" || true

echo "== turn events on STDOUT (codex's real protocol) =="
grep -c '"type":"turn.started"' "$workdir/stdout.ndjson" || true

echo
echo "== turn events on STDERR (must be zero for stderr to be parseable as protocol) =="
grep -n '"type":"turn.started"' "$workdir/stderr.log" || echo "none"

echo
echo "== the trace record that splices raw tool output into stderr =="
grep -n -A 12 'codex_otel.log_only: event.name="codex.tool_result"' "$workdir/stderr.log" | head -40 || echo "none"
