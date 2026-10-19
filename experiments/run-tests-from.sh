#!/usr/bin/env bash
# Run the default suite from file N onward (1-based), continuing past failures.
# Usage: experiments/run-tests-from.sh N > log
start=${1:-1}
i=0; fails=()
for f in $(node scripts/run-tests.mjs --suite default --list); do
  i=$((i+1)); [ "$i" -lt "$start" ] && continue
  echo "[$i] $f"
  timeout 300 node "$f" >/tmp/rt-one.log 2>&1 || { fails+=("$f"); echo "FAILED: $f"; tail -40 /tmp/rt-one.log; }
done
echo "DONE: ${#fails[@]} failed: ${fails[*]}"
