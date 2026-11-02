use super::*;
use std::fs::DirBuilder;
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt, symlink};
use std::sync::atomic::{AtomicUsize, Ordering};

static SEQUENCE: AtomicUsize = AtomicUsize::new(0);
const ROLLOUT: &str = "rollout-2026-10-01T00-00-00-019f2a1b-0000-7000-8000-000000003785.jsonl";

struct Fixture {
    outer: PathBuf,
    root: PathBuf,
    private: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let outer = std::env::temp_dir().join(format!(
            "hive-native-stages-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        DirBuilder::new().mode(0o700).create(&outer).unwrap();
        let root = outer.join("canonical");
        let private = outer.join("private");
        for directory in [
            &root,
            &private,
            &root.join("sessions"),
            &root.join("sessions/date"),
        ] {
            DirBuilder::new().mode(0o700).create(directory).unwrap();
        }
        symlink(root.join("sessions"), private.join("sessions")).unwrap();
        Self {
            outer,
            root,
            private,
        }
    }
    fn path(&self, suffix: &str) -> PathBuf {
        self.private
            .join("sessions/date")
            .join(format!(".{ROLLOUT}.{suffix}"))
    }
    fn selected(&self, path: &Path) -> io::Result<SelectedPath> {
        SelectedPath::open(&self.root, Some(&self.private), path)
    }
    fn foreign(&self) -> PathBuf {
        let target = self.outer.join("protected-evidence");
        fs::write(&target, b"synthetic prior evidence").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();
        target
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.outer);
    }
}

#[test]
fn every_native_stage_is_private_and_publishable() {
    for suffix in SUFFIXES {
        let f = Fixture::new();
        let stage = f.selected(&f.path(suffix)).unwrap();
        let mut file = stage.create().unwrap();
        file.write_all(b"synthetic migrated conversation").unwrap();
        file.sync_all().unwrap();
        assert_eq!(file.metadata().unwrap().mode() & 0o777, 0o600);
        let target_path = f.private.join("sessions/date").join(ROLLOUT);
        let target = f.selected(&target_path).unwrap();
        publish_selected(&stage, &target).unwrap();
        assert_eq!(
            fs::read(target_path).unwrap(),
            b"synthetic migrated conversation"
        );
        assert!(!f.path(suffix).exists());
    }
}

#[test]
fn retry_replaces_safe_orphan_without_truncating_its_inode() {
    let f = Fixture::new();
    let path = f.path("paginated.tmp");
    let stage = f.selected(&path).unwrap();
    let mut old = stage.create().unwrap();
    old.write_all(b"prior interrupted staging bytes").unwrap();
    let before = old.metadata().unwrap();
    let fresh = stage.create().unwrap();
    assert_ne!(identity(&fresh.metadata().unwrap()), identity(&before));
    assert_eq!(fresh.metadata().unwrap().len(), 0);
    assert_eq!(old.metadata().unwrap().len(), 31);
}

#[test]
fn unsafe_existing_stages_preserve_foreign_data_and_entries() {
    for suffix in SUFFIXES {
        for hard in [false, true] {
            let f = Fixture::new();
            let foreign = f.foreign();
            let path = f.path(suffix);
            if hard {
                fs::hard_link(&foreign, &path).unwrap();
            } else {
                symlink(&foreign, &path).unwrap();
            }
            let before = fs::symlink_metadata(&path).unwrap();
            assert!(f.selected(&path).is_err());
            assert_eq!(
                identity(&fs::symlink_metadata(&path).unwrap()),
                identity(&before)
            );
            assert_eq!(fs::read(&foreign).unwrap(), b"synthetic prior evidence");
        }
    }
}

#[test]
fn link_added_after_admission_refuses_create_read_remove_and_publish() {
    for hard in [false, true] {
        let f = Fixture::new();
        let path = f.path("paginated.tmp");
        let stage = f.selected(&path).unwrap();
        let target = f
            .selected(&f.private.join("sessions/date").join(ROLLOUT))
            .unwrap();
        let foreign = f.foreign();
        if hard {
            fs::hard_link(&foreign, &path).unwrap();
        } else {
            symlink(&foreign, &path).unwrap();
        }
        assert!(stage.create().is_err());
        assert!(stage.open_existing(false).is_err());
        assert!(stage.remove().is_err());
        assert!(publish_selected(&stage, &target).is_err());
        assert_eq!(fs::read(foreign).unwrap(), b"synthetic prior evidence");
    }
}

#[test]
fn changed_parent_cannot_redirect_staging_or_cleanup() {
    let f = Fixture::new();
    let path = f.path("paginated.tmp");
    let stage = f.selected(&path).unwrap();
    let retained = f.root.join("sessions/retained");
    fs::rename(f.root.join("sessions/date"), &retained).unwrap();
    let foreign = f.outer.join("foreign");
    fs::create_dir(&foreign).unwrap();
    symlink(&foreign, f.root.join("sessions/date")).unwrap();
    assert!(stage.create().is_err());
    assert!(stage.remove().is_err());
    assert!(stage.open_existing(false).is_err());
    assert_eq!(fs::read_dir(foreign).unwrap().count(), 0);
    assert_eq!(fs::read_dir(retained).unwrap().count(), 0);
}

