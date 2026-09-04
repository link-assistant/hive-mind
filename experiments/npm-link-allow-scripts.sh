#!/usr/bin/env bash
# Issue #2198 / upstream npm bug: `npm link` warns that a package's install
# scripts are "not yet covered by allowScripts", but no allowScripts mechanism
# can cover them. Enumerates every documented way to review the script and
# reports which, if any, silences the warning.
#
# Usage: bash experiments/npm-link-allow-scripts.sh
set -euo pipefail

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "npm $(npm --version), node $(node --version)"
echo

fixture() { # $1 = extra top-level package.json keys, $2 = .npmrc contents
  rm -rf "$work/pkg" "$work/global" "$work/ran"
  mkdir -p "$work/pkg" "$work/global"
  cat > "$work/pkg/package.json" <<JSON
{
  "name": "@fixture/link-me",
  "version": "1.0.0",
  "bin": { "fixture": "./bin.mjs" },
  "scripts": { "prepare": "node -e \"require('node:fs').writeFileSync('$work/ran','1')\"" }$1
}
JSON
  printf '#!/usr/bin/env node\nconsole.log("ok");\n' > "$work/pkg/bin.mjs"
  [ -n "$2" ] && printf '%s\n' "$2" > "$work/pkg/.npmrc"
  return 0
}

probe() { # $1 = label, rest = npm link args
  local label="$1"; shift
  local warns
  warns=$( (cd "$work/pkg" && npm_config_prefix="$work/global" npm link "$@" 2>&1) | grep -c 'allow-scripts' || true)
  printf '%-46s warning=%-3s prepare_ran=%s\n' \
    "$label" "$([ "$warns" -gt 0 ] && echo yes || echo no)" \
    "$([ -f "$work/ran" ] && echo yes || echo no)"
}

fixture "" "";                                                         probe "baseline"
fixture ', "allowScripts": { "@fixture/link-me": true }' "";           probe "package.json allowScripts (bare name)"
fixture ', "allowScripts": { "@fixture/link-me@1.0.0": true }' "";     probe "package.json allowScripts (name@version)"
fixture "" "allow-scripts=@fixture/link-me";                           probe ".npmrc allow-scripts"
fixture "" "";                                                         probe "--allow-scripts=<name>" --allow-scripts=@fixture/link-me
fixture "" "";                                                         probe "--ignore-scripts" --ignore-scripts

echo
echo "npm approve-scripts --allow-scripts-pending says:"
fixture "" ""
(cd "$work/pkg" && npm_config_prefix="$work/global" npm link >/dev/null 2>&1) || true
(cd "$work/pkg" && npm_config_prefix="$work/global" npm approve-scripts --allow-scripts-pending 2>&1 | head -3)
