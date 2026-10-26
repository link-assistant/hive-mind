// Standalone tests compile the exact module inserted into the pinned source.
// They are primitive tests; native CLI/provider acceptance remains separate.
#[path = "canonical_auth.rs"]
mod canonical_auth;

use canonical_auth::CanonicalAuth;
use std::fs::{self, DirBuilder};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt, symlink};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "hive-canonical-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        DirBuilder::new().mode(0o700).create(&path).unwrap();
        Self(path)
    }
    fn shared(&self) -> CanonicalAuth {
        CanonicalAuth::open(&self.0).unwrap()
    }
    fn worker(&self, hold: bool) -> ReapedChild {
        ReapedChild(
            Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "worker", "--ignored"])
                .env_clear()
                .env("PATH", "/usr/bin:/bin")
                .env("CODEX_AUTH_HOME", &self.0)
                .env("SYNTHETIC_HOLD", if hold { "1" } else { "0" })
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct ReapedChild(Child);
impl ReapedChild {
    fn finish(&mut self) {
        let deadline = Instant::now() + Duration::from_secs(6);
        loop {
            if let Some(status) = self.0.try_wait().unwrap() {
                assert!(status.success(), "Synthetic worker failed.");
                return;
            }
            assert!(
                Instant::now() < deadline,
                "Synthetic worker exceeded its finite wait."
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
impl Drop for ReapedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
#[ignore]
fn worker() {
    let deadline = Instant::now() + Duration::from_secs(4);
    let mut shared = CanonicalAuth::configured().unwrap().unwrap();
    let guard = loop {
        match shared.try_lock().unwrap() {
            Ok(guard) => break guard,
            Err(waiting) => shared = waiting,
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    };
    let path = PathBuf::from(std::env::var_os("CODEX_AUTH_HOME").unwrap());
    if std::env::var("SYNTHETIC_HOLD").unwrap() == "1" {
        fs::write(path.join("owner-ready"), b"synthetic").unwrap();
        std::thread::sleep(Duration::from_secs(4));
        return;
    }
    let current = CanonicalAuth::open(&path).unwrap();
    if current.read().unwrap().as_deref() == Some(b"G0") {
        // A predecessor can be consumed once. The second process must reread
        // G1 under the lock, rather than attempting this exclusive creation.
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path.join("exchange-once"))
            .unwrap();
        guard.assert_current().unwrap();
        current.write(b"G1").unwrap();
    }
    assert_eq!(current.read().unwrap().as_deref(), Some(b"G1".as_slice()));
}

#[test]
fn atomic_storage_logout_and_recreation_do_not_replace_the_lock() {
    let fixture = Fixture::new();
    let shared = fixture.shared();
    let guard = fixture.shared().try_lock().unwrap().unwrap();
    let lock = fixture.0.join(".hive-mind-refresh.lock");
    let inode = fs::metadata(&lock).unwrap().ino();
    shared.write(b"G0").unwrap();
    let old_auth = fs::File::open(fixture.0.join("auth.json")).unwrap();
    shared.write(b"G1").unwrap();
    assert_ne!(
        old_auth.metadata().unwrap().ino(),
        fs::metadata(fixture.0.join("auth.json")).unwrap().ino()
    );
    assert_eq!(shared.read().unwrap().as_deref(), Some(b"G1".as_slice()));
    assert!(shared.delete().unwrap());
    assert!(!shared.delete().unwrap());
    assert!(shared.read().unwrap().is_none());
    shared.write(b"G2").unwrap();
    guard.assert_current().unwrap();
    assert_eq!(fs::metadata(lock).unwrap().ino(), inode);
}

#[test]
fn separate_processes_reread_and_consume_the_predecessor_once() {
    let fixture = Fixture::new();
    fixture.shared().write(b"G0").unwrap();
    let mut first = fixture.worker(false);
    let mut second = fixture.worker(false);
    first.finish();
    second.finish();
    assert_eq!(
        fixture.shared().read().unwrap().as_deref(),
        Some(b"G1".as_slice())
    );
    assert!(fixture.0.join("exchange-once").is_file());
}

#[test]
fn forced_owner_death_releases_the_same_inode() {
    let fixture = Fixture::new();
    fixture.shared().write(b"G0").unwrap();
    let mut owner = fixture.worker(true);
    let deadline = Instant::now() + Duration::from_secs(3);
    while !fixture.0.join("owner-ready").exists() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    let inode = fs::metadata(fixture.0.join(".hive-mind-refresh.lock"))
        .unwrap()
        .ino();
    assert!(fixture.shared().try_lock().unwrap().is_err());
    owner.0.kill().unwrap();
    owner.0.wait().unwrap();
    let mut peer = fixture.worker(false);
    peer.finish();
    assert_eq!(
        fs::metadata(fixture.0.join(".hive-mind-refresh.lock"))
            .unwrap()
            .ino(),
        inode
    );
}

#[test]
fn unsafe_auth_files_and_missing_or_linked_directories_are_refused() {
    let fixture = Fixture::new();
    let outside = Fixture::new();
    let private = outside.0.join("private");
    fs::write(&private, b"SYNTHETIC").unwrap();
    fs::set_permissions(&private, fs::Permissions::from_mode(0o600)).unwrap();
    let auth = fixture.0.join("auth.json");
    symlink(&private, &auth).unwrap();
    for operation in [
        fixture.shared().read().map(|_| ()),
        fixture.shared().write(b"G1"),
        fixture.shared().delete().map(|_| ()),
    ] {
        assert!(operation.is_err());
    }
    fs::remove_file(&auth).unwrap();
    fs::hard_link(&private, &auth).unwrap();
    assert!(fixture.shared().write(b"G1").is_err());
    fs::remove_file(&auth).unwrap();
    fs::write(&auth, b"unsafe permissions").unwrap();
    fs::set_permissions(&auth, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(fixture.shared().read().is_err());
    fs::remove_file(&auth).unwrap();
    fs::create_dir(&auth).unwrap();
    assert!(fixture.shared().read().is_err());
    let alias = outside.0.join("alias");
    symlink(&fixture.0, &alias).unwrap();
    assert!(CanonicalAuth::open(&alias).is_err());
    assert!(CanonicalAuth::open(&outside.0.join("missing")).is_err());
    assert_eq!(fs::read(&private).unwrap(), b"SYNTHETIC");
}

#[test]
fn oversized_credentials_and_replaced_lock_are_refused() {
    let fixture = Fixture::new();
    assert!(fixture.shared().write(&vec![0; 1024 * 1024 + 1]).is_err());
    let guard = fixture.shared().try_lock().unwrap().unwrap();
    fs::rename(
        fixture.0.join(".hive-mind-refresh.lock"),
        fixture.0.join("old-lock"),
    )
    .unwrap();
    fs::write(fixture.0.join(".hive-mind-refresh.lock"), b"").unwrap();
    fs::set_permissions(
        fixture.0.join(".hive-mind-refresh.lock"),
        fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    assert!(guard.assert_current().is_err());
}

#[test]
fn independent_configuration_copies_and_links_are_conflicts() {
    let fixture = Fixture::new();
    let configuration = Fixture::new();
    let shared = fixture.shared();
    shared.write(b"SYNTHETIC").unwrap();
    assert!(!shared.conflicts_with(&fixture.0));
    assert!(!shared.conflicts_with(&configuration.0));
    let private = configuration.0.join("auth.json");
    fs::write(&private, b"SYNTHETIC").unwrap();
    assert!(shared.conflicts_with(&configuration.0));
    fs::remove_file(&private).unwrap();
    symlink(fixture.0.join("auth.json"), &private).unwrap();
    assert!(shared.conflicts_with(&configuration.0));
    fs::remove_file(&private).unwrap();
    symlink(configuration.0.join("missing"), &private).unwrap();
    assert!(shared.conflicts_with(&configuration.0));
}

#[test]
fn unsafe_lock_paths_are_refused_without_touching_other_files() {
    let fixture = Fixture::new();
    let outside = Fixture::new();
    let target = outside.0.join("protected");
    fs::write(&target, b"SYNTHETIC").unwrap();
    fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();
    let lock = fixture.0.join(".hive-mind-refresh.lock");
    symlink(&target, &lock).unwrap();
    assert!(fixture.shared().try_lock().is_err());
    fs::remove_file(&lock).unwrap();
    fs::hard_link(&target, &lock).unwrap();
    assert!(fixture.shared().try_lock().is_err());
    fs::remove_file(&lock).unwrap();
    fs::write(&lock, b"").unwrap();
    fs::set_permissions(&lock, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(fixture.shared().try_lock().is_err());
    assert_eq!(fs::read(target).unwrap(), b"SYNTHETIC");
}
