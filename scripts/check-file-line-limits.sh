#!/usr/bin/env bash
# check-file-line-limits.sh
#
# Enforces a 1500-line limit on all .mjs files and on release.yml.
#
# Usage:
#   bash scripts/check-file-line-limits.sh
#
# Exit code 0 = all files within limit; non-zero = one or more violations.

set -euo pipefail

LIMIT=1500
FAILURES=()

echo "Checking that all .mjs files are under ${LIMIT} lines..."

while IFS= read -r -d '' file; do
  line_count=$(wc -l < "$file")
  echo "$file: $line_count lines"
  if [ "$line_count" -gt "$LIMIT" ]; then
    echo "ERROR: $file has $line_count lines (limit: ${LIMIT})"
    echo "::error file=$file::File has $line_count lines (limit: ${LIMIT})"
    FAILURES+=("$file")
  fi
done < <(find . -name "*.mjs" -type f -print0)

echo ""
echo "Checking that .github/workflows/release.yml is under ${LIMIT} lines..."
RELEASE_YML=".github/workflows/release.yml"
if [ -f "$RELEASE_YML" ]; then
  line_count=$(wc -l < "$RELEASE_YML")
  echo "$RELEASE_YML: $line_count lines"
  if [ "$line_count" -gt "$LIMIT" ]; then
    echo "ERROR: $RELEASE_YML has $line_count lines (limit: ${LIMIT})"
    echo "::error file=$RELEASE_YML::File has $line_count lines (limit: ${LIMIT}). Move inline scripts to ./scripts/ folder."
    FAILURES+=("$RELEASE_YML")
  fi
else
  echo "WARNING: $RELEASE_YML not found, skipping"
fi

echo ""
if [ "${#FAILURES[@]}" -gt 0 ]; then
  echo "The following files exceed the ${LIMIT} line limit:"
  printf '  %s\n' "${FAILURES[@]}"
  echo ""
  echo "Move large inline scripts to the ./scripts/ folder to reduce file size."
  exit 1
else
  echo "All checked files are within the ${LIMIT} line limit!"
fi
