#!/usr/bin/env bash
# check-file-line-limits.sh
#
# Enforces the documented 1500-line architecture limit on tracked
# JavaScript (.js, .mjs, .cjs) and Markdown (.md) files, plus
# .github/workflows/release.yml.
#
# This shell gate complements the ESLint `max-lines` rule: ESLint only
# covers source files it lints, while this check walks every tracked
# JavaScript and Markdown file so .js, .cjs, and documentation cannot
# slip past the limit.
#
# Intentional exceptions (kept in sync with the eslint.config.js ignore
# list): case-study and generated-data files under
# docs/case-studies/*/data/ mirror external sources verbatim and must not
# be reflowed to satisfy the limit, so they are excluded here.
#
# Usage:
#   bash scripts/check-file-line-limits.sh
#
# Exit code 0 = all files within limit; non-zero = one or more violations.

set -euo pipefail

LIMIT=1500
WARN_THRESHOLD=1350
FAILURES=()
WARNINGS=()

# check_file FILE [HINT]
# Counts lines in FILE and records a warning or failure when it crosses
# the warning threshold or hard limit. HINT is appended to the GitHub
# annotation to suggest a remediation.
check_file() {
  local file="$1"
  local hint="${2:-Extract code to keep files under the ${LIMIT} line limit.}"
  local line_count
  line_count=$(wc -l < "$file" | tr -d '[:space:]')
  echo "$file: $line_count lines"
  if [ "$line_count" -gt "$LIMIT" ]; then
    echo "ERROR: $file has $line_count lines (limit: ${LIMIT})"
    echo "::error file=$file::File has $line_count lines (limit: ${LIMIT}). ${hint}"
    FAILURES+=("$file")
  elif [ "$line_count" -gt "$WARN_THRESHOLD" ]; then
    echo "WARNING: $file has $line_count lines (approaching limit of ${LIMIT}, warning threshold: ${WARN_THRESHOLD})"
    echo "::warning file=$file::File has $line_count lines (approaching limit of ${LIMIT}). ${hint}"
    WARNINGS+=("$file")
  fi
}

echo "Checking that JavaScript and Markdown files are under ${LIMIT} lines..."

# Walk every tracked JavaScript and Markdown file. node_modules is build
# output, and docs/case-studies/*/data holds verbatim external sources
# (see header note and eslint.config.js ignores).
while IFS= read -r -d '' file; do
  check_file "$file"
done < <(find . -type f \
  \( -name "*.js" -o -name "*.mjs" -o -name "*.cjs" -o -name "*.md" \) \
  -not -path "*/node_modules/*" \
  -not -path "./docs/case-studies/*/data/*" \
  -print0)

echo ""
echo "Checking that .github/workflows/release.yml is under ${LIMIT} lines..."
RELEASE_YML=".github/workflows/release.yml"
if [ -f "$RELEASE_YML" ]; then
  check_file "$RELEASE_YML" "Move inline scripts to the ./scripts/ folder to reduce file size."
else
  echo "WARNING: $RELEASE_YML not found, skipping"
fi

echo ""
if [ "${#WARNINGS[@]}" -gt 0 ]; then
  echo "The following files are approaching the ${LIMIT} line limit (>${WARN_THRESHOLD} lines):"
  printf '  %s\n' "${WARNINGS[@]}"
  echo ""
  echo "Consider extracting code to prevent concurrent PR merge limit violations."
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
