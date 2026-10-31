#!/usr/bin/env python3
"""Actual native metadata must not open another authority through a DB alias."""
import argparse
import hashlib
import importlib.util
import os
from pathlib import Path
import sqlite3
import tempfile

spec = importlib.util.spec_from_file_location(
    "sqlite_authority_probe", Path(__file__).with_name("probe-codex-native-sqlite-authority.py")
)
authority = importlib.util.module_from_spec(spec)
spec.loader.exec_module(authority)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("binary", type=Path)
    parser.add_argument("--alias", choices=["symlink", "hardlink"], default="symlink")
    parser.add_argument("--expect-follow", action="store_true")
    args = parser.parse_args()
    assert args.binary.is_absolute() and args.binary.is_file()
    with tempfile.TemporaryDirectory(prefix="hive-codex-sqlite-binding-") as temporary:
        root = Path(temporary)
        baseline, refused = authority.exercise(args.binary, root / "baseline", None)
        assert not refused and baseline["canonical"] and not baseline["private"] and not baseline["redirected"]
        print("PASS: healthy actual native metadata opens only canonical SQLite databases.", flush=True)

        evidence = {}

        def prepare(canonical, private, redirected):
            target = redirected / "outside.sqlite"
            with sqlite3.connect(target) as connection:
                connection.execute("CREATE TABLE hive_binding_probe (value TEXT)")
                connection.execute("INSERT INTO hive_binding_probe VALUES ('preserved')")
            os.chmod(target, 0o600)
            evidence["target"] = target
            evidence["digest"] = hashlib.sha256(target.read_bytes()).digest()
            evidence["inode"] = target.stat().st_ino
            selected = canonical / "state_5.sqlite"
            if args.alias == "symlink":
                selected.symlink_to(target)
            else:
                os.link(target, selected)

        _, refused = authority.exercise(args.binary, root / "alias", None, prepare)
        target = evidence["target"]
        assert target.stat().st_ino == evidence["inode"], "The native control replaced existing outside evidence."
        with sqlite3.connect(f"file:{target}?mode=ro", uri=True) as connection:
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            assert connection.execute("SELECT value FROM hive_binding_probe").fetchall() == [("preserved",)]
        if args.expect_follow:
            assert not refused and "_sqlx_migrations" in tables, "The negative control must prove actual native migrations reached the aliased database."
            print(f"PASS: the actual CLI follows a {args.alias} and migrates the outside SQLite authority.", flush=True)
        else:
            assert refused, "An aliased native database must refuse explicitly before SQLite opens."
            assert tables == {"hive_binding_probe"}, "Native SQLite modified an unadmitted database."
            assert hashlib.sha256(target.read_bytes()).digest() == evidence["digest"], "Refusal changed existing outside evidence."
            print(f"PASS: the actual CLI refuses a {args.alias} before changing outside SQLite evidence.", flush=True)


if __name__ == "__main__":
    main()
