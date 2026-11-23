#!/usr/bin/env bash
# Run the sanitizer-related test files one by one; logs and a summary go to $1.
# Usage: experiments/issue-3739-run-sanitizer-tests.sh /tmp/out [test-list-file]
# No V8 heap flag: worker threads inherit it and it overrides the log sanitize
# worker's resourceLimits, which breaks the #2189 containment test.
set -u
out=${1:-/tmp/sanitizer-tests}; list=${2:-experiments/issue-3739-sanitizer-tests.txt}
mkdir -p "$out"; : > "$out/summary.txt"
status=0
while read -r t; do
  [ -z "$t" ] && continue
  node "tests/$t" < /dev/null > "$out/$t.log" 2>&1
  result=$?
  echo "$result $t" >> "$out/summary.txt"
  [ "$result" -eq 0 ] || status=1
done < "$list"
cat "$out/summary.txt"
exit "$status"
