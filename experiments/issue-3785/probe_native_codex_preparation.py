#!/usr/bin/env python3
"""Check the actual pinned source preparation, repeatability and refusal paths.

Supply a local upstream checkout and a new output directory. This clones the
committed upstream tree twice and never compiles or changes the supplied tree.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BUILDER = ROOT / "scripts/build-native-codex.py"
source = Path(sys.argv[1]).resolve(strict=True)
output = Path(sys.argv[2]).absolute()
output.mkdir(mode=0o700)


def run(*arguments, passes=True):
    result = subprocess.run(["python3", str(BUILDER), *map(str, arguments)],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if (result.returncode == 0) != passes:
        raise AssertionError("Native source preparation produced an unexpected result.")
    return result.stdout


inventories = []
for index in (1, 2):
    tree = output / ("source-" + str(index))
    subprocess.run(["git", "clone", "--no-local", "--quiet", str(source), str(tree)], check=True)
    state = output / ("state-" + str(index) + ".json")
    (output / ("prepare-" + str(index) + ".log")).write_bytes(run("prepare", tree, state))
    inventories.append(json.loads(state.read_text())["sourceFiles"])
    run("verify-source", tree, state)
    original_state = state.read_bytes()
    run("prepare", tree, state, passes=False)
    assert state.read_bytes() == original_state
    target = tree / "codex-rs/login/src/auth/canonical_auth.rs"
    original = target.read_bytes()
    target.write_bytes(original + b"\n// unadmitted source change\n")
    (output / "changed-source-refused.log").write_bytes(run("verify-source", tree, state, passes=False))
    target.write_bytes(original)
    unexpected = tree / "unadmitted-source.rs"
    unexpected.write_text("unexpected release input\n")
    run("verify-source", tree, state, passes=False)
    unexpected.unlink()
    saved = json.loads(state.read_text())
    saved["recipeSha256"] = "0" * 64
    state.write_text(json.dumps(saved))
    run("verify-source", tree, state, passes=False)
    state.write_bytes(original_state)
    run("verify-source", tree, state)
assert inventories[0] == inventories[1], "Fresh preparations must yield identical source inventories."
identity = hashlib.sha256(json.dumps(inventories[0], sort_keys=True).encode()).hexdigest()
print(json.dumps({"result": "PASS", "freshPreparations": 2,
                  "changedSourceFiles": len(inventories[0]), "inventorySha256": identity,
                  "refused": ["repeat preparation", "changed source", "extra source", "changed recipe identity"]}))
