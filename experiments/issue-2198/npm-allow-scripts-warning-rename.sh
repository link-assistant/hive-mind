#!/usr/bin/env bash
# Issue #2198 / F4 follow-up: npm renamed the warning prefix that the F4 test
# matched on, without changing the behaviour the warning reports.
#
# The `test-suites` job went red on run 33890315861 with
# "npm fixed linkPkg() and the --ignore-scripts workaround can be dropped".
# npm had fixed nothing: the runners moved 11.17.0 -> 11.19.0 and the log
# prefix `npm warn allow-scripts` became `npm warn install-scripts`.
#
# This script links the same throwaway package under every npm given as an
# argument and prints what each one says, so the claim is checked rather than
# inferred from a truncated CI log.
#
# Usage: npm-allow-scripts-warning-rename.sh <npm-binary> [<npm-binary> ...]
set -uo pipefail

for npm_bin in "$@"; do
  version="$("$npm_bin" --version)"
  echo "================ npm ${version} (${npm_bin})"

  work="$(mktemp -d)"
  trap 'rm -rf "${work}"' EXIT
  mkdir -p "${work}/pkg" "${work}/global"
  cat > "${work}/pkg/package.json" <<JSON
{
  "name": "@hive-mind-fixture/link-me",
  "version": "1.0.0",
  "bin": { "hive-mind-fixture": "./bin.mjs" },
  "scripts": { "prepare": "node -e \"require('node:fs').writeFileSync('${work}/prepare-ran', 'ran')\"" }
}
JSON
  printf '#!/usr/bin/env node\nconsole.log("ok");\n' > "${work}/pkg/bin.mjs"
  chmod +x "${work}/pkg/bin.mjs"

  for mode in bare ignore-scripts; do
    rm -f "${work}/prepare-ran"
    args=(link)
    [ "${mode}" = "ignore-scripts" ] && args+=(--ignore-scripts)
    echo "---- npm ${args[*]}"
    (cd "${work}/pkg" && npm_config_prefix="${work}/global" npm_config_update_notifier=false \
      "$npm_bin" "${args[@]}" 2>&1) | sed 's/^/    /'
    if [ -f "${work}/prepare-ran" ]; then echo "    [prepare script RAN]"; else echo "    [prepare script did not run]"; fi
  done

  rm -rf "${work}"
  trap - EXIT
done
