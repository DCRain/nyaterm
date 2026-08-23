use std::collections::BTreeMap;
use std::time::Duration;

use genai::adapter::AdapterKind;
use genai::chat::{ChatOptions, ReasoningEffort};
use genai::resolver::{AuthData, Endpoint, ServiceTargetResolver};
use genai::{Client, ModelIden, WebConfig};
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
use serde_json::Value;

use crate::config::{
    self, AI_REQUEST_USER_AGENT_DEFAULT, AiApiFormat, AiBackendKind, AiModelConfigItem,
    AiModelSource, AiProviderCredential, AiProviderKind, AiReasoningEffort, AiSettings,
    ai_model_id_for_credential,
};
use crate::error::{AppError, AppResult};
use crate::utils::url::{join_api_base_url, normalize_api_base_url};

use super::types::{AiChatRequest, AiModelDiscovery};

#[derive(Debug, Clone)]
pub(super) struct ResolvedAiModel {
    pub model_name: String,
    pub provider_kind: AiProviderKind,
    pub api_format: AiApiFormat,
    pub credential: Option<AiProviderCredential>,
}

pub(super) fn resolve_request_model_config(
    settings: &AiSettings,
    request: &AiChatRequest,
) -> AppResult<AiModelConfigItem> {
    request
        .model_id
        .as_deref()
        .and_then(|id| {
            settings
                .models
                .iter()
                .find(|model| model.enabled && model.id == id)
        })
        .or_else(|| {
            settings.default_model_id.as_deref().and_then(|id| {
                settings
                    .models
                    .iter()
                    .find(|model| model.enabled && model.id == id)
            })
        })
        .or_else(|| settings.models.iter().find(|model| model.enabled))
        .cloned()
        .ok_or_else(|| AppError::Config("No enabled AI model configured".to_string()))
}

pub(super) fn build_chat_options(settings: &AiSettings) -> ChatOptions {
    let mut options = ChatOptions::default()
        .with_capture_reasoning_content(true)
        .with_normalize_reasoning_content(true);

    if let Some(reasoning_effort) = genai_reasoning_effort(&settings.default_reasoning_effort) {
        options = options.with_reasoning_effort(reasoning_effort);
    }

    options
}

fn genai_reasoning_effort(value: &AiReasoningEffort) -> Option<ReasoningEffort> {
    match value {
        AiReasoningEffort::Auto => None,
        AiReasoningEffort::None => Some(ReasoningEffort::None),
        AiReasoningEffort::Low => Some(ReasoningEffort::Low),
        AiReasoningEffort::Medium => Some(ReasoningEffort::Medium),
        AiReasoningEffort::High => Some(ReasoningEffort::High),
        AiReasoningEffort::XHigh => Some(ReasoningEffort::XHigh),
    }
}

pub(super) fn resolve_request_model(
    settings: &AiSettings,
    request: &AiChatRequest,
) -> AppResult<ResolvedAiModel> {
    tracing::debug!(
        requested_model_id = ?request.model_id,
        default_model_id = ?settings.default_model_id,
        enabled_model_count = settings.models.iter().filter(|model| model.enabled).count(),
        "Resolving AI model for request"
    );

    let selected_model = resolve_request_model_config(settings, request)?;

    if selected_model.backend == AiBackendKind::Codex {
        return Err(AppError::Config(
            "Codex models must be routed through codex app-server".to_string(),
        ));
    }

    let model_provider_kind = selected_model
        .provider_kind
        .clone()
        .or_else(|| infer_provider_kind_from_model_id(&selected_model.id));

    let credential =
        resolve_model_credential(settings, &selected_model, model_provider_kind.as_ref())?;
    let provider_kind = credential
        .as_ref()
        .map(|credential| credential.provider_kind.clone())
        .or(model_provider_kind)
        .ok_or_else(|| {
            AppError::Config(format!(
                "AI model '{}' is missing provider information",
                selected_model.name
            ))
        })?;
    validate_model_credential(&provider_kind, credential.as_ref())?;

    tracing::info!(
        requested_model_id = ?request.model_id,
        resolved_model_id = %selected_model.id,
        resolved_model_name = %selected_model.name,
        provider_kind = ?provider_kind,
        credential_id = ?credential.as_ref().map(|item| item.id.as_str()),
        "Resolved AI model"
    );

    Ok(ResolvedAiModel {
        model_name: selected_model.name.clone(),
        provider_kind,
        api_format: credential
            .as_ref()
            .map(|credential| credential.api_format.clone())
            .unwrap_or_default(),
        credential,
    })
}

