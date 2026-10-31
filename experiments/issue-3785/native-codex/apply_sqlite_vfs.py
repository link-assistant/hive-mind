#!/usr/bin/env python3
"""Attach selected native SQLite authority before pools and startup PRAGMAs."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(sys.argv[1]).resolve(strict=True)
if subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip() != '6aaac694803004a63c6f393d153c96d22521a6b9':
    raise SystemExit('Refusing unpinned native source.')
expected = {
    'codex-rs/state/src/lib.rs': '54d87c3bc38168c07b4db38687cce4544c2c8951afac0c267d1d2da7010185ca',
    'codex-rs/state/src/sqlite.rs': '2697177d5b1f019ae85f67bf159220dcbb3d42631e712f41cb2fea2e453166d6',
    'codex-rs/state/src/runtime/reclamation.rs': '833104f1e57768ae96c58f5df71d2ae3d658b3c3aeea7141ce960f68ef660650',
    'codex-rs/state/Cargo.toml': '1e6d3abbb2baf1a549a7a3cc93b15bf6f748045ef075da7621f95ea42cb50e4e',
    'codex-rs/Cargo.lock': 'bc5f7352658f51deace9dddb4bc404742b06c6402cc825b6d37051c008d989bd',
    'codex-rs/core/src/config/canonical_sqlite_authority.rs': 'c2a2d582e586cfeeb88210b2b6163516fabd8edd6d098c25789be4a4a249d08e',
}
sources = {}
for name, digest in expected.items():
    path = root / name
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise SystemExit('Refusing changed SQLite connection or admission source: ' + name)
    sources[name] = path.read_text()
copies = {
    'canonical_sqlite_vfs.c': 'codex-rs/state/src/sqlite/canonical_sqlite_vfs.c',
    'canonical_sqlite_vfs.rs': 'codex-rs/state/src/sqlite/canonical_sqlite_vfs.rs',
    'canonical_sqlite_build.rs': 'codex-rs/state/build.rs',
}
if any((root / name).exists() for name in copies.values()):
    raise SystemExit('Refusing to overwrite native SQLite operation authority.')


def replace(name, before, after):
    if sources[name].count(before) != 1:
        raise SystemExit('Refusing changed SQLite integration anchor: ' + name)
    sources[name] = sources[name].replace(before, after, 1)


sqlite = 'codex-rs/state/src/sqlite.rs'
replace(sqlite, 'mod busy_retry;\n', '''mod busy_retry;
#[cfg(target_os = "linux")]
mod canonical_sqlite_vfs;
#[cfg(target_os = "linux")]
pub use canonical_sqlite_vfs::admit_canonical_sqlite;

pub(crate) fn canonical_options(
    path: &Path,
    options: SqliteConnectOptions,
) -> Result<SqliteConnectOptions, Error> {
    #[cfg(target_os = "linux")]
    { canonical_sqlite_vfs::options(path, options) }
    #[cfg(not(target_os = "linux"))]
    { let _ = path; Ok(options) }
}
''')
for before, after in (
    ('        // Each failed attempt closes its pool before initialization is retried.',
     '        let options = canonical_options(path, options)?;\n        // Each failed attempt closes its pool before initialization is retried.'),
    ('        if let Some(busy_timeout) = busy_timeout {',
     '        let mut options = canonical_options(path, options)?;\n        if let Some(busy_timeout) = busy_timeout {'),
    ('        SqlitePoolOptions::new()\n            .max_connections(1)\n            .connect_with(options)\n            .await\n            .map(Some)',
     '        let options = canonical_options(&path, options)?;\n        SqlitePoolOptions::new()\n            .max_connections(1)\n            .connect_with(options)\n            .await\n            .map(Some)'),
):
    replace(sqlite, before, after)
# Preserve one mutable binding for read-only busy-timeout selection.
replace(sqlite, '        let mut options = SqliteConnectOptions::new()',
        '        let options = SqliteConnectOptions::new()')
replace(sqlite,
    '            .filename(path)\n            .create_if_missing(false)\n            .busy_timeout(Duration::ZERO)',
    '            .filename(&path)\n            .create_if_missing(false)\n            .busy_timeout(Duration::ZERO)')
replace('codex-rs/state/src/lib.rs', 'pub use sqlite::SqliteConfig;',
        '#[cfg(target_os = "linux")]\npub use sqlite::admit_canonical_sqlite;\npub use sqlite::SqliteConfig;')
reclamation = 'codex-rs/state/src/runtime/reclamation.rs'
replace(reclamation, '        &SqliteConnectOptions::new()\n            .filename(path)',
        '        &crate::sqlite::canonical_options(path, SqliteConnectOptions::new()\n            .filename(path)')
replace(reclamation, '            .log_slow_statements(LevelFilter::Off, Duration::ZERO),',
        '            .log_slow_statements(LevelFilter::Off, Duration::ZERO))?,')
replace('codex-rs/state/Cargo.toml', '\n[dev-dependencies]\n',
        '\n[build-dependencies]\ncc = "=1.2.55"\n\n[dev-dependencies]\n')
lockfile = 'codex-rs/Cargo.lock'
start = sources[lockfile].index('name = "codex-state"\n')
end = sources[lockfile].index('\n[[package]]', start)
package = sources[lockfile][start:end]
if package.count(' "chrono",\n') != 1 or ' "cc",\n' in package:
    raise SystemExit('Refusing changed native state lock dependencies.')
sources[lockfile] = sources[lockfile][:start] + package.replace(' "chrono",\n', ' "cc",\n "chrono",\n', 1) + sources[lockfile][end:]

core = 'codex-rs/core/src/config/canonical_sqlite_authority.rs'
replace(core, '//! This is path-policy admission; SQLite operation/descriptor leases are separate.',
        '//! Selected state also retains native SQLite directory and operation authority.')
replace(core, 'const NONBLOCK: i32 = 0x800;\n', '')
start = sources[core].index('// This admission does not hold a lease')
end = sources[core].index('/// CODEX_ROLLOUT_HOME', start)
# Never open and close an independent descriptor for a database that may already
# have this process's POSIX locks. The state authority owns bounded persistent
# descriptors and validates actual SQLite handles for every connection.
sources[core] = sources[core][:start] + '''// Inspect path policy without opening/closing extra database descriptors.
// Native state retains canonical handles before any managed pools open.
fn database_files(root: &Path, owner: u32) -> io::Result<()> {
    for database in DATABASES {
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let path = root.join(format!("{database}{suffix}"));
            match fs::symlink_metadata(&path) {
                Ok(info) if info.is_file() && info.uid() == owner
                    && info.nlink() == 1 && info.mode() & 0o022 == 0 => (),
                Err(error) if error.kind() == io::ErrorKind::NotFound => (),
                _ => return Err(refused()),
            }
        }
    }
    Ok(())
}

''' + sources[core][end:]
replace(core, '    .map_err(|_| refused())\n}',
        '    .map_err(|_| refused())?;\n    codex_state::admit_canonical_sqlite(Path::new(&root))\n}')
for name in sources:
    if name.endswith('.rs'):
        sources[name] = subprocess.run(
            ['rustfmt', '--edition', '2024', '--config', 'skip_children=true'],
            input=sources[name], text=True, capture_output=True, check=True,
        ).stdout
if '--check' in sys.argv[2:]:
    print('Pinned native SQLite operation patch is applicable; no files changed.')
else:
    for name, content in sources.items():
        (root / name).write_text(content)
    for source, target in copies.items():
        shutil.copyfile(Path(__file__).with_name(source), root / target)
    print('Attached selected SQLite VFS to all pool, read-only, cleanup and reclamation connections.')
