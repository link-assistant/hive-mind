#!/usr/bin/env bash
# Issue #4029 F1: reproduce the docker-pr-check failure without Docker.
#
# The lifecycle gate (scripts/verify-capability-lifecycle.mjs, P3) lets the
# idle updater move Codex to npm `latest`. Codex rewrites
# $CODEX_HOME/skills/.system with its own embedded stock skills whenever the
# marker differs. When `latest` ships different stock skills than the pinned
# 0.164.0 baseline, the production audit refuses launch with
# CodexStockBaselineError. A later start of the pinned binary restores them.
#
# Usage: experiments/issue-4029/codex-stock-skills-drift.sh [newer-version] [previous-version]
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
newer="${1:-$(npm view @openai/codex version)}"
previous="${2:-0.163.0}"
pinned="$(node -p "require('$repo/src/codex-stock-skills-0.164.0.json').cliVersion.split(' ').pop()")"
# Codex refuses some startup side effects when CODEX_HOME is under /tmp, so the
# probe lives under ~/.cache (removed on exit).
mkdir -p "$HOME/.cache"
work="$(mktemp -d "$HOME/.cache/issue-4029-drift.XXXXXX")"
trap 'rm -rf "$work"' EXIT
install() { BUN_INSTALL="$work/bun-$1" bun install --silent -g "@openai/codex@$1" >/dev/null; }
# `codex mcp list` does not materialize system skills; a real `codex exec`
# start does (the same command nativeStartup() runs). The fake key and the
# local unreachable provider keep the probe offline: only startup side effects matter.
start() {
  (cd "$work" && CODEX_HOME="$work/codex-home" OPENAI_API_KEY=sk-offline-probe \
    timeout 60 "$work/bun-$1/bin/codex" exec --skip-git-repo-check \
      -c 'model_provider="probe"' -c 'model_providers.probe={name="probe",base_url="http://127.0.0.1:9/v1",wire_api="responses",request_max_retries=0,stream_max_retries=0}' \
      'echo synthetic' >/dev/null 2>&1) || true
  echo "  marker: $(cat "$work/codex-home/skills/.system/.codex-system-skills.marker" 2>/dev/null || echo '<none>')"
}
check() {
  node --input-type=module -e "
    const { validateCodexStockSkills } = await import('$repo/src/codex-stock-skills.lib.mjs');
    try { await validateCodexStockSkills({ directory: '$work/codex-home/skills/.system' }); console.log('  audit: matches the pinned baseline'); }
    catch (error) { console.log('  audit: ' + error.constructor.name + ': ' + error.message); }"
}
mkdir -p "$work/codex-home"
echo "pinned=$pinned newer=$newer previous=$previous"
install "$pinned"; install "$newer"; install "$previous"
echo "0. start previous codex $previous (P3 staged previous release)"; start "$previous"; check
echo "1. start pinned codex $pinned"; start "$pinned"; check
echo "2. start newer codex $newer (what P3 'first native start with the updated binaries' does)"; start "$newer"; check
echo "3. start pinned codex $pinned again (restores the verified stock runtime)"; start "$pinned"; check
