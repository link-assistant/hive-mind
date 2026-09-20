#!/usr/bin/env bash
# Issue #2094 — reproduce the Codex 0.144.x authenticated curated-marketplace
# loader boundary with a real CLI and real rendered prompts.
#
# Requirements:
#   - a ChatGPT-authenticated Codex home
#   - superpowers@openai-curated available in that home's marketplace snapshot
#
# The script works only in mktemp-created copies and never changes the supplied
# operator home. Set CODEX_BIN or OPERATOR_CODEX_HOME to override discovery.

set -euo pipefail

CODEX_BIN="${CODEX_BIN:-$(command -v codex)}"
OPERATOR_CODEX_HOME="${OPERATOR_CODEX_HOME:-${CODEX_HOME:-$HOME/.codex}}"
TARGET_CWD="${TARGET_CWD:-$(pwd -P)}"
REPRO_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/issue-2094-loader.XXXXXX")"
REPRO_OPERATOR="$REPRO_ROOT/operator/.codex"
NESTED_HOME="$REPRO_OPERATOR/hive-mind/repositories/CEHR2005/GCS-TS"
FRESH_HOME="$REPRO_ROOT/fresh/.codex"

cleanup() {
  rm -rf "$REPRO_ROOT"
}
trap cleanup EXIT

copy_runtime_state() {
  local destination="$1"
  mkdir -p "$destination"
  for filename in config.toml auth.json installation_id; do
    if [ -f "$OPERATOR_CODEX_HOME/$filename" ]; then
      cp "$OPERATOR_CODEX_HOME/$filename" "$destination/$filename"
    fi
  done
  mkdir -p "$destination/.tmp" "$destination/plugins/cache/openai-curated"
  cp -aL "$OPERATOR_CODEX_HOME/.tmp/plugins" "$destination/.tmp/plugins"
  cp "$OPERATOR_CODEX_HOME/.tmp/plugins.sha" "$destination/.tmp/plugins.sha"
  if [ -d "$OPERATOR_CODEX_HOME/plugins/cache/openai-curated/superpowers" ]; then
    cp -aL "$OPERATOR_CODEX_HOME/plugins/cache/openai-curated/superpowers" "$destination/plugins/cache/openai-curated/superpowers"
  fi
  CODEX_HOME="$destination" "$CODEX_BIN" plugin add superpowers@openai-curated --json >/dev/null
}

visible_skills() {
  local codex_home="$1"
  local mode="$2"
  if [ "$mode" = local ]; then
    (cd "$TARGET_CWD" && CODEX_HOME="$codex_home" "$CODEX_BIN" -c features.remote_plugin=false debug prompt-input 'issue-2094 loader probe') 2>/dev/null \
      | rg -o 'superpowers:[a-z0-9-]+' | sort -u
  else
    (cd "$TARGET_CWD" && CODEX_HOME="$codex_home" "$CODEX_BIN" debug prompt-input 'issue-2094 loader probe') 2>/dev/null \
      | rg -o 'superpowers:[a-z0-9-]+' | sort -u
  fi
}

copy_runtime_state "$REPRO_OPERATOR"
copy_runtime_state "$NESTED_HOME"
copy_runtime_state "$FRESH_HOME"

"$CODEX_BIN" --version
printf 'cwd=%s\n' "$TARGET_CWD"
printf 'auth_mode=%s\n' "$(node -e 'const x=require(process.argv[1]); process.stdout.write(String(x.auth_mode || "unknown"))' "$REPRO_OPERATOR/auth.json")"

for entry in "operator:$REPRO_OPERATOR" "nested:$NESTED_HOME" "fresh:$FRESH_HOME"; do
  label="${entry%%:*}"
  codex_home="${entry#*:}"
  visible_skills "$codex_home" remote >"$REPRO_ROOT/$label-remote.txt" || true
  visible_skills "$codex_home" local >"$REPRO_ROOT/$label-local.txt"
  printf '%-8s remote_plugin=true:  %2d superpowers skills\n' "$label" "$(wc -l <"$REPRO_ROOT/$label-remote.txt")"
  printf '%-8s remote_plugin=false: %2d superpowers skills\n' "$label" "$(wc -l <"$REPRO_ROOT/$label-local.txt")"
  # The production account exposed zero remote Superpowers skills. A backend
  # account may later have a partial remote bundle (observed: 8), but it still
  # replaces rather than merges the complete 14-skill local payload.
  test "$(wc -l <"$REPRO_ROOT/$label-remote.txt")" -lt "$(wc -l <"$REPRO_ROOT/$label-local.txt")"
  test "$(wc -l <"$REPRO_ROOT/$label-local.txt")" -eq 14
done

printf '\nThe payload and enablement are identical in each pair. Only loader catalog\n'
printf 'selection changes: the authenticated remote catalog filters local entries\n'
printf 'from the reserved openai-curated marketplace before prompt construction.\n'

# Docker isolation mounts the complete operator .codex directory, including the
# nested scoped home. Opt in with an image that contains Codex 0.144.x:
#   HIVE_MIND_ISSUE_2094_DOCKER_IMAGE=konard/hive-mind-dind:latest ./this-script
if [ -n "${HIVE_MIND_ISSUE_2094_DOCKER_IMAGE:-}" ]; then
  docker_output="$REPRO_ROOT/docker.txt"
  docker run --rm \
    -v "$REPRO_OPERATOR:/home/box/.codex" \
    -v "$TARGET_CWD:/workspace" \
    -w /workspace \
    -e CODEX_HOME=/home/box/.codex/hive-mind/repositories/CEHR2005/GCS-TS \
    "$HIVE_MIND_ISSUE_2094_DOCKER_IMAGE" \
    codex -c features.remote_plugin=false debug prompt-input 'issue-2094 docker loader probe' 2>/dev/null \
    | rg -o 'superpowers:[a-z0-9-]+' | sort -u >"$docker_output"
  printf 'docker   remote_plugin=false: %2d superpowers skills\n' "$(wc -l <"$docker_output")"
  test -s "$docker_output"
fi
