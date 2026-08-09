use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiProviderId {
    Openai,
    Anthropic,
    Gemini,
    Deepseek,
    Kimi,
    Glm,
    Custom,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiProtocol {
    OpenaiResponses,
    AnthropicMessages,
    GeminiGenerateContent,
    OpenaiChatCompletions,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderCatalogEntry {
    pub id: AiProviderId,
    pub display_name: String,
    pub protocol: AiProtocol,
    pub official_base_url: Option<String>,
    pub models_path: String,
    pub documentation_url: Option<String>,
    pub supports_model_discovery: bool,
    #[serde(default)]
    pub vision_model_prefixes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderCatalog {
    pub schema_version: u32,
    pub providers: Vec<AiProviderCatalogEntry>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialState {
    Missing,
    Stored,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    Untested,
    Ready,
    Error,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiServiceCapabilities {
    pub understanding: bool,
    pub learning: bool,
    pub vision: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiServiceConfig {
    pub id: String,
    pub provider_id: AiProviderId,
    pub display_name: String,
    pub protocol: AiProtocol,
    pub base_url: String,
    pub model_id: Option<String>,
    pub connection_state: ConnectionState,
    pub revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiServiceSummary {
    pub id: String,
    pub provider_id: AiProviderId,
    pub display_name: String,
    pub protocol: AiProtocol,
    pub base_url: String,
    pub model_id: Option<String>,
    pub credential_state: CredentialState,
    pub connection_state: ConnectionState,
    pub capabilities: AiServiceCapabilities,
    pub is_default: bool,
    pub revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiServiceSettings {
    pub schema_version: u32,
    pub revision: u64,
    pub provider_catalog: AiProviderCatalog,
    pub services: Vec<AiServiceSummary>,
    pub default_service_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAiServiceInput {
    pub expected_revision: u64,
    pub id: Option<String>,
    pub provider_id: AiProviderId,
    pub display_name: String,
    pub protocol: AiProtocol,
    pub base_url: Option<String>,
    pub model_id: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAiServiceInput {
    pub expected_revision: u64,
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetDefaultAiServiceInput {
    pub expected_revision: u64,
    pub id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSettingsFile {
    pub schema_version: u32,
    pub revision: u64,
    pub custom_proxy_url: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSettings {
    pub schema_version: u32,
    pub revision: u64,
    pub custom_proxy_url: Option<String>,
    pub effective_mode: String,
    pub effective_source: String,
    pub effective_proxy_address: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetNetworkSettingsInput {
    pub expected_revision: u64,
    pub custom_proxy_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiServiceProbeInput {
    pub service_config_id: Option<String>,
    pub provider_id: AiProviderId,
    pub protocol: AiProtocol,
    pub base_url: Option<String>,
    pub model_id: Option<String>,
    pub api_key: Option<String>,
}

pub(crate) struct ResolvedAiService {
    pub service_config_id: Option<String>,
    pub provider_id: AiProviderId,
    pub protocol: AiProtocol,
    pub base_url: String,
    pub model_id: Option<String>,
    pub api_key: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelInfo {
    pub id: String,
    pub display_name: String,
    pub vision: bool,
    pub capability_source: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelList {
    pub models: Vec<AiModelInfo>,
    pub manual_entry_allowed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiServiceTestResult {
    pub state: ConnectionState,
    pub models: Vec<AiModelInfo>,
    pub selected_model_id: Option<String>,
    pub capabilities: AiServiceCapabilities,
    pub minimal_request_used: bool,
    pub may_incur_usage: bool,
    pub provider_request_id: Option<String>,
}
