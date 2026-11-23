// Inserted into the pinned native provider module by apply_request_auth.py.
// No alternate credential owner or remote catalog is constructed in this state.
#[derive(Debug)]
struct RejectedCanonicalModelProvider {
    info: ModelProviderInfo,
}

impl RejectedCanonicalModelProvider {
    fn refusal<T>() -> codex_protocol::error::Result<T> {
        Err(CodexErr::InvalidRequest(
            "Provider authority overrides are unsupported with canonical authentication."
                .to_string(),
        ))
    }
}

impl ModelProvider for RejectedCanonicalModelProvider {
    fn info(&self) -> &ModelProviderInfo {
        &self.info
    }

    fn auth_manager(&self) -> Option<Arc<AuthManager>> {
        None
    }

    fn auth(&self) -> ModelProviderFuture<'_, Option<CodexAuth>> {
        Box::pin(async { None })
    }

    fn account_state(&self) -> ProviderAccountResult {
        Ok(ProviderAccountState {
            account: None,
            requires_openai_auth: true,
        })
    }

    fn api_provider(&self) -> ModelProviderFuture<'_, codex_protocol::error::Result<Provider>> {
        Box::pin(async { Self::refusal() })
    }

    fn runtime_base_url(
        &self,
    ) -> ModelProviderFuture<'_, codex_protocol::error::Result<Option<String>>> {
        Box::pin(async { Self::refusal() })
    }

    fn api_auth(
        &self,
    ) -> ModelProviderFuture<'_, codex_protocol::error::Result<SharedAuthProvider>> {
        Box::pin(async { Self::refusal() })
    }

    fn api_auth_for_scope(
        &self,
        _scope: ProviderAuthScope,
    ) -> ModelProviderFuture<'_, codex_protocol::error::Result<ResolvedProviderAuth>> {
        Box::pin(async { Self::refusal() })
    }

    fn models_manager(
        &self,
        _codex_home: PathBuf,
        config_model_catalog: Option<ModelsResponse>,
    ) -> SharedModelsManager {
        // The trait's default uses only an in-memory static catalog and None
        // auth. Both cached entry points therefore remain free of providers.
        self.models_manager_without_cache(config_model_catalog)
    }
}
