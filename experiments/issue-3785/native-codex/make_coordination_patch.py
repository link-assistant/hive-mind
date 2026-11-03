#!/usr/bin/env python3
"""Regenerate the experimental manager patch from the immutable native source.

This reads git objects, never edits the supplied checkout, and refuses ambiguous
anchors. Run the uncoordinated native controls before applying the output.
"""
import difflib
from pathlib import Path
import subprocess
import sys

PIN = "6aaac694803004a63c6f393d153c96d22521a6b9"
root = Path(sys.argv[1]).resolve(strict=True)
if subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != PIN:
    raise SystemExit("Refusing unpinned native source.")


def original(name):
    return subprocess.check_output(["git", "-C", str(root), "show", f"{PIN}:{name}"], text=True)


def replace(text, before, after):
    if text.count(before) != 1:
        raise SystemExit(f"Ambiguous pinned coordination anchor: {before[:75]!r}")
    return text.replace(before, after, 1)


manager_path = "codex-rs/login/src/auth/manager.rs"
before = original(manager_path)
source = before
source = replace(source, 'pub const OPENAI_API_KEY_ENV_VAR:', '#[path = "canonical_transaction.rs"]\nmod canonical_transaction;\n\npub const OPENAI_API_KEY_ENV_VAR:')
# Every synchronous writer takes the cross-process lock before the existing
# process-local storage mutex. Internal commits called under a refresh guard
# deliberately do not reacquire it.
for header in [
    '    record: AgentIdentityAuthRecord,\n) -> std::io::Result<()> {',
    '    keyring_backend_kind: AuthKeyringBackendKind,\n) -> std::io::Result<()> {\n    let _commit = auth_storage_commit_guard()?;',
]:
    source = replace(source, header, header + '\n    let _canonical = canonical_transaction::Transaction::acquire()?;' if 'let _commit' not in header else header.replace('    let _commit', '    let _canonical = canonical_transaction::Transaction::acquire()?;\n    let _commit'))
source = replace(source, '    let mut auth = stored\n        .or_else(|| guard.clone())', '''    if canonical_transaction::selected() && stored.is_none() {
        return Err(std::io::Error::other("Canonical credentials were removed during identity registration."));
    }
    let mut auth = stored
        .or_else(|| guard.clone())''')
# Public logout locks once; bulk logout uses the unlocked primitive under the
# same guard, including its ephemeral no-op cleanup.
logout_header = '''pub fn logout(
    codex_home: &Path,
    auth_credentials_store_mode: AuthCredentialsStoreMode,
    keyring_backend_kind: AuthKeyringBackendKind,
) -> std::io::Result<bool> {'''
source = replace(source, logout_header, logout_header + '''
    let _canonical = canonical_transaction::Transaction::acquire()?;
    logout_unlocked(codex_home, auth_credentials_store_mode, keyring_backend_kind)
}

fn logout_unlocked(
    codex_home: &Path,
    auth_credentials_store_mode: AuthCredentialsStoreMode,
    keyring_backend_kind: AuthKeyringBackendKind,
) -> std::io::Result<bool> {''')
bulk_start = source.index('fn logout_all_stores(')
bulk_end = source.index('\n#[allow(clippy::too_many_arguments)]', bulk_start)
bulk = source[bulk_start:bulk_end]
bulk_unlocked = bulk.replace('fn logout_all_stores(', 'fn logout_all_stores_unlocked(', 1).replace('logout(', 'logout_unlocked(')
bulk_wrapper = '''fn logout_all_stores(
    codex_home: &Path,
    auth_credentials_store_mode: AuthCredentialsStoreMode,
    keyring_backend_kind: AuthKeyringBackendKind,
) -> std::io::Result<bool> {
    let _canonical = canonical_transaction::Transaction::acquire()?;
    logout_all_stores_unlocked(codex_home, auth_credentials_store_mode, keyring_backend_kind)
}

'''
source = source[:bulk_start] + bulk_wrapper + bulk_unlocked + source[bulk_end:]
# Global native logout/revoke must read current authority after lock acquisition.
start = source.index('pub async fn logout_with_revoke(')
end = source.index('\n/// Store API-key credentials', start)
part = source[start:end]
part = replace(part, ') -> std::io::Result<bool> {\n', ') -> std::io::Result<bool> {\n    let canonical = canonical_transaction::Transaction::acquire_async().await?;\n')
part = replace(part, '        Err(err) => {\n            tracing::warn!', '        Err(err) => {\n            if canonical_transaction::selected() { return Err(err); }\n            tracing::warn!')
part = replace(part, '    logout_all_stores(', '    canonical.assert_current()?;\n    logout_all_stores_unlocked(')
source = source[:start] + part + source[end:]
# Explicit canonical selection disallows environment credentials from silently
# overriding the file authority. Provider-specific alternate routes still need
# launcher admission before this experiment can ship.
source = replace(source, '    // API key via env var takes precedence over any other auth method.', '''    if canonical_transaction::selected()
        && [OPENAI_API_KEY_ENV_VAR, CODEX_API_KEY_ENV_VAR, CODEX_ACCESS_TOKEN_ENV_VAR]
            .iter().any(|key| std::env::var_os(key).is_some()) {
        return Err(std::io::Error::other("Environment credentials conflict with canonical authentication."));
    }
    // API key via env var takes precedence over any other auth method.''')
