//! Deliberately small, provider-neutral model catalogue projection.

use std::collections::HashSet;

use serde_json::{Map, Value, json};

use crate::clients::ClientKind;
use crate::model_routing::ModelRouteError;

pub(super) fn project_catalog(
    catalog: &Value,
    _client: ClientKind,
) -> Result<Value, ModelRouteError> {
    let entries = catalog
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| ModelRouteError::NotFound("model catalog has no data array".into()))?;
    let mut seen = HashSet::new();
    let mut data = Vec::with_capacity(entries.len());
    for entry in entries {
        let Some(raw) = entry.as_object() else {
            continue;
        };
        let Some(id) = raw.get("id").and_then(Value::as_str) else {
            continue;
        };
        if !seen.insert(id.to_string()) {
            return Err(ModelRouteError::Conflict(format!(
                "exact model id collision across healthy providers: {id}"
            )));
        }
        data.push(Value::Object(project_model(raw, id)));
    }
    data.sort_by(|left, right| {
        left.get("id")
            .and_then(Value::as_str)
            .cmp(&right.get("id").and_then(Value::as_str))
    });
    let mut projected = Map::from_iter([
        ("object".into(), Value::String("list".into())),
        ("data".into(), Value::Array(data)),
    ]);
    for field in [
        "model_policy",
        "healthy_providers",
        "starting_providers",
        "degraded_providers",
        "degraded_reasons",
        "catalog_conflicts",
        "using_fallback",
    ] {
        if let Some(value) = catalog.get(field) {
            projected.insert(field.into(), value.clone());
        }
    }
    if let Some(candidates) = catalog
        .get("catalog_conflict_candidates")
        .and_then(Value::as_array)
    {
        let candidates = candidates
            .iter()
            .filter_map(Value::as_object)
            .filter_map(|raw| {
                let id = raw.get("id").and_then(Value::as_str)?;
                Some(Value::Object(project_model(raw, id)))
            })
            .collect::<Vec<_>>();
        projected.insert(
            "catalog_conflict_candidates".into(),
            Value::Array(candidates),
        );
    }
    Ok(Value::Object(projected))
}

fn project_model(raw: &Map<String, Value>, id: &str) -> Map<String, Value> {
    let service = service(raw);
    let owner = raw
        .get("owned_by")
        .and_then(Value::as_str)
        .filter(|owner| !owner.is_empty())
        .unwrap_or(service);
    let mut projected = Map::from_iter([
        ("id".into(), Value::String(id.to_string())),
        ("service".into(), Value::String(service.to_string())),
        ("owned_by".into(), Value::String(owner.to_string())),
    ]);
    for field in ["selector_kind", "variant_of"] {
        if let Some(value) = raw.get(field) {
            projected.insert(field.into(), value.clone());
        }
    }
    super::native_catalog::copy_availability(raw, &mut projected);
    if let Some(fetched) = raw
        .get("router_fetched_at")
        .filter(|value| value.is_number() || value.is_string())
    {
        projected.insert("metadata_fetched_at".into(), fetched.clone());
    }
    if let Some(created) = raw.get("created").filter(|value| value.is_number()) {
        projected.insert("provider_created_at".into(), created.clone());
    }
    let source_kind = capability_source_kind(raw);
    if source_kind != "unknown" {
        project_capability_fields(raw, &mut projected);
    }
    let capability_fields = CAPABILITY_FIELDS
        .into_iter()
        .filter(|field| projected.contains_key(*field))
        .map(str::to_string)
        .collect::<Vec<_>>();
    let source_url = raw.get("router_source_url").cloned().unwrap_or(Value::Null);
    let retrieved_at = raw.get("router_fetched_at").cloned().unwrap_or(Value::Null);
    let scope = json!({
        "provider": raw.get("provider").cloned().unwrap_or_else(|| Value::String(owner.to_string())),
        "account": raw.get("router_account").cloned().unwrap_or(Value::Null),
        "endpoint": raw.get("router_endpoint").cloned().unwrap_or(Value::Null),
        "protocols": raw.get("router_protocols").cloned().unwrap_or(Value::Null),
        "model": id,
    });
    let fields = capability_fields
        .iter()
        .map(|field| {
            let raw_field = capability_raw_field(raw, field);
            (
                field.clone(),
                json!({
                    "field": field,
                    "value": projected.get(field).cloned().unwrap_or(Value::Null),
                    "source_kind": source_kind,
                    "source_url": source_url.clone(),
                    "upstream_raw_field": raw_field,
                    "retrieved_at": retrieved_at.clone(),
                    "router_version": crate::VERSION,
                    "scope": scope.clone(),
                    "effective_restriction": "exact_model_record",
                    "conflict": false,
                    "unknown": source_kind == "unknown",
                }),
            )
        })
        .collect::<Map<_, _>>();
    projected.insert(
        "capability_provenance".into(),
        json!({
            "source_kind": source_kind,
            "source_url": source_url,
            "retrieved_at": retrieved_at,
            "scope": scope,
            "fields": fields,
        }),
    );
    projected
}

