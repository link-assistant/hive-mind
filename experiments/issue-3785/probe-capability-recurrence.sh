#!/usr/bin/env bash
# Issue #3785: run native deployment-style probes (version/auth/MCP/model) in a
# disposable HOME and list every file they create, once per Codex baseline.
# Synthetic only: no credentials; model probes target a closed loopback port.
#
# Observed with claude 2.1.316 / codex 0.166.0 (2026-11-01):
#   remote_plugin=false only      -> codex exec clones the curated marketplace
#                                    into ~/.codex/.tmp/plugins (541 SKILL.md)
#   remote_plugin=false, plugins=false -> no plugin paths created
set -u
for baseline in 'remote_plugin = false' $'remote_plugin = false\nplugins = false' $'remote_plugin = false\nplugins = false\napps = false'; do
  fixture=$(mktemp -d /tmp/hive-cap-probe.XXXXXX)
  home="$fixture/home"; mkdir -p "$home/.claude" "$home/.codex" "$fixture/work"
  printf '[features]\n%s\n' "$baseline" > "$home/.codex/config.toml"
  printf '{"syncClaudeAiSkills":false,"syncClaudeAiPlugins":false,"disableClaudeAiConnectors":true,"env":{"CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL":"1","ENABLE_CLAUDEAI_MCP_SERVERS":"false"}}\n' > "$home/.claude/settings.json"
  run() { (cd "$fixture/work" && env -i HOME="$home" PATH="$PATH" TERM=dumb ANTHROPIC_BASE_URL=http://127.0.0.1:9 OPENAI_BASE_URL=http://127.0.0.1:9 timeout 40 "$@" </dev/null >/dev/null 2>&1); echo "  $* -> $?"; }
  snap() { (cd "$home" && find . -mindepth 1 | sort) > "$fixture/$1.txt"; }
  echo "##### Codex baseline: $(echo "$baseline" | tr '\n' ' ')"
  snap before
  run claude --version; run claude auth status --json; run claude mcp list
  run codex --version; run codex login status; run codex mcp list
  snap probes
  run claude -p ping --max-turns 1
  run codex exec --skip-git-repo-check ping
  snap model
  echo "== created by version/auth/mcp probes"; comm -13 "$fixture/before.txt" "$fixture/probes.txt"
  echo "== created by model probes (plugin paths only, depth-limited)"
  comm -13 "$fixture/probes.txt" "$fixture/model.txt" | grep -E 'plugins|skills' | awk -F/ 'NF<=5' | head -20
  echo "   plugin paths: $(comm -13 "$fixture/probes.txt" "$fixture/model.txt" | grep -c plugins)  SKILL.md: $(find "$home" -name SKILL.md | wc -l)"
  rm -rf "$fixture"
done
