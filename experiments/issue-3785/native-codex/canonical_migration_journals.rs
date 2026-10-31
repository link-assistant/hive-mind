//! Opt-in Linux journal safety for the pinned native migration experiment.
//! Empty pending journals are durable receipts, never arbitrary truncation targets.
use std::fs::{self, File, Metadata, OpenOptions};
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf};

const DIRECTORY: i32 = 0x10000;
const NOFOLLOW: i32 = 0x20000;
const NONBLOCK: i32 = 0x800;

fn refused() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "Canonical migration journal storage is unavailable or unsafe.",
    )
}

fn identity(info: &Metadata) -> (u64, u64) {
    (info.dev(), info.ino())
}

fn absolute(path: &Path) -> bool {
    path.is_absolute()
        && path.parent().is_some()
        && path
            .components()
            .all(|part| matches!(part, Component::RootDir | Component::Normal(_)))
}

fn directory(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .custom_flags(DIRECTORY | NOFOLLOW)
        .open(path)
}

struct Journal {
    root: PathBuf,
    root_handle: File,
    parent: PathBuf,
    parent_handle: File,
    source: PathBuf,
    anchored: PathBuf,
    owner: u32,
}

impl Journal {
    fn open(root: &Path, private: Option<&Path>, source: &Path) -> io::Result<Self> {
        if !absolute(root) || !absolute(source) {
            return Err(refused());
        }
        if private
            .is_some_and(|home| !absolute(home) || home.starts_with(root) || root.starts_with(home))
        {
            return Err(refused());
        }
        let relative = source
            .strip_prefix(root)
            .or_else(|_| {
                private
                    .ok_or_else(refused)
                    .and_then(|home| source.strip_prefix(home).map_err(|_| refused()))
            })
            .map_err(|_| refused())?;
        let parts: Vec<_> = relative.components().collect();
        if parts.len() != 2 || parts[0].as_os_str() != "rollout-migrations" {
            return Err(refused());
        }
        let name = source.file_name().ok_or_else(refused)?;
        let identifier = name
            .to_str()
            .and_then(|name| name.strip_suffix(".pending"))
            .ok_or_else(refused)?;
        if identifier.len() != 36
            || !identifier.bytes().enumerate().all(|(index, byte)| {
                if [8, 13, 18, 23].contains(&index) {
                    byte == b'-'
                } else {
                    byte.is_ascii_hexdigit()
                }
            })
        {
            return Err(refused());
        }
        let root_handle = directory(root)?;
        let parent = root.join("rollout-migrations");
        let anchored_parent = PathBuf::from(format!(
            "/proc/self/fd/{}/rollout-migrations",
            root_handle.as_raw_fd()
        ));
        let parent_handle = directory(&anchored_parent)?;
        let anchored =
            PathBuf::from(format!("/proc/self/fd/{}", parent_handle.as_raw_fd())).join(name);
        let journal = Self {
            root: root.to_path_buf(),
            root_handle,
            parent,
            parent_handle,
            source: source.to_path_buf(),
            anchored,
            owner: fs::metadata("/proc/self")?.uid(),
        };
        journal.assert_current()?;
        journal.inspect()?;
        Ok(journal)
    }

    fn assert_current(&self) -> io::Result<()> {
        for (public, held) in [
            (&self.root, &self.root_handle),
            (&self.parent, &self.parent_handle),
        ] {
            let visible = fs::symlink_metadata(public)?;
            if !visible.is_dir()
                || visible.uid() != self.owner
                || visible.mode() & 0o077 != 0
                || identity(&visible) != identity(&held.metadata()?)
                || fs::canonicalize(public)?.as_os_str() != public.as_os_str()
            {
                return Err(refused());
            }
        }
        if fs::canonicalize(self.source.parent().ok_or_else(refused)?)? != self.parent {
            return Err(refused());
        }
        Ok(())
    }

    fn safe_file(&self, info: &Metadata) -> bool {
        info.is_file()
            && info.nlink() == 1
            && info.uid() == self.owner
            && info.mode() & 0o077 == 0
            && info.len() == 0
    }

    fn inspect(&self) -> io::Result<Option<Metadata>> {
        match fs::symlink_metadata(&self.anchored) {
            Ok(info) if self.safe_file(&info) => Ok(Some(info)),
            Ok(_) => Err(refused()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn write(&self) -> io::Result<()> {
        self.assert_current()?;
        self.inspect()?;
        let file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(NOFOLLOW | NONBLOCK)
            .open(&self.anchored)
        {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => OpenOptions::new()
                .read(true)
                .custom_flags(NOFOLLOW | NONBLOCK)
                .open(&self.anchored)?,
            Err(error) => return Err(error),
        };
        let opened = file.metadata()?;
        let visible = self.inspect()?.ok_or_else(refused)?;
        if !self.safe_file(&opened) || identity(&opened) != identity(&visible) {
            return Err(refused());
        }
        // Existing valid receipts are already empty. Never truncate a file,
        // even after validation: a linked target must retain all its evidence.
        file.sync_all()?;
        self.parent_handle.sync_all()?;
        self.assert_current()?;
        let visible = self.inspect()?.ok_or_else(refused)?;
        if identity(&visible) != identity(&opened) {
            return Err(refused());
        }
        Ok(())
    }

    fn remove(&self, required: bool) -> io::Result<()> {
        self.assert_current()?;
        if let Some(before) = self.inspect()? {
            if self
                .inspect()?
                .is_none_or(|visible| identity(&visible) != identity(&before))
            {
                return Err(refused());
            }
            fs::remove_file(&self.anchored)?;
            self.parent_handle.sync_all()?;
        } else if required {
            return Err(refused());
        }
        self.assert_current()?;
        if self.inspect()?.is_some() {
            return Err(refused());
        }
        Ok(())
    }
}

fn configured(source: &Path) -> io::Result<Option<Journal>> {
    let Some(root) = std::env::var_os("CODEX_ROLLOUT_HOME") else {
        return Ok(None);
    };
    let private = std::env::var_os("CODEX_HOME").map(PathBuf::from);
    Journal::open(Path::new(&root), private.as_deref(), source).map(Some)
}

pub(crate) fn validate(source: &Path) -> io::Result<()> {
    configured(source).map(|_| ())
}

pub(crate) fn write(source: &Path) -> io::Result<()> {
    configured(source)?.ok_or_else(refused)?.write()
}

pub(crate) fn remove(source: &Path, required: bool) -> io::Result<()> {
    configured(source)?.ok_or_else(refused)?.remove(required)
}

#[cfg(test)]
#[path = "canonical_migration_journals_tests.rs"]
mod tests;
