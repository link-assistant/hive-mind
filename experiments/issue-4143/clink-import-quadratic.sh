#!/usr/bin/env bash
# Issue #4143: time of one `clink --in` (no --transactions) on tmpfs as the
# number of named lines grows; doubling the input should double the time.
# Usage: CLINK=/path/to/clink experiments/issue-4143/clink-import-quadratic.sh [n...]
set -u
C=${CLINK:-clink}
D=$(mktemp -d -p /dev/shm 2>/dev/null || mktemp -d)
echo "$($C --version) dir=$D"
for n in ${@:-100 200 400 800}; do
  python3 -c "
for i in range($n): print(f'(k{i}: a{i} b{i})')" > "$D/in.lino"
  rm -f "$D"/s.*
  s=$(date +%s%N)
  $C --db "$D/s.links" --in "$D/in.lino"
  e=$(( ($(date +%s%N) - s) / 1000000 ))
  $C --db "$D/s.links" --out "$D/out.lino"
  echo "named_lines=$n links=$(wc -l < "$D/out.lino") import_ms=$e"
done
rm -rf "$D"