const CAPABILITY_FIELDS: [&str; 8] = [
    "context_window",
    "max_output_tokens",
    "modalities",
    "pricing",
    "deprecation_date",
    "default_reasoning_level",
    "supported_reasoning_levels",
    "client_capabilities",
];

fn capability_source_kind(raw: &Map<String, Value>) -> &'static str {
    let nonempty = |field| {
        raw.get(field)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
    };
    let provider_is_known = nonempty("provider") || nonempty("owned_by");
    let protocols_are_exact = raw
        .get("router_protocols")
        .and_then(Value::as_array)
        .is_some_and(|protocols| {
            !protocols.is_empty()
                && protocols.iter().all(|protocol| {
                    protocol
                        .as_str()
                        .is_some_and(|value| !value.trim().is_empty())
                })
        });
    let retrieved_at_is_known = raw.get("router_fetched_at").is_some_and(|value| {
        value.is_number()
            || value
                .as_str()
                .is_some_and(|timestamp| !timestamp.trim().is_empty())
    });
    if provider_is_known
        && nonempty("router_account")
        && nonempty("router_endpoint")
        && protocols_are_exact
        && nonempty("router_source_url")
        && retrieved_at_is_known
    {
        "authenticated_live_catalog"
    } else {
        "unknown"
    }
}

fn project_capability_fields(raw: &Map<String, Value>, projected: &mut Map<String, Value>) {
    copy_first_number(
        raw,
        projected,
        "context_window",
        &[
            "context_window",
            "max_input_tokens",
            "inputTokenLimit",
            "input_token_limit",
            "context_length",
        ],
    );
    copy_first_number(
        raw,
        projected,
        "max_output_tokens",
        &[
            "max_output_tokens",
            "max_tokens",
            "outputTokenLimit",
            "output_token_limit",
        ],
    );
    if let Some(modalities) = normalized_modalities(raw) {
        projected.insert("modalities".into(), modalities);
    }
    if let Some(pricing) = normalized_pricing(raw) {
        projected.insert("pricing".into(), pricing);
    }
    if let Some(value) = ["deprecation_date", "deprecationDate"]
        .into_iter()
        .find_map(|key| raw.get(key))
        .filter(|value| value.is_string() || value.is_null())
    {
        projected.insert("deprecation_date".into(), value.clone());
    }
    if let Some(value) = raw
        .get("default_reasoning_level")
        .filter(|value| value.is_string())
    {
        projected.insert("default_reasoning_level".into(), value.clone());
    }
    if let Some(levels) = normalized_reasoning_levels(raw) {
        projected.insert("supported_reasoning_levels".into(), levels);
    }
    if let Some(capabilities) = raw.get("client_capabilities").and_then(Value::as_object) {
        projected.insert(
            "client_capabilities".into(),
            Value::Object(capabilities.clone()),
        );
    }
}

