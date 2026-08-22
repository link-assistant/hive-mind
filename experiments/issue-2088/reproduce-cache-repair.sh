#!/usr/bin/env bash
# Issue #2088 — reproduce and repair a repository-scoped Codex plugin cache,
# end to end, against a real Codex CLI and a real rendered prompt.
#
# The failing run against CEHR2005/GCS-TS#4 had:
#   - `superpowers@openai-curated` present in the marketplace catalogue,
#   - `[plugins."superpowers@openai-curated"] enabled = true` in the scoped
#     CODEX_HOME/config.toml,
#   - `codex plugin list` reporting the plugin as installed and enabled,
#   - and zero `superpowers:*` skills in the prompt the model received.
#
# This script establishes the four facts the fix in
# src/codex-capability-preflight.lib.mjs depends on:
#
#   FACT 1  A scoped home with a materialised payload exposes <plugin>:<skill>.
#   FACT 2  Deleting only plugins/cache leaves config.toml (enablement) intact
#           and drops every skill from the rendered prompt — the #2088 state.
#   FACT 3  Re-running `codex plugin add` re-materialises the payload and
#           restores every skill; running it again is a no-op (idempotent).
#   FACT 4  A *stale* payload — a version directory without skills/ — presents
#           the same symptom and is repaired the same way, and a scoped home
#           that cannot reach its marketplace is repaired by copying the
#           operator's own materialised payload.
#
# Requires: codex >= 0.144, python3, network access to github.com.
# NOTE: Codex refuses to create helper binaries under /tmp, so the work
# directory defaults to a path under $HOME.
# Usage: experiments/issue-2088/reproduce-cache-repair.sh

set -euo pipefail

WORK="${WORK:-$HOME/issue-2088-repro}"
SRC="$WORK/openai-plugins"
MKT="$WORK/marketplace"
OPERATOR="$WORK/operator-codex-home"
SCOPED="$OPERATOR/hive-mind/repositories/CEHR2005/GCS-TS"
PLUGIN="superpowers@issue2088"
CACHE_REL="plugins/cache/issue2088/superpowers"

rm -rf "$WORK"
mkdir -p "$WORK" "$OPERATOR" "$SCOPED"

skills_in_prompt() {
  # $1 = CODEX_HOME to probe. Prints the sorted set of superpowers skills that
  # Codex renders into <skills_instructions> for that home.
  CODEX_HOME="$1" codex debug prompt-input "hive-mind capability probe" 2>/dev/null | grep -o 'superpowers:[a-z-]*' | sort -u
}

echo "==> Fetching the curated plugin catalogue"
git clone -q --depth 1 https://github.com/openai/plugins.git "$SRC"

# `openai-curated` is reserved for Codex's own snapshot sync, so the catalogue
# is renamed and reduced to the plugin under test before being registered as a
# personal marketplace.
cp -r "$SRC" "$MKT"
rm -rf "$MKT/.git"
python3 - "$MKT/.agents/plugins/marketplace.json" <<'PY'
import json, sys
path = sys.argv[1]
manifest = json.load(open(path))
manifest["name"] = "issue2088"
manifest["plugins"] = [p for p in manifest.get("plugins", []) if p.get("name") == "superpowers"]
json.dump(manifest, open(path, "w"), indent=2)
PY

echo "==> Provisioning the repository-scoped CODEX_HOME"
CODEX_HOME="$SCOPED" codex plugin marketplace add "$MKT" --json > /dev/null
CODEX_HOME="$SCOPED" codex plugin add "$PLUGIN" --json > /dev/null

echo
echo "==> FACT 1: a materialised scoped payload exposes the skills"
skills_in_prompt "$SCOPED" > "$WORK/skills-healthy.txt"
wc -l < "$WORK/skills-healthy.txt" | xargs echo "    superpowers skills visible:"
test -s "$WORK/skills-healthy.txt" || { echo "FAIL: expected superpowers skills to be exposed"; exit 1; }

# Keep a copy to act as the operator's own materialised payload for FACT 4.
mkdir -p "$OPERATOR/$(dirname "$CACHE_REL")"
cp -r "$SCOPED/$CACHE_REL" "$OPERATOR/$CACHE_REL"

