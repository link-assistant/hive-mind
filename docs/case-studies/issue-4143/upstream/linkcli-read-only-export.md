# Link CLI export on a read-only mount

[Upstream report](https://github.com/link-foundation/link-cli/issues/210)

`clink 3.3.3` rewrites the database and name store for a plain `--out`. It fails if the database lives in a read-only directory even when the requested output is writable. The input files' mtimes change in a writable directory.

### Reproduction

Run as a normal user with Link CLI 3.3.3 on Linux.

```bash
work=$(mktemp -d)
mkdir "$work/state"
printf '(root: root root)\n' > "$work/input.lino"
clink --db "$work/state/bot.links" --in "$work/input.lino"
stat -c '%n %y' "$work/state/"*.links
clink --db "$work/state/bot.links" --out "$work/before.lino"
stat -c '%n %y' "$work/state/"*.links
chmod 500 "$work/state"
clink --db "$work/state/bot.links" --out "$work/after.lino"
chmod 700 "$work/state"
```

The `--out` in the read-only directory exits 1 with `Permission denied (os error 13)` while creating `bot.links.<id>.saving`. Both input stores have new modification times after the export in the writable directory. Twelve parallel exports against the writable directory all succeeded in a separate probe.

### Expected behavior

An export without transaction replay, import, or another mutation opens the existing store under a shared lock and only writes the designated output. It succeeds when the existing database and names file are readable and the output is writable.

### Workaround

Copy the data and names files to a private writable directory and export that copy. An application that has a parallel text mirror can compare the copied snapshot with the text store and retry when they differ. Hive Mind needs this for token-free status from a read-only host mount. See https://github.com/link-assistant/hive-mind/pull/4146.

### Suggested implementation

Plain export currently reaches the unconditional `storage.save()` at the end of `run()` in `src/main.rs`, even though `lock_mode()` already classifies the invocation as read-only. Skip saving for that case when there are no initialization or recovery changes. Ensure the shared-lock path can open existing lock state without requesting directory write access. Add a regression that checks existing file mtimes and tests a store directory mounted or chmodded read-only, while writing the export to a separate directory.
