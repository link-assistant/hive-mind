#!/usr/bin/env python3
"""Bind canonical identity metadata publication to its originating login.

Apply after the durable refresh-intent patch. The native CLI regression must
reproduce stale publication before this repair; production remains unchanged.
"""
import hashlib
from pathlib import Path
import subprocess
import sys

PIN = "6aaac694803004a63c6f393d153c96d22521a6b9"
MANAGER_HASH = "e039c0d763717e14a298439a94c182ee6b0dd39ccc506977127a3817d2349815"
root = Path(sys.argv[1]).resolve(strict=True)
if subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != PIN:
    raise SystemExit("Refusing unpinned native source.")
target = root / "codex-rs/login/src/auth/manager.rs"
source = target.read_text()
if hashlib.sha256(source.encode()).hexdigest() != MANAGER_HASH:
    raise SystemExit("Refusing a changed native identity writer.")
before = '''    if canonical_transaction::selected() && stored.is_none() {
        return Err(std::io::Error::other(
            "Canonical credentials were removed during identity registration.",
        ));
    }
    let mut auth = stored'''
after = '''    if canonical_transaction::selected() {
        // Older native credentials have no login_owner_id. They still must
        // match the account/user and remain an OAuth login before a pending
        // bootstrap can publish its private identity key into canonical state.
        let expected = guard.as_ref().and_then(|auth| auth.tokens.as_ref());
        let current = stored.as_ref().and_then(|auth| auth.tokens.as_ref());
        if !matches!((expected, current), (Some(expected), Some(current))
            if same_login_for_persistence(expected, current))
        {
            return Err(std::io::Error::other(
                "Canonical login changed during identity registration.",
            ));
        }
    }
    let mut auth = stored'''
if source.count(before) != 1:
    raise SystemExit("Ambiguous native identity publication context; no files changed.")
source = source.replace(before, after, 1)
source = subprocess.run(
    ["rustfmt", "+1.99.1", "--edition", "2024", "--config", "skip_children=true"],
    input=source, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
).stdout
if "--check" in sys.argv[2:]:
    print("Pinned canonical identity publication patch is applicable; no files changed.")
else:
    target.write_text(source)
    print("Applied canonical identity publication experiment; production is unchanged.")