echo
echo "==> FACT 2: delete only plugins/cache — the #2088 state"
rm -rf "$SCOPED/$CACHE_REL"
echo "    config.toml still declares the plugin:"
grep -A1 'plugins\.' "$SCOPED/config.toml" | sed 's/^/      /'
echo "    codex plugin list reports:"
CODEX_HOME="$SCOPED" codex plugin list 2>/dev/null | grep -E 'PLUGIN|superpowers' | sed 's/^/      /' || true
skills_in_prompt "$SCOPED" > "$WORK/skills-missing.txt" || true
echo "    superpowers skills visible: $(wc -l < "$WORK/skills-missing.txt")"
if [ -s "$WORK/skills-missing.txt" ]; then
  echo "FAIL: skills still exposed after the payload was removed"
  exit 1
fi

echo
echo "==> FACT 3: 'codex plugin add' repairs the payload, and is idempotent"
CODEX_HOME="$SCOPED" codex plugin add "$PLUGIN" --json > /dev/null
skills_in_prompt "$SCOPED" > "$WORK/skills-repaired.txt"
diff "$WORK/skills-healthy.txt" "$WORK/skills-repaired.txt" \
  && echo "    repaired catalogue matches the healthy catalogue exactly"
CODEX_HOME="$SCOPED" codex plugin add "$PLUGIN" --json > /dev/null
skills_in_prompt "$SCOPED" > "$WORK/skills-repeated.txt"
diff "$WORK/skills-repaired.txt" "$WORK/skills-repeated.txt" \
  && echo "    a repeated install changes nothing"

echo
echo "==> FACT 4a: a stale payload reports 'installed, enabled' and exposes nothing"
# This is the exact production signature: the version directory survives, so
# `codex plugin list` still reports the plugin as installed and enabled, while
# the skills the model would receive are gone. Any provisioning step that skips
# `plugin add` because the plugin "is already installed" never repairs it.
find "$SCOPED/$CACHE_REL" -maxdepth 2 -name skills -type d -exec rm -rf {} + 2>/dev/null || true
CODEX_HOME="$SCOPED" codex plugin list 2>/dev/null | grep -E 'superpowers' | sed 's/^/      /' || true
skills_in_prompt "$SCOPED" > "$WORK/skills-stale.txt" || true
echo "    superpowers skills visible with a gutted payload: $(wc -l < "$WORK/skills-stale.txt")"
if [ -s "$WORK/skills-stale.txt" ]; then
  echo "FAIL: a stale payload should expose no skills"
  exit 1
fi
CODEX_HOME="$SCOPED" codex plugin list --json 2>/dev/null \
  | python3 -c 'import json,sys; p=[x for x in json.load(sys.stdin).get("installed",[]) if x.get("installed") and x.get("enabled")]; sys.exit(0 if p else 1)' \
  && echo "    ...yet 'codex plugin list --json' still reports installed=true, enabled=true"
CODEX_HOME="$SCOPED" codex plugin add "$PLUGIN" --json > /dev/null
skills_in_prompt "$SCOPED" > "$WORK/skills-stale-repaired.txt"
diff "$WORK/skills-healthy.txt" "$WORK/skills-stale-repaired.txt" \
  && echo "    're-adding' the plugin repairs the stale payload as well"

echo
echo "==> FACT 4b: an unreachable marketplace is repaired from the operator payload"
# Simulate the marketplace source disappearing after the scoped home was built.
mv "$MKT" "$MKT.detached"
rm -rf "$SCOPED/$CACHE_REL"
mkdir -p "$SCOPED/$(dirname "$CACHE_REL")"
cp -r "$OPERATOR/$CACHE_REL" "$SCOPED/$CACHE_REL"
skills_in_prompt "$SCOPED" > "$WORK/skills-copied.txt"
diff "$WORK/skills-healthy.txt" "$WORK/skills-copied.txt" \
  && echo "    copying the operator payload restores the full catalogue offline"
mv "$MKT.detached" "$MKT"

echo
echo "==> RESULT"
echo "    healthy payload:            $(wc -l < "$WORK/skills-healthy.txt") skills"
echo "    payload deleted:            $(wc -l < "$WORK/skills-missing.txt") skills (config still says enabled)"
echo "    after 'codex plugin add':   $(wc -l < "$WORK/skills-repaired.txt") skills"
echo "    stale payload:              $(wc -l < "$WORK/skills-stale.txt") skills"
echo "    operator payload copied in: $(wc -l < "$WORK/skills-copied.txt") skills"
echo
echo "Enablement and exposure are independent: the preflight must check the"
echo "materialised payload and the rendered prompt, and repair the payload"
echo "before 'codex exec' rather than reporting the gap and continuing."
