//! Select guarded SQLite I/O only for explicitly selected canonical history.
use sqlx::Error;
use sqlx::sqlite::SqliteConnectOptions;
use std::ffi::CString;
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::path::PathBuf;

const DATABASES: [&str; 7] = [
    "state_5.sqlite",
    "logs_2.sqlite",
    "goals_1.sqlite",
    "memories_1.sqlite",
    "memories_v2_1.sqlite",
    "queue_1.sqlite",
    "thread_history_1.sqlite",
];

unsafe extern "C" {
    fn hive_canonical_sqlite_vfs(root: *const std::ffi::c_char) -> std::ffi::c_int;
    fn hive_canonical_sqlite_backup(
        path: *const std::ffi::c_char,
        relative: *mut std::ffi::c_char,
        capacity: usize,
        moved: *mut u32,
    ) -> std::ffi::c_int;
}

fn refused() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "Canonical SQLite configuration is unavailable or unsafe.",
    )
}

/// Retain canonical directory and database authority before native pools open.
/// Held main descriptors remain alive until process disposal to preserve locks.
pub fn admit_canonical_sqlite(root: &Path) -> io::Result<()> {
    let selected = std::env::var_os("CODEX_SQLITE_HOME").ok_or_else(refused)?;
    let rollout = std::env::var_os("CODEX_ROLLOUT_HOME").ok_or_else(refused)?;
    if root.as_os_str() != selected || root.as_os_str() != rollout {
        return Err(refused());
    }
    let root = CString::new(root.as_os_str().as_bytes()).map_err(|_| refused())?;
    // SAFETY: CString retains a terminated root for this call. The native
    // authority copies it and owns all process-lifetime state and callbacks.
    if unsafe { hive_canonical_sqlite_vfs(root.as_ptr()) } != 0 {
        return Err(refused());
    }
    Ok(())
}

pub(crate) fn options(
    path: &Path,
    options: SqliteConnectOptions,
) -> Result<SqliteConnectOptions, Error> {
    let Some(root) = std::env::var_os("CODEX_ROLLOUT_HOME") else {
        return Ok(options);
    };
    let root = Path::new(&root);
    if !DATABASES
        .iter()
        .any(|name| root.join(name).as_os_str() == path.as_os_str())
    {
        return Err(Error::Io(refused()));
    }
    admit_canonical_sqlite(root).map_err(Error::Io)?;
    Ok(options.vfs("hive-canonical-sqlite"))
}

/// Run the finite descriptor-relative backup outside the async executor. The
/// caller reports exactly the files moved; ordinary recovery does not call it.
pub(crate) fn backup(path: &Path) -> io::Result<Vec<(PathBuf, PathBuf)>> {
    let root = std::env::var_os("CODEX_ROLLOUT_HOME").ok_or_else(refused)?;
    let root = Path::new(&root);
    let name = DATABASES
        .iter()
        .find(|name| root.join(name).as_os_str() == path.as_os_str())
        .ok_or_else(refused)?;
    admit_canonical_sqlite(root)?;
    let path = CString::new(path.as_os_str().as_bytes()).map_err(|_| refused())?;
    let mut relative = [0u8; 4096];
    let mut moved = 0;
    // SAFETY: the terminated path and writable, bounded output buffers remain
    // alive for this synchronous call. The native gate owns all file handles.
    let result = unsafe {
        hive_canonical_sqlite_backup(
            path.as_ptr(),
            relative.as_mut_ptr().cast(),
            relative.len(),
            &mut moved,
        )
    };
    if result == libsqlite3_sys::SQLITE_BUSY {
        return Err(io::Error::new(
            io::ErrorKind::WouldBlock,
            "Canonical SQLite recovery requires closed database handles and no live native peers.",
        ));
    }
    if result != libsqlite3_sys::SQLITE_OK || moved == 0 || moved & !15 != 0 {
        return Err(refused());
    }
    let end = relative
        .iter()
        .position(|byte| *byte == 0)
        .ok_or_else(refused)?;
    let relative = std::str::from_utf8(&relative[..end]).map_err(|_| refused())?;
    if !relative.starts_with("db-backups/sqlite-") || relative.contains("..") {
        return Err(refused());
    }
    let mut backups = Vec::new();
    for (index, suffix) in ["", "-wal", "-shm", "-journal"].into_iter().enumerate() {
        if moved & (1 << index) != 0 {
            let leaf = format!("{name}{suffix}");
            backups.push((root.join(&leaf), root.join(relative).join(leaf)));
        }
    }
    Ok(backups)
}
