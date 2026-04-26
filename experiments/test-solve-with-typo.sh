#!/bin/bash

# Test script to verify the option suggestion feature works in the actual solve command
# This simulates the exact error from Issue #1072

echo "=== Testing solve command with --branch typo (Issue #1072) ==="
echo ""
echo "Running: node src/solve.mjs https://github.com/test/repo/issues/1 --branch dev --dry-run"
echo ""

# Run the command with the typo and capture the error
node src/solve.mjs https://github.com/test/repo/issues/1 --branch dev --dry-run 2>&1 || true

echo ""
echo "=== Expected behavior ==="
echo "The error message should suggest --base-branch as an alternative to --branch"
