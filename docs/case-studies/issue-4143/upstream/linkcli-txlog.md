## Summary

With `--transactions`, every `clink` call gets slower as writes accumulate, even when the live store stays the same size. The transitions store (`<db>.transitions.links` plus `<db>.transitions.names.links`) grows with every write. In the run below the names file grows by about 4.7 KB per write, and `--retention sized:64` does not bound it. The transitions store appears to be a regular `LinkStorage`, loaded and saved in full on every invocation: the save path writes every link and name to `<path>.saving` and then renames it. So the cost of each call grows with the history. A small state file rewritten every few seconds takes over 4 s per write after 40 writes.

The four sizes printed are `s.links`, `s.names.links`, `s.transitions.links` and `s.transitions.names.links`.

## Reproduction

```bash
#!/usr/bin/env bash
# usage: perf.sh <dir> <writes> [clink args...]
D=$1; N=$2; shift 2; mkdir -p "$D"; C=${CLINK:-clink}
for i in $(seq 1 "$N"); do
  echo "(hive_mind_state: hive_mind_state (~obj ((hb ~b64_$(printf %06d $i | base64 | tr -d '=')) ((k v$((i%3))) ~end))))" > "$D/in.lino"
  s=$(date +%s%N); $C --db "$D/s.links" --in "$D/in.lino" "$@" >/dev/null || break
  e=$(( ($(date +%s%N)-s)/1000000 ))
  if [ $((i % 10)) -eq 0 ] || [ $i -le 3 ]; then echo "write $i: ${e}ms sizes: $(stat -c '%s' $D/*.links | tr '\n' ' ')"; fi
done
```

`perf.sh /tmp/tx 40 --transactions --retention sized:64` with clink 3.1.2:

```
write 1: 1393ms sizes: 102 2213 720 24231
write 2: 800ms sizes: 175 2385 1062 33010
write 3: 565ms sizes: 248 2578 1422 40833
write 10: 868ms sizes: 542 3238 2892 72907
write 20: 1413ms sizes: 962 4133 4992 117582
write 30: 2849ms sizes: 1460 5009 7092 161288
write 40: 4076ms sizes: 1970 5904 9192 208949
```

The same loop without `--transactions` stays at 12–23 ms per write:

```
write 1: 14ms sizes: 102 2213
write 20: 14ms sizes: 962 4133
```

## Expected

The cost of a write depends on the size of the change and of the live store, not on how many writes came before. A retention policy bounds the marker log on disk.

## Workaround

hive-mind rotates the transitions files once they pass 64 KiB (`HIVE_MIND_STATE_LINKS_LOG_MAX_BYTES`). It renames them aside before the next `--transactions` write, so each write replays at most one segment. A 40-run concurrent fuzz passed with no failures at both 64 KiB and 256 KiB (link-assistant/hive-mind#4143).

## Suggested fix

1. Store the transitions as an append-only log, for example the `FileTransitionLog` already in `rust/src/transactions/log.rs`. Each invocation then appends its own transitions instead of loading and rewriting the whole history.
2. Make `--retention sized:<n>` (and the other policies) also compact the names file of the transitions store, so the files stay bounded on disk.
3. Add a benchmark to CI that fails when write N+100 takes much longer than write N on a constant-size store.
