## Summary

With `--transactions`, one `clink --in file.lino` call commits **one transaction per created link**. Each commit runs a full store save (temp file plus rename) and an fsync of the journal. As a result:

1. **Slow imports:** an import with `--transactions` takes about 50× longer than the same import without it on a normal disk. Here 100 lines take 19.3 s instead of 0.38 s.
2. **Non-atomic imports:** a crash part-way through an import leaves a partial import behind. After `kill -9`, 30 of 100 lines were in the store. Each auto-committed link is durable on its own, so the import is not all-or-nothing.

This affects 3.2.1, the latest release (rust-v3.2.1, `2bbd35d`). 3.1.2 has the same per-link commit and is slower still (158 s for 100 lines). The 3.2.0 journal (#195) made each commit cheaper, but every link still gets its own commit.

`HOW-IT-WORKS.md` says a write costs one append. For `--in`, each link pays a full store rewrite and an fsync.

## Reproduction

```bash
#!/usr/bin/env bash
# CLINK=/path/to/clink ./repro.sh [dir]   (pass a tmpfs dir to see the cost without fsync)
C=${CLINK:-clink}; BASE=${1:-$(mktemp -d)}
for n in 1 10 50 100; do
  python3 -c "
for i in range($n): print(f'(k{i}: a{i} b{i})')" > "$BASE/in.lino"
  for mode in "" "--transactions --retention sized:64"; do
    rm -f "$BASE"/s.*
    s=$(date +%s%N)
    $C --db "$BASE/s.links" --in "$BASE/in.lino" $mode --trace > "$BASE/trace" 2>&1
    e=$(( ($(date +%s%N) - s) / 1000000 ))
    echo "lines=$n [${mode:-no transactions}] ${e}ms store_saves=$(grep -c '\] Saved' "$BASE/trace") commits=$(grep -c 'Committed tx' "$BASE/trace")"
  done
done
```

### clink 3.2.1, overlay disk

| Lines | Without `--transactions` | With `--transactions` | Store saves (without/with) | Commits (with) |
|---:|---:|---:|---:|---:|
| 1 | 12 ms | 152 ms | 4 / 26 | 10 |
| 10 | 29 ms | 1835 ms | 4 / 206 | 100 |
| 50 | 163 ms | 9307 ms | 4 / 1006 | 500 |
| 100 | 384 ms | 19267 ms | 4 / 2006 | 1000 |

### The same run on tmpfs (`/dev/shm`)

| Lines | Without | With |
|---:|---:|---:|
| 10 | 21 ms | 63 ms |
| 100 | 299 ms | 1569 ms |

On tmpfs the gap shrinks a lot, which points at fsync and file IO as the main cost. The work also grows with the store size, because every commit saves the whole store.

### clink 3.1.2 baseline

| Lines | With `--transactions` |
|---:|---:|
| 10 | 5490 ms |
| 50 | 44884 ms |
| 100 | 158555 ms |

### Crash atomicity

```bash
python3 -c "
for i in range(100): print(f'(k{i}: a{i} b{i})')" > in.lino
clink --db s.links --in in.lino --transactions --retention sized:64 & P=$!
sleep 6; kill -9 $P
clink --db s.links --out out.lino --transactions; grep -c '^(k' out.lino
# 30   (expected 0 or 100)
```

Re-importing an unchanged file commits nothing (0 commits, 40 ms for 20 lines), and changing one line costs 4 commits. So the cost lands on first imports and on any import that creates many links.

## Root cause (rust-v3.2.1, `2bbd35d`)

- `rust/src/main.rs`, `import_inputs`, calls `import_lino_file` and never opens an explicit transaction around the import.
- `rust/src/lino_database_input.rs:11`: `import_lino_file`/`import_lino_text` import link by link and only call `save()` at the end.
- `rust/src/transactions/mod.rs` (~658): `ensure_open_transaction` opens an `auto_commit: true` transaction for each write when none is open, and that transaction commits after that one write.
- `rust/src/transactions/commit.rs`: `commit_current` → `finish_commit_checkpoint` runs:
  - `self.inner.flush()`, a full `LinkStorage::save` (`link_storage.rs:367`, temp file plus rename);
  - `mark_applied`;
  - `flush_log`, i.e. `sync_all` on the journal (`journal_file.rs:135`);
  - `enforce_retention`.

  All of this runs for every single link.

`--commit-mode async` gives the same timings.

## Suggested fix

Run each CLI invocation (one `--in` import, or one query/`--update`) inside a single explicit transaction. Call `begin_transaction()` before `import_lino_file` and `commit()` after it, and roll back on error. Then one import is one atomic commit: one store save and one journal fsync. That matches the "a write costs one append" model in `HOW-IT-WORKS.md`, and the import becomes all-or-nothing when the process dies mid-import, which completes #129 for crashes.

A regression test could:
- count `Committed tx` in `--trace` for a 10-line `--in` with `--transactions` (expect 1);
- kill the process mid-import and expect 0 or N lines.

## Workaround

hive-mind ([hive-mind#4143](https://github.com/link-assistant/hive-mind/issues/4143)) imports a full tree without `--transactions` into a fresh store and renames it over the old one. It does this on a first write and on a rebuild. That gives atomic replacement and avoids the per-link commit. It keeps `--transactions` only for incremental writes, which create just a few links each.

