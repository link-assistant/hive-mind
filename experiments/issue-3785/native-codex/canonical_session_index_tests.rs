use super::*;
use std::fs::DirBuilder;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt, symlink};
use std::process::{Child, Command, Stdio};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "hive-index-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        DirBuilder::new().mode(0o700).create(&root).unwrap();
        Self(root)
    }
    fn worker(&self, action: &str) -> Reaped {
        // Rust's test names omit the crate, including when this module is
        // nested under the real rollout crate rather than compiled alone.
        let module = module_path!().split_once("::").unwrap().1;
        let worker = format!("{module}::worker");
        Reaped(
            Command::new(std::env::current_exe().unwrap())
                .args(["--exact", &worker, "--ignored"])
                .env_clear()
                .env("CODEX_SESSION_INDEX_HOME", &self.0)
                .env("SYNTHETIC_ACTION", action)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        )
    }
    fn wait_ready(&self) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while !self.0.join("ready").exists() {
            assert!(
                Instant::now() < deadline,
                "Synthetic index worker did not acquire its lock."
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
struct Reaped(Child);
impl Reaped {
    fn finish(&mut self) {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(status) = self.0.try_wait().unwrap() {
                assert!(status.success(), "Synthetic index worker failed.");
                return;
            }
            assert!(
                Instant::now() < deadline,
                "Synthetic index worker exceeded its deadline."
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
impl Drop for Reaped {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
#[ignore]
fn worker() {
    let root = PathBuf::from(std::env::var_os("CODEX_SESSION_INDEX_HOME").unwrap());
    let private = root.join("private").join(INDEX);
    let action = std::env::var("SYNTHETIC_ACTION").unwrap();
    if action == "append" {
        fs::write(root.join("peer-started"), "synthetic").unwrap();
    }
    let result = with_index(&private, |path| {
        match action.as_str() {
            "replace" => {
                replace(path, "first\n")?;
            }
            "append" => {
                let mut file = open_append(path)?;
                file.write_all(b"peer\n")?;
                file.sync_all()?;
            }
            "rewrite-paused" => {
                let prior = read_string(path)?;
                fs::write(root.join("ready"), "synthetic")?;
                let deadline = Instant::now() + Duration::from_secs(3);
                while !root.join("release").exists() {
                    assert!(Instant::now() < deadline);
                    std::thread::sleep(Duration::from_millis(10));
                }
                replace(path, &prior)?;
            }
            "hold" => {
                fs::write(root.join("ready"), "synthetic")?;
                std::thread::sleep(Duration::from_secs(4));
            }
            "replace-lock" => {
                fs::rename(root.join(LOCK), root.join("original-lock"))?;
                OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .mode(0o600)
                    .open(root.join(LOCK))?;
            }
            "read" | "refuse" => {
                assert!(exists(path)?);
                let _ = read_string(path)?;
            }
            _ => panic!("Unknown bounded index scenario."),
        }
        Ok(())
    });
    if ["refuse", "replace-lock"].contains(&action.as_str()) {
        assert!(result.is_err());
    } else {
        result.unwrap();
    }
}

#[test]
fn canonical_replacement_and_peer_append_never_materialize_private_copies() {
    let fixture = Fixture::new();
    fixture.worker("replace").finish();
    fixture.worker("append").finish();
    fixture.worker("read").finish();
    assert_eq!(
        fs::read_to_string(fixture.0.join(INDEX)).unwrap(),
        "first\npeer\n"
    );
    assert!(!fixture.0.join("private").exists());
    assert_eq!(
        fs::metadata(fixture.0.join(INDEX)).unwrap().mode() & 0o777,
        0o600
    );
}

#[test]
fn paused_atomic_rewrite_cannot_discard_a_peer_append() {
    let fixture = Fixture::new();
    fixture.worker("replace").finish();
    let mut rewrite = fixture.worker("rewrite-paused");
    fixture.wait_ready();
    let mut peer = fixture.worker("append");
    let deadline = Instant::now() + Duration::from_secs(2);
    while !fixture.0.join("peer-started").exists() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    std::thread::sleep(Duration::from_millis(100));
    assert!(
        peer.0.try_wait().unwrap().is_none(),
        "The peer must wait while a rewrite owns the canonical index lock."
    );
    fs::write(fixture.0.join("release"), "synthetic").unwrap();
    rewrite.finish();
    peer.finish();
    assert_eq!(
        fs::read_to_string(fixture.0.join(INDEX)).unwrap(),
        "first\npeer\n"
    );
}

#[test]
fn owner_death_releases_the_same_lock_inode_without_deleting_it() {
    let fixture = Fixture::new();
    let mut owner = fixture.worker("hold");
    fixture.wait_ready();
    let before = fs::metadata(fixture.0.join(LOCK)).unwrap();
    owner.0.kill().unwrap();
    owner.0.wait().unwrap();
    fixture.worker("append").finish();
    assert_eq!(
        identity(&before),
        identity(&fs::metadata(fixture.0.join(LOCK)).unwrap())
    );
}

#[test]
fn private_copy_and_linked_index_refuse_without_changing_evidence() {
    let fixture = Fixture::new();
    fs::create_dir(fixture.0.join("private")).unwrap();
    fs::write(fixture.0.join("private").join(INDEX), "private evidence").unwrap();
    fixture.worker("refuse").finish();
    assert!(!fixture.0.join(INDEX).exists());
    fs::remove_file(fixture.0.join("private").join(INDEX)).unwrap();
    fs::write(fixture.0.join("foreign"), "foreign evidence").unwrap();
    symlink("foreign", fixture.0.join(INDEX)).unwrap();
    fixture.worker("refuse").finish();
    assert_eq!(
        fs::read_to_string(fixture.0.join("foreign")).unwrap(),
        "foreign evidence"
    );
}

#[test]
fn linked_root_unsafe_modes_and_replaced_lock_refuse() {
    let fixture = Fixture::new();
    let alias = fixture.0.join("alias");
    symlink(&fixture.0, &alias).unwrap();
    assert!(Authority::open(&alias).is_err());
    fs::set_permissions(&fixture.0, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(Authority::open(&fixture.0).is_err());
    fs::set_permissions(&fixture.0, fs::Permissions::from_mode(0o700)).unwrap();
    fixture.worker("replace-lock").finish();
}
