#!/usr/bin/env bash
# Issue #2130 — why `--model formal-ai` reaches api.openai.com instead of the
# Formal AI server when Hive Mind drives codex.
#
# `formal-ai with codex` supplies the provider block as GLOBAL `-c` overrides,
# before the `exec` subcommand (see codex-shim-capture.txt). Hive Mind appends
# its own `-c` overrides AFTER `exec` (src/codex.lib.mjs:870). This script runs
# the same prompt three ways, changing only where the `-c` overrides sit, and
# records which provider each session actually came up with.
#
# Prerequisites: a Formal AI server on $BASE_URL (`formal-ai serve --agent-mode`).
# Usage: ./repro-codex-c-order.sh [outdir]

set -u

BASE_URL="${BASE_URL:-http://127.0.0.1:8123/api/openai/v1}"
OUT="${1:-$(cd "$(dirname "$0")" && pwd)/codex-order}"
PROMPT="${PROMPT:-Reply with the single word: ok}"

# The provider block exactly as `formal-ai with codex` passes it.
PROVIDER=(
  -c "model_providers.formalai.name=formal-ai server"
  -c "model_providers.formalai.base_url=$BASE_URL"
  -c "model_providers.formalai.env_key=FORMAL_AI_API_KEY"
  -c "model_providers.formalai.wire_api=responses"
  -c 'model_provider=formalai'
  -c 'model=formal-ai'
)
# The overrides Hive Mind appends after `exec`.
HIVE=(-c 'model_reasoning_effort=none' -c 'model_reasoning_summary=auto')

run() {
  local name="$1" home="$2"
  shift 2
  rm -rf "$home"
  mkdir -p "$home"
  # Identical on-disk config for every variant, so only argv differs.
  printf '[projects."%s"]\ntrust_level = "trusted"\n' "$PWD" >"$home/config.toml"
  echo "== $name =="
  echo "   codex $*"
  printf '%s' "$PROMPT" |
    env CODEX_HOME="$home" FORMAL_AI_API_KEY=formal-ai \
      codex "$@" >"$OUT-$name.stdout.log" 2>"$OUT-$name.stderr.log"
  echo "   exit=$?"
  # The session rollout records the provider codex actually resolved.
  local meta
  meta=$(find "$home/sessions" -name 'rollout-*.jsonl' 2>/dev/null | head -1)
  if [ -n "$meta" ]; then
    node -e '
      const line = require("fs").readFileSync(process.argv[1], "utf8").split("\n")[0];
      const p = JSON.parse(line).payload || {};
      console.log("   model_provider=" + p.model_provider + "  cli=" + p.cli_version);
    ' "$meta"
  fi
  grep -c '401 Unauthorized' "$OUT-$name.stderr.log" | sed 's/^/   401 responses: /'
}

# A: provider block only, all before `exec` — the wrapper's own layout.
run before "/tmp/codex-home-2130-order-b" "${PROVIDER[@]}" exec --model formal-ai --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox

# B: same, plus Hive Mind's overrides after `exec` — the production layout.
run after "/tmp/codex-home-2130-order-c" "${PROVIDER[@]}" exec --model formal-ai --json --skip-git-repo-check "${HIVE[@]}" --dangerously-bypass-approvals-and-sandbox

# C: the workaround — every override before `exec`.
run fixed "/tmp/codex-home-2130-order-d" "${PROVIDER[@]}" "${HIVE[@]}" exec --model formal-ai --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox

echo
echo "Logs: $OUT-{before,after,fixed}.{stdout,stderr}.log"
