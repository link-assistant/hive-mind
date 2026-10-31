#!/usr/bin/env bash
# Reproduce actual native plan publication loss, then verify the pinned repair.
set -euo pipefail
package=$1
prefix=$2
export PYTHONDONTWRITEBYTECODE=1
for scenario in first replacement; do
  if python3 experiments/issue-3785/native-gemini/probe_plan_publication.py "$package" --scenario "$scenario" --point after-journal --diagnostics "$prefix-$scenario-before.log" > "$prefix-$scenario-before-control.log" 2>&1; then
    echo 'Native interrupted plan publication unexpectedly recovered before repair.'
    exit 1
  fi
  grep -F "PASS: actual native plan owner reaches $scenario after-journal before forced death and whole private-home disposal." "$prefix-$scenario-before-control.log"
  grep -F 'Gemini canonical conversation history is unavailable or unsafe.' "$prefix-$scenario-before-$scenario-after-journal-peer.log"
done
if python3 experiments/issue-3785/native-gemini/probe_plans_history.py "$package" --scenario unsafe-plan-reserved --diagnostics "$prefix-reserved-before.log" > "$prefix-reserved-before-control.log" 2>&1; then
  echo 'Native plan transaction metadata names unexpectedly refused before repair.'
  exit 1
fi
grep -F 'Missing expected rejection' "$prefix-reserved-before-unsafe-plan-reserved-owner.log"
python3 experiments/issue-3785/native-gemini/apply_plan_transactions.py "$package" --check
python3 experiments/issue-3785/native-gemini/apply_plan_transactions.py "$package"
python3 experiments/issue-3785/native-gemini/probe_plan_publication.py "$package" --diagnostics "$prefix-after.log" > "$prefix-after-control.log" 2>&1
python3 experiments/issue-3785/native-gemini/probe_plan_publication.py "$package" --live-stage-replacement --diagnostics "$prefix-live.log" > "$prefix-live-control.log" 2>&1
for state in intent-symlink intent-hardlink intent-mode intent-malformed intent-schema intent-utf8 intent-oversized intent-name intent-scope intent-digest intent-revision intent-stage-name stage-symlink stage-hardlink stage-mode stage-content stage-missing target-symlink target-hardlink target-mode target-content target-missing journal-conflict; do
  python3 experiments/issue-3785/native-gemini/probe_plan_publication.py "$package" --attack "$state" --diagnostics "$prefix-$state.log" > "$prefix-$state-control.log" 2>&1
done
python3 experiments/issue-3785/native-gemini/probe_plans_history.py "$package" --plan-transactions --diagnostics "$prefix-storage.log" > "$prefix-storage-control.log" 2>&1