fn capability_raw_field<'a>(raw: &'a Map<String, Value>, field: &str) -> Option<&'a str> {
    let candidates: &[&str] = match field {
        "context_window" => &[
            "context_window",
            "max_input_tokens",
            "inputTokenLimit",
            "input_token_limit",
            "context_length",
        ],
        "max_output_tokens" => &[
            "max_output_tokens",
            "max_tokens",
            "outputTokenLimit",
            "output_token_limit",
        ],
        "modalities" => &[
            "modalities",
            "input_modalities",
            "supported_input_modalities",
            "output_modalities",
            "supported_output_modalities",
        ],
        "pricing" => &["pricing", "input_per_mtok", "output_per_mtok", "currency"],
        "deprecation_date" => &["deprecation_date", "deprecationDate"],
        "default_reasoning_level" => &["default_reasoning_level"],
        "supported_reasoning_levels" => &["supported_reasoning_levels"],
        "client_capabilities" => &["client_capabilities"],
        _ => &[],
    };
    candidates
        .iter()
        .copied()
        .find(|candidate| raw.contains_key(*candidate))
}

fn normalized_reasoning_levels(raw: &Map<String, Value>) -> Option<Value> {
    let levels = raw.get("supported_reasoning_levels")?.as_array()?;
    let normalized = levels
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|level| {
            let effort = level.get("effort")?.as_str()?;
            let mut value = Map::from_iter([("effort".into(), Value::String(effort.to_string()))]);
            if let Some(description) = level.get("description").and_then(Value::as_str) {
                value.insert("description".into(), Value::String(description.to_string()));
            }
            Some(Value::Object(value))
        })
        .collect::<Vec<_>>();
    (!normalized.is_empty()).then_some(Value::Array(normalized))
}

fn service(raw: &Map<String, Value>) -> &str {
    match raw.get("provider").and_then(Value::as_str) {
        Some("claude") => "anthropic",
        Some("codex") => "codex",
        Some("gemini") => "gemini",
        Some("qwen") => "qwen",
        _ => raw
            .get("owned_by")
            .and_then(Value::as_str)
            .filter(|owner| !owner.is_empty())
            .unwrap_or("openai"),
    }
}

fn copy_first_number(
    raw: &Map<String, Value>,
    target: &mut Map<String, Value>,
    target_key: &str,
    source_keys: &[&str],
) {
    if let Some(value) = source_keys
        .iter()
        .find_map(|key| raw.get(*key))
        .filter(|value| value.is_number())
    {
        target.insert(target_key.to_string(), value.clone());
    }
}

fn normalized_modalities(raw: &Map<String, Value>) -> Option<Value> {
    if let Some(modalities) = raw.get("modalities").and_then(Value::as_object) {
        let mut normalized = Map::new();
        for key in ["input", "output"] {
            if let Some(values) = string_array(modalities.get(key)) {
                normalized.insert(key.into(), values);
            }
        }
        if !normalized.is_empty() {
            return Some(Value::Object(normalized));
        }
    }
    let mut normalized = Map::new();
    for (target, sources) in [
        ("input", ["input_modalities", "supported_input_modalities"]),
        (
            "output",
            ["output_modalities", "supported_output_modalities"],
        ),
    ] {
        if let Some(values) = sources
            .into_iter()
            .find_map(|source| string_array(raw.get(source)))
        {
            normalized.insert(target.into(), values);
        }
    }
    (!normalized.is_empty()).then_some(Value::Object(normalized))
}

fn string_array(value: Option<&Value>) -> Option<Value> {
    let values = value?.as_array()?;
    values
        .iter()
        .all(Value::is_string)
        .then(|| Value::Array(values.clone()))
}

