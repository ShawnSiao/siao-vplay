use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub enum StorageArea {
    AppData,
    RemoteMedia,
    MediaCache,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageLocationKind {
    AppData,
    RemoteMedia,
    MediaCache,
    SubtitleExport,
    VideoReportExport,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageLocationInput {
    pub kind: StorageLocationKind,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearPlaybackCacheInput {
    pub confirmed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearPlaybackCacheResult {
    pub reclaimed_bytes: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub enum StorageMigrationMode {
    Copy,
    Rebuild,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub enum StorageMigrationStatus {
    Prepared,
    Running,
    Interrupted,
    Cancelled,
    Failed,
    Completed,
    RestartRequired,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareStorageMigrationInput {
    pub area: StorageArea,
    pub destination_directory: String,
    #[serde(default = "default_migration_mode")]
    pub mode: StorageMigrationMode,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartStorageMigrationInput {
    pub task_id: String,
    pub confirmed: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageMigrationTaskInput {
    pub task_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct StorageMigrationTask {
    pub id: String,
    pub area: StorageArea,
    pub mode: StorageMigrationMode,
    pub status: StorageMigrationStatus,
    pub source_root: String,
    pub destination_root: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub bytes_to_copy: u64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub copied_bytes: u64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub file_count: usize,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub verified_file_count: usize,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub free_space_bytes: Option<u64>,
    pub previous_root_retained: bool,
    pub restart_required: bool,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub created_at_ms: i64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub updated_at_ms: i64,
}

fn default_migration_mode() -> StorageMigrationMode {
    StorageMigrationMode::Copy
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct SaveStorageSettingsInput {
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740990_u64)))]
    pub expected_revision: u64,
    pub remote_media_root: Option<String>,
    pub media_cache_root: Option<String>,
    pub default_subtitle_export_directory: Option<String>,
    pub default_video_report_export_directory: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct StorageSettingsView {
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub revision: u64,
    pub app_data_root: String,
    pub app_data_root_locked_by_environment: bool,
    pub remote_media_root: String,
    pub remote_media_uses_default: bool,
    pub media_cache_root: String,
    pub media_cache_uses_default: bool,
    pub default_subtitle_export_directory: Option<String>,
    pub default_video_report_export_directory: Option<String>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub app_data_used_bytes: u64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub app_data_free_space_bytes: Option<u64>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub remote_media_used_bytes: u64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub media_cache_used_bytes: u64,
    pub app_data_available: bool,
    pub remote_media_available: bool,
    pub media_cache_available: bool,
    pub pending_app_data_root: Option<String>,
}


#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorageSettingsFile {
    #[serde(default = "settings_version")]
    pub version: u32,
    #[serde(default = "initial_revision")]
    pub revision: u64,
    #[serde(default)]
    pub active_app_data_root: Option<String>,
    #[serde(default)]
    pub pending_app_data_root: Option<String>,
    #[serde(default)]
    pub remote_media_root: Option<String>,
    #[serde(default)]
    pub media_cache_root: Option<String>,
    #[serde(default)]
    pub default_subtitle_export_directory: Option<String>,
    #[serde(default)]
    pub default_video_report_export_directory: Option<String>,
}

impl Default for StorageSettingsFile {
    fn default() -> Self {
        Self {
            version: settings_version(),
            revision: initial_revision(),
            active_app_data_root: None,
            pending_app_data_root: None,
            remote_media_root: None,
            media_cache_root: None,
            default_subtitle_export_directory: None,
            default_video_report_export_directory: None,
        }
    }
}

pub(crate) const fn settings_version() -> u32 {
    1
}

const fn initial_revision() -> u64 {
    1
}
