#!/bin/bash

# Quick test to check for stderr errors without running the full solve command
echo "=== Quick stderr test for solve command ==="
echo ""

# Run from /tmp (non-git directory) to trigger the git error
cd /tmp

# Run solve.mjs and capture only the first 50 lines before the long output starts
timeout 5 node /tmp/gh-issue-solver-1760621682805/src/solve.mjs https://github.com/test/test/issues/1 --dry-run --skip-tool-check 2>&1 | head -50 > /tmp/solve-test-output.log 2>&1 &
PID=$!

# Wait for timeout or completion
wait $PID 2>/dev/null
EXIT_CODE=$?

echo "Process completed with exit code: $EXIT_CODE"
echo ""

# Extract just stderr lines
echo "=== Checking for problematic stderr messages ==="
echo ""

if grep -q "fatal: not a git repository" /tmp/solve-test-output.log; then
  echo "❌ FAIL: Found 'fatal: not a git repository' error"
  FAIL=1
else
  echo "✅ PASS: No 'fatal: not a git repository' error found"
fi

if grep -q "YError: Not enough arguments" /tmp/solve-test-output.log; then
  echo "❌ FAIL: Found 'YError: Not enough arguments' error"
  FAIL=1
else
  echo "✅ PASS: No 'YError: Not enough arguments' error found"
fi

echo ""
echo "=== First 50 lines of output ==="
cat /tmp/solve-test-output.log

if [ "$FAIL" = "1" ]; then
  echo ""
  echo "❌ Test failed - errors found in stderr"
  exit 1
else
  echo ""
  echo "✅ Test passed - no spurious errors found"
  exit 0
fi
