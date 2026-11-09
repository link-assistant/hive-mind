#!/usr/bin/env bash
# Exercise the complete native CLI, including its real Plan Mode tools and resume.
set -euo pipefail
package=$1
prefix=$2
phase=$3
export PYTHONDONTWRITEBYTECODE=1
case "$phase" in
  before|after) ;;
  *) echo 'Expected before or after.' >&2; exit 2 ;;
esac
for scenario in first replacement; do
  if [ "$phase" = before ]; then
    diagnostic="$prefix-$scenario-before.log"
    if python3 experiments/issue-3785/probe-gemini-native-cli.py "$package" --history --history-plan --history-plan-interruption "$scenario" --history-plan-point after-journal --diagnostics "$diagnostic" > "$prefix-$scenario-before-control.log" 2>&1; then
      echo 'The complete native CLI unexpectedly recovered the interrupted plan before repair.'
      exit 1
    fi
    grep -F "PASS: the complete actual native Plan Mode CLI reaches $scenario after-journal, is killed and reaped, and loses its whole private home before acknowledgement." "$prefix-$scenario-before-control.log"
    grep -F 'AssertionError: Fresh complete native CLI must recover the interrupted plan and resume its canonical session.' "$prefix-$scenario-before-control.log"
    grep -F 'Gemini canonical conversation history is unavailable or unsafe.' "$prefix-$scenario-before-recovery.log"
  else
    for point in after-intent after-journal after-publish; do
      python3 experiments/issue-3785/probe-gemini-native-cli.py "$package" --history --history-plan --history-plan-interruption "$scenario" --history-plan-point "$point" --diagnostics "$prefix-$scenario-$point.log" > "$prefix-$scenario-$point-control.log" 2>&1
    done
  fi
done
