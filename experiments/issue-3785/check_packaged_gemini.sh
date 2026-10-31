#!/usr/bin/env bash
# Exercise the npm allowlist, exact installation and actual native runtime.
set -euo pipefail
source_package=$1
tested_package=$2
prefix=$3
export PYTHONDONTWRITEBYTECODE=1
mkdir "$prefix-package"
npm pack --ignore-scripts --json --pack-destination "$prefix-package" > "$prefix-pack.json" 2> "$prefix-pack.log" &
wait "$!"
python3 - "$prefix" <<'PY'
import json
from pathlib import Path
import sys
import tarfile
prefix = Path(sys.argv[1])
filename = json.loads(prefix.with_name(prefix.name + '-pack.json').read_text())[0]['filename']
assert filename == Path(filename).name
root = prefix.with_name(prefix.name + '-package')
with tarfile.open(root / filename) as archive:
    archive.extractall(root, filter='data')
PY
node --max-old-space-size=256 experiments/issue-3785/probe-packaged-native-gemini.mjs "$prefix-package/package" "$source_package" "$tested_package" "$prefix-cli" > "$prefix-install.log" 2>&1
if [ "${4:-}" = --install-only ]; then exit 0; fi
runtime_package=$(cat "$prefix-package/activated-root.txt")
export GEMINI_PROBE_MODULE="$runtime_package/bundle/chunk-DKZARV6U.js"
node --max-old-space-size=128 experiments/issue-3785/probe-gemini-native-writers.mjs > "$prefix-writers.log" 2>&1
node --max-old-space-size=128 experiments/issue-3785/probe-gemini-native-request-auth.mjs > "$prefix-requests.log" 2>&1
node --max-old-space-size=128 experiments/issue-3785/probe-gemini-native-reads.mjs --private-configs > "$prefix-reads.log" 2>&1
python3 experiments/issue-3785/probe-gemini-native-cli.py "$runtime_package" --history --restorable-history --restorable-acp --diagnostics "$prefix-acp.log" > "$prefix-acp-control.log" 2>&1
python3 experiments/issue-3785/probe-gemini-native-cli.py "$runtime_package" --history --restorable-history --restorable-terminal-reopen --restorable-terminal-startup-prompt --diagnostics "$prefix-terminal.log" > "$prefix-terminal-control.log" 2>&1
python3 experiments/issue-3785/probe-gemini-native-cli.py "$runtime_package" --history --history-subagent --history-subagent-restore --history-subagent-engine agent --diagnostics "$prefix-child.log" > "$prefix-child-control.log" 2>&1
python3 experiments/issue-3785/probe-gemini-native-cli.py "$runtime_package" --history --history-plan --history-plan-interruption replacement --history-plan-point partial-intent-journal --diagnostics "$prefix-plan.log" > "$prefix-plan-control.log" 2>&1
