#!/usr/bin/env python3
"""Refuse unauthenticated model execution after canonical credentials disappear.

Apply only after the full CLI request control establishes this intermediate
behavior. This source experiment is not installed in production images.
"""
import hashlib
from pathlib import Path
import subprocess
import sys

PIN = "6aaac694803004a63c6f393d153c96d22521a6b9"
AUTH_HASH = "fcb210f36cc01f88b511305952aa36820bfa15d0afd0186fd49ac72e98c20153"
root = Path(sys.argv[1]).resolve(strict=True)
if subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != PIN:
    raise SystemExit("Refusing unpinned native source.")
target = root / "codex-rs/model-provider/src/auth.rs"
source = target.read_text()
if hashlib.sha256(source.encode()).hexdigest() != AUTH_HASH:
    raise SystemExit("Refusing a changed native request auth provider.")
anchor = '''    if let Some(auth) = bearer_auth_for_provider(provider)? {'''
if source.count(anchor) != 1:
    raise SystemExit("Ambiguous native request auth context; no files changed.")
source = source.replace(anchor, '''    // A canonical authority disappearing is logout or failed admission. Do not
    // turn an auth-required request into unauthenticated network execution.
    if std::env::var_os("CODEX_AUTH_HOME").is_some()
        && provider.requires_openai_auth
        && auth.is_none()
    {
        return Err(CodexErr::InvalidRequest(
            "Canonical authentication is unavailable; authenticate before execution.".to_string(),
        ));
    }
    if let Some(auth) = bearer_auth_for_provider(provider)? {''', 1)
source = subprocess.run(
    ["rustfmt", "--edition", "2024", "--config", "skip_children=true"],
    input=source, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
).stdout
if "--check" in sys.argv[2:]:
    print("Pinned canonical request auth patch is applicable; no files changed.")
else:
    target.write_text(source)
    print("Applied canonical request auth experiment; production is unchanged.")
