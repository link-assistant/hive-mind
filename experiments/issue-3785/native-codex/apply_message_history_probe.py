#!/usr/bin/env python3
"""Add only a bounded driver for the real, pinned public prompt-history API."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(sys.argv[1]).resolve(strict=True)
if subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != "6aaac694803004a63c6f393d153c96d22521a6b9":
    raise SystemExit("Refusing unpinned native source.")
for name, expected in {
    "src/lib.rs": "5296d70335948ca3b1a59ddede75c599ec1c192efa4630b6d8d198ce992703b6",
    "src/batch.rs": "57e1fbff51ad4c0d759d79e8f8c9e5fabda4cd8632d138948361ce1ee911fc09",
    "Cargo.toml": "adb2d2b3f7c7a6068b87deb69cb2dcd4afcbe45ad86e9b0a41bc4b5dce724722",
}.items():
    if hashlib.sha256((root / "codex-rs/message-history" / name).read_bytes()).hexdigest() != expected:
        raise SystemExit("Refusing changed native prompt-history source or dependencies.")
target = root / "codex-rs/message-history/src/bin/hive-message-history-probe.rs"
if target.exists():
    raise SystemExit("Refusing to overwrite an existing native prompt-history driver.")
target.parent.mkdir(exist_ok=True)
shutil.copyfile(Path(__file__).with_name("message_history_probe.rs"), target)
print("Added the actual native prompt-history driver; production is unchanged.")
