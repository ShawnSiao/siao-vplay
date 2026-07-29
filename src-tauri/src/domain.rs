use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    Ready,
    NeedsRelink,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaSourceKind {
    LocalFile,
}

impl MediaSourceKind {
    pub(crate) fn as_database_value(&self) -> &'static str {
        match self {
            Self::LocalFile => "local_file",
        }
    }

    pub(crate) fn from_database_value(value: &str) -> Option<Self> {
        match value {
            "local_file" => Some(Self::LocalFile),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSource {
    pub id: String,
    pub kind: MediaSourceKind,
    pub locator: String,
    pub display_name: String,
    pub is_available: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackState {
    pub position_ms: i64,
    pub duration_ms: Option<i64>,
    pub volume: f64,
    pub playback_rate: f64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub title: String,
    pub status: ProjectStatus,
    pub revision: i64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub last_opened_at_ms: i64,
    pub media_source: MediaSource,
    pub playback_state: PlaybackState,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLocalProjectInput {
    pub media_path: String,
    pub title: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkProjectMediaInput {
    pub project_id: String,
    pub media_path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlaybackStateInput {
    pub project_id: String,
    pub position_ms: i64,
    pub duration_ms: Option<i64>,
    pub volume: f64,
    pub playback_rate: f64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectResult {
    pub project_id: String,
    pub deleted: bool,
    pub source_media_deleted: bool,
}
