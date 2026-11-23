#!/usr/bin/env python3
"""Apply only after both native synchronous cached-read controls fail as expected."""
import hashlib
from pathlib import Path
import subprocess
import sys

PIN = "6aaac694803004a63c6f393d153c96d22521a6b9"
COORDINATED = "e40e4a670f95fa7904631399b5f2eec7296d60e60f5d16b967335d48af2c5850"
root = Path(sys.argv[1]).resolve(strict=True)
package = Path(__file__).resolve().parent
if subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != PIN:
    raise SystemExit("Refusing unpinned native source.")
manager = root / 'codex-rs/login/src/auth/manager.rs'
if hashlib.sha256(manager.read_bytes()).hexdigest() != COORDINATED:
    raise SystemExit("Refusing a manager without the exact preceding coordination patch.")
for name in ['canonical_auth.rs', 'canonical_transaction.rs']:
    if manager.with_name(name).read_bytes() != (package / name).read_bytes():
        raise SystemExit("Refusing a modified native storage/transaction module.")
patch = package / 'cached_reads.patch'
subprocess.run(['git', '-C', str(root), 'apply', '--unidiff-zero', '--check', str(patch)], check=True)
if '--check' in sys.argv[2:]:
    print('Pinned synchronous read patch is applicable; no files changed.')
else:
    subprocess.run(['git', '-C', str(root), 'apply', '--unidiff-zero', str(patch)], check=True)
    print('Applied synchronous read experiment; production is unchanged.')
