#!/usr/bin/env python3
"""Verify three actual native SQLite peers retain data across peer disposal."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3
import tempfile

spec = importlib.util.spec_from_file_location(
    "native_compression_probe", Path(__file__).with_name("probe-codex-native-compression.py")
)
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


def verify_names(child, expected):
    sections = child.request("threadSection/list", {"limit": 100})
    actual = {item["name"] for item in sections["data"]}
    assert expected <= actual, "Every live peer must discover all acknowledged native writes."
    assert child.child.poll() is None, "Healthy canonical storage must keep the native peer alive."


def run(binary, root, selected):
    canonical = root / "canonical"
    canonical.mkdir(mode=0o700)
    for entry in ("sessions", "archived_sessions", "thread-writer-locks"):
        (canonical / entry).mkdir(mode=0o700)
    (canonical / "rollout-maintenance.lock").touch(mode=0o600)
    children = []
    expected = set()
    try:
        for index in range(3):
            child = native.Native(binary, root, canonical, f"configuration-{index}", True,
                                  path_selected=selected)
            children.append(child)
            child.initialize()
            marker = f"Synthetic peer {index} startup section"
            child.request("threadSection/create", {"name": marker})
            expected.add(marker)
        # Dispatch each round before receiving any replies: all three native
        # SQLite pools are alive and can overlap their writes to the same store.
        for round_index in range(4):
            pending = []
            for index, child in enumerate(children):
                marker = f"Synthetic peer {index} round {round_index} section"
                pending.append((child, child.send("threadSection/create", {"name": marker})))
                expected.add(marker)
            for child, request in pending:
                child.receive(request)
            for child in children:
                verify_names(child, expected)
        retired = children[1]
        retired.stop()
        shutil.rmtree(retired.config)
        for child in (children[0], children[2]):
            verify_names(child, expected)
            marker = f"Synthetic survivor {len(expected)} section"
            child.request("threadSection/create", {"name": marker})
            expected.add(marker)
        restarted = native.Native(binary, root, canonical, "configuration-restarted", True,
                                  path_selected=selected)
        children.append(restarted)
        restarted.initialize()
        verify_names(restarted, expected)
        marker = "Synthetic restarted peer section"
        restarted.request("threadSection/create", {"name": marker})
        expected.add(marker)
        for child in (children[0], children[2], restarted):
            verify_names(child, expected)
            child.diagnostic()
    finally:
        for child in reversed(children):
            child.stop()
    # No native process remains when the host inspects the final database.
    with sqlite3.connect(canonical / "state_5.sqlite", timeout=2) as connection:
        assert connection.execute("PRAGMA quick_check").fetchone() == ("ok",)
        names = {row[0] for row in connection.execute("SELECT name FROM thread_sections LIMIT 100")}
        assert expected <= names, "Peer disposal must preserve every acknowledged write."
    return {"selected": selected, "concurrentNativePeers": 3,
            "acknowledgedSections": len(expected), "privateConfigurationDisposed": True,
            "freshPeerRetainedSections": True, "databaseQuickCheck": "ok"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("--without-path-selector", action="store_true")
    args = parser.parse_args()
    assert args.binary.is_absolute() and args.binary.is_file()
    with args.binary.open("rb") as source:
        print(json.dumps({"binarySha256": hashlib.file_digest(source, "sha256").hexdigest()}), flush=True)
    with tempfile.TemporaryDirectory(prefix="hive-native-sqlite-peers-") as temporary:
        print(json.dumps(run(args.binary, Path(temporary), not args.without_path_selector)), flush=True)


if __name__ == "__main__":
    main()
