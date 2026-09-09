use serde::{Deserialize, Serialize};

use super::MediaSummary;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub(crate) enum LibraryMediaSection {
    ContinueWatching,
    WatchLater,
    Unclassified,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListLibrarySectionInput {
    pub section: LibraryMediaSection,
    pub offset: i64,
    pub expected_snapshot_token: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) struct LibrarySectionPage {
    pub section: LibraryMediaSection,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub offset: i64,
    #[cfg_attr(test, schemars(regex(pattern = "^[a-f0-9]{64}$")))]
    pub snapshot_token: String,
    #[cfg_attr(test, schemars(length(max = 24)))]
    pub items: Vec<MediaSummary>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub total_count: i64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub next_offset: Option<i64>,
}
