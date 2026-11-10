#!/usr/bin/env python3
"""Generate synchronous read invalidation after the verified coordination patch.

This does not mutate the supplied native checkout. CI first demonstrates both
cached-read failures on that intermediate version, then applies this repair.
"""
import difflib
import hashlib
from pathlib import Path
import subprocess
import sys

PIN = "6aaac694803004a63c6f393d153c96d22521a6b9"
COORDINATED = "e40e4a670f95fa7904631399b5f2eec7296d60e60f5d16b967335d48af2c5850"
relative = "codex-rs/login/src/auth/manager.rs"
root = Path(sys.argv[1]).resolve(strict=True)
if subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != PIN:
    raise SystemExit("Refusing unpinned native source.")
before = (root / relative).read_text()
if hashlib.sha256(before.encode()).hexdigest() != COORDINATED:
    raise SystemExit("Apply the exact coordination experiment before generating cached reads.")


def replace(text, anchor, replacement):
    if text.count(anchor) != 1:
        raise SystemExit("Ambiguous pinned cached-read anchor.")
    return text.replace(anchor, replacement, 1)


source = replace(before, '''    /// Current cached auth (clone) without attempting a refresh.
    pub fn auth_cached(&self) -> Option<CodexAuth> {
''', '''    /// Current auth without refresh or network I/O. Canonical mode reads the
    /// selected file on every call, including synchronous request-header paths.
    pub fn auth_cached(&self) -> Option<CodexAuth> {
        if canonical_transaction::selected() {
            for _ in 0..2 {
                let generation = self.auth_change_state_tx.borrow().generation;
                let auth = self.load_canonical_auth();
                if self.publish_reloaded_auth(generation, auth.clone()).is_some() {
                    return auth;
                }
            }
            // Concurrent in-process changes must not resurrect an older snapshot.
            return None;
        }
        self.auth_cached_unchecked()
    }

    // Refresh compares the generation loaded before acquiring the cross-process
    // guard with the one read under it. A public read here would overwrite the
    // predecessor and make a waiter consume the already-rotated token again.
    fn auth_cached_unchecked(&self) -> Option<CodexAuth> {
''')
source = replace(source, '''    async fn load_auth(&self) -> Option<CodexAuth> {
        if canonical_transaction::selected() && self.has_external_auth() {
            return None;
        }
''', '''    // API-key and managed ChatGPT file credentials require no async work to
    // reconstruct. Other auth modes are explicitly unsupported by this adapter,
    // rather than permitting a request-path fallback or nested Tokio runtime.
    fn load_canonical_auth(&self) -> Option<CodexAuth> {
        if self.has_external_auth()
            || [OPENAI_API_KEY_ENV_VAR, CODEX_API_KEY_ENV_VAR, CODEX_ACCESS_TOKEN_ENV_VAR]
                .iter().any(|key| std::env::var_os(key).is_some()) {
            return None;
        }
        let stored = load_auth_dot_json(
            &self.codex_home,
            self.auth_credentials_store_mode,
            self.keyring_backend_kind,
        ).ok()??;
        let auth = match stored.resolved_mode() {
            AuthMode::ApiKey => CodexAuth::from_api_key(stored.openai_api_key.as_deref()?),
            AuthMode::Chatgpt => {
                let provenance = stored.tokens.as_ref()
                    .and_then(|tokens| tokens.oauth_provenance.as_ref());
                let client = create_default_auth_client(
                    &refresh_token_endpoint(provenance), &self.auth_route_config,
                ).ok()?;
                let storage = create_auth_storage(
                    self.codex_home.clone(), self.auth_credentials_store_mode,
                    self.keyring_backend_kind,
                );
                CodexAuth::Chatgpt(ChatgptAuth {
                    state: ChatgptAuthState {
                        auth_dot_json: Arc::new(Mutex::new(Some(stored))), client,
                    },
                    storage,
                })
            }
            _ => return None,
        };
        validate_auth_restrictions(
            Some(&self.allowed_login_methods()),
            self.effective_chatgpt_workspaces().as_deref(), &auth,
        ).ok()?;
        Some(auth)
    }

    async fn load_auth(&self) -> Option<CodexAuth> {
        if canonical_transaction::selected() {
            return self.load_canonical_auth();
        }
''')
source = replace(source, '        let auth_before_reload = self.auth_cached();',
                 '        let auth_before_reload = self.auth_cached_unchecked();')
source = subprocess.run(
    ['rustfmt', '--edition', '2024', '--config', 'skip_children=true'],
    input=source, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    check=True,
).stdout
patch = ''.join(difflib.unified_diff(
    before.splitlines(True), source.splitlines(True),
    fromfile=f'a/{relative}', tofile=f'b/{relative}', n=0,
))
Path(__file__).with_name('cached_reads.patch').write_text(patch)
print('Generated pinned synchronous read patch; native source is unchanged.')
