//! Linux file-store adapter for the pinned Codex source experiment.
//! This module is not installed or selected by production launchers yet.
//! Configuration/skills stay in CODEX_HOME; CODEX_AUTH_HOME selects only auth.
//! All errors are structural: never include credential bytes or parser excerpts.
use std::fs::{self, File, Metadata, OpenOptions, TryLockError};
use std::io::{self, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const O_DIRECTORY: i32 = 0x10000;
const O_NOFOLLOW: i32 = 0x20000;
const O_NONBLOCK: i32 = 0x800;
const LIMIT: u64 = 1024 * 1024;
const LOCK: &str = ".hive-mind-refresh.lock";
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn refused() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "Canonical authentication storage is unavailable or unsafe.",
    )
}

fn identity(info: &Metadata) -> (u64, u64) {
    (info.dev(), info.ino())
}

fn uid() -> io::Result<u32> {
    // Linux procfs exposes this process's real owner without another crate or
    // parsing a configurable home. Production Linux images require procfs.
    Ok(fs::metadata("/proc/self")?.uid())
}

fn safe_file(info: &Metadata, owner: u32) -> bool {
    info.is_file() && info.nlink() == 1 && info.uid() == owner && info.mode() & 0o077 == 0
}

#[derive(Debug)]
pub(crate) struct CanonicalAuth {
    path: PathBuf,
    directory: File,
    owner: u32,
}

impl CanonicalAuth {
    pub(crate) fn configured() -> io::Result<Option<Self>> {
        match std::env::var_os("CODEX_AUTH_HOME") {
            None => Ok(None),
            Some(path) => Self::open(Path::new(&path)).map(Some),
        }
    }

    pub(crate) fn open(path: &Path) -> io::Result<Self> {
        if !path.is_absolute() || path.parent().is_none() || path.as_os_str().is_empty() {
            return Err(refused());
        }
        for component in path.components() {
            if !matches!(component, Component::RootDir | Component::Normal(_)) {
                return Err(refused());
            }
        }
        // Equality rejects symlink ancestors and selectors that would otherwise
        // resolve to an unexpected authority.
        if fs::canonicalize(path)? != path {
            return Err(refused());
        }
        let owner = uid()?;
        let directory = OpenOptions::new()
            .read(true)
            .custom_flags(O_DIRECTORY | O_NOFOLLOW)
            .open(path)?;
        let shared = Self {
            path: path.to_path_buf(),
            directory,
            owner,
        };
        shared.assert_current()?;
        Ok(shared)
    }

    fn entry(&self, name: &str) -> PathBuf {
        // Anchor operations to the opened directory, rather than following a
        // path ancestor replaced between validation and a filesystem operation.
        PathBuf::from(format!("/proc/self/fd/{}", self.directory.as_raw_fd())).join(name)
    }

    pub(crate) fn conflicts_with(&self, configuration_home: &Path) -> bool {
        if configuration_home == self.path {
            return false;
        }
        match fs::symlink_metadata(configuration_home.join("auth.json")) {
            Err(err) if err.kind() == io::ErrorKind::NotFound => false,
            // An independent file, redirected link, directory or inspection
            // failure must stop admission, even if contents happen to match.
            _ => true,
        }
    }

    pub(crate) fn assert_current(&self) -> io::Result<()> {
        let opened = self.directory.metadata()?;
        let current = fs::symlink_metadata(&self.path)?;
        if !current.is_dir()
            || current.uid() != self.owner
            || current.mode() & 0o077 != 0
            || identity(&current) != identity(&opened)
            || fs::canonicalize(&self.path)? != self.path
        {
            return Err(refused());
        }
        Ok(())
    }

    fn inspect_auth(&self) -> io::Result<Option<Metadata>> {
        match fs::symlink_metadata(self.entry("auth.json")) {
            Ok(info) if safe_file(&info, self.owner) && info.len() <= LIMIT => Ok(Some(info)),
            Ok(_) => Err(refused()),
            Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(refused()),
        }
    }

    pub(crate) fn read(&self) -> io::Result<Option<Vec<u8>>> {
        self.assert_current()?;
        let Some(before) = self.inspect_auth()? else {
            return Ok(None);
        };
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(O_NOFOLLOW | O_NONBLOCK)
            .open(self.entry("auth.json"))?;
        let opened = file.metadata()?;
        if !safe_file(&opened, self.owner) || identity(&opened) != identity(&before) {
            return Err(refused());
        }
        let mut bytes = Vec::new();
        file.take(LIMIT + 1).read_to_end(&mut bytes)?;
        let current = self.inspect_auth()?.ok_or_else(refused)?;
        self.assert_current()?;
        if bytes.len() as u64 > LIMIT
            || identity(&current) != identity(&opened)
            || current.len() != opened.len()
            || current.mtime_nsec() != opened.mtime_nsec()
            || current.ctime_nsec() != opened.ctime_nsec()
            || current.mtime() != opened.mtime()
            || current.ctime() != opened.ctime()
        {
            return Err(refused());
        }
        Ok(Some(bytes))
    }

    pub(crate) fn write(&self, bytes: &[u8]) -> io::Result<()> {
        if bytes.len() as u64 > LIMIT {
            return Err(refused());
        }
        self.assert_current()?;
        self.inspect_auth()?;
        let name = format!(
            ".auth-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let temporary = self.entry(&name);
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(O_NOFOLLOW)
            .open(&temporary)?;
        let result = (|| {
            file.write_all(bytes)?;
            file.sync_all()?;
            self.assert_current()?;
            self.inspect_auth()?;
            fs::rename(&temporary, self.entry("auth.json"))?;
            self.directory.sync_all()
        })();
        // The file was created by this operation; cleanup never targets a lock
        // or another generation. A failed rename preserves prior credentials.
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }

    pub(crate) fn delete(&self) -> io::Result<bool> {
        self.assert_current()?;
        if self.inspect_auth()?.is_none() {
            return Ok(false);
        }
        fs::remove_file(self.entry("auth.json"))?;
        self.directory.sync_all()?;
        Ok(true)
    }

    pub(crate) fn try_lock(self) -> io::Result<Result<RefreshLock, Self>> {
        self.assert_current()?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(O_NOFOLLOW | O_NONBLOCK)
            .open(self.entry(LOCK))?;
        if !safe_file(&file.metadata()?, self.owner) {
            return Err(refused());
        }
        match file.try_lock() {
            Ok(()) => {
                let guard = RefreshLock { shared: self, file };
                guard.assert_current()?;
                Ok(Ok(guard))
            }
            Err(TryLockError::WouldBlock) => Ok(Err(self)),
            Err(TryLockError::Error(_)) => Err(refused()),
        }
    }
}

#[derive(Debug)]
pub(crate) struct RefreshLock {
    shared: CanonicalAuth,
    file: File,
}

impl RefreshLock {
    pub(crate) fn assert_current(&self) -> io::Result<()> {
        self.shared.assert_current()?;
        let info = fs::symlink_metadata(self.shared.entry(LOCK))?;
        if !safe_file(&info, self.shared.owner)
            || identity(&info) != identity(&self.file.metadata()?)
        {
            return Err(refused());
        }
        Ok(())
    }
}
