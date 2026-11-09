//! Validate final native configuration before selected SQLite databases open.
//! This is path-policy admission; SQLite operation/descriptor leases are separate.
use std::fs::{self, File, OpenOptions};
use std::io;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

// ARM64 uses distinct Linux UAPI directory/no-follow bits from x86-64.
const NOFOLLOW: i32 = if cfg!(target_arch = "aarch64") {
    0x8000
} else {
    0x20000
};
const DIRECTORY: i32 = if cfg!(target_arch = "aarch64") {
    0x4000
} else {
    0x10000
};
const NONBLOCK: i32 = 0x800;
const DATABASES: [&str; 7] = [
    "state_5.sqlite",
    "logs_2.sqlite",
    "goals_1.sqlite",
    "memories_1.sqlite",
    "memories_v2_1.sqlite",
    "queue_1.sqlite",
    "thread_history_1.sqlite",
];

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

// This admission does not hold a lease across later SQLite operations. Keep all
// metadata checks bounded and never open aliases, repair or read database data.
fn database_files(root: &Path, owner: u32) -> io::Result<()> {
    for database in DATABASES {
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let path = root.join(format!("{database}{suffix}"));
            let before = match fs::symlink_metadata(&path) {
                Ok(info) => info,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            if !before.is_file()
                || before.uid() != owner
                || before.nlink() != 1
                || before.mode() & 0o022 != 0
            {
                return Err(refused());
            }
            let descriptor = OpenOptions::new()
                .read(true)
                .custom_flags(NOFOLLOW | NONBLOCK)
                .open(&path)?;
            let held = descriptor.metadata()?;
            let visible = fs::symlink_metadata(&path)?;
            for info in [&held, &visible] {
                if !info.is_file()
                    || info.uid() != owner
                    || info.nlink() != 1
                    || info.mode() & 0o022 != 0
                    || (info.dev(), info.ino()) != (before.dev(), before.ino())
                {
                    return Err(refused());
                }
            }
        }
    }
    Ok(())
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
    database_files(root, owner)?;
    let after = fs::symlink_metadata(root)?;
    if !after.is_dir()
        || after.uid() != owner
        || after.mode() & 0o077 != 0
        || (held.dev(), held.ino()) != (after.dev(), after.ino())
        || fs::canonicalize(root)? != root
    {
        return Err(refused());
    }
    Ok(())
}

#[cfg(test)]
#[path = "canonical_sqlite_authority_tests.rs"]
mod tests;
