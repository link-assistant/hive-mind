#!/usr/bin/env bash
# Smoke-test src/memory-check.mjs end to end on a real runner.
#
# Issue #2198: these three steps used to be inline `run: |` blocks in the
# memory-check job of .github/workflows/release.yml. They were moved here so
# that workflow stays clear of the 1350-line warning threshold enforced by
# scripts/check-file-line-limits.sh, which exists because concurrent pull
# requests cannot both extend one oversized file (issue #1593).
#
# Behaviour is unchanged: print the runner's resource picture, prove the
# checker passes when the thresholds are trivially satisfiable, and prove it
# *fails* when they are not -- the second half is the part that matters, since
# a checker that never fails is a false negative.
set -euo pipefail

CHECK=./src/memory-check.mjs

echo "=== System Information ==="
uname -a
echo ""
echo "=== Memory Information ==="
free -h
echo ""
echo "=== Disk Information ==="
df -h
echo ""
echo "=== CPU Information ==="
lscpu | head -20
echo ""

echo "Testing with low thresholds (should pass)..."
"$CHECK" --min-memory 10 --min-disk-space 100 --json
echo ""
echo "Testing verbose output..."
"$CHECK" --min-memory 10 --min-disk-space 100
echo ""
echo "Testing quiet mode..."
"$CHECK" --min-memory 10 --min-disk-space 100 --quiet --json
echo ""

echo "Testing with impossible memory requirement (should fail)..."
if "$CHECK" --min-memory 999999 --exit-on-failure --quiet --json; then
  echo "ERROR: Should have failed with impossible memory requirement"
  exit 1
fi
echo "Correctly failed with impossible memory requirement"
echo ""

echo "Testing with impossible disk requirement (should fail)..."
if "$CHECK" --min-disk-space 999999999 --exit-on-failure --quiet --json; then
  echo "ERROR: Should have failed with impossible disk requirement"
  exit 1
fi
echo "Correctly failed with impossible disk requirement"
