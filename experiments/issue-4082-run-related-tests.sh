#!/usr/bin/env bash
# Runs the existing tests that touch the watch loop / feedback code changed for issue #4082.
cd "$(dirname "$0")/.."
out=ci-logs/issue-4082-related
mkdir -p "$out"
: > "$out/summary.txt"
for t in "$@"; do
  name=$(basename "$t")
  if timeout 300 node --max-old-space-size=512 "$t" > "$out/$name.log" 2>&1; then echo "PASS $t" >> "$out/summary.txt"; else echo "FAIL($?) $t" >> "$out/summary.txt"; fi
done
