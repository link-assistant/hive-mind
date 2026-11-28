#!/usr/bin/env bash
# CLINK=/path/to/clink bash experiments/issue-4143/clink-3.3.3-recheck.sh
set -euo pipefail

clink=${CLINK:-clink}
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
ulimit -s 2048
"$clink" --version

printf '(first: first first)\n(second: second second)\n' > "$dir/batch.lino"
"$clink" --db "$dir/batch.links" --in "$dir/batch.lino" --transactions --indexed-lookups > /dev/null
"$clink" --db "$dir/batch.links" --log > "$dir/batch.log"
awk -F '\t' '{ tx[$4]++ } END { print "transaction rows=" NR ", transaction IDs=" length(tx); exit !(NR >= 2 && length(tx) == 1 && !("" in tx)) }' "$dir/batch.log"

python3 - <<'PY' > "$dir/deep.lino"
nested = "leaf"
for _ in range(65):
    nested = f"(branch {nested})"
print(f"(root: id {nested})")
PY
if "$clink" --db "$dir/deep.links" --in "$dir/deep.lino" > "$dir/limit.log" 2>&1; then
  echo 'Expected max-depth 64 to reject the nested input' >&2
  exit 1
fi
rg -i 'depth.*64|64.*depth' "$dir/limit.log" | head -1
"$clink" --db "$dir/deep.links" --in "$dir/deep.lino" --in-max-depth 72 > /dev/null
echo 'Import succeeded with --in-max-depth 72'

pids=()
for i in {1..12}; do
  printf '(w%s: w%s w%s)\n' "$i" "$i" "$i" > "$dir/w$i.lino"
  "$clink" --db "$dir/shared.links" --in "$dir/w$i.lino" --lock pid --transactions --indexed-lookups > /dev/null &
  pids+=("$!")
done
successes=0
for pid in "${pids[@]}"; do
  if wait "$pid"; then successes=$((successes + 1)); fi
done
"$clink" --db "$dir/shared.links" --out "$dir/shared.lino" --lock pid > /dev/null
present=$(rg -c '^\(w[0-9]+:' "$dir/shared.lino")
echo "PID lock: writers=12 exited_ok=$successes links_present=$present"
test "$successes" -eq 12
test "$present" -eq 12

# Simulate a process that exited before it could clean up its PID lock.
sleep 0.1 &
gone=$!
wait "$gone"
mkdir "$dir/shared.links.lock.d"
namespace=$(readlink /proc/self/ns/pid)
printf 'pid=%s\nhost=%s\npid_namespace=%s\n' "$gone" "$(hostname)" "$namespace" > "$dir/shared.links.lock.d/owner"
"$clink" --db "$dir/shared.links" --in "$dir/w1.lino" --lock pid --lock-timeout 1000 > /dev/null
test ! -d "$dir/shared.links.lock.d"
echo 'PID lock: recovered immediately from a dead owner'
