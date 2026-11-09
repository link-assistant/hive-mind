#!/usr/bin/env python3
"""Apply the experimental file-store adapter to one immutable Codex checkout.

This does not install a CLI or change the production launcher. Native refresh
coordination and the complete CLI/provider gate must pass before integration.
"""
from pathlib import Path
import hashlib
import re
import shutil
import subprocess
import sys

PIN = "6aaac694803004a63c6f393d153c96d22521a6b9"
root = Path(sys.argv[1]).resolve(strict=True)
revision = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
if revision != PIN:
    raise SystemExit("Refusing an unpinned native Codex source tree.")
target = root / "codex-rs/login/src/auth/storage.rs"
source = target.read_text()
lockfile = root / "codex-rs/Cargo.lock"
locktext = lockfile.read_text()
# The release tag bumps workspace.package but retains 0.0.0 for its 166 local
# lock entries. Repair only those versions, with exact input/output hashes.
# Registry/git dependency versions, checksums and edges remain byte-identical.
if hashlib.sha256(locktext.encode()).hexdigest() != "7ec2bfabf3b967c00409b85489076f8df3849745d3e469473d88288322adeb4a":
    raise SystemExit("Pinned upstream lockfile does not match.")
locktext, repaired = re.subn(r'(\[\[package\]\]\nname = "[^"\n]+"\n)version = "0\.0\.0"\n', r'\g<1>version = "0.164.0"\n', locktext)
if repaired != 166 or hashlib.sha256(locktext.encode()).hexdigest() != "bc5f7352658f51deace9dddb4bc404742b06c6402cc825b6d37051c008d989bd":
    raise SystemExit("Refusing an unexpected native lockfile change.")


def replace_once(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit("Pinned source context does not match; no adapter changes written.")
    source = source.replace(before, after, 1)


replace_once(
    '#[path = "storage_error.rs"]\nmod storage_error;',
    '#[cfg(target_os = "linux")]\n#[path = "canonical_auth.rs"]\nmod canonical_auth;\n\n#[path = "storage_error.rs"]\nmod storage_error;',
)
replace_once(
    '    let auth_file = get_auth_file(codex_home);\n    match std::fs::remove_file(&auth_file) {',
    '''    #[cfg(target_os = "linux")]
    if let Some(shared) = canonical_auth::CanonicalAuth::configured()? {
        return shared.delete();
    }
    let auth_file = get_auth_file(codex_home);
    match std::fs::remove_file(&auth_file) {''',
)
replace_once(
    '        let mut file = File::open(auth_file)?;',
    '''        #[cfg(target_os = "linux")]
        if let Some(shared) = canonical_auth::CanonicalAuth::configured()? {
            let bytes = shared.read()?.ok_or_else(|| std::io::Error::from(std::io::ErrorKind::NotFound))?;
            return serde_json::from_slice(&bytes).map_err(|_| std::io::Error::other("Canonical authentication is malformed."));
        }
        let mut file = File::open(auth_file)?;''',
)
replace_once(
    '        let auth_file = get_auth_file(&self.codex_home);\n\n        if let Some(parent) = auth_file.parent() {',
    '''        #[cfg(target_os = "linux")]
        if let Some(shared) = canonical_auth::CanonicalAuth::configured()? {
            let bytes = serde_json::to_vec_pretty(auth_dot_json)?;
            return shared.write(&bytes);
        }
        let auth_file = get_auth_file(&self.codex_home);

        if let Some(parent) = auth_file.parent() {''',
)
replace_once(
    '    let storage: Arc<dyn AuthStorageBackend> = match mode {',
    '''    #[cfg(target_os = "linux")]
    match canonical_auth::CanonicalAuth::configured() {
        Ok(Some(shared)) if shared.conflicts_with(&codex_home) => {
            return Arc::new(RejectedCanonicalStorage { empty: false });
        }
        // Internal ephemeral cleanup must remain a no-op, but an explicitly
        // selected canonical file authority cannot load/save another backend.
        Ok(Some(_)) if mode == AuthCredentialsStoreMode::Ephemeral => {
            return Arc::new(RejectedCanonicalStorage { empty: true });
        }
        Ok(Some(_)) if mode != AuthCredentialsStoreMode::File => {
            return Arc::new(RejectedCanonicalStorage { empty: false });
        }
        Err(_) => return Arc::new(RejectedCanonicalStorage { empty: false }),
        _ => {}
    }
    let storage: Arc<dyn AuthStorageBackend> = match mode {''',
)
source += '''
#[cfg(target_os = "linux")]
#[derive(Debug)]
struct RejectedCanonicalStorage { empty: bool }

#[cfg(target_os = "linux")]
impl AuthStorageBackend for RejectedCanonicalStorage {
    fn load(&self) -> std::io::Result<Option<AuthDotJson>> {
        if self.empty { Ok(None) } else { Err(std::io::Error::other("Canonical file authentication is required.")) }
    }
    fn save(&self, _: &AuthDotJson) -> std::io::Result<()> {
        Err(std::io::Error::other("Canonical file authentication is required."))
    }
    fn delete(&self) -> std::io::Result<bool> {
        if self.empty { Ok(false) } else { Err(std::io::Error::other("Canonical file authentication is required.")) }
    }
}
'''
module = target.parent / "canonical_auth.rs"
if module.exists():
    raise SystemExit("Refusing to overwrite an existing native adapter module.")
probe = root / "codex-rs/login/src/bin/hive-canonical-auth-probe.rs"
if probe.exists():
    raise SystemExit("Refusing to overwrite an existing native process driver.")
# Check every source anchor before writing either file.
shutil.copyfile(Path(__file__).with_name("canonical_auth.rs"), module)
probe.parent.mkdir(exist_ok=True)
shutil.copyfile(Path(__file__).with_name("native_lifecycle_probe.rs"), probe)
target.write_text(source)
lockfile.write_text(locktext)
print("Applied the experimental auth-directory adapter to the immutable Codex source.")
