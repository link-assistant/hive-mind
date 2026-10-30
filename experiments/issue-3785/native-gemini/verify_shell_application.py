#!/usr/bin/env python3
"""Rebuild history stages from the pinned constructor package and compare bytes."""
import argparse
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('constructor_package', type=Path)
parser.add_argument('tested_package', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
source = args.constructor_package.resolve(strict=True)
tested = args.tested_package.resolve(strict=True)
output = args.output.resolve()
assert not output.exists() and not output.is_symlink(), 'Refuse to replace an existing package.'
output.mkdir(mode=0o700)
shutil.copyfile(source / 'package.json', output / 'package.json')
shutil.copytree(source / 'bundle', output / 'bundle', symlinks=False)
here = Path(__file__).resolve().parent


def hashes():
    result = {}
    for file in output.rglob('*'):
        if file.is_file():
            with file.open('rb') as stream:
                result[str(file.relative_to(output))] = hashlib.file_digest(stream, 'sha256').hexdigest()
    return result


for stage in ('history', 'artifacts', 'blobs', 'logger', 'shell_history'):
    command = [sys.executable, str(here / ('apply_' + stage + '.py')), str(output)]
    before = hashes()
    subprocess.run([*command, '--check'], check=True)
    assert hashes() == before, 'Checking applicability must not modify the disposable package.'
    subprocess.run(command, check=True)

for name in ('chunk-DKZARV6U.js', 'chunk-XHQ6TTKH.js', 'gemini-GLQ4MVLB.js', 'interactiveCli-AVD3AKNJ.js', 'hive-gemini-admission.mjs', 'hive-gemini-history.mjs', 'hive-gemini-publication.mjs', 'hive-gemini-shell-history.mjs'):
    actual = (output / 'bundle' / name).read_bytes()
    assert actual == (tested / 'bundle' / name).read_bytes(), 'Fresh application differs from the tested package: ' + name
    print(hashlib.sha256(actual).hexdigest(), name)
print('PASS: checked fresh source application produces the same eight native manager/CLI/helper files without mutation during applicability checks.')