fn infer_provider_kind_from_model_id(model_id: &str) -> Option<AiProviderKind> {
    let (prefix, _) = model_id.split_once(':')?;
    match prefix {
        "openai" => Some(AiProviderKind::Openai),
        "anthropic" => Some(AiProviderKind::Anthropic),
        "gemini" => Some(AiProviderKind::Gemini),
        "deepseek" => Some(AiProviderKind::Deepseek),
        "groq" => Some(AiProviderKind::Groq),
        "ollama" => Some(AiProviderKind::Ollama),
        "xai" => Some(AiProviderKind::Xai),
        "cohere" => Some(AiProviderKind::Cohere),
        "mimo" => Some(AiProviderKind::Mimo),
        "zai" => Some(AiProviderKind::Zai),
        "openai_compatible" => Some(AiProviderKind::OpenaiCompatible),
        _ => None,
    }
}

fn resolve_model_credential(
    settings: &AiSettings,
    model: &AiModelConfigItem,
    provider_kind: Option<&AiProviderKind>,
) -> AppResult<Option<AiProviderCredential>> {
    if let Some(credential_id) = model.credential_id.as_deref() {
        let credential = settings
            .provider_credentials
            .iter()
            .find(|item| item.id == credential_id && item.enabled)
            .cloned()
            .ok_or_else(|| {
                AppError::Config(format!(
                    "No enabled AI credential found for model '{}'",
                    model.name
                ))
            })?;
        return Ok(Some(credential));
    }

    Ok(provider_kind.and_then(|provider_kind| {
        settings
            .provider_credentials
            .iter()
            .find(|item| item.enabled && &item.provider_kind == provider_kind)
            .cloned()
    }))
}

fn validate_model_credential(
    provider_kind: &AiProviderKind,
    credential: Option<&AiProviderCredential>,
) -> AppResult<()> {
    match provider_kind {
        AiProviderKind::Ollama => Ok(()),
        AiProviderKind::OpenaiCompatible => {
            if credential.is_none() {
                return Err(AppError::Config(
                    "No enabled OpenAI-compatible AI credential configured".to_string(),
                ));
            }
            Ok(())
        }
        _ => {
            let credential = credential.ok_or_else(|| {
                AppError::Config(format!(
                    "No enabled AI credential configured for {:?}",
                    provider_kind
                ))
            })?;
            if credential
                .api_key
                .as_deref()
                .is_none_or(|value| value.trim().is_empty())
            {
                return Err(AppError::Config(format!(
                    "No API key configured for AI credential '{}'",
                    credential.name
                )));
            }
            Ok(())
        }
    }
}

pub(super) fn build_client(model: &ResolvedAiModel, settings: &AiSettings) -> AppResult<Client> {
    tracing::debug!(
        model_name = %model.model_name,
        provider_kind = ?model.provider_kind,
        has_credential = model.credential.is_some(),
        has_base_url = model
            .credential
            .as_ref()
            .and_then(|credential| credential.base_url.as_deref())
            .is_some_and(|value| !value.trim().is_empty()),
        "Building AI client"
    );

    let adapter_kind = adapter_kind(&model.provider_kind);
    let mapped_model = genai_model_name(&model.provider_kind, &model.model_name);
    let api_key = model
        .credential
        .as_ref()
        .and_then(|credential| credential.api_key.clone())
        .filter(|value| !value.trim().is_empty());
    let base_url = model
        .credential
        .as_ref()
        .and_then(|credential| credential.base_url.as_deref())
        .map(normalize_api_base_url)
        .transpose()?
        .filter(|value| !value.trim().is_empty());
    let allows_empty_auth = model.provider_kind == AiProviderKind::OpenaiCompatible;

    let resolver =
        ServiceTargetResolver::from_resolver_fn(move |service_target: genai::ServiceTarget| {
            Ok(apply_service_target_overrides(
                service_target,
                api_key.clone(),
                base_url.clone(),
                allows_empty_auth,
            ))
        });

    let web_config = WebConfig::default().with_default_headers(ai_request_headers(settings)?);

    Ok(Client::builder()
        .with_model_mapper_fn(move |_model| Ok(ModelIden::new(adapter_kind, mapped_model.clone())))
        .with_service_target_resolver(resolver)
        .with_web_config(web_config)
        .build())
}

