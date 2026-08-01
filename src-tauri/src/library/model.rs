use serde::{Deserialize, Serialize};

use super::LibraryError;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CollectionKind {
    Series,
    Folder,
    Manual,
}

impl CollectionKind {
    pub(crate) fn as_database_value(self) -> &'static str {
        match self {
            Self::Series => "series",
            Self::Folder => "folder",
            Self::Manual => "manual",
        }
    }

    pub(crate) fn from_database_value(value: &str) -> Result<Self, LibraryError> {
        match value {
            "series" => Ok(Self::Series),
            "folder" => Ok(Self::Folder),
            "manual" => Ok(Self::Manual),
            _ => Err(LibraryError::InvalidData(format!("未知集合类型：{value}"))),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CollectionSortMode {
    Episode,
    Natural,
    Manual,
    AddedAt,
}

impl CollectionSortMode {
    pub(crate) fn as_database_value(self) -> &'static str {
        match self {
            Self::Episode => "episode",
            Self::Natural => "natural",
            Self::Manual => "manual",
            Self::AddedAt => "added_at",
        }
    }

    pub(crate) fn from_database_value(value: &str) -> Result<Self, LibraryError> {
        match value {
            "episode" => Ok(Self::Episode),
            "natural" => Ok(Self::Natural),
            "manual" => Ok(Self::Manual),
            "added_at" => Ok(Self::AddedAt),
            _ => Err(LibraryError::InvalidData(format!(
                "未知集合排序模式：{value}"
            ))),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ItemAvailability {
    Available,
    Missing,
    RootOffline,
    Changed,
}

impl ItemAvailability {
    pub(crate) fn from_database_value(value: &str) -> Result<Self, LibraryError> {
        match value {
            "available" => Ok(Self::Available),
            "missing" => Ok(Self::Missing),
            "root_offline" => Ok(Self::RootOffline),
            "changed" => Ok(Self::Changed),
            _ => Err(LibraryError::InvalidData(format!(
                "未知单集可用状态：{value}"
            ))),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Collection {
    pub id: String,
    pub kind: CollectionKind,
    pub title: String,
    pub root_id: Option<String>,
    pub system_key: Option<String>,
    pub poster_path: Option<String>,
    pub sort_mode: CollectionSortMode,
    pub auto_play_next: bool,
    pub last_opened_at_ms: Option<i64>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CollectionSummary {
    #[serde(flatten)]
    pub collection: Collection,
    pub item_count: i64,
    pub season_count: i64,
    pub watched_count: i64,
    pub total_duration_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryRootSummary {
    pub id: String,
    pub path: String,
    pub display_name: String,
    pub availability: String,
    pub last_scanned_at_ms: Option<i64>,
    pub item_count: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaSummary {
    pub project_id: String,
    pub project_title: String,
    pub display_name: String,
    pub media_locator: String,
    pub media_available: bool,
    pub poster_path: Option<String>,
    pub position_ms: i64,
    pub duration_ms: Option<i64>,
    pub completed_at_ms: Option<i64>,
    pub last_opened_at_ms: i64,
    pub created_at_ms: i64,
    pub original_subtitle_available: bool,
    pub chinese_translation_available: bool,
    pub collection_id: Option<String>,
    pub collection_title: Option<String>,
    pub season_number: Option<i64>,
    pub episode_number: Option<i64>,
    pub absolute_order: Option<i64>,
    pub episode_title: Option<String>,
    pub item_availability: Option<ItemAvailability>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryHome {
    pub continue_watching: Vec<MediaSummary>,
    pub collections: Vec<CollectionSummary>,
    pub folders: Vec<LibraryRootSummary>,
    pub unclassified: Vec<MediaSummary>,
    pub total_project_count: i64,
    pub collection_item_count: i64,
    pub unclassified_count: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SeasonSummary {
    pub season_number: Option<i64>,
    pub episode_count: i64,
    pub watched_count: i64,
    pub total_duration_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CollectionDetail {
    pub summary: CollectionSummary,
    pub seasons: Vec<SeasonSummary>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EpisodeReference {
    pub project_id: String,
    pub display_title: String,
    pub season_number: Option<i64>,
    pub episode_number: Option<i64>,
    pub absolute_order: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EpisodeNeighbors {
    pub previous: Option<EpisodeReference>,
    pub next: Option<EpisodeReference>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SearchResultKind {
    Collection,
    Episode,
    Unclassified,
}

impl SearchResultKind {
    pub(crate) fn from_database_value(value: &str) -> Result<Self, LibraryError> {
        match value {
            "collection" => Ok(Self::Collection),
            "episode" => Ok(Self::Episode),
            "unclassified" => Ok(Self::Unclassified),
            _ => Err(LibraryError::InvalidData(format!(
                "未知搜索结果类型：{value}"
            ))),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchResult {
    pub kind: SearchResultKind,
    pub title: String,
    pub subtitle: Option<String>,
    pub collection_id: Option<String>,
    pub project_id: Option<String>,
    pub season_number: Option<i64>,
    pub episode_number: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateCollectionInput {
    pub title: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateCollectionInput {
    pub collection_id: String,
    pub title: Option<String>,
    pub sort_mode: Option<CollectionSortMode>,
    pub auto_play_next: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddProjectToCollectionInput {
    pub collection_id: String,
    pub project_id: String,
    pub season_number: Option<i64>,
    pub episode_number: Option<i64>,
    pub absolute_order: Option<i64>,
    pub display_title: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScanLibraryFolderInput {
    pub scan_id: String,
    pub root_path: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EpisodeRecognition {
    SxxExx,
    SeasonXEpisode,
    ChineseEpisode,
    NumericPrefix,
    SeasonDirectory,
    Unresolved,
    Conflict,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryScanCandidate {
    pub candidate_id: String,
    pub relative_path: String,
    pub display_title: String,
    pub season_number: Option<i64>,
    pub episode_number: Option<i64>,
    pub absolute_order: i64,
    pub recognition: EpisodeRecognition,
    pub needs_confirmation: bool,
    pub confirmation_reason: Option<String>,
    pub source_size_bytes: u64,
    pub source_modified_at_ms: Option<i64>,
    pub quick_fingerprint: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum IgnoredEntryReason {
    Hidden,
    System,
    ReparsePoint,
    IgnoredName,
    Temporary,
    UnsupportedExtension,
    OutsideRoot,
    Unreadable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IgnoredLibraryEntry {
    pub relative_path: String,
    pub reason: IgnoredEntryReason,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum LibraryScanPhase {
    Scanning,
    Fingerprinting,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryScanProgress {
    pub scan_id: String,
    pub phase: LibraryScanPhase,
    pub scanned_directories: u64,
    pub scanned_files: u64,
    pub candidate_files: u64,
    pub ignored_entries: u64,
    pub current_relative_path: Option<String>,
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryScanPreview {
    pub scan_id: String,
    pub preview_token: String,
    pub root_path: String,
    pub root_display_name: String,
    pub suggested_collection_title: String,
    pub candidates: Vec<LibraryScanCandidate>,
    pub ignored_entries: Vec<IgnoredLibraryEntry>,
    pub ignored_count: u64,
    pub needs_confirmation_count: u64,
    pub expires_at_ms: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfirmLibraryItemInput {
    pub candidate_id: String,
    pub display_title: String,
    pub season_number: Option<i64>,
    pub episode_number: Option<i64>,
    pub absolute_order: i64,
    #[serde(default)]
    pub confirmed: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfirmLibraryImportInput {
    pub preview_token: String,
    pub collection_title: String,
    pub items: Vec<ConfirmLibraryItemInput>,
    #[serde(default)]
    pub confirm_fingerprint_duplicates: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryImportResult {
    pub root_id: String,
    pub collection: CollectionDetail,
    pub imported_item_count: u64,
    pub created_project_count: u64,
    pub reused_project_count: u64,
}
