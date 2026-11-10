#!/usr/bin/env bash
# Run the sanitizer-related test files one by one; logs and a summary go to $1.
# Usage: experiments/issue-3739-run-sanitizer-tests.sh /tmp/out [test-list-file]
set -u
out=${1:-/tmp/sanitizer-tests}; list=${2:-experiments/issue-3739-sanitizer-tests.txt}
mkdir -p "$out"; : > "$out/summary.txt"
while read -r t; do
  [ -z "$t" ] && continue
  timeout 600 node --max-old-space-size=2048 "tests/$t" < /dev/null > "$out/$t.log" 2>&1
  echo "$? $t" >> "$out/summary.txt"
done < "$list"
cat "$out/summary.txt"
