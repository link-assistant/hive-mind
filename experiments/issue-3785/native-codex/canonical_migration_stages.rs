//! Descriptor-anchored files for the selected native migration experiment.
//! Never truncate an existing inode or follow a staging target into other data.
use std::fs::{self, File, Metadata, OpenOptions};
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf};

const DIRECTORY: i32 = 0x10000;
const NOFOLLOW: i32 = 0x20000;
const NONBLOCK: i32 = 0x800;
const SUFFIXES: [&str; 4] = [
    "paginated.tmp",
    "decompressed.tmp",
    "paginated.zst.tmp",
    "paginated.tmp.head.tmp",
];

fn refused() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "Canonical migration staging storage is unavailable or unsafe.",
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

fn staging_name(name: &str) -> bool {
    name.starts_with(".rollout-")
        && SUFFIXES.iter().any(|suffix| {
            name.strip_suffix(&format!(".{suffix}"))
                .is_some_and(|stem| stem.ends_with(".jsonl") || stem.ends_with(".jsonl.zst"))
        })
}

fn rollout_name(name: &str) -> bool {
    name.starts_with("rollout-") && (name.ends_with(".jsonl") || name.ends_with(".jsonl.zst"))
}

struct SelectedPath {
    handles: Vec<(PathBuf, File)>,
    source: PathBuf,
    anchored: PathBuf,
    owner: u32,
    staging: bool,
}

impl SelectedPath {
    fn open(root: &Path, private: Option<&Path>, source: &Path) -> io::Result<Self> {
        if !absolute(root)
            || !absolute(source)
            || private.is_some_and(|home| {
                !absolute(home) || home.starts_with(root) || root.starts_with(home)
            })
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
        if !(2..=12).contains(&parts.len())
            || !matches!(parts[0], Component::Normal(name) if name == "sessions" || name == "archived_sessions")
            || !parts
                .iter()
                .all(|part| matches!(part, Component::Normal(_)))
        {
            return Err(refused());
        }
        let name = source
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(refused)?;
        let staging = staging_name(name);
        if !staging && !rollout_name(name) {
            return Err(refused());
        }
        let owner = fs::metadata("/proc/self")?.uid();
        let mut handles = vec![(root.to_path_buf(), directory(root)?)];
        let info = handles[0].1.metadata()?;
        if info.uid() != owner || info.mode() & 0o077 != 0 {
            return Err(refused());
        }
        for part in &parts[..parts.len() - 1] {
            let (parent, held) = handles.last().ok_or_else(refused)?;
            let public = parent.join(part.as_os_str());
            let anchored =
                PathBuf::from(format!("/proc/self/fd/{}", held.as_raw_fd())).join(part.as_os_str());
            handles.push((public, directory(&anchored)?));
        }
        let anchored = PathBuf::from(format!(
            "/proc/self/fd/{}",
            handles.last().ok_or_else(refused)?.1.as_raw_fd()
        ))
        .join(name);
        let selected = Self {
            handles,
            source: source.to_path_buf(),
            anchored,
            owner,
            staging,
        };
        selected.assert_current()?;
        selected.inspect()?;
        Ok(selected)
    }

    fn assert_current(&self) -> io::Result<()> {
        for (public, held) in &self.handles {
            let info = fs::symlink_metadata(public)?;
            if !info.is_dir()
                || info.uid() != self.owner
                || info.mode() & 0o022 != 0
                || (public == &self.handles[0].0 && info.mode() & 0o077 != 0)
                || identity(&info) != identity(&held.metadata()?)
                || fs::canonicalize(public)?.as_os_str() != public.as_os_str()
            {
                return Err(refused());
            }
        }
        if fs::canonicalize(self.source.parent().ok_or_else(refused)?)?
            != self.handles.last().ok_or_else(refused)?.0
        {
            return Err(refused());
        }
        Ok(())
    }

    fn safe_file(&self, info: &Metadata) -> bool {
        info.is_file() && info.uid() == self.owner && info.nlink() == 1 && info.mode() & 0o077 == 0
    }

