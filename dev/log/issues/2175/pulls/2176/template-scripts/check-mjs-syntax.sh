#!/usr/bin/env bash
# check-mjs-syntax.sh
#
# Checks Node.js syntax for all .mjs files in src/, scripts/, and tests/.
#
# Usage:
#   bash scripts/check-mjs-syntax.sh
#
# Exit code 0 = all files pass syntax check; non-zero = syntax error found.

set -euo pipefail

echo "Checking syntax for all .mjs files..."

CHECKED=0
for dir in src scripts tests; do
  if [ -d "$dir" ]; then
    for file in "$dir"/*.mjs; do
      if [ -f "$file" ]; then
        echo "Checking $file..."
        timeout 10s node --check "$file"
        CHECKED=$((CHECKED + 1))
      fi
    done
  fi
done

echo ""
echo "Syntax check passed for $CHECKED file(s)."
