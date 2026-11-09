#!/usr/bin/env bash
# Run the native-claude-auth-experiment probe sequence against one native
# Claude binary and print one PASS/FAIL line per step (issue #3785).
# Usage: experiments/issue-3785/run-claude-native-probes.sh /path/to/claude [log-dir]
set -u
binary="$1"
logs="${2:-$(mktemp -d)}"
here="$(cd "$(dirname "$0")" && pwd)"
export PYTHONDONTWRITEBYTECODE=1
step() { local name="$1"; shift; if "$@" > "$logs/$name.log" 2>&1; then echo "PASS $name"; else echo "FAIL $name"; fi; }
expect_fail() { local name="$1" marker="$2"; shift 2; if "$@" > "$logs/$name.log" 2>&1; then echo "FAIL $name (unexpectedly passed)"; elif grep -qF "$marker" "$logs/$name.log"; then echo "PASS $name (expected failure)"; else echo "FAIL $name (other failure)"; fi; }
step storage node "$here/probe-claude-secure-storage.mjs" "$binary"
step healthy python3 "$here/probe-claude-native-refresh.py" "$binary" --diagnostics "$logs/healthy-native.log"
for scenario in expired concurrent replace-login logout; do
  step "$scenario" python3 "$here/probe-claude-native-refresh.py" "$binary" "--$scenario" --diagnostics "$logs/$scenario-native.log"
done
step output-style python3 "$here/probe-claude-native-refresh.py" "$binary" --global-output-style --diagnostics "$logs/output-style-native.log"
step owner-death-reuse python3 "$here/probe-claude-native-refresh.py" "$binary" --owner-death --expect-predecessor-reuse --diagnostics "$logs/owner-death-native.log"
expect_fail owner-death-strict 'A peer must refuse the consumed predecessor after owner death.' python3 "$here/probe-claude-native-refresh.py" "$binary" --owner-death --diagnostics "$logs/owner-death-strict-native.log"
step history-before python3 "$here/probe-claude-native-refresh.py" "$binary" --history --private-history --expect-history-gap --diagnostics "$logs/history-before-native.log"
expect_fail history-strict 'A fresh native peer must resume persisted history.' python3 "$here/probe-claude-native-refresh.py" "$binary" --history --private-history --diagnostics "$logs/history-strict-native.log"
step history-after python3 "$here/probe-claude-native-refresh.py" "$binary" --history --diagnostics "$logs/history-after-native.log"
echo "logs: $logs"
