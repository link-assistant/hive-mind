#!/usr/bin/env bash
# Measure the load-sensitivity of tests/test-graceful-shutdown-waits-1823.mjs,
# Suite 5, assertion "non-detached child IS interrupted by the group SIGINT".
#
# Why this exists
# ---------------
# The assertion failed once during a full-suite run on the #2233 branch. The
# branch adds only two new files under scripts/ and nothing under src/, and the
# test loads exactly one repository file (src/exit-handler.lib.mjs), so it
# cannot be a regression from the branch. This probe demonstrates the actual
# cause, which is a race inside the test:
#
#   the harness prints READY as soon as spawn() returns, but the child is still
#   booting node. The test waits a fixed 150 ms and then SIGINTs the group. If
#   the child has not yet executed `process.on('SIGINT', ...)`, the default
#   disposition kills it, the marker file is never written, and the harness
#   reports CHILD_CLOSED:null instead of CHILD_CLOSED:1.
#
# Under CPU contention node's boot exceeds 150 ms and the assertion fails.
#
# Usage: probe-graceful-shutdown-race.sh <repo-dir> <runs> [load-workers]
set -u
repo="${1:?repo dir}"; runs="${2:-5}"; load="${3:-0}"

pids=()
for ((i = 0; i < load; i++)); do
  bash -c 'while :; do :; done' & pids+=("$!")
done
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null; done; }
trap cleanup EXIT

echo "repo=$repo commit=$(git -C "$repo" rev-parse --short HEAD) runs=$runs load-workers=$load"
pass=0; fail=0
for ((i = 1; i <= runs; i++)); do
  out="$(cd "$repo" && node tests/test-graceful-shutdown-waits-1823.mjs 2>&1)"
  if grep -q 'non-detached child IS interrupted' <<<"$out" && ! grep -q '❌ FAIL: non-detached child IS interrupted' <<<"$out"; then
    pass=$((pass + 1)); echo "  run $i: PASS"
  else
    fail=$((fail + 1))
    echo "  run $i: FAIL  $(grep -A1 '❌ FAIL: non-detached' <<<"$out" | tail -1 | sed 's/^ *//')"
  fi
done
echo "result: $pass passed, $fail failed"
