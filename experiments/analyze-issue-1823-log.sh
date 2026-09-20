#!/usr/bin/env bash
# Issue #1823: reproduce the log analysis used in docs/case-studies/issue-1823/README.md.
# Usage: ./experiments/analyze-issue-1823-log.sh <path-to-decompressed-log>
# The log itself is stored gzipped at
#   docs/case-studies/issue-1823/logs/tmp-start-command-logs-isolation-screen-fc60434a-*.log.gz
set -euo pipefail
LOG="${1:?path to decompressed log required (gunzip the .log.gz first)}"

echo "=== Total lines ==="; wc -l "$LOG"

echo "=== Double signal-handler race + non-isolated solve (the interrupt sequence) ==="
grep -nE '🛑 Received|❌ Interrupted \(CTRL|Session interrupted by user' "$LOG"

echo "=== Confirm OLD build never reached graceful completion (expect 0 each) ==="
for p in 'Shutdown complete' 'Press CTRL\+C again' 'force-stop'; do
  printf '%-22s %s\n' "$p" "$(grep -ac "$p" "$LOG")"
done

echo "=== False [solve worker-N ERROR] stderr lines ==="
echo "total: $(grep -acE '\[solve worker-[0-9]+ ERROR\]' "$LOG")"
grep -aoE '\[solve worker-[0-9]+ ERROR\] .*' "$LOG" \
  | grep -aoE '(DEBUG|INFO| WARN| ERROR)' | sort | uniq -c | sort -rn

echo "=== Downstream errors caused by interrupting solve/codex ==="
grep -anE 'Could not read Codex final message|No Codex usage found' "$LOG"
