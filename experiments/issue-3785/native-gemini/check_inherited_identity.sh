#!/usr/bin/env bash
# Reproduce native startup gaps, then independently rebuild the final adapter.
set -euo pipefail
constructor=$1
tested=$2
prefix=$3
export PYTHONDONTWRITEBYTECODE=1
for state in auth-mismatch history-mismatch; do
  extra=()
  if [ "$state" = history-mismatch ]; then extra+=(--history); fi
  if python3 experiments/issue-3785/probe-gemini-native-cli.py "$tested" "${extra[@]}" --storage-identity "$state" --diagnostics "$prefix-$state-before.log" > "$prefix-$state-before-control.log" 2>&1; then
    echo 'The preceding native CLI unexpectedly refused an inherited identity mismatch.'
    exit 1
  fi
  grep -F 'AssertionError: Native CLI must refuse a mismatched inherited storage identity before inference.' "$prefix-$state-before-control.log"
done
python3 experiments/issue-3785/native-gemini/apply_inherited_identity.py "$tested" --check
python3 experiments/issue-3785/native-gemini/apply_inherited_identity.py "$tested"
python3 experiments/issue-3785/native-gemini/verify_shell_application.py "$constructor" "$tested" --acp --terminal-resume --headless --subagent --conversation-evidence --stream-admission --plans --plan-transactions --atomic-proofs --inherited-identity --output "$prefix-fresh-cli" > "$prefix-source.log" 2>&1
node --max-old-space-size=64 experiments/issue-3785/native-gemini/probe_inherited_identity.mjs "$prefix-fresh-cli" > "$prefix-components.log" 2>&1
