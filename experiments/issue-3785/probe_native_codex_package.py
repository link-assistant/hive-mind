#!/usr/bin/env python3
"""Pack the actual npm artifacts and verify both native payloads (issue #4050).

The main tarball must carry the recipe and no executable, and fit the npm
publish budget; each platform's executable is its own byte-verified variant
package. The main archive is also wired exactly as publication wires it and
checked to pin both variants.

Output layout:
  pack.json, <main>.tgz       the unwired main archive (what CI installs)
  variants/variants.json, *.tgz  one verified variant package per platform
  wired/<main>.tgz            the main archive as published, with its pins
  *.log                       every command's output

--expect-missing reproduces a missing platform: packing must refuse.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("output", type=Path)
parser.add_argument("--expect-missing", action="store_true")
arguments = parser.parse_args()
output = arguments.output.absolute()
output.mkdir(mode=0o700)
env = {**os.environ, "NODE_OPTIONS": "--max-old-space-size=128"}


def run(name, command, cwd=ROOT, check=True):
    with (output / (name + ".log")).open("wb") as log:
        result = subprocess.run(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
    if check and result.returncode:
        raise AssertionError(name + " failed; see " + str(output / (name + ".log")) + ":\n"
                             + (output / (name + ".log")).read_text(errors="replace")[-4000:])
    return result


variants = run("variants", ["node", str(ROOT / "scripts/native-codex-packages.mjs"), "pack", str(output / "variants")],
               check=not arguments.expect_missing)
if arguments.expect_missing:
    if variants.returncode == 0:
        raise AssertionError("Expected packing to refuse a missing native runtime platform.")
    print("PASS: reproduced a missing native Codex platform; no variant package was produced.")
    raise SystemExit(0)

with (output / "pack.json").open("wb") as log, (output / "pack-errors.log").open("wb") as errors:
    subprocess.run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", str(output)],
                   cwd=ROOT, env=env, stdout=log, stderr=errors, check=True)
archive = output / json.loads((output / "pack.json").read_text())[0]["filename"]
run("size", ["node", str(ROOT / "scripts/check-npm-tarball-size.mjs"), str(archive),
             *[entry["archive"] for entry in json.loads((output / "variants/variants.json").read_text())]])
run("verify-unwired", ["python3", str(ROOT / "scripts/build-native-codex.py"), "verify-package", "--unwired", str(archive)])

# Wire a copy of the archive exactly as `native-codex-packages.mjs publish` wires
# the repository before `changeset publish`, then verify what would be published.
stage = output / "wired-stage"
stage.mkdir()
with tarfile.open(archive, "r:gz") as package:
    package.extractall(stage, filter="data")
run("wire", ["node", str(ROOT / "scripts/native-codex-packages.mjs"), "wire", str(stage / "package")])
(output / "wired").mkdir()
run("wired-pack", ["npm", "pack", "--ignore-scripts", "--pack-destination", str(output / "wired")], cwd=stage / "package")
shutil.rmtree(stage)
[wired] = (output / "wired").glob("*.tgz")
run("verify-wired", ["python3", str(ROOT / "scripts/build-native-codex.py"), "verify-package", str(wired)])
print("PASS: the main npm artifact carries the recipe only and pins both byte-verified native variant packages.")
