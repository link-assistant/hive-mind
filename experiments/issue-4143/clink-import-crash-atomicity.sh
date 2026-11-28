#!/usr/bin/env bash
# Issue #4143: is one `clink --in ... --transactions` import atomic if the
# process dies part-way? Kills the import after KILL_AFTER seconds and counts
# how many of the input lines survived. Usage:
#   CLINK=/path/to/clink experiments/issue-4143/clink-import-crash-atomicity.sh
set -u
C=${CLINK:-clink}
D=$(mktemp -d)
N=${LINES:-100}
python3 -c "
for i in range($N): print(f'(k{i}: a{i} b{i})')" > "$D/in.lino"
echo "$($C --version) lines=$N"
$C --db "$D/s.links" --in "$D/in.lino" --transactions --retention sized:64 &
P=$!
sleep "${KILL_AFTER:-6}"
kill -9 "$P" 2>/dev/null && echo "killed import after ${KILL_AFTER:-6}s" || echo "import finished before the kill"
wait "$P" 2>/dev/null
$C --db "$D/s.links" --out "$D/out.lino" --transactions > /dev/null 2>&1
echo "input lines present after reopen: $(grep -c '^(k' "$D/out.lino") of $N (atomic would be 0 or $N)"
rm -rf "$D"
