use super::*;
use std::fs::DirBuilder;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt, symlink};
use std::sync::atomic::{AtomicUsize, Ordering};

static SEQUENCE: AtomicUsize = AtomicUsize::new(0);
const NAME: &str = "019f2a1b-0000-7000-8000-000000003785.pending";

struct Fixture {
    outer: PathBuf,
    root: PathBuf,
    private: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let outer = std::env::temp_dir().join(format!(
            "hive-migration-journal-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        DirBuilder::new().mode(0o700).create(&outer).unwrap();
        let root = outer.join("canonical");
        let private = outer.join("private");
        for directory in [&root, &private, &root.join("rollout-migrations")] {
            DirBuilder::new().mode(0o700).create(directory).unwrap();
        }
        symlink(
            root.join("rollout-migrations"),
            private.join("rollout-migrations"),
        )
        .unwrap();
        Self {
            outer,
            root,
            private,
        }
    }
    fn path(&self) -> PathBuf {
        self.private.join("rollout-migrations").join(NAME)
    }
    fn journal(&self) -> io::Result<Journal> {
        Journal::open(&self.root, Some(&self.private), &self.path())
    }
    fn foreign(&self) -> PathBuf {
        let path = self.outer.join("unrelated-evidence");
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
fn create_private_receipt_and_retry_without_replacing_its_inode() {
    let fixture = Fixture::new();
    let journal = fixture.journal().unwrap();
    journal.write().unwrap();
    let before = fs::metadata(fixture.path()).unwrap();
    assert_eq!(before.mode() & 0o777, 0o600);
    fixture.journal().unwrap().write().unwrap();
    assert_eq!(
        identity(&fs::metadata(fixture.path()).unwrap()),
        identity(&before)
    );
    assert!(fs::read(fixture.path()).unwrap().is_empty());
}

#[test]
fn canonical_receipt_survives_private_scope_disposal() {
    let fixture = Fixture::new();
    fixture.journal().unwrap().write().unwrap();
    let receipt = fixture.root.join("rollout-migrations").join(NAME);
    let before = fs::metadata(&receipt).unwrap();
    fs::remove_dir_all(&fixture.private).unwrap();
    Journal::open(&fixture.root, None, &receipt)
        .unwrap()
        .write()
        .unwrap();
    assert_eq!(identity(&fs::metadata(receipt).unwrap()), identity(&before));
}

#[test]
fn symlink_and_hardlink_journals_preserve_unrelated_evidence() {
    for hard in [false, true] {
        let fixture = Fixture::new();
        let foreign = fixture.foreign();
        let before = fs::metadata(&foreign).unwrap();
        if hard {
            fs::hard_link(&foreign, fixture.path()).unwrap();
        } else {
            symlink(&foreign, fixture.path()).unwrap();
        }
        assert!(fixture.journal().is_err());
        assert_eq!(fs::read(&foreign).unwrap(), b"synthetic prior history");
        assert_eq!(identity(&fs::metadata(foreign).unwrap()), identity(&before));
    }
}

#[test]
fn empty_hardlinked_receipts_refuse_even_when_their_contents_look_valid() {
    let fixture = Fixture::new();
    let foreign = fixture.foreign();
    fs::write(&foreign, b"").unwrap();
    fs::hard_link(&foreign, fixture.path()).unwrap();
    assert!(fixture.journal().is_err());
    assert_eq!(fs::metadata(foreign).unwrap().nlink(), 2);
}

#[test]
fn a_link_inserted_after_open_is_refused_without_truncation() {
    for hard in [false, true] {
        let fixture = Fixture::new();
        let journal = fixture.journal().unwrap();
        let foreign = fixture.foreign();
        if hard {
            fs::hard_link(&foreign, fixture.path()).unwrap();
        } else {
            symlink(&foreign, fixture.path()).unwrap();
        }
        assert!(journal.write().is_err());
        assert_eq!(fs::read(foreign).unwrap(), b"synthetic prior history");
    }
}

#[test]
fn nonempty_public_and_nonregular_journals_refuse() {
    let fixture = Fixture::new();
    fs::write(fixture.path(), b"unknown receipt evidence").unwrap();
    fs::set_permissions(fixture.path(), fs::Permissions::from_mode(0o600)).unwrap();
    assert!(fixture.journal().is_err());
    assert_eq!(
        fs::read(fixture.path()).unwrap(),
        b"unknown receipt evidence"
    );
    fs::write(fixture.path(), b"").unwrap();
    fs::set_permissions(fixture.path(), fs::Permissions::from_mode(0o644)).unwrap();
    assert!(fixture.journal().is_err());
    fs::remove_file(fixture.path()).unwrap();
    fs::create_dir(fixture.path()).unwrap();
    assert!(fixture.journal().is_err());
}

#[test]
fn changed_canonical_parent_cannot_redirect_a_receipt_write() {
    let fixture = Fixture::new();
    let journal = fixture.journal().unwrap();
    let old = fixture.root.join("retained-migrations");
    let parent = fixture.root.join("rollout-migrations");
    fs::rename(&parent, &old).unwrap();
    let foreign = fixture.outer.join("foreign");
    fs::create_dir(&foreign).unwrap();
    symlink(&foreign, &parent).unwrap();
    assert!(journal.write().is_err());
    assert_eq!(fs::read_dir(&foreign).unwrap().count(), 0);
    assert_eq!(fs::read_dir(old).unwrap().count(), 0);
}

#[test]
fn changed_projection_refuses_instead_of_using_private_fallback() {
    let fixture = Fixture::new();
    let journal = fixture.journal().unwrap();
    fs::remove_file(fixture.private.join("rollout-migrations")).unwrap();
    fs::create_dir(fixture.private.join("rollout-migrations")).unwrap();
    assert!(journal.write().is_err());
    assert!(fixture.journal().is_err());
    assert_eq!(
        fs::read_dir(fixture.root.join("rollout-migrations"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn linked_public_and_overlapping_authorities_refuse() {
    let fixture = Fixture::new();
    let alias = fixture.outer.join("alias");
    symlink(&fixture.root, &alias).unwrap();
    assert!(Journal::open(&alias, Some(&fixture.private), &fixture.path()).is_err());
    assert!(Journal::open(&fixture.root, Some(&fixture.root), &fixture.path()).is_err());
    fs::set_permissions(&fixture.root, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(fixture.journal().is_err());
}

#[test]
fn unrelated_paths_and_names_refuse() {
    let fixture = Fixture::new();
    for source in [
        fixture.private.join("auth.json"),
        fixture.private.join("rollout-migrations/unknown.pending"),
        fixture.private.join("rollout-migrations/nested").join(NAME),
        fixture.outer.join("foreign/rollout-migrations").join(NAME),
        PathBuf::from("relative.pending"),
    ] {
        assert!(Journal::open(&fixture.root, Some(&fixture.private), &source).is_err());
    }
}

#[test]
fn required_removal_and_idempotent_cleanup_preserve_receipt_semantics() {
    let fixture = Fixture::new();
    let journal = fixture.journal().unwrap();
    assert!(journal.remove(true).is_err());
    journal.remove(false).unwrap();
    journal.write().unwrap();
    journal.remove(true).unwrap();
    assert!(!fixture.path().exists());
    assert!(journal.remove(true).is_err());
    journal.remove(false).unwrap();
}

#[test]
fn journal_cleanup_refuses_new_links_and_replaced_parents() {
    for hard in [false, true] {
        let fixture = Fixture::new();
        let journal = fixture.journal().unwrap();
        let foreign = fixture.foreign();
        if hard {
            fs::hard_link(&foreign, fixture.path()).unwrap();
        } else {
            symlink(&foreign, fixture.path()).unwrap();
        }
        assert!(journal.remove(false).is_err());
        assert_eq!(fs::read(foreign).unwrap(), b"synthetic prior history");
    }
    let fixture = Fixture::new();
    let journal = fixture.journal().unwrap();
    journal.write().unwrap();
    let retained = fixture.root.join("retained");
    fs::rename(fixture.root.join("rollout-migrations"), &retained).unwrap();
    fs::create_dir(fixture.root.join("rollout-migrations")).unwrap();
    assert!(journal.remove(true).is_err());
    assert!(retained.join(NAME).exists());
}
