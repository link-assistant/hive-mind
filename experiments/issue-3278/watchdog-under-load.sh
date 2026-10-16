#!/bin/sh
# Issue #3278: run the event-loop watchdog test while every core is busy, the
# way the parallel default suite loads a CI runner. Busy loops stop after 90 s.
# Usage: experiments/issue-3278/watchdog-under-load.sh [runs] [busy-processes-per-core]
runs=${1:-3}
per_core=${2:-2}
cores=$(nproc)
pass=0
for run in $(seq "$runs"); do
  pids=''
  for _ in $(seq $((cores * per_core))); do
    timeout 90 node -e 'for (;;) {}' &
    pids="$pids $!"
  done
  if node --test tests/telegram-event-loop-watchdog-3278.test.mjs > "/tmp/watchdog-load-$run.log" 2>&1; then
    pass=$((pass + 1)); echo "run $run: pass"
  else
    echo "run $run: FAIL $(grep -o "AssertionError[^:]*: [^(;]*" "/tmp/watchdog-load-$run.log" | head -1)"
  fi
  kill $pids 2>/dev/null; wait 2>/dev/null
done
echo "$pass/$runs passed"
