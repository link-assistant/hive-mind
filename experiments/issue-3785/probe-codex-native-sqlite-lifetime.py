#!/usr/bin/env python3
"""Actual native SQLite reads/writes after authority replacement, without a provider.

Default mode requires refusal. --expect-retired is the explicit failing-native
control, not an acceptance gate. Reuse the bounded app-server/process fixture.
"""
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

BEFORE = "Synthetic SQLite section before authority replacement"
AFTER = "Synthetic SQLite section after authority replacement"
REFUSAL = "Canonical SQLite configuration is unavailable or unsafe."


def names(database):
    if not database.exists():
        return []
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True, timeout=2) as connection:
        return [row[0] for row in connection.execute("SELECT name FROM thread_sections")]


def run(binary, root, case):
    canonical = root / "canonical"
    canonical.mkdir(mode=0o700)
    for entry in ("sessions", "archived_sessions", "thread-writer-locks"):
        (canonical / entry).mkdir(mode=0o700)
    (canonical / "rollout-maintenance.lock").touch(mode=0o600)
    child = native.Native(binary, root, canonical, "configuration", True)
    refused = None
    listed_before = listed_after = None
    try:
        child.initialize()
        child.request("threadSection/create", {"name": BEFORE})
        healthy = child.request("threadSection/list", {"limit": 10})
        assert BEFORE in [item["name"] for item in healthy["data"]], \
            "Healthy actual native SQLite section writes must be discoverable."
        database = canonical / "state_5.sqlite"
        assert database.is_file(), "Require the actual initialized native SQLite database."
        initial = database.stat()
        if case == "directory":
            retired = root / "retired"
            canonical.rename(retired)
            canonical.mkdir(mode=0o700)
            retired_database = retired / database.name
        else:
            replacement = canonical / "replacement.sqlite"
            with sqlite3.connect(database, timeout=2) as source, sqlite3.connect(replacement, timeout=2) as target:
                source.backup(target)
            replacement.chmod(0o600)
            retired_database = canonical / "retired-state.sqlite"
            for suffix in ("", "-wal", "-shm"):
                source = Path(str(database) + suffix)
                if source.exists():
                    source.rename(Path(str(retired_database) + suffix))
            replacement.rename(database)
            assert database.stat().st_ino != initial.st_ino
        try:
            listed = child.request("threadSection/list", {"limit": 10})
            listed_before = BEFORE in [item["name"] for item in listed["data"]]
            child.request("threadSection/create", {"name": AFTER})
            listed = child.request("threadSection/list", {"limit": 10})
            listed_after = AFTER in [item["name"] for item in listed["data"]]
        except native.NativeFailure as error:
            refused = error.error
        child.diagnostic()
    finally:
        child.stop()
    # Private configuration also materializes the CLI's bundled stock catalog.
    # Bound the selected/retired data stores independently of that known catalog.
    for store in {canonical, retired_database.parent}:
        assert len(list(itertools.islice(store.rglob("*"), 101))) <= 100, \
            "Finite synthetic SQLite store entry limit exceeded."
    current_names, retired_names = names(database), names(retired_database)
    return {
        "case": case, "refusal": refused,
        "nativeReadRetiredSection": listed_before,
        "nativeReadNewSection": listed_after,
        "nativeWriteInRetiredDatabase": AFTER in retired_names,
        "nativeWriteInReplacementDatabase": AFTER in current_names,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("--case", choices=["directory", "database"], default="directory")
    parser.add_argument("--expect-retired", action="store_true")
    args = parser.parse_args()
    assert args.binary.is_absolute() and args.binary.is_file()
    with args.binary.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    print(json.dumps({"binarySha256": digest, "case": args.case}), flush=True)
    with tempfile.TemporaryDirectory(prefix="hive-codex-sqlite-lifetime-") as temporary:
        result = run(args.binary, Path(temporary), args.case)
        print(json.dumps(result), flush=True)
        if args.expect_retired:
            assert result["refusal"] is None and result["nativeReadRetiredSection"] \
                and result["nativeReadNewSection"] and result["nativeWriteInRetiredDatabase"] \
                and not result["nativeWriteInReplacementDatabase"], \
                "The negative control must prove actual native reads/writes in the retired database."
            print("REPRODUCED: actual native SQLite sections remain writable in a retired authority.")
        else:
            assert result["refusal"] is not None and REFUSAL in json.dumps(result["refusal"]), \
                "Replacing the admitted SQLite authority must explicitly refuse the subsequent native operation."
            assert not result["nativeWriteInRetiredDatabase"] \
                and not result["nativeWriteInReplacementDatabase"], \
                "Refusal must preserve both retired and replacement SQLite evidence."
            print("PASS: actual native SQLite operations refuse the replaced authority without writing.")


if __name__ == "__main__":
    main()
