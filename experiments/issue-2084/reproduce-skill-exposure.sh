#!/usr/bin/env bash
# Issue #2084 — reproduce Codex Agent Skill exposure end to end.
#
# Establishes, empirically, the three facts the fix depends on:
#
#   1. A plugin whose payload is materialised under
#      $CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/skills
#      exposes its skills to the model, namespaced as <plugin>:<skill>.
#   2. Removing that cache directory while leaving config.toml intact flips
#      `codex plugin list` to "not installed" and removes every skill.
#   3. Therefore the model-visible skill catalogue — not `codex plugin list`
#      STATUS — is the only sound verification signal for the preflight.
#
# Requires: codex >= 0.144, network access to github.com.
# Usage: experiments/issue-2084/reproduce-skill-exposure.sh

set -euo pipefail

WORK="${WORK:-/tmp/issue-2084-repro}"
SRC="$WORK/openai-plugins"
MKT="$WORK/marketplace"
export CODEX_HOME="$WORK/codex-home"

rm -rf "$WORK"
mkdir -p "$WORK" "$CODEX_HOME"

echo "==> Fetching the curated plugin catalogue"
git clone -q --depth 1 https://github.com/openai/plugins.git "$SRC"

# The catalogue declares itself as `openai-curated`, a name Codex reserves for
# its own snapshot sync. Rename it so it can be registered as a personal
# marketplace, and keep only the plugin under test.
cp -r "$SRC" "$MKT"
rm -rf "$MKT/.git"
python3 - "$MKT/.agents/plugins/marketplace.json" <<'PY'
import json, sys
path = sys.argv[1]
manifest = json.load(open(path))
manifest["name"] = "issue2084"
manifest["plugins"] = [p for p in manifest.get("plugins", []) if p.get("name") == "superpowers"]
json.dump(manifest, open(path, "w"), indent=2)
PY

echo "==> Registering marketplace and installing superpowers"
codex plugin marketplace add "$MKT" --json
codex plugin add superpowers@issue2084 --json

echo
echo "==> FACT 1: skills exposed while the plugin cache is present"
codex debug prompt-input "hi" 2>/dev/null | grep -o 'superpowers:[a-z-]*' | sort -u | tee "$WORK/skills-present.txt"
test -s "$WORK/skills-present.txt" || { echo "FAIL: expected superpowers skills to be exposed"; exit 1; }

echo
echo "==> FACT 2: remove plugins/cache, leave config.toml untouched"
mv "$CODEX_HOME/plugins/cache" "$WORK/cache-detached"
echo "--- config.toml still declares the plugin as enabled:"
cat "$CODEX_HOME/config.toml"
echo "--- codex plugin list now reports:"
codex plugin list | grep -E 'PLUGIN|superpowers' || true
codex debug prompt-input "hi" 2>/dev/null | grep -o 'superpowers:[a-z-]*' | sort -u > "$WORK/skills-absent.txt" || true

if [ -s "$WORK/skills-absent.txt" ]; then
  echo "FAIL: skills still exposed after cache removal"
  exit 1
fi

echo
echo "==> RESULT"
echo "    with cache:    $(wc -l < "$WORK/skills-present.txt") superpowers skills exposed"
echo "    without cache: 0 superpowers skills exposed, plugin reported 'not installed'"
echo
echo "The plugin payload under plugins/cache is what makes skills model-visible."
echo "A repository-scoped CODEX_HOME that inherits config.toml and the marketplace"
echo "snapshot but not the materialised cache yields exactly the issue #2084 symptom."
