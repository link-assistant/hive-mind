#!/usr/bin/env bash
# Issue #4143: how the cost of one `clink --in` grows with the number of links
# it creates, with and without --transactions, and how many transactions one
# import commits (from --trace). Usage:
#   CLINK=/path/to/clink experiments/issue-4143/clink-import-scaling.sh [dir]
# Pass a tmpfs dir (/dev/shm/...) to see the cost without fsync.
set -u
C=${CLINK:-clink}
BASE=${1:-$(mktemp -d)}
mkdir -p "$BASE"
echo "$($C --version) dir=$BASE ($(df -T "$BASE" | awk 'NR==2{print $2}'))"
for n in 1 10 50 100; do
  python3 -c "
for i in range($n): print(f'(k{i}: a{i} b{i})')" > "$BASE/in.lino"
  for mode in "" "--transactions --retention sized:64"; do
    rm -f "$BASE"/s.*
    s=$(date +%s%N)
    $C --db "$BASE/s.links" --in "$BASE/in.lino" $mode --trace > "$BASE/trace" 2>&1 || head -c 300 "$BASE/trace"
    e=$(( ($(date +%s%N) - s) / 1000000 ))
    echo "lines=$n [${mode:-no transactions}] ${e}ms links_created=$(grep -c 'Created link' "$BASE/trace") store_saves=$(grep -c '\] Saved' "$BASE/trace") commits=$(grep -c 'Committed tx' "$BASE/trace")"
  done
done
rm -f "$BASE"/s.* "$BASE/trace" "$BASE/in.lino"
