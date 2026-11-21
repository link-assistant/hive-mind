// Focused tests of the exact patched Transaction with its real serde/sha2/Tokio.
use super::canonical_transaction::Transaction;
use crate::auth::storage::canonical_auth::CanonicalAuth;
use std::fs::{self, DirBuilder};
use std::os::unix::fs::DirBuilderExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "hive-native-intent-tx-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        DirBuilder::new().mode(0o700).create(&path).unwrap();
        // The runner requires --test-threads=1; no other threads use the env.
        unsafe {
            std::env::set_var("CODEX_AUTH_HOME", &path);
        }
        let fixture = Self(path);
        fixture.oauth("synthetic G0", "metadata0");
        fixture
    }
    fn storage(&self) -> CanonicalAuth {
        CanonicalAuth::open(&self.0).unwrap()
    }
    fn oauth(&self, token: &str, metadata: &str) {
        self.storage().write(serde_json::to_string(&serde_json::json!({"auth_mode":"chatgpt", "tokens":{"refresh_token":token}, "last_refresh":metadata})).unwrap().as_bytes()).unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        unsafe {
            std::env::remove_var("CODEX_AUTH_HOME");
        }
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn successful_rotation_and_nonrotation_clear_intent() {
    for rotate in [true, false] {
        let fixture = Fixture::new();
        let transaction = Transaction::acquire().unwrap();
        transaction.begin_refresh_exchange("synthetic G0").unwrap();
        assert!(Transaction::assert_refresh_readable().is_err());
        fixture.oauth(
            if rotate {
                "synthetic G1"
            } else {
                "synthetic G0"
            },
            "metadata1",
        );
        transaction.finish_refresh_exchange("synthetic G0").unwrap();
        assert!(Transaction::assert_refresh_readable().is_ok());
        assert_eq!(fixture.storage().refresh_intent().unwrap(), None);
    }
}

#[test]
fn unknown_outcome_and_metadata_only_rewrites_cannot_reauthorize_g0() {
    let fixture = Fixture::new();
    let transaction = Transaction::acquire().unwrap();
    transaction.begin_refresh_exchange("synthetic G0").unwrap();
    drop(transaction);
    fixture.oauth("synthetic G0", "rewritten metadata");
    assert!(Transaction::assert_refresh_readable().is_err());
    let peer = Transaction::acquire().unwrap();
    assert!(peer.begin_refresh_exchange("synthetic G0").is_err());
    assert!(fixture.storage().refresh_intent().unwrap().is_some());
}

#[test]
fn durable_published_g1_survives_death_before_marker_cleanup() {
    let fixture = Fixture::new();
    let transaction = Transaction::acquire().unwrap();
    transaction.begin_refresh_exchange("synthetic G0").unwrap();
    fixture.oauth("synthetic G1", "metadata1");
    drop(transaction);
    assert!(Transaction::assert_refresh_readable().is_ok());
    assert!(fixture.storage().refresh_intent().unwrap().is_some());
    let peer = Transaction::acquire().unwrap();
    assert_eq!(fixture.storage().refresh_intent().unwrap(), None);
    peer.begin_refresh_exchange("synthetic G1").unwrap();
}

#[test]
fn fresh_api_login_can_replace_uncertain_oauth_without_reusing_g0() {
    let fixture = Fixture::new();
    let transaction = Transaction::acquire().unwrap();
    transaction.begin_refresh_exchange("synthetic G0").unwrap();
    drop(transaction);
    let login = Transaction::acquire().unwrap();
    fixture
        .storage()
        .write(br#"{"OPENAI_API_KEY":"synthetic fresh API login"}"#)
        .unwrap();
    drop(login);
    assert!(Transaction::assert_refresh_readable().is_ok());
    let _peer = Transaction::acquire().unwrap();
    assert_eq!(fixture.storage().refresh_intent().unwrap(), None);
}

#[test]
fn logout_preserves_uncertainty_until_fresh_oauth_login() {
    let fixture = Fixture::new();
    let transaction = Transaction::acquire().unwrap();
    transaction.begin_refresh_exchange("synthetic G0").unwrap();
    drop(transaction);
    let logout = Transaction::acquire().unwrap();
    fixture.storage().delete().unwrap();
    drop(logout);
    assert!(Transaction::assert_refresh_readable().is_err());
    let login = Transaction::acquire().unwrap();
    fixture.oauth("synthetic G2", "metadata2");
    drop(login);
    assert!(Transaction::assert_refresh_readable().is_ok());
    let peer = Transaction::acquire().unwrap();
    peer.begin_refresh_exchange("synthetic G2").unwrap();
}

#[test]
fn malformed_credentials_and_wrong_predecessors_cannot_clear_intent() {
    let fixture = Fixture::new();
    let transaction = Transaction::acquire().unwrap();
    assert!(transaction.begin_refresh_exchange("different G0").is_err());
    assert_eq!(fixture.storage().refresh_intent().unwrap(), None);
    transaction.begin_refresh_exchange("synthetic G0").unwrap();
    assert!(transaction.finish_refresh_exchange("different G0").is_err());
    drop(transaction);
    fixture
        .storage()
        .write(b"malformed synthetic JSON")
        .unwrap();
    assert!(Transaction::assert_refresh_readable().is_err());
    let repair = Transaction::acquire().unwrap();
    assert!(repair.begin_refresh_exchange("synthetic G0").is_err());
    assert!(fixture.storage().refresh_intent().unwrap().is_some());
}

#[test]
fn explicit_reauthentication_can_repair_malformed_auth_without_clearing_uncertainty() {
    let fixture = Fixture::new();
    let transaction = Transaction::acquire().unwrap();
    transaction.begin_refresh_exchange("synthetic G0").unwrap();
    drop(transaction);
    fixture
        .storage()
        .write(b"malformed synthetic JSON")
        .unwrap();
    assert!(Transaction::assert_refresh_readable().is_err());

    // An explicit native login needs the same transaction lock before it can
    // replace broken JSON. Acquiring it must preserve the consumed G0 marker.
    let login =
        Transaction::acquire().expect("explicit login must be able to repair safe malformed auth");
    assert!(fixture.storage().refresh_intent().unwrap().is_some());
    assert!(login.begin_refresh_exchange("synthetic G0").is_err());
    fixture.oauth("synthetic fresh login", "metadata2");
    drop(login);

    assert!(Transaction::assert_refresh_readable().is_ok());
    let _peer = Transaction::acquire().unwrap();
    assert_eq!(fixture.storage().refresh_intent().unwrap(), None);
}
