#!/usr/bin/env python3
"""Verify actual native corrupt-database backup without losing unrelated data."""
import argparse
import hashlib
import importlib.util
import itertools
import json
from pathlib import Path
import sqlite3
import tempfile

spec = importlib.util.spec_from_file_location(
    "native_compression_probe", Path(__file__).with_name("probe-codex-native-compression.py")
)
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)

BEFORE = "Synthetic section before corrupt database recovery"
AFTER = "Synthetic section after corrupt database recovery"
CORRUPT = b"Synthetic invalid SQLite database for bounded native recovery.\n" * 64


def run(binary, root, selected):
    canonical = root / "canonical"
    canonical.mkdir(mode=0o700)
    for entry in ("sessions", "archived_sessions", "thread-writer-locks"):
        (canonical / entry).mkdir(mode=0o700)
    (canonical / "rollout-maintenance.lock").touch(mode=0o600)
    before = native.Native(binary, root, canonical, "configuration-before", True,
                           path_selected=selected)
    try:
        before.initialize()
        before.request("threadSection/create", {"name": BEFORE})
        names = before.request("threadSection/list", {"limit": 10})
        assert BEFORE in [item["name"] for item in names["data"]]
    finally:
        before.stop()
    database = canonical / "state_5.sqlite"
    unrelated = canonical / "logs_2.sqlite"
    # All native processes are reaped before these bounded fixture changes.
    with sqlite3.connect(database, timeout=2) as connection:
        assert connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0] == 0
    with sqlite3.connect(unrelated, timeout=2) as connection:
        connection.execute("CREATE TABLE synthetic_recovery_sentinel(value TEXT)")
        connection.execute("INSERT INTO synthetic_recovery_sentinel VALUES ('retained')")
    unrelated.chmod(0o600)
    database.write_bytes(CORRUPT)
    after = native.Native(binary, root, canonical, "configuration-after", True,
                          path_selected=selected)
    try:
        after.initialize()
        after.request("threadSection/create", {"name": AFTER})
        names = after.request("threadSection/list", {"limit": 10})
        names = [item["name"] for item in names["data"]]
        assert AFTER in names and BEFORE not in names, "Native recovery must use the rebuilt database."
    finally:
        after.stop()
    assert len(list(itertools.islice(canonical.rglob("*"), 101))) <= 100
    backups = list((canonical / "db-backups").glob("*/state_5.sqlite"))
    assert len(backups) == 1 and backups[0].stat().st_size == len(CORRUPT)
    assert backups[0].read_bytes() == CORRUPT, "The exact corrupt input must be retained for diagnosis."
    with sqlite3.connect(unrelated, timeout=2) as connection:
        assert connection.execute("SELECT value FROM synthetic_recovery_sentinel").fetchall() == [("retained",)]
    with sqlite3.connect(database, timeout=2) as connection:
        assert connection.execute("PRAGMA quick_check").fetchone() == ("ok",)
        names = [row[0] for row in connection.execute("SELECT name FROM thread_sections LIMIT 100")]
        # Native recovery also creates its built-in sections.
        assert AFTER in names and BEFORE not in names, names
    return {"selected": selected, "actualNativeRecovery": True,
            "corruptBytesBackedUp": True, "unrelatedDatabasePreserved": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("--without-path-selector", action="store_true")
    args = parser.parse_args()
    assert args.binary.is_absolute() and args.binary.is_file()
    with args.binary.open("rb") as stream:
        print(json.dumps({"binarySha256": hashlib.file_digest(stream, "sha256").hexdigest()}), flush=True)
    with tempfile.TemporaryDirectory(prefix="hive-native-sqlite-recovery-") as temporary:
        print(json.dumps(run(args.binary, Path(temporary), not args.without_path_selector)), flush=True)


if __name__ == "__main__":
    main()
