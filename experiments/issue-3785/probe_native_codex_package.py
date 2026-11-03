#!/usr/bin/env python3
"""Pack the actual repository npm allowlist and verify both native payloads."""
import argparse
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("output", type=Path)
parser.add_argument("--expect-missing", action="store_true")
arguments = parser.parse_args()
output = arguments.output.absolute()
output.mkdir(mode=0o700)
with (output / "pack.json").open("wb") as log, (output / "pack-errors.log").open("wb") as errors:
    subprocess.run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", str(output)],
                   cwd=ROOT, env={**os.environ, "NODE_OPTIONS": "--max-old-space-size=128"},
                   stdout=log, stderr=errors, check=True)
archive = output / json.loads((output / "pack.json").read_text())[0]["filename"]
with (output / "verify.log").open("wb") as log:
    result = subprocess.run(["python3", str(ROOT / "scripts/build-native-codex.py"),
                             "verify-package", str(archive)], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
if arguments.expect_missing:
    if result.returncode == 0 or b"actual npm file allowlist omitted" not in (output / "verify.log").read_bytes():
        raise AssertionError("Expected the actual unpublished native runtime payload to be absent.")
    print("PASS: reproduced missing native Codex platforms in the actual npm artifact.")
elif result.returncode:
    raise AssertionError("The actual npm artifact did not preserve the complete verified native runtimes.")
else:
    print("PASS: actual npm artifact preserves both complete verified native runtimes.")
