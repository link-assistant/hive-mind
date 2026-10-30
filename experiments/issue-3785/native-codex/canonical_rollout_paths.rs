//! Experimental SQLite rollout-path projection. Does not move configuration.
//! The native writer still owns rollout selection (including immutable reverts).
use std::fs::{self, File, Metadata, OpenOptions};
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf};

const NOFOLLOW: i32 = 0x20000;
const DIRECTORY: i32 = 0x10000;

fn refused() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "Canonical rollout metadata path is unavailable or unsafe.",
    )
}

fn identity(info: &Metadata) -> (u64, u64) {
    (info.dev(), info.ino())
}

fn absolute(path: &Path) -> bool {
    path.is_absolute()
        && path.parent().is_some()
        && !path
            .components()
            .any(|part| !matches!(part, Component::RootDir | Component::Normal(_)))
}

fn directory(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .custom_flags(NOFOLLOW | DIRECTORY)
        .open(path)
}

/// With no selector, retain upstream behavior. A selected root never falls back
/// to recording the private alias when projection fails.
pub(crate) fn persisted_path(path: &Path) -> io::Result<PathBuf> {
    let Some(root) = std::env::var_os("CODEX_ROLLOUT_HOME") else {
        return Ok(path.to_path_buf());
    };
    let private = std::env::var_os("CODEX_HOME").map(PathBuf::from);
    project(Path::new(&root), private.as_deref(), path)
}

fn project(root: &Path, private: Option<&Path>, source: &Path) -> io::Result<PathBuf> {
    if !absolute(root) || !absolute(source) || fs::canonicalize(root)? != root {
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
    if parts.len() < 2
        || !matches!(parts[0], Component::Normal(name) if name == "sessions" || name == "archived_sessions")
        || parts
            .iter()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(refused());
    }
    let name = source.file_name().ok_or_else(refused)?;
    if !name.as_encoded_bytes().ends_with(b".jsonl")
        && !name.as_encoded_bytes().ends_with(b".jsonl.zst")
    {
        return Err(refused());
    }
    let owner = fs::metadata("/proc/self")?.uid();
    let mut handles = vec![(root.to_path_buf(), directory(root)?)];
    let root_info = handles[0].1.metadata()?;
    if root_info.uid() != owner || root_info.mode() & 0o077 != 0 {
        return Err(refused());
    }
    // Keep each selected parent open, refusing links inside the canonical tree.
    for part in &parts[..parts.len() - 1] {
        let (parent, handle) = handles.last().ok_or_else(refused)?;
        let public = parent.join(part.as_os_str());
        let anchored =
            PathBuf::from(format!("/proc/self/fd/{}", handle.as_raw_fd())).join(part.as_os_str());
        handles.push((public, directory(&anchored)?));
    }
    let (parent, handle) = handles.last().ok_or_else(refused)?;
    let source_parent = source.parent().ok_or_else(refused)?;
    if fs::canonicalize(source_parent)? != *parent {
        return Err(refused());
    }
    let anchored = PathBuf::from(format!("/proc/self/fd/{}", handle.as_raw_fd())).join(name);
    for candidate in [
        anchored.clone(),
        PathBuf::from(format!("{}.zst", anchored.display())),
    ] {
        match fs::symlink_metadata(candidate) {
            Ok(info) => {
                if !info.is_file()
                    || info.nlink() != 1
                    || info.uid() != owner
                    || info.mode() & 0o077 != 0
                {
                    return Err(refused());
                }
                break;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    for (public, held) in &handles {
        let visible = fs::symlink_metadata(public)?;
        if !visible.is_dir() || identity(&visible) != identity(&held.metadata()?) {
            return Err(refused());
        }
    }
    if fs::canonicalize(root)? != root || fs::canonicalize(source_parent)? != *parent {
        return Err(refused());
    }
    Ok(parent.join(name))
}

#[cfg(test)]
#[path = "canonical_rollout_paths_tests.rs"]
mod tests;
