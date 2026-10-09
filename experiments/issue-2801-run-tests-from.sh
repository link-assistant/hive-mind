#!/usr/bin/env bash
# Run the default test suite from line N of `run-tests.mjs --list` onward, 4 at a time, and list the failures.
# Usage: experiments/issue-2801-run-tests-from.sh 408 /tmp/out-dir
start=${1:-1}; out=${2:-/tmp/run-tests-from}; mkdir -p "$out"
node scripts/run-tests.mjs --suite default --list | tail -n +"$start" |
  xargs -P 4 -I{} sh -c 'f="{}"; timeout 300 node "$f" > "'"$out"'/$(echo "$f" | tr / _).log" 2>&1 || echo "FAIL $? $f"' > "$out/failures.txt"
echo "done $(wc -l < "$out/failures.txt") failures"; cat "$out/failures.txt"
