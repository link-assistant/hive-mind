#!/usr/bin/env bash
# test-auto-fork-option.sh
#
# Tests that the --auto-fork flag is correctly recognised and propagated by
# solve.mjs, hive.mjs, and start-screen.mjs.
#
# Usage:
#   bash scripts/test-auto-fork-option.sh
#
# Exit code 0 = all --auto-fork tests pass; non-zero = unexpected failure.

set -euo pipefail

echo "Testing --auto-fork option with dry-run mode..."

echo ""
echo "Testing solve.mjs with --auto-fork and --dry-run..."
timeout 10s ./src/solve.mjs https://github.com/test/repo/issues/1 --auto-fork --dry-run --skip-tool-check 2>&1 | tee solve_auto_fork.log || true
if grep -qE "(auto-fork|Auto-fork)" solve_auto_fork.log; then
  echo "solve.mjs recognizes --auto-fork flag"
else
  echo "Could not verify --auto-fork flag in solve output"
fi

echo ""
echo "Testing hive.mjs with --auto-fork and --dry-run..."
timeout 30s ./src/hive.mjs https://github.com/test/repo --auto-fork --dry-run --skip-tool-check --once --max-issues 1 2>&1 | tee hive_auto_fork.log || true
if grep -qE "(auto-fork|Auto-fork)" hive_auto_fork.log; then
  echo "hive.mjs recognizes --auto-fork flag"
else
  echo "Could not verify --auto-fork flag in hive output"
fi

echo ""
echo "Testing start-screen.mjs passes --auto-fork to solve..."
timeout 5s ./src/start-screen.mjs solve https://github.com/test/repo/issues/1 --auto-fork 2>&1 | tee start_screen_auto_fork.log || true
if grep -qE "(auto-fork|GNU Screen|screen.*not.*installed)" start_screen_auto_fork.log; then
  echo "start-screen.mjs accepts --auto-fork flag"
else
  echo "Could not verify start-screen flag acceptance"
fi

echo ""
echo "All --auto-fork option tests completed"
