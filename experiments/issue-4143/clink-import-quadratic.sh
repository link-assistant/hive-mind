#!/usr/bin/env bash
# Issue #4143: time of one `clink --in` and `--out` (no --transactions) on
# tmpfs as the number of named lines grows; doubling the input should double
# the time. FLAGS="--indexed-lookups" enables link-cli's opt-in name index
# (link-cli#110), which removes the scans of the names store.
# Usage: CLINK=/path/to/clink [FLAGS=...] experiments/issue-4143/clink-import-quadratic.sh [n...]
set -u
C=${CLINK:-clink}
FLAGS=${FLAGS:-}
D=$(mktemp -d -p /dev/shm 2>/dev/null || mktemp -d)
echo "$($C --version) flags='$FLAGS'"
for n in ${@:-100 200 400 800}; do
  python3 -c "
for i in range($n): print(f'(k{i}: a{i} b{i})')" > "$D/in.lino"
  rm -f "$D"/s.*
  s=$(date +%s%N)
  $C --db "$D/s.links" --in "$D/in.lino" $FLAGS
  e=$(( ($(date +%s%N) - s) / 1000000 ))
  s=$(date +%s%N)
  $C --db "$D/s.links" --out "$D/out.lino" $FLAGS
  o=$(( ($(date +%s%N) - s) / 1000000 ))
  echo "named_lines=$n links=$(wc -l < "$D/out.lino") import_ms=$e export_ms=$o"
done
rm -rf "$D"