fn normalized_pricing(raw: &Map<String, Value>) -> Option<Value> {
    let source = raw.get("pricing").and_then(Value::as_object).unwrap_or(raw);
    let mut pricing = Map::new();
    for key in ["input_per_mtok", "output_per_mtok", "currency"] {
        if let Some(value) = source
            .get(key)
            .filter(|value| value.is_string() || value.is_number())
        {
            pricing.insert(key.into(), value.clone());
        }
    }
    (!pricing.is_empty()).then_some(Value::Object(pricing))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_ids_and_provider_metadata_are_normalized_without_guessing() {
        let catalog = json!({"data": [
            {
                "id": "claude-live",
                "provider": "claude",
                "router_account": "claude-account",
                "router_endpoint": "https://api.anthropic.com",
                "router_protocols": ["anthropic-messages"],
                "router_source_url": "https://api.anthropic.com/v1/models",
                "router_fetched_at": 2_000_000_000,
                "max_input_tokens": 200_000,
                "max_tokens": 64000,
                "modalities": {"input": ["text", "image"], "output": ["text"]},
                "pricing": {"input_per_mtok": "5", "output_per_mtok": "25", "currency": "USD"},
                "deprecationDate": "2030-01-01"
            },
            {
                "id": "models/gemini-live",
                "name": "models/gemini-live",
                "provider": "gemini",
                "owned_by": "google",
                "created": 1,
                "router_account": "gemini-account",
                "router_endpoint": "https://generativelanguage.googleapis.com",
                "router_protocols": ["gemini-generate-content"],
                "router_source_url": "https://generativelanguage.googleapis.com/v1beta/models",
                "router_fetched_at": 2_000_000_000,
                "inputTokenLimit": 1_000_000,
                "outputTokenLimit": 65536
            },
            {"id": "metadata-absent", "owned_by": "configured-provider"},
            {"id": "z-ai-live", "owned_by": "z.ai", "max_tokens": 4096},
            {"id": "lefine-live", "owned_by": "lefine", "max_tokens": 8192}
        ]});
        let projected = project_catalog(&catalog, ClientKind::ClaudeCode).unwrap();
        let entries = projected["data"].as_array().unwrap();
        let claude = entries
            .iter()
            .find(|entry| entry["id"] == "claude-live")
            .unwrap();
        let gemini = entries
            .iter()
            .find(|entry| entry["id"] == "models/gemini-live")
            .unwrap();
        let absent = entries
            .iter()
            .find(|entry| entry["id"] == "metadata-absent")
            .unwrap();
        assert_eq!(claude["service"], "anthropic");
        assert_eq!(claude["owned_by"], "anthropic");
        assert_eq!(claude["context_window"], 200_000);
        assert_eq!(
            claude["capability_provenance"]["fields"]["pricing"]["upstream_raw_field"],
            "pricing"
        );
        assert_eq!(
            claude["capability_provenance"]["fields"]["deprecation_date"]["upstream_raw_field"],
            "deprecationDate"
        );
        assert!(gemini.get("native_id").is_none());
        assert_eq!(gemini["owned_by"], "google");
        assert_eq!(gemini["max_output_tokens"], 65536);
        assert_eq!(gemini["provider_created_at"], 1);
        assert_eq!(gemini["metadata_fetched_at"], 2_000_000_000_i64);
        assert_ne!(gemini["metadata_fetched_at"], gemini["provider_created_at"]);
        assert!(absent.get("context_window").is_none());
        assert!(absent.get("pricing").is_none());
        assert_eq!(
            absent["capability_provenance"]["scope"]["model"],
            "metadata-absent"
        );
        assert_eq!(absent["capability_provenance"]["source_kind"], "unknown");
        assert_eq!(absent["capability_provenance"]["fields"], json!({}));
        let z_ai = entries
            .iter()
            .find(|entry| entry["id"] == "z-ai-live")
            .unwrap();
        let lefine = entries
            .iter()
            .find(|entry| entry["id"] == "lefine-live")
            .unwrap();
        assert_eq!(z_ai["owned_by"], "z.ai");
        assert_eq!(z_ai["service"], "z.ai");
        assert!(z_ai.get("metadata_source").is_none());
        assert_eq!(lefine["owned_by"], "lefine");
        assert_eq!(lefine["service"], "lefine");
        assert!(lefine.get("metadata_source").is_none());
    }

    #[test]
    fn provider_ownership_never_changes_with_the_requesting_client() {
        let catalog = json!({"data": [
            {"id": "z-ai-live", "owned_by": "z.ai"},
            {"id": "lefine-live", "owned_by": "lefine"}
        ]});
        for client in [
            ClientKind::ClaudeCode,
            ClientKind::Codex,
            ClientKind::GeminiCli,
            ClientKind::QwenCode,
            ClientKind::GrokCli,
            ClientKind::Opencode,
            ClientKind::Cursor,
            ClientKind::Agent,
        ] {
            let projected = project_catalog(&catalog, client).unwrap();
            let entries = projected["data"].as_array().unwrap();
            assert_eq!(entries[0]["service"], "lefine", "{client:?}");
            assert_eq!(entries[1]["service"], "z.ai", "{client:?}");
        }
    }

    #[test]
    fn projections_preserve_only_exact_provider_reasoning_evidence() {
        let catalog = json!({"data": [
            {
                "id": "gpt-live",
                "owned_by": "openai",
                "router_account": "openai-account",
                "router_endpoint": "https://api.openai.com",
                "router_protocols": ["openai-responses"],
                "router_source_url": "https://api.openai.com/v1/models",
                "router_fetched_at": "2030-01-01T00:00:00Z",
                "default_reasoning_level": "high",
                "supported_reasoning_levels": [
                    {"effort": "high", "description": "Deep reasoning"},
                    {"effort": "xhigh", "description": "Extra deep reasoning"}
                ]
            },
            {"id": "glm-live", "owned_by": "z.ai"},
            {
                "id": "glm-newly-discovered",
                "owned_by": "z.ai",
                "router_source_url": "https://api.z.ai/models",
                "default_reasoning_level": "max"
            },
            {
                "id": "glm-provider-described",
                "owned_by": "z.ai",
                "router_account": "zai-account",
                "router_endpoint": "https://api.z.ai",
                "router_protocols": ["openai-responses"],
                "router_source_url": "https://api.z.ai/models",
                "router_fetched_at": "2030-01-01T00:00:00Z",
                "default_reasoning_level": "high",
                "supported_reasoning_levels": [
                    {"effort": "high", "description": "Provider-defined reasoning"}
                ]
            }
        ]});

        let codex = project_catalog(&catalog, ClientKind::Codex).unwrap();
        let entries = codex["data"].as_array().unwrap();
        let ids = entries
            .iter()
            .map(|entry| entry["id"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            ids,
            [
                "glm-live",
                "glm-newly-discovered",
                "glm-provider-described",
                "gpt-live"
            ]
        );
        for id in ["glm-live", "glm-newly-discovered"] {
            let model = entries.iter().find(|entry| entry["id"] == id).unwrap();
            assert!(model.get("default_reasoning_level").is_none());
            assert!(model.get("supported_reasoning_levels").is_none());
            assert!(model.get("reasoning_metadata_source").is_none());
        }
        let described = entries
            .iter()
            .find(|entry| entry["id"] == "glm-provider-described")
            .unwrap();
        assert_eq!(described["default_reasoning_level"], "high");
        assert_eq!(
            described["supported_reasoning_levels"],
            json!([{"effort": "high", "description": "Provider-defined reasoning"}])
        );
        assert!(described.get("reasoning_metadata_source").is_none());
        assert_eq!(
            described["capability_provenance"]["source_kind"],
            "authenticated_live_catalog"
        );
        assert_eq!(
            described["capability_provenance"]["scope"]["model"],
            "glm-provider-described"
        );

        let claude = project_catalog(&catalog, ClientKind::ClaudeCode).unwrap();
        for model in
            claude["data"].as_array().unwrap().iter().filter(|entry| {
                entry["owned_by"] == "z.ai" && entry["id"] != "glm-provider-described"
            })
        {
            assert!(model.get("default_reasoning_level").is_none());
            assert!(model.get("supported_reasoning_levels").is_none());
            assert!(model.get("reasoning_metadata_source").is_none());
        }
        let claude_described = claude["data"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["id"] == "glm-provider-described")
            .unwrap();
        assert_eq!(claude_described["default_reasoning_level"], "high");
        assert!(claude_described.get("reasoning_metadata_source").is_none());
    }

    #[test]
    fn claude_projection_never_synthesizes_owner_wide_capabilities() {
        let catalog = json!({"data": [
            {"id": "glm-5.3-flash", "owned_by": "z.ai"},
            {"id": "future-saffron-2099", "owned_by": "z.ai"},
            {
                "id": "provider-described",
                "owned_by": "z.ai",
                "router_account": "zai-account",
                "router_endpoint": "https://provider.example",
                "router_protocols": ["anthropic-messages"],
                "router_source_url": "https://provider.example/models",
                "router_fetched_at": 42,
                "client_capabilities": {
                    "claude": {"behaves_as": "provider-exact", "source": "provider"}
                }
            },
            {"id": "unprofiled", "owned_by": "another-provider"}
        ]});

        let projected = project_catalog(&catalog, ClientKind::ClaudeCode).unwrap();
        let entries = projected["data"].as_array().unwrap();
        for id in ["glm-5.3-flash", "future-saffron-2099"] {
            let model = entries.iter().find(|model| model["id"] == id).unwrap();
            assert!(model.get("client_capabilities").is_none());
        }
        let described = entries
            .iter()
            .find(|model| model["id"] == "provider-described")
            .unwrap();
        assert_eq!(
            described["client_capabilities"]["claude"]["behaves_as"],
            "provider-exact"
        );
        assert_eq!(
            described["capability_provenance"]["source_url"],
            "https://provider.example/models"
        );
        let unprofiled = entries
            .iter()
            .find(|model| model["id"] == "unprofiled")
            .unwrap();
        assert!(unprofiled.get("client_capabilities").is_none());
    }

    #[test]
    fn capability_fields_with_incomplete_scope_remain_unknown_and_absent() {
        let catalog = json!({"data": [{
            "id": "unscoped-model",
            "owned_by": "provider",
            "router_source_url": "https://provider.example/models",
            "router_fetched_at": "2030-01-01T00:00:00Z",
            "context_window": 1_000_000,
            "max_output_tokens": 65536,
            "modalities": {"input": ["text", "image"], "output": ["text"]},
            "supported_reasoning_levels": [{"effort": "high"}],
            "client_capabilities": {"claude": {"behaves_as": "foreign-model"}}
        }]});

        let projected = project_catalog(&catalog, ClientKind::ClaudeCode).unwrap();
        let model = &projected["data"][0];
        for field in CAPABILITY_FIELDS {
            assert!(model.get(field).is_none(), "unexpected {field}: {model}");
        }
        assert_eq!(model["capability_provenance"]["source_kind"], "unknown");
        assert_eq!(model["capability_provenance"]["fields"], json!({}));
    }

    #[test]
    fn configured_fallback_is_inventory_not_capability_evidence() {
        let catalog = json!({
            "data": [{
                "id": "configured-model",
                "owned_by": "configured-provider",
                "catalog_source": "configured_fallback",
                "context_window": 123_456
            }]
        });

        let projected = project_catalog(&catalog, ClientKind::ClaudeCode).unwrap();
        let model = &projected["data"][0];
        assert_eq!(model["id"], "configured-model");
        assert!(model.get("context_window").is_none());
        assert_eq!(model["capability_provenance"]["source_kind"], "unknown");
        assert_eq!(model["capability_provenance"]["fields"], json!({}));
    }

    #[test]
    fn models_from_one_owner_retain_distinct_exact_capabilities_and_provenance() {
        let catalog = json!({"data": [
            {
                "id": "same-owner-small",
                "owned_by": "z.ai",
                "provider": "z.ai",
                "router_account": "account-a",
                "router_endpoint": "https://api.z.ai",
                "router_protocols": ["openai-responses"],
                "router_source_url": "https://api.z.ai/api/paas/v4/models",
                "router_fetched_at": "2030-01-01T00:00:00Z",
                "context_window": 200_000,
                "max_output_tokens": 8192,
                "modalities": {"input": ["text"], "output": ["text"]},
                "supported_reasoning_levels": [{"effort": "low"}]
            },
            {
                "id": "same-owner-large",
                "owned_by": "z.ai",
                "provider": "z.ai",
                "router_account": "account-a",
                "router_endpoint": "https://api.z.ai",
                "router_protocols": ["openai-responses"],
                "router_source_url": "https://api.z.ai/api/paas/v4/models",
                "router_fetched_at": "2030-01-01T00:00:01Z",
                "context_window": 1_000_000,
                "max_output_tokens": 65536,
                "modalities": {"input": ["text", "image"], "output": ["text"]},
                "supported_reasoning_levels": [{"effort": "high"}]
            }
        ]});

        let projected = project_catalog(&catalog, ClientKind::Codex).unwrap();
        let entries = projected["data"].as_array().unwrap();
        let small = entries
            .iter()
            .find(|entry| entry["id"] == "same-owner-small")
            .unwrap();
        let large = entries
            .iter()
            .find(|entry| entry["id"] == "same-owner-large")
            .unwrap();
        assert_eq!(small["context_window"], 200_000);
        assert_eq!(large["context_window"], 1_000_000);
        assert_ne!(small["modalities"], large["modalities"]);
        assert_ne!(
            small["supported_reasoning_levels"],
            large["supported_reasoning_levels"]
        );
        for (model, id) in [(small, "same-owner-small"), (large, "same-owner-large")] {
            for field in [
                "context_window",
                "max_output_tokens",
                "modalities",
                "supported_reasoning_levels",
            ] {
                assert_eq!(
                    model["capability_provenance"]["fields"][field]["scope"]["model"],
                    id
                );
                assert_eq!(
                    model["capability_provenance"]["fields"][field]["upstream_raw_field"],
                    field
                );
            }
        }
    }

    #[test]
    fn duplicate_exact_ids_fail_instead_of_choosing_an_owner() {
        let catalog = json!({"data": [
            {"id": "same", "provider": "claude"},
            {"id": "same", "provider": "codex"}
        ]});
        assert!(matches!(
            project_catalog(&catalog, ClientKind::ClaudeCode),
            Err(ModelRouteError::Conflict(_))
        ));
    }

    #[test]
    fn exact_gemini_id_survives_discovery_projection_and_code_assist_envelope() {
        let catalogs = crate::model_catalog::ModelCatalogCache::new();
        catalogs.record_success(
            crate::subscription::SubscriptionProvider::Gemini,
            vec!["models/gemini-live-exact".into()],
        );

        let discovered = crate::model_routing::model_catalog(
            &[crate::subscription::SubscriptionProvider::Gemini],
            &catalogs,
        );
        let projected = project_catalog(&discovered, ClientKind::GeminiCli).unwrap();
        let id = projected["data"][0]["id"].as_str().unwrap();
        assert_eq!(id, "models/gemini-live-exact");

        let envelope = crate::gemini::code_assist_envelope(id, &json!({"contents": []}));
        assert_eq!(envelope["model"], "gemini-live-exact");
    }
}
