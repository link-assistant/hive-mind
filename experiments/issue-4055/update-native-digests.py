#!/usr/bin/env python3
"""Refresh the native recipe and source inventory for changed adapter files.

Usage: python3 -I experiments/issue-4055/update-native-digests.py canonical_sqlite_vfs.c canonical_sqlite_vfs.rs
Each name is an input under experiments/issue-3785/native-codex/ that
apply_*.py copies verbatim into the pinned upstream source tree.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
ADAPTERS = ROOT / "experiments/issue-3785/native-codex"
RECIPE = ROOT / "src/native-codex/recipe.json"
INVENTORY = ROOT / "src/native-codex/source-files.json"
spec = importlib.util.spec_from_file_location("build_native_codex", ROOT / "scripts/build-native-codex.py")
BUILD = importlib.util.module_from_spec(spec)
spec.loader.exec_module(BUILD)

recipe_text = RECIPE.read_text()
recipe = json.loads(recipe_text)
inventory = json.loads(INVENTORY.read_text())
for name in sys.argv[1:]:
    data = (ADAPTERS / name).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    previous = recipe["inputs"][name]
    copies = [path for path, item in inventory.items() if item["sha256"] == previous]
    if len(copies) != 1:
        raise SystemExit(f"Expected one copied source for {name}, found {copies}")
    recipe["inputs"][name] = digest
    # Replace digests in place: the recipe keeps hand-formatted one-line arrays.
    recipe_text = recipe_text.replace(f'"{name}": "{previous}"', f'"{name}": "{digest}"', 1)
    inventory[copies[0]].update(sha256=digest, bytes=len(data))
    print(f"{name}: {previous[:12]} -> {digest[:12]} ({copies[0]}, {len(data)} bytes)")
previous = recipe["sourceInventorySha256"]
recipe["sourceInventorySha256"] = BUILD.source_digest(inventory)
recipe_text = recipe_text.replace(f'"sourceInventorySha256": "{previous}"',
                                  f'"sourceInventorySha256": "{recipe["sourceInventorySha256"]}"', 1)
if json.loads(recipe_text) != recipe:
    raise SystemExit("In-place recipe update diverged from the parsed update.")
print("sourceInventorySha256:", recipe["sourceInventorySha256"])
RECIPE.write_text(recipe_text)
INVENTORY.write_text(json.dumps(inventory, indent=2) + "\n")
