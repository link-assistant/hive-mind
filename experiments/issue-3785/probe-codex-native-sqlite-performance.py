#!/usr/bin/env python3
"""Measure finite healthy actual-native section operations in both selector modes."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import time

spec = importlib.util.spec_from_file_location(
    "native_compression_probe", Path(__file__).with_name("probe-codex-native-compression.py")
)
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


def run(binary, root, selected):
    canonical = root / "canonical"
    canonical.mkdir(mode=0o700)
    for entry in ("sessions", "archived_sessions", "thread-writer-locks"):
        (canonical / entry).mkdir(mode=0o700)
    (canonical / "rollout-maintenance.lock").touch(mode=0o600)
    start = time.perf_counter()
    child = native.Native(binary, root, canonical, "configuration", True, path_selected=selected)
    try:
        child.initialize()
        marker = "Synthetic healthy native performance section"
        child.request("threadSection/create", {"name": marker})
        startup = time.perf_counter() - start
        start = time.perf_counter()
        for _ in range(25):
            sections = child.request("threadSection/list", {"limit": 30})
            assert marker in [item["name"] for item in sections["data"]]
        reads = time.perf_counter() - start
        start = time.perf_counter()
        for index in range(10):
            child.request("threadSection/create", {"name": f"Synthetic measured section {index}"})
        writes = time.perf_counter() - start
        sections = child.request("threadSection/list", {"limit": 30})
        assert len([item for item in sections["data"] if item["name"].startswith("Synthetic measured section ")]) == 10
        assert child.child.poll() is None
        child.diagnostic()
    finally:
        child.stop()
    return {"selected": selected, "startupMillis": round(startup * 1000, 3),
            "queries": 25, "queryMillis": round(reads * 1000, 3),
            "writes": 10, "writeMillis": round(writes * 1000, 3)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    args = parser.parse_args()
    assert args.binary.is_absolute() and args.binary.is_file()
    with args.binary.open("rb") as source:
        print(json.dumps({"binarySha256": hashlib.file_digest(source, "sha256").hexdigest()}), flush=True)
    with tempfile.TemporaryDirectory(prefix="hive-native-sqlite-performance-") as temporary:
        fixture = Path(temporary)
        for repetition, modes in enumerate(((False, True), (True, False))):
            for selected in modes:
                root = fixture / f"{repetition}-{selected}"
                root.mkdir(mode=0o700)
                print(json.dumps({"repetition": repetition, **run(args.binary, root, selected)}), flush=True)


if __name__ == "__main__":
    main()
