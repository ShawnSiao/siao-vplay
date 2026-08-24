use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveStorageSettingsInput {
    pub expected_revision: u64,
    pub remote_media_root: Option<String>,
    pub media_cache_root: Option<String>,
    pub default_subtitle_export_directory: Option<String>,
    pub default_video_report_export_directory: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSettingsView {
    pub revision: u64,
    pub app_data_root: String,
    pub app_data_root_locked_by_environment: bool,
    pub remote_media_root: String,
    pub remote_media_uses_default: bool,
    pub media_cache_root: String,
    pub media_cache_uses_default: bool,
    pub default_subtitle_export_directory: Option<String>,
    pub default_video_report_export_directory: Option<String>,
    pub app_data_used_bytes: u64,
    pub app_data_free_space_bytes: Option<u64>,
    pub remote_media_used_bytes: u64,
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