#[test]
fn changed_private_projection_refuses_without_private_fallback() {
    let f = Fixture::new();
    let stage = f.selected(&f.path("paginated.tmp")).unwrap();
    fs::remove_file(f.private.join("sessions")).unwrap();
    fs::create_dir_all(f.private.join("sessions/date")).unwrap();
    assert!(stage.create().is_err());
    assert!(f.selected(&f.path("paginated.tmp")).is_err());
    assert_eq!(
        fs::read_dir(f.private.join("sessions/date"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn unsafe_publish_target_preserves_both_histories() {
    for hard in [false, true] {
        let f = Fixture::new();
        let stage = f.selected(&f.path("paginated.tmp")).unwrap();
        stage.create().unwrap().write_all(b"new history").unwrap();
        let target_path = f.private.join("sessions/date").join(ROLLOUT);
        let target = f.selected(&target_path).unwrap();
        let foreign = f.foreign();
        if hard {
            fs::hard_link(&foreign, &target_path).unwrap();
        } else {
            symlink(&foreign, &target_path).unwrap();
        }
        assert!(publish_selected(&stage, &target).is_err());
        assert_eq!(fs::read(foreign).unwrap(), b"synthetic prior evidence");
        assert_eq!(fs::read(f.path("paginated.tmp")).unwrap(), b"new history");
    }
}

#[test]
fn nonregular_or_public_stage_refuses_without_mutation() {
    let f = Fixture::new();
    let path = f.path("paginated.tmp");
    fs::create_dir(&path).unwrap();
    assert!(f.selected(&path).is_err());
    fs::remove_dir(&path).unwrap();
    fs::write(&path, b"public stage").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(f.selected(&path).is_err());
    assert_eq!(fs::read(path).unwrap(), b"public stage");
}

#[test]
fn only_declared_rollout_and_stage_paths_are_admitted() {
    let f = Fixture::new();
    for path in [
        f.private.join("auth.json"),
        f.private.join("sessions/auth.json"),
        f.private.join("sessions/.auth.json.paginated.tmp"),
        f.outer.join(ROLLOUT),
        PathBuf::from(ROLLOUT),
    ] {
        assert!(f.selected(&path).is_err());
    }
    let rollout = f
        .selected(&f.private.join("sessions/date").join(ROLLOUT))
        .unwrap();
    assert!(rollout.create().is_err());
    assert!(rollout.remove().is_err());
}

#[test]
fn public_root_or_writable_parent_refuses_after_admission() {
    for root in [false, true] {
        let f = Fixture::new();
        let stage = f.selected(&f.path("paginated.tmp")).unwrap();
        let directory = if root {
            f.root.clone()
        } else {
            f.root.join("sessions/date")
        };
        fs::set_permissions(
            directory,
            fs::Permissions::from_mode(if root { 0o755 } else { 0o777 }),
        )
        .unwrap();
        assert!(stage.create().is_err());
    }
}

#[test]
fn cleanup_is_idempotent_and_canonical_data_survives_private_disposal() {
    let f = Fixture::new();
    let path = f.path("paginated.tmp");
    let stage = f.selected(&path).unwrap();
    stage
        .create()
        .unwrap()
        .write_all(b"retained stage")
        .unwrap();
    fs::remove_dir_all(&f.private).unwrap();
    let canonical = f.root.join("sessions/date").join(path.file_name().unwrap());
    let peer = SelectedPath::open(&f.root, None, &canonical).unwrap();
    assert_eq!(
        peer.open_existing(false).unwrap().metadata().unwrap().len(),
        14
    );
    peer.remove().unwrap();
    peer.remove().unwrap();
    assert!(!canonical.exists());
}

#[test]
fn rollout_admission_checks_every_stage_before_mutation() {
    for suffix in SUFFIXES {
        let f = Fixture::new();
        let source = f.private.join("sessions/date").join(ROLLOUT);
        fs::write(&source, b"synthetic original rollout").unwrap();
        fs::set_permissions(&source, fs::Permissions::from_mode(0o600)).unwrap();
        validate_rollout_in(&f.root, Some(&f.private), &source).unwrap();
        let foreign = f.foreign();
        symlink(&foreign, f.path(suffix)).unwrap();
        assert!(validate_rollout_in(&f.root, Some(&f.private), &source).is_err());
        assert_eq!(fs::read(source).unwrap(), b"synthetic original rollout");
        assert_eq!(fs::read(foreign).unwrap(), b"synthetic prior evidence");
    }
}

#[test]
fn compressed_rollouts_admit_all_native_stage_names() {
    let f = Fixture::new();
    let source = f
        .private
        .join("sessions/date")
        .join(format!("{ROLLOUT}.zst"));
    fs::write(&source, b"synthetic compressed source").unwrap();
    fs::set_permissions(&source, fs::Permissions::from_mode(0o600)).unwrap();
    for suffix in SUFFIXES {
        let stage = source.with_file_name(format!(".{ROLLOUT}.zst.{suffix}"));
        f.selected(&stage)
            .unwrap()
            .create()
            .unwrap()
            .write_all(b"safe orphan")
            .unwrap();
    }
    validate_rollout_in(&f.root, Some(&f.private), &source).unwrap();
    assert_eq!(fs::read(source).unwrap(), b"synthetic compressed source");
}
