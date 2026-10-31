//! Linux prompt-history experiment. One canonical directory, one stable lock,
//! and synced atomic publication; never materialize history in private config.
use std::fs::{self, File, Metadata, OpenOptions, TryLockError};
use std::io::{self, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

const HISTORY: &str = "history.jsonl";
const LOCK: &str = ".hive-message-history.lock";
const NOFOLLOW: i32 = 0x20000;
const DIRECTORY: i32 = 0x10000;
const NONBLOCK: i32 = 0x800;
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn refused() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "Canonical prompt history is unavailable or unsafe.",
    )
}
fn identity(info: &Metadata) -> (u64, u64) {
    (info.dev(), info.ino())
}
fn owner() -> io::Result<u32> {
    Ok(fs::metadata("/proc/self")?.uid())
}
fn safe_file(info: &Metadata) -> io::Result<bool> {
    Ok(info.is_file() && info.nlink() == 1 && info.uid() == owner()? && info.mode() & 0o077 == 0)
}
pub(crate) fn selected() -> bool {
    std::env::var_os("CODEX_MESSAGE_HISTORY_HOME").is_some()
}

struct Authority {
    path: PathBuf,
    directory: File,
    private_path: PathBuf,
    private_home: PathBuf,
}
impl Authority {
    fn open(private_path: &Path) -> io::Result<Self> {
        let path =
            PathBuf::from(std::env::var_os("CODEX_MESSAGE_HISTORY_HOME").ok_or_else(refused)?);
        if !path.is_absolute()
            || path.parent().is_none()
            || path
                .components()
                .any(|part| !matches!(part, Component::RootDir | Component::Normal(_)))
            || fs::canonicalize(&path)? != path
        {
            return Err(refused());
        }
        let private_home = fs::canonicalize(private_path.parent().ok_or_else(refused)?)?;
        if path.starts_with(&private_home) || private_home.starts_with(&path) {
            return Err(refused());
        }
        match fs::symlink_metadata(private_path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            _ => return Err(refused()),
        }
        let directory = OpenOptions::new()
            .read(true)
            .custom_flags(NOFOLLOW | DIRECTORY)
            .open(&path)?;
        let authority = Self {
            path,
            directory,
            private_path: private_path.to_path_buf(),
            private_home,
        };
        authority.assert_current()?;
        Ok(authority)
    }
    fn entry(&self, name: &str) -> PathBuf {
        PathBuf::from(format!("/proc/self/fd/{}", self.directory.as_raw_fd())).join(name)
    }
    fn assert_current(&self) -> io::Result<()> {
        let current = fs::symlink_metadata(&self.path)?;
        if !current.is_dir()
            || current.uid() != owner()?
            || current.mode() & 0o077 != 0
            || identity(&current) != identity(&self.directory.metadata()?)
            || fs::canonicalize(&self.path)? != self.path
        {
            return Err(refused());
        }
        if fs::canonicalize(self.private_path.parent().ok_or_else(refused)?)? != self.private_home {
            return Err(refused());
        }
        match fs::symlink_metadata(&self.private_path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            _ => return Err(refused()),
        }
        Ok(())
    }
    fn assert_lock(&self, guard: &File) -> io::Result<()> {
        self.assert_current()?;
        let current = fs::symlink_metadata(self.entry(LOCK))?;
        if !safe_file(&current)? || identity(&current) != identity(&guard.metadata()?) {
            return Err(refused());
        }
        Ok(())
    }
    fn acquire(&self) -> io::Result<File> {
        let guard = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(NOFOLLOW | NONBLOCK)
            .open(self.entry(LOCK))?;
        if !safe_file(&guard.metadata()?)? {
            return Err(refused());
        }
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match guard.try_lock() {
                Ok(()) => {
                    self.assert_lock(&guard)?;
                    return Ok(guard);
                }
                Err(TryLockError::WouldBlock) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(TryLockError::WouldBlock) => {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "Canonical prompt history lock deadline exceeded.",
                    ));
                }
                Err(TryLockError::Error(error)) => return Err(error),
            }
        }
    }
    fn validate_history(&self) -> io::Result<()> {
        match fs::symlink_metadata(self.entry(HISTORY)) {
            Ok(info) if safe_file(&info)? => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            _ => Err(refused()),
        }
    }
}

pub(crate) fn with_history<T>(
    private_path: &Path,
    operation: impl FnOnce(&Path) -> io::Result<T>,
) -> io::Result<T> {
    let authority = Authority::open(private_path)?;
    let guard = authority.acquire()?;
    authority.validate_history()?;
    let result = operation(&authority.entry(HISTORY))?;
    authority.assert_lock(&guard)?;
    authority.validate_history()?;
    authority.directory.sync_all()?;
    Ok(result)
}

pub(crate) fn open_read(path: &Path) -> io::Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(NOFOLLOW | NONBLOCK)
        .open(path)?;
    if !safe_file(&file.metadata()?)? {
        return Err(refused());
    }
    Ok(file)
}

pub(crate) fn log_id(path: &Path) -> io::Result<u64> {
    // The data inode changes on publication. The lock inode identifies this
    // logical history for native TUI cursors across those atomic appends.
    Ok(open_read(&path.with_file_name(LOCK))?.metadata()?.ino())
}

pub(crate) fn append(private_path: &Path, line: &[u8]) -> io::Result<()> {
    with_history(private_path, |path| {
        let temporary = path.with_extension(format!(
            "jsonl.tmp.{}.{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let mut created = false;
        let result = (|| {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .custom_flags(NOFOLLOW)
                .open(&temporary)?;
            created = true;
            match open_read(path) {
                Ok(mut previous) => {
                    // Stream the existing history; do not buffer the full file.
                    io::copy(&mut previous, &mut file)?;
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
            file.write_all(line)?;
            file.sync_all()?;
            fs::rename(&temporary, path)?;
            File::open(path.parent().ok_or_else(refused)?)?.sync_all()
        })();
        if result.is_err() && created {
            let _ = fs::remove_file(temporary);
        }
        result
    })
}

pub(crate) fn metadata(private_path: &Path) -> io::Result<(u64, usize)> {
    with_history(private_path, |path| {
        let mut file = match open_read(path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok((0, 0)),
            Err(error) => return Err(error),
        };
        let id = log_id(path)?;
        let mut count = 0usize;
        let mut buffer = [0u8; 8192];
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                return Ok((id, count));
            }
            count += buffer[..read].iter().filter(|byte| **byte == b'\n').count();
        }
    })
}
