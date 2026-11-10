// Actual storage and intent modules, without a replacement storage implementation.
#[path = "canonical_auth.rs"]
mod canonical_auth;

use canonical_auth::{CanonicalAuth, RefreshLock};
use std::fs::{self, DirBuilder};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt, symlink};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);
const INTENT: &str = ".hive-mind-refresh-intent";
const G0: [u8; 32] = [7; 32];
const G1: [u8; 32] = [9; 32];

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "hive-intent-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        DirBuilder::new().mode(0o700).create(&path).unwrap();
        Self(path)
    }
    fn storage(&self) -> CanonicalAuth {
        CanonicalAuth::open(&self.0).unwrap()
    }
    fn guard(&self) -> RefreshLock {
        self.storage().try_lock().unwrap().unwrap()
    }
    fn raw_intent(&self, bytes: &[u8], mode: u32) {
        fs::write(self.0.join(INTENT), bytes).unwrap();
        fs::set_permissions(self.0.join(INTENT), fs::Permissions::from_mode(mode)).unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
struct ReapedChild(Child);
impl Drop for ReapedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn durable_intent_is_exclusive_and_not_deleted_by_unlock_or_logout() {
    let fixture = Fixture::new();
    fixture.storage().write(b"synthetic G0").unwrap();
    let inode;
    {
        let guard = fixture.guard();
        inode = fs::metadata(fixture.0.join(".hive-mind-refresh.lock"))
            .unwrap()
            .ino();
        guard.begin_refresh(&G0).unwrap();
        assert!(guard.begin_refresh(&G0).is_err());
        assert!(guard.begin_refresh(&G1).is_err());
        assert_eq!(fixture.storage().refresh_intent().unwrap(), Some(G0));
        assert!(guard.finish_refresh(&G1).is_err());
        assert!(fixture.storage().delete().unwrap());
        assert_eq!(guard.refresh_intent().unwrap(), Some(G0));
    }
    let peer = fixture.guard();
    assert_eq!(peer.refresh_intent().unwrap(), Some(G0));
    assert_eq!(
        fs::metadata(fixture.0.join(".hive-mind-refresh.lock"))
            .unwrap()
            .ino(),
        inode
    );
    assert!(peer.begin_refresh(&G0).is_err());
}

#[test]
fn successful_commit_can_clear_intent_and_reuse_the_same_lock() {
    let fixture = Fixture::new();
    fixture.storage().write(b"synthetic G0").unwrap();
    let guard = fixture.guard();
    guard.begin_refresh(&G0).unwrap();
    fixture.storage().write(b"synthetic G1").unwrap();
    guard.sync_current_auth().unwrap();
    guard.finish_refresh(&G0).unwrap();
    assert_eq!(guard.refresh_intent().unwrap(), None);
    assert_eq!(
        guard.auth_bytes().unwrap().as_deref(),
        Some(b"synthetic G1".as_slice())
    );
    guard.begin_refresh(&G1).unwrap();
    assert_eq!(guard.refresh_intent().unwrap(), Some(G1));
}

#[test]
fn malformed_truncated_oversized_and_public_markers_remain_preserved() {
    for (bytes, mode) in [
        (vec![0; 40], 0o600),
        (vec![0; 39], 0o600),
        (vec![0; 41], 0o600),
        (vec![0; 40], 0o644),
    ] {
        let fixture = Fixture::new();
        fixture.raw_intent(&bytes, mode);
        let guard = fixture.guard();
        assert!(guard.refresh_intent().is_err());
        assert!(guard.begin_refresh(&G0).is_err());
        assert!(guard.finish_refresh(&G0).is_err());
        assert_eq!(fs::read(fixture.0.join(INTENT)).unwrap(), bytes);
    }
}

#[test]
fn linked_and_directory_markers_refuse_without_altering_the_target() {
    let outside = Fixture::new();
    let target = outside.0.join("protected");
    fs::write(&target, [0; 40]).unwrap();
    fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();
    for kind in 0..3 {
        let fixture = Fixture::new();
        let marker = fixture.0.join(INTENT);
        match kind {
            0 => symlink(&target, &marker).unwrap(),
            1 => fs::hard_link(&target, &marker).unwrap(),
            _ => fs::create_dir(&marker).unwrap(),
        }
        let guard = fixture.guard();
        assert!(guard.refresh_intent().is_err());
        assert!(guard.begin_refresh(&G0).is_err());
        assert!(guard.finish_refresh(&G0).is_err());
        assert_eq!(fs::read(&target).unwrap(), [0; 40]);
    }
}

#[test]
fn replaced_lock_cannot_begin_or_finish_an_intent() {
    let fixture = Fixture::new();
    let guard = fixture.guard();
    guard.begin_refresh(&G0).unwrap();
    fs::rename(
        fixture.0.join(".hive-mind-refresh.lock"),
        fixture.0.join("old-lock"),
    )
    .unwrap();
    drop(fixture.guard());
    assert!(guard.begin_refresh(&G1).is_err());
    assert!(guard.finish_refresh(&G0).is_err());
    assert_eq!(fixture.storage().refresh_intent().unwrap(), Some(G0));
}

#[test]
fn auth_durability_refuses_missing_or_unsafe_auth() {
    let fixture = Fixture::new();
    let guard = fixture.guard();
    assert!(guard.sync_current_auth().is_err());
    fixture.storage().write(b"synthetic G1").unwrap();
    fs::set_permissions(
        fixture.0.join("auth.json"),
        fs::Permissions::from_mode(0o644),
    )
    .unwrap();
    assert!(guard.sync_current_auth().is_err());
}

#[test]
#[ignore]
fn owner_worker() {
    let storage = CanonicalAuth::configured().unwrap().unwrap();
    let guard = storage.try_lock().unwrap().unwrap();
    guard.begin_refresh(&G0).unwrap();
    fs::write(
        PathBuf::from(std::env::var_os("CODEX_AUTH_HOME").unwrap()).join("ready"),
        b"ready",
    )
    .unwrap();
    std::thread::sleep(Duration::from_secs(5));
}

#[test]
fn forced_owner_death_preserves_durable_intent_and_lock_identity() {
    let fixture = Fixture::new();
    let mut owner = ReapedChild(
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "owner_worker", "--ignored"])
            .env_clear()
            .env("CODEX_AUTH_HOME", &fixture.0)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(3);
    while !fixture.0.join("ready").exists() {
        assert!(
            Instant::now() < deadline,
            "Synthetic owner did not reach durable publication."
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    let inode = fs::metadata(fixture.0.join(".hive-mind-refresh.lock"))
        .unwrap()
        .ino();
    assert!(fixture.storage().try_lock().unwrap().is_err());
    owner.0.kill().unwrap();
    owner.0.wait().unwrap();
    let peer = fixture.guard();
    assert_eq!(peer.refresh_intent().unwrap(), Some(G0));
    assert!(peer.begin_refresh(&G0).is_err());
    assert_eq!(
        fs::metadata(fixture.0.join(".hive-mind-refresh.lock"))
            .unwrap()
            .ino(),
        inode
    );
}
