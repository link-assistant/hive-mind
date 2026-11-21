#!/usr/bin/env python3
"""Apply the manager experiment only after native negative controls have run."""
from pathlib import Path
import shutil
import subprocess
import sys

PIN = "6aaac694803004a63c6f393d153c96d22521a6b9"
root = Path(sys.argv[1]).resolve(strict=True)
package = Path(__file__).resolve().parent
if subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != PIN:
    raise SystemExit("Refusing unpinned native source.")
for relative in ['codex-rs/login/src/auth/manager.rs', 'codex-rs/login/src/auth/account_grant.rs']:
    expected = subprocess.check_output(["git", "-C", str(root), "show", f"{PIN}:{relative}"])
    if (root / relative).read_bytes() != expected:
        raise SystemExit("Refusing modified native manager source.")
storage = root / 'codex-rs/login/src/auth/storage.rs'
text = storage.read_text()
if text.count('mod canonical_auth;') != 1 or 'pub(super) mod canonical_auth;' in text:
    raise SystemExit("The native storage experiment must be applied exactly once first.")
module = storage.with_name('canonical_auth.rs')
if module.read_bytes() != (package / 'canonical_auth.rs').read_bytes():
    raise SystemExit("Native canonical storage does not match the tested module.")
transaction = storage.with_name('canonical_transaction.rs')
if transaction.exists():
    raise SystemExit("Refusing an existing native transaction module.")
patch = package / 'coordination.patch'
subprocess.run(['git', '-C', str(root), 'apply', '--check', str(patch)], check=True)
if '--check' in sys.argv[2:]:
    print('Pinned native coordination patch is applicable; no files changed.')
else:
    subprocess.run(['git', '-C', str(root), 'apply', str(patch)], check=True)
    shutil.copyfile(package / 'canonical_transaction.rs', transaction)
    storage.write_text(text.replace('mod canonical_auth;', 'pub(super) mod canonical_auth;', 1))
    print('Applied native manager coordination experiment; production is unchanged.')
