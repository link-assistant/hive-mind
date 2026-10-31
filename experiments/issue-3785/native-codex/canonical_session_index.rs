//! Experimental Linux session-index authority for the pinned native CLI.
//! Keep configuration private while all index reads and mutations use one
//! directory and one stable OS lock. No selector retains upstream behavior.
use std::fs::{self, File, Metadata, OpenOptions, TryLockError};
use std::io::{self, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

const NOFOLLOW: i32 = 0x20000;
const DIRECTORY: i32 = 0x10000;
const NONBLOCK: i32 = 0x800;
const INDEX: &str = "session_index.jsonl";
const LOCK: &str = ".hive-session-index.lock";
const MAX_REWRITE: u64 = 32 * 1024 * 1024;
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn refused() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "Canonical session index is unavailable or unsafe.",
    )
}

fn identity(info: &Metadata) -> (u64, u64) {
    (info.dev(), info.ino())
}
fn safe_file(info: &Metadata, owner: u32) -> bool {
    info.is_file() && info.nlink() == 1 && info.uid() == owner && info.mode() & 0o077 == 0
}

struct Authority {
    path: PathBuf,
    directory: File,
    owner: u32,
}
impl Authority {
    fn open(path: &Path) -> io::Result<Self> {
        if !path.is_absolute()
            || path.parent().is_none()
            || path
                .components()
                .any(|part| !matches!(part, Component::RootDir | Component::Normal(_)))
            || fs::canonicalize(path)? != path
        {
            return Err(refused());
        }
        let owner = fs::metadata("/proc/self")?.uid();
        let directory = OpenOptions::new()
            .read(true)
            .custom_flags(DIRECTORY | NOFOLLOW)
            .open(path)?;
        let authority = Self {
            path: path.to_owned(),
            directory,
            owner,
        };
        authority.assert_current()?;
        Ok(authority)
    }
    fn entry(&self, name: &str) -> PathBuf {
        PathBuf::from(format!("/proc/self/fd/{}", self.directory.as_raw_fd())).join(name)
    }
    fn assert_current(&self) -> io::Result<()> {
        let info = fs::symlink_metadata(&self.path)?;
        if !info.is_dir()
            || info.uid() != self.owner
            || info.mode() & 0o077 != 0
            || identity(&info) != identity(&self.directory.metadata()?)
            || fs::canonicalize(&self.path)? != self.path
        {
            return Err(refused());
        }
        Ok(())
    }
    fn validate_index(&self) -> io::Result<()> {
        match fs::symlink_metadata(self.entry(INDEX)) {
            Ok(info) if safe_file(&info, self.owner) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            _ => Err(refused()),
        }
    }
    fn acquire(&self) -> io::Result<File> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(NOFOLLOW | NONBLOCK)
            .open(self.entry(LOCK))?;
        if !safe_file(&file.metadata()?, self.owner) {
            return Err(refused());
        }
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match file.try_lock() {
                Ok(()) => {
                    self.assert_lock(&file)?;
                    return Ok(file);
                }
                Err(TryLockError::WouldBlock) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(TryLockError::WouldBlock) => {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "Canonical session index lock deadline exceeded.",
                    ));
                }
                Err(TryLockError::Error(_)) => return Err(refused()),
            }
        }
    }
    fn assert_lock(&self, file: &File) -> io::Result<()> {
        self.assert_current()?;
        let current = fs::symlink_metadata(self.entry(LOCK))?;
        if !safe_file(&current, self.owner) || identity(&current) != identity(&file.metadata()?) {
            return Err(refused());
        }
        Ok(())
    }
}

pub(crate) fn with_index<T>(
    private_path: &Path,
    operation: impl FnOnce(&Path) -> io::Result<T>,
) -> io::Result<T> {
    let Some(root) = std::env::var_os("CODEX_SESSION_INDEX_HOME") else {
        return operation(private_path);
    };
    let authority = Authority::open(Path::new(&root))?;
    if private_path != authority.path.join(INDEX) {
        match fs::symlink_metadata(private_path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            _ => return Err(refused()),
        }
    }
    let guard = authority.acquire()?;
    authority.validate_index()?;
    let result = operation(&authority.entry(INDEX))?;
    authority.assert_lock(&guard)?;
    authority.validate_index()?;
    authority.directory.sync_all()?;
    Ok(result)
}

pub(crate) fn exists(path: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(refused()),
    }
}

pub(crate) fn open_read(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    if std::env::var_os("CODEX_SESSION_INDEX_HOME").is_some() {
        options.custom_flags(NOFOLLOW | NONBLOCK);
    }
    let file = options.open(path)?;
    if std::env::var_os("CODEX_SESSION_INDEX_HOME").is_some()
        && !safe_file(&file.metadata()?, fs::metadata("/proc/self")?.uid())
    {
        return Err(refused());
    }
    Ok(file)
}

pub(crate) fn open_append(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    if std::env::var_os("CODEX_SESSION_INDEX_HOME").is_some() {
        options.mode(0o600).custom_flags(NOFOLLOW | NONBLOCK);
    }
    let file = options.open(path)?;
    if std::env::var_os("CODEX_SESSION_INDEX_HOME").is_some()
        && !safe_file(&file.metadata()?, fs::metadata("/proc/self")?.uid())
    {
        return Err(refused());
    }
    Ok(file)
}

pub(crate) fn read_string(path: &Path) -> io::Result<String> {
    if std::env::var_os("CODEX_SESSION_INDEX_HOME").is_none() {
        return fs::read_to_string(path);
    }
    let mut bytes = Vec::new();
    open_read(path)?
        .take(MAX_REWRITE + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_REWRITE {
        return Err(refused());
    }
    String::from_utf8(bytes).map_err(|_| refused())
}

pub(crate) fn replace(path: &Path, contents: &str) -> io::Result<()> {
    if std::env::var_os("CODEX_SESSION_INDEX_HOME").is_none() {
        let temporary = path.with_extension("jsonl.tmp");
        fs::write(&temporary, contents)?;
        return fs::rename(temporary, path);
    }
    if contents.len() as u64 > MAX_REWRITE {
        return Err(refused());
    }
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
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        File::open(path.parent().ok_or_else(refused)?)?.sync_all()
    })();
    if result.is_err() && created {
        let _ = fs::remove_file(temporary);
    }
    result
}

#[cfg(test)]
#[path = "canonical_session_index_tests.rs"]
mod tests;
