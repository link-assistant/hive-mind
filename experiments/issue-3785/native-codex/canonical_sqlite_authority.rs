//! Validate final native configuration before selected SQLite databases open.
//! This is path-policy admission; SQLite operation/descriptor leases are separate.
use std::fs::{self, File, OpenOptions};
use std::io;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

const NOFOLLOW: i32 = 0x20000;
const DIRECTORY: i32 = 0x10000;

fn refused() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "Canonical SQLite configuration is unavailable or unsafe.",
    )
}

fn absolute(path: &Path) -> bool {
    path.to_str().is_some_and(|value| {
        value.starts_with('/')
            && value.len() > 1
            && !value.contains(['\0', '\r', '\n'])
            && value[1..]
                .split('/')
                .all(|part| !part.is_empty() && part != "." && part != "..")
    })
}

/// CODEX_ROLLOUT_HOME selects the canonical history contract. Upstream's
/// CODEX_SQLITE_HOME alone retains upstream configuration precedence.
pub(crate) fn admit(sqlite: &Path, logs: &Path, private: &Path) -> io::Result<()> {
    let Some(root) = std::env::var_os("CODEX_ROLLOUT_HOME") else {
        return Ok(());
    };
    let selected = std::env::var_os("CODEX_SQLITE_HOME").ok_or_else(refused)?;
    validate(
        Path::new(&root),
        Path::new(&selected),
        sqlite,
        logs,
        private,
    )
    .map_err(|_| refused())
}

fn validate(
    root: &Path,
    selected: &Path,
    sqlite: &Path,
    logs: &Path,
    private: &Path,
) -> io::Result<()> {
    if !absolute(root)
        || !absolute(selected)
        || !absolute(private)
        || selected != root
        || sqlite != root
        || logs != root
        || private.starts_with(root)
        || root.starts_with(private)
        || fs::canonicalize(root)? != root
        || fs::canonicalize(private)? != private
    {
        return Err(refused());
    }
    let directory: File = OpenOptions::new()
        .read(true)
        .custom_flags(NOFOLLOW | DIRECTORY)
        .open(root)?;
    let held = directory.metadata()?;
    let visible = fs::symlink_metadata(root)?;
    let private_info = fs::symlink_metadata(private)?;
    let owner = fs::metadata("/proc/self")?.uid();
    if !held.is_dir()
        || !visible.is_dir()
        || held.uid() != owner
        || held.mode() & 0o077 != 0
        || visible.uid() != owner
        || visible.mode() & 0o077 != 0
        || (held.dev(), held.ino()) != (visible.dev(), visible.ino())
        || !private_info.is_dir()
        || private_info.uid() != owner
        || private_info.mode() & 0o077 != 0
        || fs::canonicalize(root)? != root
        || fs::canonicalize(private)? != private
    {
        return Err(refused());
    }
    Ok(())
}

#[cfg(test)]
#[path = "canonical_sqlite_authority_tests.rs"]
mod tests;
