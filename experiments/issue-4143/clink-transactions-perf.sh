#!/usr/bin/env bash
# usage: perf.sh <dir> <writes> <extra clink args...>
D=$1; N=$2; shift 2; mkdir -p "$D"; C=${CLINK:-/tmp/clink-rust/bin/clink}
for i in $(seq 1 "$N"); do
  echo "(hive_mind_state: hive_mind_state (~obj ((hb ~b64_$(printf %06d $i | base64 | tr -d '=')) ((k v$((i%3))) ~end))))" > "$D/in.lino"
  s=$(date +%s%N); timeout 60 $C --db "$D/s.links" --in "$D/in.lino" "$@" >/dev/null 2>"$D/err" || { echo "fail $i: $(head -c 200 $D/err)"; break; }; e=$(( ($(date +%s%N)-s)/1000000 ))
  if [ $((i % 10)) -eq 0 ] || [ $i -le 3 ]; then echo "write $i: ${e}ms sizes: $(stat -c '%s' $D/*.links | tr '\n' ' ')"; fi
done
