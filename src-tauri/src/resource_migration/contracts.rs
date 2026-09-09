use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ResourceMigrationSource {
    pub kind: String,
    pub path: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ResourceMigrationCandidate {
    pub source_kind: String,
    pub source_root: String,
    pub resource_id: String,
    pub resource_path: String,
    pub state: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub reusable_bytes: u64,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ResourceMigrationPreview {
    pub sources: Vec<ResourceMigrationSource>,
    pub candidates: Vec<ResourceMigrationCandidate>,
    pub verified_resource_ids: Vec<String>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub reusable_bytes: u64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub rejected_count: usize,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ResourceAdoptionResult {
    pub adopted_resource_ids: Vec<String>,
    pub already_active_resource_ids: Vec<String>,
    pub rejected_resource_ids: Vec<String>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub reusable_bytes: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct LocalResourceMovePlan {
    #[cfg_attr(test, schemars(regex(pattern = "^[a-f0-9]{64}$")))]
    pub plan_fingerprint: String,
    pub previous_root: String,
    pub selected_parent: String,
    pub resource_root: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub bytes_to_copy: u64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub file_count: usize,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub free_space_bytes: Option<u64>,
    pub cross_volume: bool,
    pub destination_exists: bool,
    pub confirmation_required: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct LocalResourceMoveResult {
    #[cfg_attr(test, schemars(regex(pattern = "^[a-f0-9]{64}$")))]
    pub plan_fingerprint: String,
    pub request_id: String,
    pub previous_root: String,
    pub current_root: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub copied_bytes: u64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub verified_file_count: usize,
    pub cross_volume: bool,
    pub previous_root_retained: bool,
}
