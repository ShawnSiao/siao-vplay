use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub enum AiProviderId {
    Openai,
    Anthropic,
    Gemini,
    Deepseek,
    Kimi,
    Glm,
    Custom,
}

impl AiProviderId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Anthropic => "anthropic",
            Self::Gemini => "gemini",
            Self::Deepseek => "deepseek",
            Self::Kimi => "kimi",
            Self::Glm => "glm",
            Self::Custom => "custom",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub enum AiProtocol {
    OpenaiResponses,
    AnthropicMessages,
    GeminiGenerateContent,
    OpenaiChatCompletions,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
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
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct AiProviderCatalog {
    #[cfg_attr(test, schemars(range(min = 0, max = 4294967295_u64)))]
    pub schema_version: u32,
    pub providers: Vec<AiProviderCatalogEntry>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub enum CredentialState {
    Missing,
    Stored,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub enum ConnectionState {
    Untested,
    Ready,
    Error,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
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
#[cfg_attr(test, derive(schemars::JsonSchema))]
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
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct AiServiceSettings {
    #[cfg_attr(test, schemars(range(min = 0, max = 4294967295_u64)))]
    pub schema_version: u32,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
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
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct NetworkSettings {
    #[cfg_attr(test, schemars(range(min = 0, max = 4294967295_u64)))]
    pub schema_version: u32,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
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
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct AiModelInfo {
    pub id: String,
    pub display_name: String,
    pub vision: bool,
    pub capability_source: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct AiModelList {
    pub models: Vec<AiModelInfo>,
    pub manual_entry_allowed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct AiServiceTestResult {
    pub state: ConnectionState,
    pub models: Vec<AiModelInfo>,
    pub selected_model_id: Option<String>,
    pub capabilities: AiServiceCapabilities,
    pub minimal_request_used: bool,
    pub may_incur_usage: bool,
    pub provider_request_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AiExecutionTarget {
    Manual,
    Codex,
    Api {
        service_config_id: String,
        model_id: String,
    },
}

impl AiExecutionTarget {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Codex => "codex",
            Self::Api { .. } => "api",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMaterialAuthorization {
    pub subtitles: bool,
    pub current_question: bool,
    pub frames: bool,
    pub service_revision: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskExecutionInfo {
    pub kind: String,
    pub service_config_id: Option<String>,
    pub service_revision: Option<u64>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub provider_request_id: Option<String>,
    pub usage: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAiExecutionInput {
    pub execution: AiExecutionTarget,
    pub authorization: AiMaterialAuthorization,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub enum AiExecutionKind { Manual, Codex, Api }

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct AiExecutionPreview {
    pub execution_kind: AiExecutionKind,
    pub service_config_id: Option<String>,
    pub provider_id: Option<AiProviderId>,
    pub display_name: String,
    pub model_id: Option<String>,
    pub subtitles: bool,
    pub current_question: bool,
    pub frames_requested: bool,
    pub frames_effective: bool,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub service_revision: Option<u64>,
}
