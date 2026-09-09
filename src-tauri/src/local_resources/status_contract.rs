use serde::Serialize;

#[cfg_attr(test, derive(schemars::JsonSchema))]
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalResourceRootState {
    SetupRequired,
    Ready,
    RootUnavailable,
    RepairRequired,
}

#[cfg_attr(test, derive(schemars::JsonSchema))]
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum LocalResourceCapabilityState {
    SetupRequired,
    NotReady,
    Preparing,
    Ready,
    RepairRequired,
    RootUnavailable,
    UpdateAvailable,
}

#[cfg_attr(test, derive(schemars::JsonSchema))]
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalResourceCapabilityStatus {
    pub id: String,
    pub title: String,
    pub state: LocalResourceCapabilityState,
    pub required_resource_ids: Vec<String>,
    pub missing_resource_ids: Vec<String>,
}

#[cfg_attr(test, derive(schemars::JsonSchema))]
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalResourceStatus {
    pub configured: bool,
    pub selected_parent: Option<String>,
    pub resource_root: Option<String>,
    pub root_state: LocalResourceRootState,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub free_space_bytes: Option<u64>,
    pub preferred_profile: String,
    pub capabilities: Vec<LocalResourceCapabilityStatus>,
}