# Preserve the test-facing helper; the native refresh path borrows its existing
# descriptor guard instead of recursively locking around persist_tokens.
start = source.index('pub(super) fn persist_tokens(')
end = source.index('\n// Requests refreshed ChatGPT OAuth tokens', start)
part = source[start:end]
signature, body = part.split('    let _commit = auth_storage_commit_guard()?;', 1)
inner_signature = signature.replace('pub(super) fn persist_tokens(', 'fn persist_tokens_unlocked(', 1)
wrapper = signature + '''    let canonical = canonical_transaction::Transaction::acquire()?;
    canonical.assert_current()?;
    persist_tokens_unlocked(storage, expected, provenance, id_token, access_token, refresh_token)
}

'''
part = wrapper + inner_signature + '    let _commit = auth_storage_commit_guard()?;' + body
part = replace(part, '    let tokens = auth_dot_json\n        .tokens\n        .as_mut()', '''    if canonical_transaction::selected()
        && auth_dot_json.tokens.as_ref().is_none_or(|tokens| tokens.refresh_token != expected.refresh_token) {
        return Err(std::io::Error::other("Canonical credential generation changed during refresh."));
    }
    let tokens = auth_dot_json
        .tokens
        .as_mut()''')
source = source[:start] + part + source[end:]
# Read-side invalidation is independent of token expiry; logout/replacement is
# visible even to a running process with an otherwise usable cached credential.
source = replace(source, '    pub async fn auth(&self) -> Option<CodexAuth> {\n', '    pub async fn auth(&self) -> Option<CodexAuth> {\n        if canonical_transaction::selected() { self.reload().await; }\n')
source = replace(source, '            return Some(auth);', '            return if canonical_transaction::selected() { None } else { Some(auth) };')
source = replace(source, '        self.auth().await;\n        let cached', '        self.auth().await?;\n        let cached')
source = replace(source, '    async fn load_auth(&self) -> Option<CodexAuth> {\n', '    async fn load_auth(&self) -> Option<CodexAuth> {\n        if canonical_transaction::selected() && self.has_external_auth() { return None; }\n')
source = replace(source, '        let auth = self.resolve_external_auth(external_auth.as_ref()).await?;', '''        if canonical_transaction::selected() {
            return Err(RefreshTokenError::from(std::io::Error::other("External auth conflicts with canonical authentication.")));
        }
        let auth = self.resolve_external_auth(external_auth.as_ref()).await?;''')
# Lease the same descriptor through nonstandard IdP exchanges too. The caller
# releases it before resource-server I/O, as with the existing manager permit.
source = replace(source, '        let login_generation = self.auth_change_state_tx.borrow().login_generation;\n        let Some(tokens)', '''        let canonical = canonical_transaction::Transaction::acquire_async().await?;
        if canonical_transaction::selected() { self.reload().await; }
        let login_generation = self.auth_change_state_tx.borrow().login_generation;
        let Some(tokens)''')
source = replace(source, 'Ok(Some(AccountOAuthGrantLease { grant, permit }))', 'Ok(Some(AccountOAuthGrantLease { grant, permit, canonical }))')
# Refresh always locks, then rereads. Authority-forced refresh uses the same
# generation check instead of bypassing it and reusing a consumed predecessor.
start = source.index('    async fn refresh_token_with_reason(')
end = source.index('\n    /// Attempt to refresh the current auth token', start)
part = source[start:end]
part = replace(part, '        let auth_before_reload = self.auth_cached();', '''        let canonical = canonical_transaction::Transaction::acquire_async().await.map_err(RefreshTokenError::from)?;
        let auth_before_reload = self.auth_cached();''')
part = part.replace('self.refresh_token_from_authority_impl(reason)', 'self.refresh_token_from_authority_impl(reason, &canonical)')
part = replace(part, '        if self.has_external_auth() {', '''        if canonical_transaction::selected() {
            if self.has_external_auth() {
                return Err(RefreshTokenError::from(std::io::Error::other("External auth conflicts with canonical authentication.")));
            }
            self.reload().await;
            canonical.assert_current().map_err(RefreshTokenError::from)?;
            let current = self.auth_cached();
            if current.is_none() {
                return Err(RefreshTokenError::from(std::io::Error::other("Canonical authentication is unavailable.")));
            }
            if !Self::auths_equal_for_refresh(auth_before_reload.as_ref(), current.as_ref()) {
                return Ok(());
            }
            return self.refresh_token_from_authority_impl(reason, &canonical).await;
        }
        if self.has_external_auth() {''')
