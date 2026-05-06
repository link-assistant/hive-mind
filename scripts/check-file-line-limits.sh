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
# Issue #1593: Warning threshold to catch files approaching the limit before they exceed it.
# This mitigates the concurrent PR merge race condition where two PRs each pass CI individually
# but their combined changes push a file over the limit after both merge to main.
# See docs/case-studies/issue-1593 for the full analysis.
WARN_THRESHOLD=1350
FAILURES=()
WARNINGS=()

echo "Checking that all .mjs files are under ${LIMIT} lines..."

while IFS= read -r -d '' file; do
  line_count=$(wc -l < "$file")
  echo "$file: $line_count lines"
  if [ "$line_count" -gt "$LIMIT" ]; then
    echo "ERROR: $file has $line_count lines (limit: ${LIMIT})"
    echo "::error file=$file::File has $line_count lines (limit: ${LIMIT})"
    FAILURES+=("$file")
  elif [ "$line_count" -gt "$WARN_THRESHOLD" ]; then
    echo "WARNING: $file has $line_count lines (approaching limit of ${LIMIT}, warning threshold: ${WARN_THRESHOLD})"
    echo "::warning file=$file::File has $line_count lines (approaching limit of ${LIMIT}). Consider extracting code to keep under ${WARN_THRESHOLD} lines to prevent concurrent PR merge issues (see issue #1593)."
    WARNINGS+=("$file")
  fi
done < <(find . -path "./node_modules" -prune -o -name "*.mjs" -type f -print0)

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
  elif [ "$line_count" -gt "$WARN_THRESHOLD" ]; then
    echo "WARNING: $RELEASE_YML has $line_count lines (approaching limit of ${LIMIT}, warning threshold: ${WARN_THRESHOLD})"
    echo "::warning file=$RELEASE_YML::File has $line_count lines (approaching limit of ${LIMIT}). Consider moving inline scripts to ./scripts/ folder."
    WARNINGS+=("$RELEASE_YML")
  fi
else
  echo "WARNING: $RELEASE_YML not found, skipping"
fi

echo ""
if [ "${#WARNINGS[@]}" -gt 0 ]; then
  echo "The following files are approaching the ${LIMIT} line limit (>${WARN_THRESHOLD} lines):"
  printf '  %s\n' "${WARNINGS[@]}"
  echo ""
  echo "Consider extracting code to prevent concurrent PR merge limit violations (see issue #1593)."
  echo ""
fi
if [ "${#FAILURES[@]}" -gt 0 ]; then
  echo "The following files exceed the ${LIMIT} line limit:"
  printf '  %s\n' "${FAILURES[@]}"
  echo ""
  echo "Move large inline scripts to the ./scripts/ folder to reduce file size."
  exit 1
else
  echo "All checked files are within the ${LIMIT} line limit!"
fi
