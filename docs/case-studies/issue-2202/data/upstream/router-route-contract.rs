//! Canonical HTTP route classification and endpoint construction.
//!
//! Every network route belongs to exactly one class. Server listeners and
//! clients consume this inventory instead of maintaining path-shaped policy in
//! separate string tables.

use http::Method;

pub use crate::api_error::ApiDialect;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum RouteClass {
    Neutral,
    Management,
    Service(ServiceKind),
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ServiceKind {
    Anthropic,
    OpenAi,
    Codex,
    Qwen,
    Gemini,
    Vertex,
    Bedrock,
    GitHub,
    Git,
    ActivityPub,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ListenerKind {
    Combined,
    InferenceOnly,
    Admin,
    GitHubAdapter,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum RouteAuth {
    None,
    Client,
    Admin,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum RouteMethod {
    Get,
    Post,
    Delete,
    Any,
}

impl RouteMethod {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Post => "POST",
            Self::Delete => "DELETE",
            Self::Any => "ANY",
        }
    }

    fn matches(self, method: &Method) -> bool {
        self == Self::Any
            || matches!(
                (self, method),
                (Self::Get, &Method::GET)
                    | (Self::Post, &Method::POST)
                    | (Self::Delete, &Method::DELETE)
            )
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum RouteId {
    Health,
    Tokens,
    ClientTokens,
    RevokeToken,
    RotateToken,
    RotateClientToken,
    Providers,
    Provider,
    Login,
    LoginSession,
    LoginCode,
    Usage,
    Accounts,
    SubscriptionHealth,
    Metrics,
    AdminStatus,
    AdminBootstrap,
    AdminBootstrapConfirm,
    AdminRotate,
    AdminSummary,
    AnthropicMessages,
    AnthropicCountTokens,
    AnthropicModels,
    OpenAiChatCompletions,
    OpenAiResponses,
    OpenAiModels,
    CodexChatCompletions,
    CodexResponses,
    CodexModels,
    QwenChatCompletions,
    QwenResponses,
    QwenModels,
    GeminiModels,
    GeminiModel,
    Vertex,
    AnthropicVertex,
    BedrockInvoke,
    BedrockInvokeStream,
    GitHubRest,
    GitHubGraphql,
    Git,
    ActivityPubActor,
    ActivityPubInbox,
    ActivityPubOutbox,
    ActivityPubFollowers,
    ActivityPubFollowProblemsets,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RouteSpec {
    pub id: RouteId,
    pub method: RouteMethod,
    pub template: &'static str,
    pub class: RouteClass,
    pub auth: RouteAuth,
    pub dialect: ApiDialect,
    pub listeners: &'static [ListenerKind],
}

const COMBINED_AND_INFERENCE: &[ListenerKind] =
    &[ListenerKind::Combined, ListenerKind::InferenceOnly];
const COMBINED_AND_ADMIN: &[ListenerKind] = &[ListenerKind::Combined, ListenerKind::Admin];
const COMBINED_ONLY: &[ListenerKind] = &[ListenerKind::Combined];

const fn neutral(id: RouteId, method: RouteMethod, template: &'static str) -> RouteSpec {
    RouteSpec {
        id,
        method,
        template,
        class: RouteClass::Neutral,
        auth: RouteAuth::None,
        dialect: ApiDialect::Anthropic,
        listeners: COMBINED_AND_INFERENCE,
    }
}

const fn management(id: RouteId, method: RouteMethod, template: &'static str) -> RouteSpec {
    RouteSpec {
        id,
        method,
        template,
        class: RouteClass::Management,
        auth: RouteAuth::Admin,
        dialect: ApiDialect::Anthropic,
        listeners: COMBINED_AND_ADMIN,
    }
}

const fn open_management(id: RouteId, method: RouteMethod, template: &'static str) -> RouteSpec {
    RouteSpec {
        auth: RouteAuth::None,
        ..management(id, method, template)
    }
}

const fn ai_service(
    id: RouteId,
    method: RouteMethod,
    template: &'static str,
    service: ServiceKind,
    dialect: ApiDialect,
) -> RouteSpec {
    RouteSpec {
        id,
        method,
        template,
        class: RouteClass::Service(service),
        auth: RouteAuth::Client,
        dialect,
        listeners: COMBINED_AND_INFERENCE,
    }
}

const fn private_service(
    id: RouteId,
    method: RouteMethod,
    template: &'static str,
    service: ServiceKind,
    dialect: ApiDialect,
) -> RouteSpec {
    RouteSpec {
        id,
        method,
        template,
        class: RouteClass::Service(service),
        auth: RouteAuth::Client,
        dialect,
        listeners: COMBINED_ONLY,
    }
}

const fn public_private_service(
    id: RouteId,
    method: RouteMethod,
    template: &'static str,
    service: ServiceKind,
    dialect: ApiDialect,
) -> RouteSpec {
    RouteSpec {
        auth: RouteAuth::None,
        ..private_service(id, method, template, service, dialect)
    }
}

const ROUTES: &[RouteSpec] = &[
    neutral(RouteId::Health, RouteMethod::Get, "/api/health"),
    management(RouteId::Tokens, RouteMethod::Get, "/api/management/tokens"),
    management(RouteId::Tokens, RouteMethod::Post, "/api/management/tokens"),
    management(
        RouteId::ClientTokens,
        RouteMethod::Post,
        "/api/management/tokens/client",
    ),
    management(
        RouteId::RevokeToken,
        RouteMethod::Post,
        "/api/management/tokens/revoke",
    ),
    management(
        RouteId::RotateToken,
        RouteMethod::Post,
        "/api/management/tokens/rotate",
    ),
    management(
        RouteId::RotateClientToken,
        RouteMethod::Post,
        "/api/management/tokens/rotate-client",
    ),
    management(
        RouteId::Providers,
        RouteMethod::Get,
        "/api/management/providers",
    ),
    management(
        RouteId::Providers,
        RouteMethod::Post,
        "/api/management/providers",
    ),
    management(
        RouteId::Provider,
        RouteMethod::Get,
        "/api/management/providers/{name}",
    ),
    management(
        RouteId::Provider,
        RouteMethod::Delete,
        "/api/management/providers/{name}",
    ),
    management(RouteId::Login, RouteMethod::Post, "/api/management/login"),
    management(
        RouteId::LoginSession,
        RouteMethod::Get,
        "/api/management/login/{id}",
    ),
    management(
        RouteId::LoginSession,
        RouteMethod::Delete,
        "/api/management/login/{id}",
    ),
    management(
        RouteId::LoginCode,
        RouteMethod::Post,
        "/api/management/login/{id}/code",
    ),
    management(RouteId::Usage, RouteMethod::Get, "/api/management/usage"),
    management(
        RouteId::Accounts,
        RouteMethod::Get,
        "/api/management/accounts",
    ),
    management(
        RouteId::SubscriptionHealth,
        RouteMethod::Get,
        "/api/management/health/subscriptions",
    ),
    management(
        RouteId::Metrics,
        RouteMethod::Get,
        "/api/management/metrics",
    ),
    open_management(
        RouteId::AdminStatus,
        RouteMethod::Get,
        "/api/management/admin/status",
    ),
    open_management(
        RouteId::AdminBootstrap,
        RouteMethod::Post,
        "/api/management/admin/bootstrap",
    ),
    open_management(
        RouteId::AdminBootstrapConfirm,
        RouteMethod::Post,
        "/api/management/admin/bootstrap/confirm",
    ),
    management(
        RouteId::AdminRotate,
        RouteMethod::Post,
        "/api/management/admin/rotate",
    ),
    management(
        RouteId::AdminSummary,
        RouteMethod::Get,
        "/api/management/admin/summary",
    ),
    ai_service(
        RouteId::AnthropicMessages,
        RouteMethod::Post,
        "/api/services/anthropic/v1/messages",
        ServiceKind::Anthropic,
        ApiDialect::Anthropic,
    ),
    ai_service(
        RouteId::AnthropicCountTokens,
        RouteMethod::Post,
        "/api/services/anthropic/v1/messages/count_tokens",
        ServiceKind::Anthropic,
        ApiDialect::Anthropic,
    ),
    ai_service(
        RouteId::AnthropicModels,
        RouteMethod::Get,
        "/api/services/anthropic/v1/models",
        ServiceKind::Anthropic,
        ApiDialect::Anthropic,
    ),
    ai_service(
        RouteId::OpenAiChatCompletions,
        RouteMethod::Post,
        "/api/services/openai/v1/chat/completions",
        ServiceKind::OpenAi,
        ApiDialect::OpenAi,
    ),
    ai_service(
        RouteId::OpenAiResponses,
        RouteMethod::Post,
        "/api/services/openai/v1/responses",
        ServiceKind::OpenAi,
        ApiDialect::OpenAi,
    ),
    ai_service(
        RouteId::OpenAiModels,
        RouteMethod::Get,
        "/api/services/openai/v1/models",
        ServiceKind::OpenAi,
        ApiDialect::OpenAi,
    ),
    ai_service(
        RouteId::CodexChatCompletions,
        RouteMethod::Post,
        "/api/services/codex/v1/chat/completions",
        ServiceKind::Codex,
        ApiDialect::OpenAi,
    ),
    ai_service(
        RouteId::CodexResponses,
        RouteMethod::Post,
        "/api/services/codex/v1/responses",
        ServiceKind::Codex,
        ApiDialect::OpenAi,
    ),
    ai_service(
        RouteId::CodexModels,
        RouteMethod::Get,
        "/api/services/codex/v1/models",
        ServiceKind::Codex,
        ApiDialect::OpenAi,
    ),
    ai_service(
        RouteId::QwenChatCompletions,
        RouteMethod::Post,
        "/api/services/qwen/v1/chat/completions",
        ServiceKind::Qwen,
        ApiDialect::OpenAi,
    ),
    ai_service(
        RouteId::QwenResponses,
        RouteMethod::Post,
        "/api/services/qwen/v1/responses",
        ServiceKind::Qwen,
        ApiDialect::OpenAi,
    ),
    ai_service(
        RouteId::QwenModels,
        RouteMethod::Get,
        "/api/services/qwen/v1/models",
        ServiceKind::Qwen,
        ApiDialect::OpenAi,
    ),
    ai_service(
        RouteId::GeminiModels,
        RouteMethod::Get,
        "/api/services/gemini/v1beta/models",
        ServiceKind::Gemini,
        ApiDialect::Gemini,
    ),
    ai_service(
        RouteId::GeminiModel,
        RouteMethod::Get,
        "/api/services/gemini/v1beta/models/{model}",
        ServiceKind::Gemini,
        ApiDialect::Gemini,
    ),
    ai_service(
        RouteId::GeminiModel,
        RouteMethod::Post,
        "/api/services/gemini/v1beta/models/{model}",
        ServiceKind::Gemini,
        ApiDialect::Gemini,
    ),
    ai_service(
        RouteId::AnthropicVertex,
        RouteMethod::Post,
        "/api/services/vertex/v1/projects/{project}/locations/{location}/publishers/anthropic/models/{*model_action}",
        ServiceKind::Vertex,
        ApiDialect::Anthropic,
    ),
    ai_service(
        RouteId::Vertex,
        RouteMethod::Post,
        "/api/services/vertex/v1/{*path}",
        ServiceKind::Vertex,
        ApiDialect::Gemini,
    ),
    ai_service(
        RouteId::BedrockInvoke,
        RouteMethod::Post,
        "/api/services/bedrock/invoke",
        ServiceKind::Bedrock,
        ApiDialect::Anthropic,
    ),
    ai_service(
        RouteId::BedrockInvokeStream,
        RouteMethod::Post,
        "/api/services/bedrock/invoke-with-response-stream",
        ServiceKind::Bedrock,
        ApiDialect::Anthropic,
    ),
    private_service(
        RouteId::GitHubRest,
        RouteMethod::Any,
        "/api/services/github/api/v3/{*path}",
        ServiceKind::GitHub,
        ApiDialect::GitHub,
    ),
    private_service(
        RouteId::GitHubGraphql,
        RouteMethod::Post,
        "/api/services/github/api/graphql",
        ServiceKind::GitHub,
        ApiDialect::GitHub,
    ),
    private_service(
        RouteId::Git,
        RouteMethod::Any,
        "/api/services/github/git/{*path}",
        ServiceKind::Git,
        ApiDialect::GitHub,
    ),
    public_private_service(
        RouteId::ActivityPubActor,
        RouteMethod::Get,
        "/api/services/activitypub/actor/code",
        ServiceKind::ActivityPub,
        ApiDialect::Anthropic,
    ),
    public_private_service(
        RouteId::ActivityPubInbox,
        RouteMethod::Post,
        "/api/services/activitypub/inbox/code",
        ServiceKind::ActivityPub,
        ApiDialect::Anthropic,
    ),
    public_private_service(
        RouteId::ActivityPubOutbox,
        RouteMethod::Get,
        "/api/services/activitypub/outbox/code",
        ServiceKind::ActivityPub,
        ApiDialect::Anthropic,
    ),
    public_private_service(
        RouteId::ActivityPubFollowers,
        RouteMethod::Get,
        "/api/services/activitypub/actors/code/followers",
        ServiceKind::ActivityPub,
        ApiDialect::Anthropic,
    ),
    public_private_service(
        RouteId::ActivityPubFollowProblemsets,
        RouteMethod::Get,
        "/api/services/activitypub/activities/follow-problemsets-code-001",
        ServiceKind::ActivityPub,
        ApiDialect::Anthropic,
    ),
];

#[must_use]
pub const fn route_specs() -> &'static [RouteSpec] {
    ROUTES
}

/// The canonical path template for a route id.
///
/// Multiple methods may share an id, but they must share this template.
#[must_use]
pub fn route_template(id: RouteId) -> &'static str {
    ROUTES
        .iter()
        .find(|spec| spec.id == id)
        .map(|spec| spec.template)
        .expect("unknown route id")
}

#[must_use]
pub fn route_for_path(method: &Method, path: &str) -> Option<&'static RouteSpec> {
    ROUTES
        .iter()
        .find(|spec| spec.method.matches(method) && template_matches(spec.template, path))
}

#[must_use]
pub fn dialect_for_path(path: &str) -> Option<ApiDialect> {
    ROUTES
        .iter()
        .find(|spec| template_matches(spec.template, path))
        .map(|spec| spec.dialect)
}

#[must_use]
pub fn endpoint_base(origin: &str, service: ServiceKind) -> String {
    format!(
        "{}{}",
        origin.trim_end_matches('/'),
        service_base_path(service)
    )
}

#[must_use]
pub const fn service_base_path(service: ServiceKind) -> &'static str {
    match service {
        ServiceKind::Anthropic => "/api/services/anthropic",
        ServiceKind::OpenAi => "/api/services/openai/v1",
        ServiceKind::Codex => "/api/services/codex/v1",
        ServiceKind::Qwen => "/api/services/qwen/v1",
        ServiceKind::Gemini => "/api/services/gemini",
        ServiceKind::Vertex => "/api/services/vertex/v1",
        ServiceKind::Bedrock => "/api/services/bedrock",
        ServiceKind::GitHub => "/api/services/github/api/v3",
        ServiceKind::Git => "/api/services/github/git",
        ServiceKind::ActivityPub => "/api/services/activitypub",
    }
}

#[must_use]
pub fn management_endpoint(origin: &str, id: RouteId) -> String {
    let template = ROUTES
        .iter()
        .find(|spec| spec.id == id && spec.class == RouteClass::Management)
        .map(|spec| spec.template)
        .expect("management endpoint requested for a non-management route");
    assert!(
        !template.contains('{'),
        "parameterized management endpoints require explicit substitution"
    );
    format!("{}{}", origin.trim_end_matches('/'), template)
}

fn template_matches(template: &str, path: &str) -> bool {
    let mut template_segments = template.trim_matches('/').split('/');
    let mut path_segments = path.trim_matches('/').split('/');

    loop {
        match (template_segments.next(), path_segments.next()) {
            (None, None) => return true,
            (Some(segment), _) if segment.starts_with("{*") && segment.ends_with('}') => {
                return true;
            }
            (Some(segment), Some(path_segment))
                if segment.starts_with('{')
                    && segment.ends_with('}')
                    && !path_segment.is_empty() => {}
            (Some(segment), Some(path_segment)) if segment == path_segment => {}
            _ => return false,
        }
    }
}
