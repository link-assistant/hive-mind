#!/usr/bin/env bash
# verify-log-file-contents.sh
#
# Verifies that solve.mjs log files contain the version string and executed command.
# This ensures the logging behaviour introduced in issue #517 remains intact.
#
# Usage:
#   bash scripts/verify-log-file-contents.sh
#
# Exit code 0 = log file contains expected entries; non-zero = verification failed.

set -euo pipefail

echo "Testing that log files contain version and command at the start..."
set +e
timeout 30s ./src/solve.mjs "https://example.com/not-a-github-repository" --dry-run --skip-tool-check --skip-claude-check 2>&1 | tee test-log-output.txt
SOLVE_STATUS=${PIPESTATUS[0]}
set -e

# Use a deterministic validation failure so the smoke test never depends on a
# live fixture repository. The precise status/reason distinguishes that expected
# terminal result from startup, import, timeout, and argument-parsing failures.
if [ "$SOLVE_STATUS" -ne 1 ]; then
  echo "solve dry-run returned $SOLVE_STATUS; expected invalid-URL status 1"
  exit 1
fi
if ! grep -q "Not a GitHub URL" test-log-output.txt; then
  echo "solve dry-run did not reach the expected invalid-URL validation"
  exit 1
fi
if grep -Eq "(TypeError|SyntaxError|ReferenceError):" test-log-output.txt; then
  echo "solve dry-run encountered a startup/runtime error"
  exit 1
fi

LOG_FILE=$(grep -o "solve-[0-9T-]*Z\.log" test-log-output.txt | head -1)

if [ -z "$LOG_FILE" ]; then
  echo "Could not find log file path in output"
  cat test-log-output.txt
  exit 1
fi

echo "Log file: $LOG_FILE"

if [ ! -f "$LOG_FILE" ]; then
  echo "Log file not found: $LOG_FILE"
  ls -la solve-*.log || echo "No solve log files found"
  exit 1
fi

echo ""
echo "Checking log file contents..."
head -30 "$LOG_FILE"

echo ""
echo "Verifying version appears in log..."
if grep -q "solve v" "$LOG_FILE"; then
  echo "Version found in log file"
else
  echo "Version NOT found in log file"
  exit 1
fi

echo ""
echo "Verifying command appears in log..."
if grep -q "Raw command executed:" "$LOG_FILE"; then
  echo "Command found in log file"
else
  echo "Command NOT found in log file"
  exit 1
fi

echo ""
echo "Log file verification passed - version and command are present"
