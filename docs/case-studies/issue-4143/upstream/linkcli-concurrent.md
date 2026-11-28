## Summary

Several `clink` processes writing the same store at the same time lose updates or fail. `clink` 3.1.2 (rust-v3.1.2, 6934654) takes no lock. Every save writes to the same fixed temporary file, `<db>.saving` (`saving_path` in `rust/src/link_storage.rs`), and then renames it over the database. Two writers therefore overwrite each other's temporary file, and one of them fails with `Failed to replace database` when the other has already renamed it away. A writer that exits 0 can still have its links dropped, because the next writer read the store before that save and writes back its own copy (a last-writer-wins race).

`FileLock` / `DoubletsStorage::lock_exclusive` exists in `rust/src/storage/lock.rs`, but the CLI save path does not use it.

## Reproduction

```bash
#!/usr/bin/env bash
# 12 writers, each adds one link to the same store
CLINK=${CLINK:-clink}; WRITERS=${WRITERS:-12}; DIR=$(mktemp -d)
for i in $(seq 1 "$WRITERS"); do
  ( echo "(w$i: w$i w$i)" > "$DIR/in$i.lino"
    if $CLINK --db "$DIR/s.links" --in "$DIR/in$i.lino" >/dev/null 2>"$DIR/err$i.txt"; then echo ok > "$DIR/status$i"; else echo failed > "$DIR/status$i"; fi ) &
done; wait
$CLINK --db "$DIR/s.links" --out "$DIR/out.lino" >/dev/null 2>&1
lost=0; for i in $(seq 1 "$WRITERS"); do grep -q ok "$DIR/status$i" && ! grep -q "^(w$i:" "$DIR/out.lino" && lost=$((lost+1)); done
echo "writers=$WRITERS exited_ok=$(grep -l ok "$DIR"/status* | wc -l) links_present=$(grep -c '^(w' "$DIR/out.lino") lost_after_success=$lost"
grep -h . "$DIR"/err*.txt | sort | uniq -c
```

Output with clink 3.1.2 on Linux (ext4):

```
writers=12 exited_ok=8 links_present=2 lost_after_success=6
      4     No such file or directory (os error 2)
      3 Error: Failed to replace database: /tmp/tmp.MAUdMgFrTj/s.links
      1 Error: Failed to replace database: /tmp/tmp.MAUdMgFrTj/s.names.links
```

8 of the 12 writers exit 0, but only 2 links are left. 6 successful writes are lost.

## Expected

Each successful `clink` invocation is durable. Concurrent invocations are serialized, or the ones that cannot get access fail with a clear "store is locked" error, and none exits 0 without its write.

## Workaround

In hive-mind, all `clink` calls on a store run under an external lock: a `mkdir` lock directory whose owner file records the PID, host and PID namespace, so the lock is released as soon as the owner process is gone. The temporary input and output files are also per process. See link-assistant/hive-mind#4143 (`src/state-lock.lib.mjs`, `src/bot-state-links.lib.mjs`).

## Suggested fix

1. Make the CLI take `FileLock` (exclusive for writes, shared for `--out`/reads) on `<db>.lock` for the whole read-modify-write. Wait for it with a configurable timeout (for example `--lock-timeout`), and add `--no-lock` for callers that serialize access themselves.
2. Make the temporary file unique per process (`<db>.<pid>.<random>.saving`), or create it with `O_EXCL`, so writers can never share it.
3. Add a regression test that runs N concurrent `--in` imports and checks that every successful exit is present in `--out`.