fn apply_service_target_overrides(
    mut service_target: genai::ServiceTarget,
    api_key: Option<String>,
    base_url: Option<String>,
    allows_empty_auth: bool,
) -> genai::ServiceTarget {
    if let Some(api_key) = api_key {
        service_target.auth = AuthData::from_single(api_key);
    } else if allows_empty_auth {
        service_target.auth = AuthData::None;
    }
    if let Some(base_url) = base_url {
        service_target.endpoint = Endpoint::from_owned(base_url);
    }
    service_target
}

fn effective_request_user_agent(settings: &AiSettings) -> &str {
    let value = settings.request_user_agent.trim();
    if value.is_empty() {
        AI_REQUEST_USER_AGENT_DEFAULT
    } else {
        value
    }
}

pub(super) fn ai_request_headers(settings: &AiSettings) -> AppResult<HeaderMap> {
    let user_agent = effective_request_user_agent(settings);
    let user_agent_value = HeaderValue::from_str(user_agent).map_err(|error| {
        AppError::Config(format!("Invalid AI User-Agent header value: {error}"))
    })?;
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, user_agent_value);
    Ok(headers)
}

fn adapter_kind(kind: &AiProviderKind) -> AdapterKind {
    match kind {
        AiProviderKind::Openai | AiProviderKind::OpenaiCompatible => AdapterKind::OpenAI,
        AiProviderKind::Anthropic => AdapterKind::Anthropic,
        AiProviderKind::Gemini => AdapterKind::Gemini,
        AiProviderKind::Deepseek => AdapterKind::DeepSeek,
        AiProviderKind::Groq => AdapterKind::Groq,
        AiProviderKind::Ollama => AdapterKind::Ollama,
        AiProviderKind::Xai
        | AiProviderKind::Cohere
        | AiProviderKind::Mimo
        | AiProviderKind::Zai => AdapterKind::OpenAI,
    }
}

fn genai_model_name(provider_kind: &AiProviderKind, model_name: &str) -> String {
    if matches!(provider_kind, AiProviderKind::Deepseek)
        && let Some(base_model_name) = model_name.strip_suffix("-none")
    {
        return base_model_name.to_string();
    }

    model_name.to_string()
}

pub async fn list_model_names(app: &tauri::AppHandle) -> AppResult<Vec<AiModelDiscovery>> {
    let settings = config::load_app_settings(app)?;
    list_model_names_for_settings(&settings.ai).await
}

pub async fn list_model_names_for_settings(
    settings: &AiSettings,
) -> AppResult<Vec<AiModelDiscovery>> {
    let custom_credentials = openai_compatible_model_discovery_credentials(settings);

    let mut models = BTreeMap::new();
    let mut errors = Vec::new();

    for credential in &custom_credentials {
        let base_url = credential
            .base_url
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_string();
        if base_url.is_empty() {
            continue;
        }
        let api_key = credential.api_key.clone().filter(|v| !v.trim().is_empty());
        let label = credential.name.as_str();
        tracing::info!(
            credential = label,
            url = base_url,
            "Fetching model list from custom provider"
        );
        match fetch_openai_compatible_models(&base_url, api_key.as_deref(), settings).await {
            Ok(names) => {
                tracing::info!(
                    credential = label,
                    count = names.len(),
                    models = ?names,
                    "Fetched models from custom provider"
                );
                for name in names {
                    let trimmed = name.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let id = ai_model_id_for_credential(&credential.id, trimmed);
                    models.entry(id.clone()).or_insert(AiModelDiscovery {
                        id,
                        name: trimmed.to_string(),
                        backend: AiBackendKind::Genai,
                        provider_kind: Some(AiProviderKind::OpenaiCompatible),
                        credential_id: Some(credential.id.clone()),
                        source: AiModelSource::RustGenai,
                    });
                }
            }
            Err(error) => {
                tracing::warn!(credential = label, %error, "Failed to fetch models from custom provider");
                errors.push(format!("{label}: {error}"));
            }
        }
    }

    if models.is_empty() && !errors.is_empty() {
        return Err(AppError::Config(format!(
            "Failed to list AI models: {}",
            errors.join("; ")
        )));
    }

    Ok(models.into_values().collect())
}

