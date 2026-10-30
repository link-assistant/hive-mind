#!/usr/bin/env python3
"""Test the exact native metadata writer with in-memory storage/lock fixtures.

This small harness exercises the real writer and login comparisons. Its
fixtures do not establish filesystem locking or full native CLI behavior.
"""
import argparse
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source_root", type=Path)
args = parser.parse_args()
native = args.source_root.resolve(strict=True) / "codex-rs/login/src/auth"
manager = (native / "manager.rs").read_text()
account = (native / "account_grant.rs").read_text()


def extract(source, start, end):
    if source.count(start) != 1 or source.count(end) != 1:
        raise SystemExit("Ambiguous native writer/comparison boundaries.")
    return start + source.split(start)[1].split(end)[0]


writer = extract(manager, "\nfn persist_agent_identity_record(\n", '\n#[path = "canonical_transaction.rs"]')
comparison = extract(manager, "\nfn same_login_for_persistence(", "\n// Persist refreshed tokens")
account_comparison = account[account.index("pub(super) fn same_account_login("):].replace("pub(super) ", "", 1)
fixtures = r'''
use std::sync::{Arc, Mutex};
#[derive(Clone, Debug, PartialEq)] struct IdTokenInfo { chatgpt_user_id: Option<String> }
#[derive(Clone, Debug, PartialEq)] struct TokenData {
    login_owner_id: Option<String>, account_id: Option<String>, id_token: IdTokenInfo,
    refresh_token: String,
}
#[derive(Clone, Debug, PartialEq)] struct AgentIdentityAuthRecord { account_id: String }
#[derive(Clone, Debug, PartialEq)] enum AgentIdentityStorage { Record(AgentIdentityAuthRecord) }
#[derive(Clone, Debug, PartialEq)] struct AuthDotJson {
    tokens: Option<TokenData>, agent_identity: Option<AgentIdentityStorage>,
}
trait AuthStorageBackend {
    fn load(&self) -> std::io::Result<Option<AuthDotJson>>;
    fn save(&self, auth: &AuthDotJson) -> std::io::Result<()>;
}
struct MemoryStorage(Mutex<Option<AuthDotJson>>);
impl AuthStorageBackend for MemoryStorage {
    fn load(&self) -> std::io::Result<Option<AuthDotJson>> { Ok(self.0.lock().unwrap().clone()) }
    fn save(&self, auth: &AuthDotJson) -> std::io::Result<()> {
        *self.0.lock().unwrap() = Some(auth.clone()); Ok(())
    }
}
fn auth_storage_commit_guard() -> std::io::Result<()> { Ok(()) }
mod canonical_transaction {
    use std::sync::atomic::{AtomicBool, Ordering};
    pub static SELECTED: AtomicBool = AtomicBool::new(true);
    pub fn selected() -> bool { SELECTED.load(Ordering::SeqCst) }
    pub struct Transaction;
    impl Transaction { pub fn acquire() -> std::io::Result<Self> { Ok(Self) } }
}
fn auth(account: &str, generation: &str, owner: Option<&str>) -> AuthDotJson {
    AuthDotJson { tokens: Some(TokenData { login_owner_id: owner.map(String::from),
        account_id: Some(account.into()), id_token: IdTokenInfo { chatgpt_user_id: Some("user".into()) },
        refresh_token: generation.into() }), agent_identity: None }
}
fn check(current: Option<AuthDotJson>, owner: Option<&str>, accepted: bool, selected: bool) {
    canonical_transaction::SELECTED.store(selected, std::sync::atomic::Ordering::SeqCst);
    let old = auth("A", "G0", owner);
    let cached = Arc::new(Mutex::new(Some(old.clone())));
    let concrete = Arc::new(MemoryStorage(Mutex::new(current.clone())));
    let storage: Arc<dyn AuthStorageBackend> = concrete;
    let result = persist_agent_identity_record(&cached, &storage,
        AgentIdentityAuthRecord { account_id: "A".into() });
    assert_eq!(result.is_ok(), accepted, "Publication must match the current canonical login.");
    if accepted {
        let mut expected = current.unwrap();
        let identity = Some(AgentIdentityStorage::Record(AgentIdentityAuthRecord { account_id: "A".into() }));
        expected.agent_identity = identity.clone();
        assert_eq!(storage.load().unwrap(), Some(expected), "Current disk tokens must survive metadata publication.");
        let mut expected_cache = old;
        expected_cache.agent_identity = identity;
        assert_eq!(*cached.lock().unwrap(), Some(expected_cache), "Metadata may not publish another disk login into the cache.");
    } else {
        assert_eq!(storage.load().unwrap(), current, "Refusal may not mutate replacement credentials.");
        assert_eq!(*cached.lock().unwrap(), Some(old), "Refusal may not publish metadata to the old handle.");
    }
}
#[test] fn legacy_account_switch_refuses() { check(Some(auth("B", "G1", None)), None, false, true); }
#[test] fn api_key_login_refuses() { check(Some(AuthDotJson { tokens: None, agent_identity: None }), None, false, true); }
#[test] fn legacy_logout_refuses() { check(None, None, false, true); }
#[test] fn healthy_legacy_login_publishes() { check(Some(auth("A", "G0", None)), None, true, true); }
#[test] fn legacy_rotation_preserves_new_tokens() { check(Some(auth("A", "G1", None)), None, true, true); }
#[test] fn owned_rotation_preserves_new_tokens() { check(Some(auth("A", "G1", Some("owner"))), Some("owner"), true, true); }
#[test] fn owned_new_login_refuses() { check(Some(auth("A", "G1", Some("new"))), Some("owner"), false, true); }
#[test] fn missing_owner_recovery_retains_native_semantics() { check(Some(auth("A", "G0", None)), Some("owner"), true, true); }
#[test] fn missing_owner_changed_generation_refuses() { check(Some(auth("A", "G1", None)), Some("owner"), false, true); }
#[test] fn unselected_legacy_behavior_is_preserved() { check(Some(auth("B", "G1", None)), None, true, false); }
'''
with tempfile.TemporaryDirectory(prefix="hive-native-identity-tests-") as temporary:
    harness = Path(temporary) / "harness.rs"
    binary = Path(temporary) / "identity-tests"
    harness.write_text(fixtures + writer + comparison + account_comparison)
    subprocess.run(["rustc", "+1.99.1", "--edition", "2024", "--test", str(harness), "-o", str(binary)], check=True)
    subprocess.run(["prlimit", "--data=134217728", "--stack=8388608", "--core=0", "--", str(binary),
                    "--test-threads=1"], check=True)
