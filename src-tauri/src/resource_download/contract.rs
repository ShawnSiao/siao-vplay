use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub enum ResourceDownloadTaskState {
    Queued,
    Downloading,
    Paused,
    Verifying,
    Installing,
    Completed,
    Failed,
    Cancelled,
}

impl ResourceDownloadTaskState {
    pub(super) fn is_worker_active(self) -> bool {
        matches!(
            self,
            Self::Queued | Self::Downloading | Self::Verifying | Self::Installing
        )
    }

    pub(super) fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ResourceDownloadTask {
    /// Process-local root binding and mutation order, reissued when the store loads.
    #[serde(default)]
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub generation: u64,
    #[serde(default)]
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub revision: u64,
    pub id: String,
    pub resource_id: String,
    pub version: String,
    pub state: ResourceDownloadTaskState,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub downloaded_bytes: u64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub total_bytes: u64,
    pub requested_by_capability_ids: Vec<String>,
    #[serde(default)]
    pub pending_action_ids: Vec<String>,
    #[cfg_attr(test, schemars(range(min = 0, max = 4294967295_u64)))]
    pub attempt: u32,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub created_at_ms: i64,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub updated_at_ms: i64,
    #[serde(default)]
    pub(super) force_reinstall: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct CapabilityPreparation {
    pub capability_id: String,
    pub pending_action_id: Option<String>,
    #[cfg_attr(test, schemars(with = "PreparationState"))]
    pub state: String,
    pub resource_ids: Vec<String>,
    pub ready_resource_ids: Vec<String>,
    pub task_ids: Vec<String>,
}

#[cfg(test)]
#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Schema vocabulary for preparation state")]
enum PreparationState { Ready, Preparing }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ResourceDownloadSnapshot {
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub generation: u64,
    pub tasks: Vec<ResourceDownloadTask>,
}

#[cfg_attr(test, derive(schemars::JsonSchema))]
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceNetworkStatus {
    #[cfg_attr(test, schemars(with = "NetworkMode"))]
    pub mode: String,
    #[cfg_attr(test, schemars(with = "ProxySource"))]
    pub proxy_source: String,
    pub proxy_address: Option<String>,
}

#[cfg(test)]
#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Serialized network mode vocabulary")]
enum NetworkMode { Direct, Proxy }
#[cfg(test)]
#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Serialized network source vocabulary")]
enum ProxySource { Custom, Environment, WindowsSystem, Direct }