fn openai_compatible_model_discovery_credentials(
    settings: &AiSettings,
) -> Vec<&AiProviderCredential> {
    settings
        .provider_credentials
        .iter()
        .filter(|credential| {
            credential.enabled
                && credential.provider_kind == AiProviderKind::OpenaiCompatible
                && !is_builtin_ai_provider_credential_id(&credential.id)
        })
        .collect()
}

fn is_builtin_ai_provider_credential_id(id: &str) -> bool {
    matches!(
        id,
        "openai"
            | "anthropic"
            | "gemini"
            | "deepseek"
            | "groq"
            | "ollama"
            | "xai"
            | "cohere"
            | "mimo"
            | "zai"
    )
}

/// Fetches model names from an OpenAI-compatible `/v1/models` endpoint directly via HTTP,
/// bypassing `genai::Client::all_model_names` which does not apply the `ServiceTargetResolver`
/// (and therefore ignores custom auth/endpoint configuration).
async fn fetch_openai_compatible_models(
    base_url: &str,
    api_key: Option<&str>,
    settings: &AiSettings,
) -> AppResult<Vec<String>> {
    let url = openai_compatible_models_url(base_url)?;
    let client = reqwest::Client::builder()
        .default_headers(ai_request_headers(settings)?)
        .build()
        .map_err(|e| AppError::Config(format!("Failed to build AI HTTP client: {e}")))?;
    let mut req = client.get(&url);
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }
    let resp = req
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| AppError::Config(format!("Failed to fetch models from {url}: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Config(format!(
            "Failed to fetch models from {url}: {status} {body}"
        )));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Config(format!("Invalid JSON from {url}: {e}")))?;
    let names: Vec<String> = body["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item["id"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    Ok(names)
}

