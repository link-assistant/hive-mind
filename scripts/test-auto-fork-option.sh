#!/usr/bin/env bash
# test-auto-fork-option.sh
#
# Tests that the --auto-fork flag is correctly recognised and propagated by
# solve.mjs, hive.mjs, and start-screen.mjs.
#
# Usage:
#   bash scripts/test-auto-fork-option.sh
#
# Exit code 0 = all --auto-fork tests pass; non-zero = a check failed.
#
# History (issue #2082): every check here used to print "Could not verify ..."
# on failure and carry on to exit 0, so the job was green whatever happened. It
# was not hypothetical — the dry-run checks below need ~30s to reach the marker
# they grep for, and were being killed by a `timeout 10s`, so the greps had been
# failing on every run. Both halves are fixed: the timeouts are realistic and a
# failed check now fails the script.

set -euo pipefail

# The dry-run checks below exercise the real CLI, which makes several GitHub API
# calls before it reaches the auto-fork decision. Measured at ~32s; allow 3x.
DRY_RUN_TIMEOUT="${DRY_RUN_TIMEOUT:-120s}"

failed=0

# Assert that a log file contains a pattern, without aborting the whole run on
# the first failure — reporting every broken check at once is more useful than
# stopping at the first.
#
# Usage: assert_log_matches <description> <regex> <logfile>
assert_log_matches() {
  local description="$1" pattern="$2" logfile="$3"
  if grep -qE "$pattern" "$logfile"; then
    echo "PASS: $description"
  else
    echo "FAIL: $description"
    echo "  expected output matching: $pattern"
    echo "  ---- last 20 lines of $logfile ----"
    tail -20 "$logfile" | sed 's/^/  /'
    echo "  ----------------------------------"
    failed=1
  fi
}

echo "Testing --auto-fork option..."

# 1. The flag is recognised at all. This is hermetic and fast: it needs no
#    network, so it still reports precisely if the dry-run checks below break for
#    environmental reasons.
echo ""
echo "Checking that --auto-fork is a documented option..."
timeout 60s ./src/solve.mjs --help >solve_help.log 2>&1
assert_log_matches "solve.mjs documents --auto-fork" "auto-fork" "solve_help.log"

timeout 60s ./src/hive.mjs --help >hive_help.log 2>&1
assert_log_matches "hive.mjs documents --auto-fork" "auto-fork" "hive_help.log"

# 2. The flag reaches the auto-fork decision at runtime. The command exits
#    non-zero (the fixture repository does not exist), which is expected and not
#    what is under test, hence `|| true` — the assertion is on the output.
echo ""
echo "Testing solve.mjs with --auto-fork and --dry-run..."
timeout "$DRY_RUN_TIMEOUT" ./src/solve.mjs https://github.com/test/repo/issues/1 --auto-fork --dry-run --skip-tool-check 2>&1 | tee solve_auto_fork.log || true
assert_log_matches "solve.mjs acts on --auto-fork" "([Aa]uto-fork)" "solve_auto_fork.log"

echo ""
echo "Testing hive.mjs with --auto-fork and --dry-run..."
timeout "$DRY_RUN_TIMEOUT" ./src/hive.mjs https://github.com/test/repo --auto-fork --dry-run --skip-tool-check --once --max-issues 1 2>&1 | tee hive_auto_fork.log || true
assert_log_matches "hive.mjs acts on --auto-fork" "([Aa]uto-fork)" "hive_auto_fork.log"

# 3. The deprecated entry point still accepts the flag rather than rejecting it
#    as unknown.
echo ""
echo "Testing deprecated start-screen.mjs accepts --auto-fork without opening a screen..."
NODE_BIN="${NODE_BIN:-$(command -v node)}"
NO_SCREEN_PATH="$(dirname "${NODE_BIN}")"
PATH="${NO_SCREEN_PATH}" "${NODE_BIN}" ./src/start-screen.mjs solve https://github.com/test/repo/issues/1 --auto-fork --dry-run 2>&1 | tee start_screen_auto_fork.log || true
assert_log_matches "start-screen.mjs reports screen is unavailable rather than failing on the flag" "(GNU Screen is not installed|screen.*not.*installed)" "start_screen_auto_fork.log"

if grep -q "Unknown option" start_screen_auto_fork.log; then
  echo "FAIL: start-screen.mjs rejected --auto-fork as an unknown option"
  failed=1
fi

echo ""
if [ "$failed" -ne 0 ]; then
  echo "--auto-fork option tests FAILED"
  exit 1
fi

echo "All --auto-fork option tests passed"
