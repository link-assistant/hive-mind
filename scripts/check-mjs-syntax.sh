#!/usr/bin/env bash
# check-mjs-syntax.sh
#
# Checks Node.js syntax for all .mjs files in the project root, src/, and tests/.
#
# Usage:
#   bash scripts/check-mjs-syntax.sh
#
# Exit code 0 = all files pass syntax check; non-zero = syntax error found.

set -euo pipefail

echo "Checking syntax for all .mjs files..."
for file in *.mjs; do
  if [ -f "$file" ]; then
    echo "Checking $file..."
    timeout 10s node --check "$file"
  fi
done
for file in src/*.mjs; do
  if [ -f "$file" ]; then
    echo "Checking $file..."
    timeout 10s node --check "$file"
  fi
done
for file in tests/*.mjs; do
  if [ -f "$file" ]; then
    echo "Checking $file..."
    node --check "$file"
  fi
done
