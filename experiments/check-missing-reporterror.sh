#!/bin/bash

echo "=== Files with catch blocks that may need reportError ==="
echo

for file in src/solve.*.lib.mjs; do
  basename_file=$(basename "$file")

  # Count catch blocks
  catch_count=$(grep -c "} catch" "$file")

  # Count reportError calls
  report_count=$(grep -c "reportError(" "$file")

  # Subtract 1 from report_count to account for the import statement
  report_count=$((report_count - 1))

  if [ $catch_count -gt $report_count ]; then
    echo "$basename_file: $catch_count catch blocks, $report_count reportError calls"
    echo "  Missing: $((catch_count - report_count))"
    echo
  fi
done