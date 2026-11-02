use super::*;
use std::fs::DirBuilder;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt, symlink};
use std::sync::atomic::{AtomicUsize, Ordering};

static SEQUENCE: AtomicUsize = AtomicUsize::new(0);

struct Fixture {
    outer: PathBuf,
    canonical: PathBuf,
    private: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let outer = std::env::temp_dir().join(format!(
            "hive-rollout-paths-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        DirBuilder::new().mode(0o700).create(&outer).unwrap();
        let canonical = outer.join("canonical");
        let private = outer.join("private");
        for path in [&canonical, &private] {
            DirBuilder::new().mode(0o700).create(path).unwrap();
        }
        for name in ["sessions", "archived_sessions"] {
            fs::create_dir(canonical.join(name)).unwrap();
            symlink(canonical.join(name), private.join(name)).unwrap();
        }
        Self {
            outer,
            canonical,
            private,
        }
    }
    fn path(&self, area: &str, name: &str) -> PathBuf {
        self.private.join(area).join(name)
    }
    fn project(&self, source: &Path) -> io::Result<PathBuf> {
        project(&self.canonical, Some(&self.private), source)
    }
    fn write(&self, name: &str) -> PathBuf {
        let path = self.path("sessions", name);
        fs::write(&path, b"synthetic prior history").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        path
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.outer);
    }
}

#[test]
fn persisted_active_and_archived_paths_survive_private_configuration_disposal() {
    let fixture = Fixture::new();
    let source = fixture.write("rollout-original.jsonl");
    let projected = fixture.project(&source).unwrap();
    assert_eq!(
        projected,
        fixture.canonical.join("sessions/rollout-original.jsonl")
    );
    let archived = fixture.path("archived_sessions", "rollout-archived.jsonl");
    let archived_projected = fixture.project(&archived).unwrap();
    fs::remove_dir_all(&fixture.private).unwrap();
    assert_eq!(fs::read(projected).unwrap(), b"synthetic prior history");
    assert_eq!(
        archived_projected,
        fixture
            .canonical
            .join("archived_sessions/rollout-archived.jsonl")
    );
}

#[test]
fn compressed_and_not_yet_materialized_rollouts_keep_the_selected_filename() {
    let fixture = Fixture::new();
    fixture.write("rollout-thread_revert.jsonl.zst");
    for name in [
        "rollout-thread_revert.jsonl",
        "rollout-thread_revert.jsonl.zst",
        "rollout-new.jsonl",
    ] {
        assert_eq!(
            fixture.project(&fixture.path("sessions", name)).unwrap(),
            fixture.canonical.join("sessions").join(name)
        );
    }
}

#[test]
fn already_canonical_paths_do_not_require_a_private_home() {
    let fixture = Fixture::new();
    let path = fixture.canonical.join("sessions/rollout-selected.jsonl");
    assert_eq!(project(&fixture.canonical, None, &path).unwrap(), path);
}

#[test]
fn unrelated_or_unprojected_paths_refuse_without_fallback() {
    let fixture = Fixture::new();
    let path = fixture.outer.join("foreign/rollout-selected.jsonl");
    assert!(fixture.project(&path).is_err());
    fs::remove_file(fixture.private.join("sessions")).unwrap();
    fs::create_dir(fixture.private.join("sessions")).unwrap();
    assert!(
        fixture
            .project(&fixture.path("sessions", "rollout.jsonl"))
            .is_err()
    );
}

#[test]
fn linked_or_public_canonical_roots_refuse() {
    let fixture = Fixture::new();
    let alias = fixture.outer.join("alias");
    symlink(&fixture.canonical, &alias).unwrap();
    assert!(
        project(
            &alias,
            Some(&fixture.private),
            &fixture.path("sessions", "rollout.jsonl")
        )
        .is_err()
    );
    fs::set_permissions(&fixture.canonical, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(
        fixture
            .project(&fixture.path("sessions", "rollout.jsonl"))
            .is_err()
    );
}

#[test]
fn linked_canonical_ancestors_and_rollout_files_refuse() {
    let fixture = Fixture::new();
    let source = fixture.write("original.jsonl");
    let alias = fixture.path("sessions", "alias.jsonl");
    symlink(&source, &alias).unwrap();
    assert!(fixture.project(&alias).is_err());
    fs::create_dir(fixture.canonical.join("real")).unwrap();
    symlink(
        fixture.canonical.join("real"),
        fixture.canonical.join("sessions/linked"),
    )
    .unwrap();
    assert!(
        fixture
            .project(&fixture.path("sessions", "linked/rollout.jsonl"))
            .is_err()
    );
}

#[test]
fn public_or_hardlinked_history_refuses_and_preserves_bytes() {
    let fixture = Fixture::new();
    let source = fixture.write("rollout.jsonl");
    fs::set_permissions(&source, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(fixture.project(&source).is_err());
    fs::set_permissions(&source, fs::Permissions::from_mode(0o600)).unwrap();
    fs::hard_link(&source, fixture.outer.join("other-link")).unwrap();
    assert!(fixture.project(&source).is_err());
    assert_eq!(fs::read(source).unwrap(), b"synthetic prior history");
}

#[test]
fn parent_escape_and_nonhistory_namespaces_refuse() {
    let fixture = Fixture::new();
    for path in [
        PathBuf::from("relative.jsonl"),
        fixture.private.join("sessions/../auth.jsonl"),
        fixture.private.join("plugins/rollout.jsonl"),
        fixture.path("sessions", "auth.json"),
    ] {
        assert!(fixture.project(&path).is_err());
    }
}

#[test]
fn a_selected_root_must_not_disappear_with_the_private_configuration() {
    let fixture = Fixture::new();
    let source = fixture.path("sessions", "rollout.jsonl");
    assert!(project(&fixture.private, Some(&fixture.private), &source).is_err());
    assert!(project(&fixture.canonical, Some(&fixture.outer), &source).is_err());
    assert!(project(&fixture.canonical, Some(Path::new("")), &source).is_err());
}
