use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
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
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) struct LibraryScanCandidate {
    pub candidate_id: String,
    pub relative_path: String,
    pub display_title: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub season_number: Option<i64>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub episode_number: Option<i64>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub absolute_order: i64,
    pub recognition: EpisodeRecognition,
    pub needs_confirmation: bool,
    pub confirmation_reason: Option<String>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub source_size_bytes: u64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub source_modified_at_ms: Option<i64>,
    pub quick_fingerprint: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
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
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) struct IgnoredLibraryEntry {
    pub relative_path: String,
    pub reason: IgnoredEntryReason,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) enum LibraryScanPhase {
    Scanning,
    Fingerprinting,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) struct LibraryScanProgress {
    pub scan_id: String,
    pub phase: LibraryScanPhase,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub scanned_directories: u64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub scanned_files: u64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub candidate_files: u64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub ignored_entries: u64,
    pub current_relative_path: Option<String>,
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) struct LibraryScanPreview {
    pub scan_id: String,
    pub preview_token: String,
    pub root_path: String,
    pub root_display_name: String,
    pub suggested_collection_title: String,
    pub candidates: Vec<LibraryScanCandidate>,
    pub ignored_entries: Vec<IgnoredLibraryEntry>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub ignored_count: u64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub needs_confirmation_count: u64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub expires_at_ms: i64,
}