    fn inspect(&self) -> io::Result<Option<Metadata>> {
        match fs::symlink_metadata(&self.anchored) {
            Ok(info) if self.safe_file(&info) => Ok(Some(info)),
            Ok(_) => Err(refused()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn open_existing(&self, write: bool) -> io::Result<File> {
        self.assert_current()?;
        let before = self.inspect()?.ok_or_else(refused)?;
        let file = OpenOptions::new()
            .read(true)
            .write(write)
            .custom_flags(NOFOLLOW | NONBLOCK)
            .open(&self.anchored)?;
        if !self.safe_file(&file.metadata()?)
            || identity(&before) != identity(&file.metadata()?)
            || self
                .inspect()?
                .is_none_or(|visible| identity(&visible) != identity(&before))
        {
            return Err(refused());
        }
        self.assert_current()?;
        Ok(file)
    }

    fn remove(&self) -> io::Result<()> {
        if !self.staging {
            return Err(refused());
        }
        self.assert_current()?;
        if let Some(before) = self.inspect()? {
            // Unlink only the anchored entry. Even a later replacement cannot
            // redirect this operation into another directory or truncate data.
            if self
                .inspect()?
                .is_none_or(|visible| identity(&visible) != identity(&before))
            {
                return Err(refused());
            }
            fs::remove_file(&self.anchored)?;
            self.handles.last().ok_or_else(refused)?.1.sync_all()?;
        }
        self.assert_current()
    }

    fn create(&self) -> io::Result<File> {
        if !self.staging {
            return Err(refused());
        }
        // A safe orphan can be rebuilt after a crash. Replace its directory
        // entry, never truncate its inode; create_new refuses a racing entry.
        self.remove()?;
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(NOFOLLOW | NONBLOCK)
            .open(&self.anchored)?;
        let opened = file.metadata()?;
        if !self.safe_file(&opened)
            || self
                .inspect()?
                .is_none_or(|visible| identity(&visible) != identity(&opened))
        {
            return Err(refused());
        }
        self.assert_current()?;
        Ok(file)
    }
}

fn configured(source: &Path) -> io::Result<SelectedPath> {
    let root = std::env::var_os("CODEX_ROLLOUT_HOME").ok_or_else(refused)?;
    let private = std::env::var_os("CODEX_HOME").map(PathBuf::from);
    SelectedPath::open(Path::new(&root), private.as_deref(), source)
}

pub(crate) fn validate_rollout(source: &Path) -> io::Result<()> {
    let Some(root) = std::env::var_os("CODEX_ROLLOUT_HOME") else {
        return Ok(());
    };
    let private = std::env::var_os("CODEX_HOME").map(PathBuf::from);
    validate_rollout_in(Path::new(&root), private.as_deref(), source)
}

fn validate_rollout_in(root: &Path, private: Option<&Path>, source: &Path) -> io::Result<()> {
    let selected = SelectedPath::open(root, private, source)?;
    if selected.staging || selected.inspect()?.is_none() {
        return Err(refused());
    }
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(refused)?;
    for suffix in SUFFIXES {
        SelectedPath::open(
            root,
            private,
            &source.with_file_name(format!(".{name}.{suffix}")),
        )?;
    }
    selected.assert_current()
}

pub(crate) fn open_write(source: &Path) -> io::Result<File> {
    configured(source)?.create()
}

pub(crate) fn open_existing(source: &Path, write: bool) -> io::Result<File> {
    configured(source)?.open_existing(write)
}

pub(crate) fn remove(source: &Path) -> io::Result<()> {
    configured(source)?.remove()
}

pub(crate) fn publish(source: &Path, target: &Path) -> io::Result<()> {
    let source = configured(source)?;
    let target = configured(target)?;
    publish_selected(&source, &target)
}

fn publish_selected(source: &SelectedPath, target: &SelectedPath) -> io::Result<()> {
    let before = source.inspect()?.ok_or_else(refused)?;
    if !source.staging
        || source.handles.last().ok_or_else(refused)?.0
            != target.handles.last().ok_or_else(refused)?.0
    {
        return Err(refused());
    }
    source.assert_current()?;
    target.assert_current()?;
    target.inspect()?;
    fs::rename(&source.anchored, &target.anchored)?;
    target.handles.last().ok_or_else(refused)?.1.sync_all()?;
    if target
        .inspect()?
        .is_none_or(|visible| identity(&visible) != identity(&before))
    {
        return Err(refused());
    }
    source.assert_current()?;
    target.assert_current()
}

#[cfg(test)]
#[path = "canonical_migration_stages_tests.rs"]
mod tests;
