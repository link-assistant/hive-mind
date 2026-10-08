#!/usr/bin/env bash
# Issue #2771: show which `service_tier` Codex CLI puts on the wire for
# gpt-6-sol (catalog default_service_tier: priority) with no override, with
# hive-mind's new default args, and with --speed fast. Uses a local mock
# endpoint (a custom model provider, because Codex ignores OPENAI_BASE_URL)
# and a throwaway CODEX_HOME, so no real API key or quota is used.
#
# Usage: bash experiments/issue-2771/codex-service-tier-capture.sh [model]
set -u
MODEL="${1:-gpt-6-sol}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
PORT=18772
CAPTURE="$WORK/capture.jsonl"
node "$HERE/mock-llm-server.mjs" "$PORT" "$CAPTURE" >/dev/null 2>&1 &
MOCK=$!
trap 'kill $MOCK 2>/dev/null; rm -rf "$WORK"' EXIT
sleep 1
mkdir -p "$WORK/home" "$WORK/repo"
run() {
  local label="$1"
  shift
  : >"$CAPTURE"
  (cd "$WORK/repo" && CODEX_HOME="$WORK/home" MOCK_KEY=sk-test timeout 60 codex exec --skip-git-repo-check --json \
    -c model_provider=mock -c "model_providers.mock={name=\"mock\",base_url=\"http://127.0.0.1:$PORT/v1\",wire_api=\"responses\",env_key=\"MOCK_KEY\"}" \
    --model "$MODEL" "$@" 'say hi' </dev/null >/dev/null 2>&1)
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean).map(JSON.parse).filter(r => r.url.startsWith("/v1/responses"));
    const tiers = [...new Set(lines.map(r => r.service_tier ?? "(omitted = standard)"))];
    console.log(process.argv[2].padEnd(48), "requests:", String(lines.length).padStart(2), " service_tier:", tiers.join(", "));
  ' "$CAPTURE" "$label"
}
echo "codex $(codex --version 2>/dev/null) model=$MODEL"
run 'no override (before #2771)'
run 'hive default: -c service_tier=default' -c service_tier=default -c model_context_window=272000
run 'hive --speed fast: -c service_tier=fast' -c service_tier=fast
run 'hive --speed flex: -c service_tier=flex' -c service_tier=flex
# A user-level config.toml that opts into Fast (or a ChatGPT plan whose
# default is Fast) must not leak into hive runs unless --speed asks for it.
printf 'service_tier = "fast"\n' >"$WORK/home/config.toml"
run 'config.toml service_tier=fast, no override' 
run 'config.toml service_tier=fast + hive default' -c service_tier=default
