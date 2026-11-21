#!/usr/bin/env python3
"""Project both native SQLite rollout-path writers into selected canonical storage."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(sys.argv[1]).resolve(strict=True)
if subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip() != '6aaac694803004a63c6f393d153c96d22521a6b9':
    raise SystemExit('Refusing unpinned native source.')
target = root / 'codex-rs/state/src/runtime/threads.rs'
source = target.read_text()
if hashlib.sha256(source.encode()).hexdigest() != '5694b17e3da88032df83a2df5ff19d694d9a8a86b52f78a7f9d24c6f3425a555':
    raise SystemExit('Refusing changed native SQLite thread writers.')
modules = ['canonical_rollout_paths.rs', 'canonical_rollout_paths_tests.rs']
if any(target.with_name(name).exists() for name in modules):
    raise SystemExit('Refusing to overwrite canonical rollout path modules.')
before = '.bind(metadata.rollout_path.display().to_string())'
if source.count(before) != 2 or not source.startswith('use super::*;\n'):
    raise SystemExit('Refusing changed native SQLite rollout-path writer contexts.')
source = source.replace('use super::*;', '''#[path = "canonical_rollout_paths.rs"]
mod canonical_rollout_paths;

use super::*;''', 1)
source = source.replace(before, '.bind(canonical_rollout_paths::persisted_path(&metadata.rollout_path)?.display().to_string())')
source = subprocess.run(
    ['rustfmt', '--edition', '2024', '--config', 'skip_children=true'],
    input=source, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
).stdout
if '--check' in sys.argv[2:]:
    print('Pinned canonical SQLite rollout-path patch is applicable; no files changed.')
else:
    for name in modules:
        shutil.copyfile(Path(__file__).with_name(name), target.with_name(name))
    target.write_text(source)
    print('Applied canonical SQLite rollout-path experiment; production is unchanged.')
