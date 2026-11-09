#!/usr/bin/env python3
"""Refuse missing canonical auth and unsupported provider authority overrides.

Apply only after the full CLI request control establishes this intermediate
behavior. This source experiment is not installed in production images.
"""
import hashlib
from pathlib import Path
import subprocess
import sys

PIN = "6aaac694803004a63c6f393d153c96d22521a6b9"
AUTH_HASH = "fcb210f36cc01f88b511305952aa36820bfa15d0afd0186fd49ac72e98c20153"
PROVIDER_HASH = "1867ba1d0a45b3ac1367caa04900f95a60365475039342af04405463d7f1b534"
root = Path(sys.argv[1]).resolve(strict=True)
if subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != PIN:
    raise SystemExit("Refusing unpinned native source.")
target = root / "codex-rs/model-provider/src/auth.rs"
source = target.read_text()
if hashlib.sha256(source.encode()).hexdigest() != AUTH_HASH:
    raise SystemExit("Refusing a changed native request auth provider.")
provider_target = root / "codex-rs/model-provider/src/provider.rs"
provider_source = provider_target.read_text()
if hashlib.sha256(provider_source.encode()).hexdigest() != PROVIDER_HASH:
    raise SystemExit("Refusing a changed native provider factory.")

def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit("Ambiguous native request auth context; no files changed.")
    source = source.replace(before, after, 1)


replace('''pub(crate) fn resolve_provider_auth(''', '''// Canonical mode deliberately supports file-backed API keys and managed
// ChatGPT only. Provider credentials and custom headers need a separate,
// validated authority contract; do not silently route around the file manager.
pub(crate) fn validate_canonical_provider_authority(
    provider: &ModelProviderInfo,
) -> codex_protocol::error::Result<()> {
    if std::env::var_os("CODEX_AUTH_HOME").is_none() {
        return Ok(());
    }
    let custom_headers = provider.http_headers.as_ref().is_some_and(|headers| {
        headers.iter().any(|(name, value)| {
            !name.eq_ignore_ascii_case("version") || value.as_str() != env!("CARGO_PKG_VERSION")
        })
    });
    // The stock provider declares these optional mappings even when unset.
    // An environment-selected organization/project is an independent identity.
    let custom_env_headers = provider.env_http_headers.as_ref().is_some_and(|headers| {
        headers.iter().any(|(name, variable)| {
            !((name.eq_ignore_ascii_case("OpenAI-Organization") && variable == "OPENAI_ORGANIZATION")
                || (name.eq_ignore_ascii_case("OpenAI-Project") && variable == "OPENAI_PROJECT"))
                || std::env::var_os(variable).is_some()
        })
    });
    if !provider.requires_openai_auth
        || provider.is_amazon_bedrock()
        || provider.env_key.is_some()
        || provider.experimental_bearer_token.is_some()
        || provider.auth.is_some()
        || provider.gateway_oauth.is_some()
        || provider.aws.is_some()
        || custom_headers
        || custom_env_headers
    {
        return Err(CodexErr::InvalidRequest(
            "Provider authority overrides are unsupported with canonical authentication.".to_string(),
        ));
    }
    Ok(())
}

fn validate_canonical_request_auth(
    auth: Option<&CodexAuth>,
    provider: &ModelProviderInfo,
) -> codex_protocol::error::Result<()> {
    validate_canonical_provider_authority(provider)?;
    if std::env::var_os("CODEX_AUTH_HOME").is_none() {
        return Ok(());
    }
    if !matches!(auth, Some(CodexAuth::ApiKey(_) | CodexAuth::Chatgpt(_))) {
        return Err(CodexErr::InvalidRequest(
            "Canonical authentication is unavailable; authenticate before execution.".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn resolve_provider_auth(''')
replace('''    if let Some(auth) = bearer_auth_for_provider(provider)? {''', '''    validate_canonical_request_auth(auth, provider)?;
    if let Some(auth) = bearer_auth_for_provider(provider)? {''')
replace('''    let ProviderAuthScope {
        agent_identity_policy,''', '''    validate_canonical_request_auth(auth, provider)?;
    let ProviderAuthScope {
        agent_identity_policy,''')

factory_context = '''    if provider_info.is_amazon_bedrock() {
        return Arc::new(AmazonBedrockModelProvider::new(provider_info, auth_manager));
    }'''
if provider_source.count(factory_context) != 1:
    raise SystemExit("Ambiguous native provider factory context; no files changed.")
provider_source = provider_source.replace(factory_context, '''    // Refuse before alternate constructors can create credential managers,
    // exporters, recovery helpers or remote model catalogs.
    if crate::auth::validate_canonical_provider_authority(&provider_info).is_err() {
        return Arc::new(RejectedCanonicalModelProvider { info: provider_info });
    }
''' + factory_context, 1)
provider_context = '''/// Runtime model provider that orchestrates primary and gateway credentials.'''
if provider_source.count(provider_context) != 1:
    raise SystemExit("Ambiguous native provider implementation context; no files changed.")
provider_source = provider_source.replace(provider_context, (Path(__file__).parent / "rejected_canonical_provider.rs").read_text() + "\n" + provider_context, 1)

def format_rust(value):
    return subprocess.run(
        ["rustfmt", "--edition", "2024", "--config", "skip_children=true"],
        input=value, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    ).stdout

source = format_rust(source)
provider_source = format_rust(provider_source)
if "--check" in sys.argv[2:]:
    print("Pinned canonical request auth patch is applicable; no files changed.")
else:
    target.write_text(source)
    provider_target.write_text(provider_source)
    print("Applied canonical request auth experiment; production is unchanged.")
