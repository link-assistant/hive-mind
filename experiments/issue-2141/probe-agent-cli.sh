#!/usr/bin/env bash
#
# Issue #2141 — probes against `@link-assistant/agent` that produced the raw
# evidence stored in docs/case-studies/issue-2141/raw/.
#
# Run:  bash experiments/issue-2141/probe-agent-cli.sh [output-dir]
# Tested with agent CLI 0.25.5 (`agent --version`).
#
# Probe A: an explicit unknown model. The CLI throws ProviderModelNotFoundError
#          on stderr, emits only a {"type":"log","level":"error"} record on
#          stdout — no {"type":"error"} event — and exits 0. Hive Mind used to
#          read that as a successful, empty run.
#
# Probe B: --model formal-ai with nothing listening on 127.0.0.1:8080. Every
#          request fails with ConnectionRefused, `isRetryable: true`, and the
#          CLI retries until `retryTimeout` (604800 s = 7 days) elapses, so the
#          run never terminates on its own. Kill it after a few seconds.

set -u

OUT_DIR="${1:-$(mktemp -d)}"
mkdir -p "$OUT_DIR"

echo "agent CLI version: $(agent --version 2>&1 | head -1)"
echo "output directory:  $OUT_DIR"

echo
echo "== Probe A: unknown model =="
echo "say hi" | agent --model nonexistent-provider/nope --print-logs --output-format json \
  >"$OUT_DIR/unknown-model-stdout.ndjson" 2>"$OUT_DIR/unknown-model-stderr.txt"
echo "exit code: $?   <- 0 means the silent-failure bug is present"
echo "error events emitted: $(grep -c '"type":"error"' "$OUT_DIR/unknown-model-stdout.ndjson" || true)"
grep -m1 'ProviderModelNotFoundError' "$OUT_DIR/unknown-model-stdout.ndjson" || true

echo
echo "== Probe B: unreachable Formal AI server (killed after 10s) =="
timeout 10 bash -c 'echo "say hi" | agent --model formal-ai --print-logs --output-format json' \
  >"$OUT_DIR/formal-ai-unreachable.ndjson" 2>"$OUT_DIR/formal-ai-unreachable-stderr.txt"
echo "exit code: $?   <- 124 means it was still retrying when the timeout fired"
grep -o 'ConnectionRefused' "$OUT_DIR/formal-ai-unreachable.ndjson" | head -1 || true
grep -o '"retryTimeout":[0-9]*' "$OUT_DIR/formal-ai-unreachable.ndjson" | head -1 || true