fn openai_compatible_models_url(base_url: &str) -> AppResult<String> {
    join_api_base_url(base_url, "models")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ai::types::{AiAction, AiContext, AiRequestOptions};
    use genai::resolver::{AuthData, Endpoint};

    fn test_service_target(auth: AuthData) -> genai::ServiceTarget {
        genai::ServiceTarget {
            endpoint: Endpoint::from_static("https://default.example/v1/"),
            auth,
            model: ModelIden::new(AdapterKind::OpenAI, "test-model"),
        }
    }

    fn test_credential(kind: AiProviderKind, api_key: Option<&str>) -> AiProviderCredential {
        test_credential_with_id("credential-test", kind, api_key)
    }

    fn test_credential_with_id(
        id: &str,
        kind: AiProviderKind,
        api_key: Option<&str>,
    ) -> AiProviderCredential {
        AiProviderCredential {
            id: id.to_string(),
            name: "Test Provider".to_string(),
            provider_kind: kind,
            api_format: AiApiFormat::default(),
            base_url: Some("https://api.example.com/v1/".to_string()),
            api_key: api_key.map(str::to_string),
            enabled: true,
        }
    }

    fn test_request(model_id: &str) -> AiChatRequest {
        AiChatRequest {
            stream_id: None,
            session_id: None,
            connection_id: None,
            terminal_session_id: None,
            owner_scope: Default::default(),
            targets: vec![],
            target_contexts: vec![],
            mode: crate::config::AiMode::Ask,
            agent_kind: crate::config::AiAgentKind::Nyaterm,
            permission_mode: crate::config::AiPermissionMode::Confirm,
            model_id: Some(model_id.to_string()),
            model_name: None,
            default_target_session_id: None,
            existing_external_session_id: None,
            attachments: vec![],
            action: AiAction::GenerateCommand,
            user_input: "test".to_string(),
            context: AiContext::default(),
            options: AiRequestOptions::default(),
        }
    }

    #[test]
    fn openai_compatible_models_url_accepts_missing_trailing_slash() {
        assert_eq!(
            openai_compatible_models_url("https://api.example.com/v1").unwrap(),
            "https://api.example.com/v1/models"
        );
    }

    #[test]
    fn openai_compatible_models_url_accepts_trailing_slash() {
        assert_eq!(
            openai_compatible_models_url("https://api.example.com/v1/").unwrap(),
            "https://api.example.com/v1/models"
        );
    }

    #[test]
    fn openai_compatible_models_url_preserves_query() {
        assert_eq!(
            openai_compatible_models_url("https://api.example.com/v1?api-version=1").unwrap(),
            "https://api.example.com/v1/models?api-version=1"
        );
    }

    #[test]
    fn ai_request_headers_use_custom_user_agent() {
        let mut settings = AiSettings::default();
        settings.request_user_agent = "nyaterm-test/1.0".to_string();

        let headers = ai_request_headers(&settings).unwrap();

        assert_eq!(
            headers
                .get(USER_AGENT)
                .and_then(|value| value.to_str().ok()),
            Some("nyaterm-test/1.0")
        );
    }

    #[test]
    fn ai_request_headers_fall_back_for_blank_user_agent() {
        let mut settings = AiSettings::default();
        settings.request_user_agent = "   ".to_string();

        let headers = ai_request_headers(&settings).unwrap();

        assert_eq!(
            headers
                .get(USER_AGENT)
                .and_then(|value| value.to_str().ok()),
            Some(AI_REQUEST_USER_AGENT_DEFAULT)
        );
    }

    #[test]
    fn ai_request_headers_reject_invalid_user_agent() {
        let mut settings = AiSettings::default();
        settings.request_user_agent = "bad\r\nvalue".to_string();

        let error = ai_request_headers(&settings).unwrap_err();

        assert!(
            error
                .to_string()
                .contains("Invalid AI User-Agent header value")
        );
    }

    #[test]
    fn openai_compatible_empty_key_uses_no_auth_override() {
        let target = apply_service_target_overrides(
            test_service_target(AuthData::from_env("OPENAI_API_KEY")),
            None,
            Some("https://api.example.com/v1/".to_string()),
            true,
        );

        assert!(matches!(target.auth, AuthData::None));
    }

    #[test]
    fn openai_compatible_non_empty_key_uses_configured_key() {
        let target = apply_service_target_overrides(
            test_service_target(AuthData::from_env("OPENAI_API_KEY")),
            Some("configured-key".to_string()),
            Some("https://api.example.com/v1/".to_string()),
            true,
        );

        assert!(matches!(target.auth, AuthData::Key(ref value) if value == "configured-key"));
    }

    #[test]
    fn custom_base_url_overrides_default_endpoint() {
        let target = apply_service_target_overrides(
            test_service_target(AuthData::from_env("ANTHROPIC_API_KEY")),
            Some("configured-key".to_string()),
            Some("https://anthropic-proxy.example.com/".to_string()),
            false,
        );

        assert!(format!("{:?}", target.endpoint).contains("https://anthropic-proxy.example.com/"));
    }

    #[test]
    fn custom_anthropic_and_gemini_use_native_adapters() {
        assert_eq!(
            adapter_kind(&AiProviderKind::Anthropic),
            AdapterKind::Anthropic
        );
        assert_eq!(adapter_kind(&AiProviderKind::Gemini), AdapterKind::Gemini);
    }

    #[test]
    fn ollama_uses_native_adapter_and_preserves_model_tag() {
        assert_eq!(adapter_kind(&AiProviderKind::Ollama), AdapterKind::Ollama);
        assert_eq!(
            genai_model_name(&AiProviderKind::Ollama, "qwen2.5:7b-instruct"),
            "qwen2.5:7b-instruct"
        );
    }

    #[test]
    fn anthropic_and_gemini_empty_keys_fail_validation() {
        for kind in [AiProviderKind::Anthropic, AiProviderKind::Gemini] {
            let credential = test_credential(kind.clone(), None);
            let error = validate_model_credential(&kind, Some(&credential)).unwrap_err();

            assert!(
                error
                    .to_string()
                    .contains("No API key configured for AI credential")
            );
        }
    }

    #[test]
    fn openai_compatible_empty_key_still_passes_validation() {
        let credential = test_credential(AiProviderKind::OpenaiCompatible, None);

        validate_model_credential(&AiProviderKind::OpenaiCompatible, Some(&credential)).unwrap();
    }

    #[test]
    fn openai_empty_key_still_fails_validation() {
        let credential = test_credential(AiProviderKind::Openai, None);
        let error =
            validate_model_credential(&AiProviderKind::Openai, Some(&credential)).unwrap_err();

        assert!(
            error
                .to_string()
                .contains("No API key configured for AI credential")
        );
    }

    #[test]
    fn model_discovery_credentials_only_include_custom_openai_compatible() {
        let mut settings = AiSettings::default();
        settings.provider_credentials = vec![
            test_credential_with_id("openai", AiProviderKind::OpenaiCompatible, None),
            test_credential_with_id("credential-openai", AiProviderKind::OpenaiCompatible, None),
            test_credential_with_id(
                "credential-anthropic",
                AiProviderKind::Anthropic,
                Some("key"),
            ),
            test_credential_with_id("credential-gemini", AiProviderKind::Gemini, Some("key")),
            AiProviderCredential {
                enabled: false,
                ..test_credential_with_id(
                    "credential-disabled",
                    AiProviderKind::OpenaiCompatible,
                    None,
                )
            },
        ];

        let ids: Vec<_> = openai_compatible_model_discovery_credentials(&settings)
            .into_iter()
            .map(|credential| credential.id.as_str())
            .collect();

        assert_eq!(ids, vec!["credential-openai"]);
    }

    #[test]
    fn model_resolution_prefers_explicit_credential_id_for_same_protocol_credentials() {
        let mut settings = AiSettings::default();
        settings.provider_credentials = vec![
            test_credential_with_id("credential-a", AiProviderKind::Anthropic, Some("key-a")),
            test_credential_with_id("credential-b", AiProviderKind::Anthropic, Some("key-b")),
        ];
        settings.models = vec![AiModelConfigItem {
            id: "credential-b:claude-test".to_string(),
            name: "claude-test".to_string(),
            backend: AiBackendKind::Genai,
            provider_kind: Some(AiProviderKind::Anthropic),
            credential_id: Some("credential-b".to_string()),
            enabled: true,
            source: AiModelSource::Manual,
            last_seen_at: None,
        }];
        settings.default_model_id = Some("credential-b:claude-test".to_string());

        let resolved =
            resolve_request_model(&settings, &test_request("credential-b:claude-test")).unwrap();

        let credential = resolved.credential.expect("credential should resolve");
        assert_eq!(credential.id, "credential-b");
        assert_eq!(credential.api_key.as_deref(), Some("key-b"));
        assert_eq!(resolved.provider_kind, AiProviderKind::Anthropic);
    }

    #[test]
    fn default_reasoning_effort_auto_is_not_sent_to_genai() {
        let settings = AiSettings::default();
        let options = build_chat_options(&settings);

        assert!(options.reasoning_effort.is_none());
    }

    #[test]
    fn explicit_reasoning_effort_maps_to_genai_options() {
        let cases = [
            (AiReasoningEffort::None, "none"),
            (AiReasoningEffort::Low, "low"),
            (AiReasoningEffort::Medium, "medium"),
            (AiReasoningEffort::High, "high"),
            (AiReasoningEffort::XHigh, "xhigh"),
        ];

        for (effort, expected) in cases {
            let mut settings = AiSettings::default();
            settings.default_reasoning_effort = effort;

            let options = build_chat_options(&settings);

            assert_eq!(
                options
                    .reasoning_effort
                    .as_ref()
                    .map(ReasoningEffort::variant_name),
                Some(expected)
            );
        }
    }

    #[test]
    fn deepseek_none_reasoning_suffix_is_not_passed_to_genai() {
        assert_eq!(
            genai_model_name(&AiProviderKind::Deepseek, "deepseek-v4-flash-none"),
            "deepseek-v4-flash"
        );
        assert_eq!(
            genai_model_name(&AiProviderKind::Deepseek, "deepseek-v4-pro-none"),
            "deepseek-v4-pro"
        );
    }

    #[test]
    fn deepseek_supported_reasoning_suffix_stays_available_for_genai() {
        assert_eq!(
            genai_model_name(&AiProviderKind::Deepseek, "deepseek-v4-flash-max"),
            "deepseek-v4-flash-max"
        );
    }

    #[test]
    fn non_deepseek_none_suffix_is_preserved() {
        assert_eq!(
            genai_model_name(&AiProviderKind::Openai, "gpt-test-none"),
            "gpt-test-none"
        );
    }
}
