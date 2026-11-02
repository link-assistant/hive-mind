//! Linux-only native maintenance lock experiment; no lock-inode deletion.
//! Callers retain both descriptors while native compression/migration runs.
use std::fs::{self, File, Metadata, OpenOptions, TryLockError};
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf};

// ARM64 uses distinct Linux UAPI directory/no-follow bits from x86-64.
const LOCK: &str = "rollout-maintenance.lock";
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

fn refused() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "Canonical rollout maintenance storage is unavailable or unsafe.",
    )
}
fn identity(info: &Metadata) -> (u64, u64) {
    (info.dev(), info.ino())
}
fn safe_lock(info: &Metadata, owner: u32) -> bool {
    info.is_file() && info.nlink() == 1 && info.uid() == owner && info.mode() & 0o077 == 0
}

pub(crate) fn try_acquire(private_home: &Path, root: &Path) -> io::Result<Option<(File, File)>> {
    if !root.is_absolute()
        || root.parent().is_none()
        || root
            .components()
            .any(|part| !matches!(part, Component::RootDir | Component::Normal(_)))
        || fs::canonicalize(root)? != root
    {
        return Err(refused());
    }
    let private_home = fs::canonicalize(private_home)?;
    if root.starts_with(&private_home) || private_home.starts_with(root) {
        return Err(refused());
    }
    match fs::symlink_metadata(private_home.join(".tmp").join(LOCK)) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        _ => return Err(refused()),
    }
    let owner = fs::metadata("/proc/self")?.uid();
    let directory = OpenOptions::new()
        .read(true)
        .custom_flags(NOFOLLOW | DIRECTORY)
        .open(root)?;
    let assert_directory = || {
        let info = fs::symlink_metadata(root)?;
        if !info.is_dir()
            || info.uid() != owner
            || info.mode() & 0o077 != 0
            || identity(&info) != identity(&directory.metadata()?)
            || fs::canonicalize(root)? != root
        {
            return Err(refused());
        }
        Ok(())
    };
    assert_directory()?;
    let lock_path = PathBuf::from(format!("/proc/self/fd/{}", directory.as_raw_fd())).join(LOCK);
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(NOFOLLOW | NONBLOCK)
        .open(&lock_path)?;
    if !safe_lock(&file.metadata()?, owner) {
        return Err(refused());
    }
    let acquired = match file.try_lock() {
        Ok(()) => true,
        Err(TryLockError::WouldBlock) => false,
        Err(TryLockError::Error(error)) => return Err(error),
    };
    assert_directory()?;
    let info = fs::symlink_metadata(&lock_path)?;
    if !safe_lock(&info, owner) || identity(&info) != identity(&file.metadata()?) {
        return Err(refused());
    }
    if !acquired {
        return Ok(None);
    }
    file.sync_all()?;
    directory.sync_all()?;
    Ok(Some((file, directory)))
}
