#!/usr/bin/env python3
"""Admit final native SQLite configuration after all upstream policy layers."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(sys.argv[1]).resolve(strict=True)
if subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip() != '6aaac694803004a63c6f393d153c96d22521a6b9':
    raise SystemExit('Refusing unpinned native source.')
target = root / 'codex-rs/core/src/config/mod.rs'
source = target.read_text()
server = root / 'codex-rs/app-server/src/lib.rs'
server_source = server.read_text()
if hashlib.sha256(server_source.encode()).hexdigest() != 'b5f2f688187126d642789f77f9d8fd2e6e0763fe59befba23e13bf91f80ac1ae':
    raise SystemExit('Refusing changed native app-server startup policy.')
if hashlib.sha256(source.encode()).hexdigest() != 'b9786bf33ed36546b100578ce26f6884033c404d11c72ed1e234c1b519605c04':
    raise SystemExit('Refusing changed native configuration resolution.')
modules = ['canonical_sqlite_authority.rs', 'canonical_sqlite_authority_tests.rs']
if any(target.with_name(name).exists() for name in modules):
    raise SystemExit('Refusing to overwrite canonical SQLite configuration modules.')
anchor = '        let mut sqlite = codex_state::SqliteConfig::from_sqlite_home(sqlite_home);\n        let requirements = config_layer_stack.requirements_toml();'
replacement = '''        let requirements = config_layer_stack.requirements_toml();
        #[cfg(target_os = "linux")]
        canonical_sqlite_authority::admit(
            sqlite_home.as_path(),
            if cfg.log_dir.is_some() && requirements.sqlite_home.is_none() {
                log_dir.as_path()
            } else {
                sqlite_home.as_path()
            },
            codex_home.as_path(),
        )?;
        let mut sqlite = codex_state::SqliteConfig::from_sqlite_home(sqlite_home);'''
if source.count(anchor) != 1 or not source.startswith('use crate::config::edit::ConfigEdit;\n'):
    raise SystemExit('Refusing changed native SQLite configuration contexts.')
source = '#[cfg(target_os = "linux")]\nmod canonical_sqlite_authority;\n\n' + source.replace(anchor, replacement, 1)
server_anchor = '    let codex_home = find_codex_home()?;\n    let startup_cwd = std::env::current_dir().ok();'
server_replacement = '''    let codex_home = find_codex_home()?;
    // Selected canonical history must not recover from admission errors by
    // silently loading defaults and opening another configuration's databases.
    let strict_config = strict_config
        || (cfg!(target_os = "linux") && std::env::var_os("CODEX_ROLLOUT_HOME").is_some());
    let startup_cwd = std::env::current_dir().ok();'''
if server_source.count(server_anchor) != 1:
    raise SystemExit('Refusing changed native app-server configuration context.')
server_source = server_source.replace(server_anchor, server_replacement, 1)
source = subprocess.run(
    ['rustfmt', '--edition', '2024', '--config', 'skip_children=true'],
    input=source, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
).stdout
server_source = subprocess.run(
    ['rustfmt', '--edition', '2024', '--config', 'skip_children=true'],
    input=server_source, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
).stdout
if '--check' in sys.argv[2:]:
    print('Pinned canonical SQLite configuration patch is applicable; no files changed.')
else:
    for name in modules:
        shutil.copyfile(Path(__file__).with_name(name), target.with_name(name))
    target.write_text(source)
    server.write_text(server_source)
    print('Applied canonical SQLite configuration admission; production selection is unchanged.')