source = source[:start] + part + source[end:]
source = replace(source, '''    async fn refresh_token_from_authority_with_reason(
        &self,
        reason: RefreshReason,
    ) -> Result<(), RefreshTokenError> {
''', '''    async fn refresh_token_from_authority_with_reason(
        &self,
        reason: RefreshReason,
    ) -> Result<(), RefreshTokenError> {
        if canonical_transaction::selected() {
            return self.refresh_token_with_reason(reason, None).await;
        }
''')
source = replace(source, '        self.refresh_token_from_authority_impl(reason).await\n', '        let canonical = canonical_transaction::Transaction::acquire_async().await.map_err(RefreshTokenError::from)?;\n        self.refresh_token_from_authority_impl(reason, &canonical).await\n')
source = replace(source, '''    async fn refresh_token_from_authority_impl(
        &self,
        reason: RefreshReason,
''', '''    async fn refresh_token_from_authority_impl(
        &self,
        reason: RefreshReason,
        canonical: &canonical_transaction::Transaction,
''')
source = replace(source, '                        reason,\n                    ))', '                        reason,\n                        canonical,\n                    ))')
# Both manager logout variants hold the descriptor through deletion and cache
# invalidation; revoke must inspect the current file, not a cached predecessor.
for name in ['logout', 'logout_with_revoke']:
    start = source.index(f'    pub async fn {name}(&self)')
    end = source.index('\n    }', start) + len('\n    }')
    part = source[start:end]
    part = replace(part, '        self.ensure_logout_allowed()?;', '        self.ensure_logout_allowed()?;\n        let canonical = canonical_transaction::Transaction::acquire_async().await?;')
    part = replace(part, 'logout_all_stores(', 'logout_all_stores_unlocked(')
    if name == 'logout_with_revoke':
        part = replace(part, '''        let auth_dot_json = self
            .auth_cached()
            .and_then(|auth| auth.get_current_auth_json());''', '''        let auth_dot_json = if canonical_transaction::selected() {
            load_auth_dot_json(&self.codex_home, self.auth_credentials_store_mode, self.keyring_backend_kind)?
        } else {
            self.auth_cached().and_then(|auth| auth.get_current_auth_json())
        };''')
    part = replace(part, '        let removed =' if name == 'logout' else '        let result =', '        canonical.assert_current()?;\n        let removed =' if name == 'logout' else '        canonical.assert_current()?;\n        let result =')
    source = source[:start] + part + source[end:]
source = replace(source, '''        tokens: TokenData,
        reason: RefreshReason,
    ) -> Result<(), RefreshTokenError> {''', '''        tokens: TokenData,
        reason: RefreshReason,
        canonical: &canonical_transaction::Transaction,
    ) -> Result<(), RefreshTokenError> {''')
source = replace(source, '        let refresh_response = request_chatgpt_token_refresh(', '        canonical.assert_current().map_err(RefreshTokenError::from)?;\n        let exchange = request_chatgpt_token_refresh(')
source = replace(source, '''        )
        .await?;

        // An explicit override may send refresh''', '''        );
        let refresh_response = if canonical_transaction::selected() {
            tokio::time::timeout(std::time::Duration::from_secs(45), exchange).await
                .map_err(|_| RefreshTokenError::from(std::io::Error::new(std::io::ErrorKind::TimedOut, "Canonical token exchange expired.")))??
        } else { exchange.await? };
        canonical.assert_current().map_err(RefreshTokenError::from)?;

        // An explicit override may send refresh''')
source = replace(source, '        persist_tokens(\n            auth.storage(),', '        persist_tokens_unlocked(\n            auth.storage(),')

account_path = 'codex-rs/login/src/auth/account_grant.rs'
account_before = original(account_path)
account = replace(account_before, '/// Login and logout remain available and invalidate the grant independently of this lease.', '/// Canonical login/logout wait for this exchange; legacy stores retain their native behavior.')
account = replace(account, '    pub(super) permit: OwnedSemaphorePermit,', '    pub(super) permit: OwnedSemaphorePermit,\n    pub(super) canonical: super::canonical_transaction::Transaction,')
account = replace(account, '        drop(self.permit);', '        drop(self.permit);\n        drop(self.canonical);')

# Parse and format both changed files without compiling the large native graph.
# This is syntax validation only; the CI native build remains required.
def formatted(text):
    return subprocess.run(['rustfmt', '--edition', '2024', '--config', 'skip_children=true'], input=text, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout


source = formatted(source)
account = formatted(account)
patch = ''.join(difflib.unified_diff(before.splitlines(True), source.splitlines(True), fromfile=f'a/{manager_path}', tofile=f'b/{manager_path}'))
patch += ''.join(difflib.unified_diff(account_before.splitlines(True), account.splitlines(True), fromfile=f'a/{account_path}', tofile=f'b/{account_path}'))
Path(__file__).with_name('coordination.patch').write_text(patch)
print('Generated pinned native coordination patch; no native checkout files changed.')
