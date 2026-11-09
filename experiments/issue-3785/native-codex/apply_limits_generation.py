#!/usr/bin/env python3
"""Bind native account usage requests to their captured credential generation."""
import hashlib
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1]).resolve(strict=True)
if subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip() != '6aaac694803004a63c6f393d153c96d22521a6b9':
    raise SystemExit('Refusing unpinned native source.')
manager = root / 'codex-rs/login/src/auth/manager.rs'
account = root / 'codex-rs/app-server/src/request_processors/account_processor.rs'
sources = {manager: manager.read_text(), account: account.read_text()}
pins = {manager: 'ec69f361a1fdd1380a51c3423b810766c0586bf6a9102a12a20bc9face51fa5b',
        account: 'f462380b847d6f895f587063cb71a07aec14cf33d46c13298a3940a9647a48d6'}
if any(hashlib.sha256(source.encode()).hexdigest() != pins[target]
       for target, source in sources.items()):
    raise SystemExit('Refusing changed native account usage or authentication contexts.')

anchor = '    pub async fn agent_identity_auth(\n'
addition = '''    /// Capture account credentials, their client and generation under the same lock.
    pub async fn auth_with_http_client_factory_and_change_state(
        &self,
    ) -> Option<(CodexAuth, HttpClientFactory, AuthChangeState)> {
        self.auth().await?;
        let cached = self.inner.read().ok()?;
        Some((
            cached.auth.clone()?,
            self.http_client_factory(),
            *self.auth_change_state_tx.borrow(),
        ))
    }

'''
if sources[manager].count(anchor) != 1:
    raise SystemExit('Ambiguous native credential snapshot context.')
sources[manager] = sources[manager].replace(anchor, addition + anchor, 1)

start = '    async fn get_account_rate_limits_response(\n'
end = '    async fn get_account_token_usage_response(\n'
source = sources[account]
if source.count(start) != 1 or source.count(end) != 1:
    raise SystemExit('Ambiguous native rate limit method context.')
begin, finish = source.index(start), source.index(end)
method = source[begin:finish]
before = '''        let Some((auth, http_client_factory)) =
            self.auth_manager.auth_with_http_client_factory().await
'''
after = '''        let Some((auth, http_client_factory, auth_change_state)) = self
            .auth_manager
            .auth_with_http_client_factory_and_change_state()
            .await
'''
if method.count(before) != 1:
    raise SystemExit('Ambiguous native rate limit credential capture.')
method = method.replace(before, after, 1)
before = '''        let client = BackendClient::from_auth(
'''
after = '''        let admit_generation = || {
            if cfg!(target_os = "linux")
                && std::env::var_os("CODEX_AUTH_HOME").is_some()
                && (self.auth_manager.auth_cached().is_none()
                    || self.auth_manager.auth_change_state_for(&auth) != Some(auth_change_state))
            {
                return Err(invalid_request(
                    "canonical authentication changed while reading account usage",
                ));
            }
            Ok(())
        };
        admit_generation()?;
        let client = BackendClient::from_auth(
'''
if method.count(before) != 1:
    raise SystemExit('Ambiguous native rate limit dispatch context.')
method = method.replace(before, after, 1)
for before, after in [
    ('        let response = response\n', '        admit_generation()?;\n        let response = response\n'),
    ('        Ok(GetAccountRateLimitsResponse {\n',
     '        admit_generation()?;\n        Ok(GetAccountRateLimitsResponse {\n'),
]:
    if method.count(before) != 1:
        raise SystemExit('Ambiguous native rate limit publication context.')
    method = method.replace(before, after, 1)
sources[account] = source[:begin] + method + source[finish:]

for target, source in sources.items():
    sources[target] = subprocess.run(
        ['rustfmt', '+1.99.1', '--edition', '2024', '--config', 'skip_children=true'],
        input=source, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    ).stdout
if '--check' in sys.argv[2:]:
    print('Pinned native account usage generation patch is applicable; no files changed.')
else:
    for target, source in sources.items():
        target.write_text(source)
    print('Applied native account usage generation admission; default selection is unchanged.')
