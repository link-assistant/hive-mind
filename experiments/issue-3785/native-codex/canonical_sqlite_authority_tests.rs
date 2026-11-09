use super::*;
use std::fs::DirBuilder;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt, symlink};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

static SEQUENCE: AtomicUsize = AtomicUsize::new(0);

struct Fixture {
    root: PathBuf,
    canonical: PathBuf,
    private: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "hive-sqlite-authority-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        DirBuilder::new().mode(0o700).create(&root).unwrap();
        let canonical = root.join("canonical");
        let private = root.join("private");
        for path in [&canonical, &private] {
            DirBuilder::new().mode(0o700).create(path).unwrap();
        }
        Self {
            root,
            canonical,
            private,
        }
    }
    fn validate(&self, sqlite: &Path, logs: &Path) -> io::Result<()> {
        validate(
            &self.canonical,
            &self.canonical,
            sqlite,
            logs,
            &self.private,
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn final_native_database_and_logs_configuration_retain_the_selected_root() {
    let fixture = Fixture::new();
    fixture
        .validate(&fixture.canonical, &fixture.canonical)
        .unwrap();
    assert!(
        fixture
            .validate(&fixture.private, &fixture.canonical)
            .is_err()
    );
    assert!(
        fixture
            .validate(&fixture.canonical, &fixture.private)
            .is_err()
    );
    assert_eq!(fs::read_dir(&fixture.canonical).unwrap().count(), 0);
    assert_eq!(fs::read_dir(&fixture.private).unwrap().count(), 0);
}

#[test]
fn selected_environment_and_final_configuration_must_agree() {
    let fixture = Fixture::new();
    assert!(
        validate(
            &fixture.canonical,
            &fixture.private,
            &fixture.canonical,
            &fixture.canonical,
            &fixture.private
        )
        .is_err()
    );
}

#[test]
fn canonical_history_cannot_disappear_with_private_configuration_disposal() {
    let fixture = Fixture::new();
    for private in [&fixture.canonical, &fixture.root] {
        assert!(
            validate(
                &fixture.canonical,
                &fixture.canonical,
                &fixture.canonical,
                &fixture.canonical,
                private
            )
            .is_err()
        );
    }
    assert!(
        validate(
            &fixture.root,
            &fixture.root,
            &fixture.root,
            &fixture.root,
            &fixture.private
        )
        .is_err()
    );
}

#[test]
fn missing_public_or_aliased_canonical_roots_refuse_without_creation_or_repair() {
    let fixture = Fixture::new();
    let alias = fixture.root.join("alias");
    symlink(&fixture.canonical, &alias).unwrap();
    assert!(validate(&alias, &alias, &alias, &alias, &fixture.private).is_err());
    fs::set_permissions(&fixture.canonical, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(
        fixture
            .validate(&fixture.canonical, &fixture.canonical)
            .is_err()
    );
    assert_eq!(
        fs::metadata(&fixture.canonical).unwrap().mode() & 0o777,
        0o755
    );
    fs::remove_dir(&fixture.canonical).unwrap();
    assert!(
        fixture
            .validate(&fixture.canonical, &fixture.canonical)
            .is_err()
    );
    assert!(!fixture.canonical.exists());
}

#[test]
fn roots_do_not_normalize_invalid_selectors_into_another_authority() {
    for value in [
        "", "/", "relative", "/a/", "/a//b", "/a/./b", "/a/../b", "/a\n", "/a\0",
    ] {
        assert!(
            !absolute(Path::new(value)),
            "invalid synthetic selector accepted"
        );
    }
    assert!(absolute(Path::new("/canonical/storage")));
}

#[test]
fn private_configuration_cannot_alias_canonical_storage_or_be_public() {
    let fixture = Fixture::new();
    fs::remove_dir(&fixture.private).unwrap();
    symlink(&fixture.canonical, &fixture.private).unwrap();
    assert!(
        fixture
            .validate(&fixture.canonical, &fixture.canonical)
            .is_err()
    );
    fs::remove_file(&fixture.private).unwrap();
    DirBuilder::new()
        .mode(0o755)
        .create(&fixture.private)
        .unwrap();
    assert!(
        fixture
            .validate(&fixture.canonical, &fixture.canonical)
            .is_err()
    );
}

const DATABASES: [&str; 7] = [
    "state_5.sqlite",
    "logs_2.sqlite",
    "goals_1.sqlite",
    "memories_1.sqlite",
    "memories_v2_1.sqlite",
    "queue_1.sqlite",
    "thread_history_1.sqlite",
];

#[test]
fn every_database_and_journal_alias_refuses_before_outside_evidence_changes() {
    let fixture = Fixture::new();
    let outside = fixture.private.join("outside");
    fs::write(&outside, b"preserve unrelated evidence").unwrap();
    for database in DATABASES {
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let selected = fixture.canonical.join(format!("{database}{suffix}"));
            symlink(&outside, &selected).unwrap();
            assert!(
                fixture
                    .validate(&fixture.canonical, &fixture.canonical)
                    .is_err(),
                "aliased native database or journal was admitted: {database}{suffix}"
            );
            assert_eq!(fs::read(&outside).unwrap(), b"preserve unrelated evidence");
            assert!(fs::symlink_metadata(&selected).unwrap().is_symlink());
            fs::remove_file(selected).unwrap();
        }
    }
}

#[test]
fn hardlinked_databases_refuse_without_changing_the_surviving_authority() {
    let fixture = Fixture::new();
    let outside = fixture.private.join("outside");
    fs::write(&outside, b"preserve the surviving authority").unwrap();
    for database in DATABASES {
        let selected = fixture.canonical.join(database);
        fs::hard_link(&outside, &selected).unwrap();
        assert!(
            fixture
                .validate(&fixture.canonical, &fixture.canonical)
                .is_err()
        );
        assert_eq!(fs::metadata(&outside).unwrap().nlink(), 2);
        assert_eq!(
            fs::read(&outside).unwrap(),
            b"preserve the surviving authority"
        );
        fs::remove_file(selected).unwrap();
    }
}

#[test]
fn nonregular_database_entries_refuse_without_repair() {
    let fixture = Fixture::new();
    let selected = fixture.canonical.join("state_5.sqlite");
    fs::create_dir(&selected).unwrap();
    assert!(
        fixture
            .validate(&fixture.canonical, &fixture.canonical)
            .is_err()
    );
    assert!(selected.is_dir());
    fs::remove_dir(&selected).unwrap();
    let listener = std::os::unix::net::UnixListener::bind(&selected).unwrap();
    assert!(
        fixture
            .validate(&fixture.canonical, &fixture.canonical)
            .is_err()
    );
    drop(listener);
}

#[test]
fn database_permissions_prevent_independent_writers_without_repair() {
    let fixture = Fixture::new();
    let selected = fixture.canonical.join("logs_2.sqlite");
    fs::write(&selected, b"native database evidence").unwrap();
    for mode in [0o666, 0o660, 0o602] {
        fs::set_permissions(&selected, fs::Permissions::from_mode(mode)).unwrap();
        assert!(
            fixture
                .validate(&fixture.canonical, &fixture.canonical)
                .is_err()
        );
        assert_eq!(fs::metadata(&selected).unwrap().mode() & 0o777, mode);
    }
}

#[test]
fn existing_native_databases_and_journals_are_checked_without_reading_contents() {
    let fixture = Fixture::new();
    for database in DATABASES {
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let selected = fixture.canonical.join(format!("{database}{suffix}"));
            fs::write(&selected, b"existing native data").unwrap();
            fs::set_permissions(&selected, fs::Permissions::from_mode(0o644)).unwrap();
        }
    }
    fixture
        .validate(&fixture.canonical, &fixture.canonical)
        .unwrap();
    assert_eq!(fs::read_dir(&fixture.canonical).unwrap().count(), 28);
}
