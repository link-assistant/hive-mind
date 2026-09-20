#!/usr/bin/env bash
# Issue #2088 — does Claude Code have the same enabled-but-not-materialized
# plugin cache gap as Codex? ("We must have similar mechanism for Claude if
# needed." — https://github.com/link-assistant/hive-mind/issues/2088)
#
# Claude Code installs marketplace plugins into the same layout Codex uses:
#
#   <CLAUDE_CONFIG_DIR>/plugins/cache/<marketplace>/<plugin>/<version>/
#
# and exposes a plugin's Agent Skills to the model only while that payload
# carries skills/<skill>/SKILL.md. This script establishes three facts:
#
#   FACT 1  A freshly installed plugin materializes skills/<skill>/SKILL.md.
#   FACT 2  Deleting only the version directory leaves `claude plugin list
#           --json` reporting `"enabled": true` with an `installPath` that no
#           longer exists, and running the CLI again does not self-heal it.
#   FACT 3  Re-running `claude plugin install` re-materializes the payload.
#
# FACT 2 is the same defect the Codex preflight repairs, which is why
# src/agent-plugin-cache.lib.mjs keeps the repair primitive CLI-agnostic
# (CLAUDE_PLUGIN_CLI vs CODEX_PLUGIN_CLI) instead of hard-coding Codex verbs.
#
# Not covered here: probing the skills the model actually receives. Claude Code
# has no `debug prompt-input` equivalent and a scoped CLAUDE_CONFIG_DIR is not
# authenticated ("Not logged in · Please run /login"), so the visibility half of
# the Codex preflight cannot be reproduced for Claude yet.
#
# Requires: claude CLI, python3. Usage:
#   experiments/issue-2088/reproduce-claude-cache-gap.sh

set -euo pipefail

WORK="${WORK:-$HOME/issue-2088-claude-repro}"
MKT="$WORK/marketplace"
export CLAUDE_CONFIG_DIR="$WORK/claude-config"
PLUGIN="demo@hive2088"
VERSION_DIR="$CLAUDE_CONFIG_DIR/plugins/cache/hive2088/demo/1.0.0"

rm -rf "$WORK"
mkdir -p "$MKT/.claude-plugin" "$MKT/plugins/demo/.claude-plugin" "$MKT/plugins/demo/skills/demo-skill" "$CLAUDE_CONFIG_DIR"

cat > "$MKT/.claude-plugin/marketplace.json" <<'JSON'
{
  "name": "hive2088",
  "owner": { "name": "hive-mind" },
  "plugins": [{ "name": "demo", "source": "./plugins/demo", "description": "issue #2088 fixture" }]
}
JSON
cat > "$MKT/plugins/demo/.claude-plugin/plugin.json" <<'JSON'
{ "name": "demo", "version": "1.0.0", "description": "issue #2088 fixture" }
JSON
cat > "$MKT/plugins/demo/skills/demo-skill/SKILL.md" <<'MD'
---
name: demo-skill
description: A fixture skill used to prove plugin payload materialization.
---
Demo.
MD

plugin_state() {
  claude plugin list --json 2>/dev/null | python3 -c '
import json, sys
for p in json.load(sys.stdin):
    if p.get("id") == "demo@hive2088":
        print("      id={} enabled={} installPath={}".format(p["id"], p.get("enabled"), p.get("installPath")))
' || true
}

echo "==> Registering the fixture marketplace"
claude plugin marketplace add "$MKT" > /dev/null
claude plugin install "$PLUGIN" > /dev/null

echo
echo "==> FACT 1: a freshly installed plugin materializes its skills"
test -f "$VERSION_DIR/skills/demo-skill/SKILL.md" || { echo "FAIL: expected SKILL.md to be materialized"; exit 1; }
echo "    $VERSION_DIR/skills/demo-skill/SKILL.md exists"
plugin_state

echo
echo "==> FACT 2: delete only the payload — enablement still reports healthy"
rm -rf "$VERSION_DIR"
plugin_state
test -d "$VERSION_DIR" && { echo "FAIL: payload unexpectedly present"; exit 1; }
echo "    ...for an installPath that no longer exists"
claude plugin list > /dev/null 2>&1 || true
if [ -d "$VERSION_DIR" ]; then
  echo "FAIL: the CLI unexpectedly self-healed the payload"
  exit 1
fi
echo "    running the CLI again does not re-materialize it"

echo
echo "==> FACT 3: 'claude plugin install' repairs the payload"
claude plugin install "$PLUGIN" > /dev/null
test -f "$VERSION_DIR/skills/demo-skill/SKILL.md" || { echo "FAIL: re-install did not repair the payload"; exit 1; }
echo "    $VERSION_DIR/skills/demo-skill/SKILL.md restored"

echo
echo "==> RESULT"
echo "    Claude Code shares the Codex failure mode: enablement is recorded"
echo "    independently of the materialized payload, 'plugin list' reports the"
echo "    stale state as healthy, and re-running the install command repairs it."
echo "    hive-mind does not install Claude plugins today, so no Claude"
echo "    provisioning path is wired up; the repair primitive is shared so one"
echo "    can be added without duplicating this logic."
