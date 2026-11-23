#!/usr/bin/env bash
# Reproduce partial visible proof writes; verify atomic proofs and old boundaries.
set -euo pipefail
package=$1
prefix=$2
export PYTHONDONTWRITEBYTECODE=1
for scenario in first replacement; do
  if python3 experiments/issue-3785/probe-gemini-native-cli.py "$package" --history --history-plan --history-plan-interruption "$scenario" --history-plan-point partial-intent-journal --diagnostics "$prefix-$scenario-before.log" > "$prefix-$scenario-before-control.log" 2>&1; then
    echo 'The complete native CLI unexpectedly recovered a partial visible proof before repair.'
    exit 1
  fi
  grep -F "PASS: the complete actual native Plan Mode CLI reaches $scenario partial-intent-journal, is killed and reaped, and loses its whole private home before acknowledgement." "$prefix-$scenario-before-control.log"
  grep -F 'AssertionError: Fresh complete native CLI must recover the interrupted plan and resume its canonical session.' "$prefix-$scenario-before-control.log"
  grep -F 'Gemini canonical conversation history is unavailable or unsafe.' "$prefix-$scenario-before-recovery.log"
done
python3 experiments/issue-3785/native-gemini/apply_atomic_publication.py "$package" --check
python3 experiments/issue-3785/native-gemini/apply_atomic_publication.py "$package"
python3 experiments/issue-3785/native-gemini/probe_atomic_publication.py "$package" --diagnostics "$prefix-proof.log" > "$prefix-proof-control.log" 2>&1
for state in alias-missing alias-symlink alias-inode alias-extra-link alias-mode alias-fifo journal-substitution journal-malformed stage-inode stage-symlink stage-mode stage-content target-collision; do
  python3 experiments/issue-3785/native-gemini/probe_atomic_publication.py "$package" --attack "$state" --diagnostics "$prefix-proof-$state.log" > "$prefix-proof-$state-control.log" 2>&1
done
for state in inode content; do
  python3 experiments/issue-3785/native-gemini/probe_atomic_publication.py "$package" --live-proof-replacement "$state" --diagnostics "$prefix-live-$state.log" > "$prefix-live-$state-control.log" 2>&1
done
python3 experiments/issue-3785/native-gemini/probe_publication.py "$package" --atomic-proofs --diagnostics "$prefix-generic.log" > "$prefix-generic-control.log" 2>&1
python3 experiments/issue-3785/native-gemini/probe_publication.py "$package" --atomic-proofs --live-journal-replacement --diagnostics "$prefix-generic-live.log" > "$prefix-generic-live-control.log" 2>&1
for state in journal-symlink journal-hardlink journal-mode journal-malformed journal-schema journal-invalid-utf8 journal-oversized journal-traversal journal-inode journal-digest stage-symlink stage-hardlink stage-mode stage-content stage-missing target-symlink target-hardlink target-mode target-content target-collision; do
  python3 experiments/issue-3785/native-gemini/probe_publication.py "$package" --atomic-proofs --attack "$state" --diagnostics "$prefix-generic-$state.log" > "$prefix-generic-$state-control.log" 2>&1
done
python3 experiments/issue-3785/native-gemini/probe_plan_publication.py "$package" --diagnostics "$prefix-plan.log" > "$prefix-plan-control.log" 2>&1
python3 experiments/issue-3785/native-gemini/probe_plan_publication.py "$package" --live-stage-replacement --diagnostics "$prefix-plan-live.log" > "$prefix-plan-live-control.log" 2>&1
for state in intent-symlink intent-hardlink intent-mode intent-malformed intent-schema intent-utf8 intent-oversized intent-name intent-scope intent-digest intent-revision intent-stage-name stage-symlink stage-hardlink stage-mode stage-content stage-missing target-symlink target-hardlink target-mode target-content target-missing journal-conflict; do
  python3 experiments/issue-3785/native-gemini/probe_plan_publication.py "$package" --attack "$state" --diagnostics "$prefix-plan-$state.log" > "$prefix-plan-$state-control.log" 2>&1
done
python3 experiments/issue-3785/native-gemini/probe_plans_history.py "$package" --plan-transactions --diagnostics "$prefix-storage.log" > "$prefix-storage-control.log" 2>&1
bash experiments/issue-3785/native-gemini/check_plan_cli_interruption.sh "$package" "$prefix-cli" after
for scenario in first replacement; do
  python3 experiments/issue-3785/probe-gemini-native-cli.py "$package" --history --history-plan --history-plan-interruption "$scenario" --history-plan-point partial-intent-journal --diagnostics "$prefix-$scenario-after.log" > "$prefix-$scenario-after-control.log" 2>&1
done
for mode in selected private; do
  extra=()
  if [ "$mode" = private ]; then extra+=(--private-history); fi
  python3 experiments/issue-3785/probe-gemini-native-cli.py "$package" --history --history-plan "${extra[@]}" --diagnostics "$prefix-$mode.log" > "$prefix-$mode-control.log" 2>&1
done
