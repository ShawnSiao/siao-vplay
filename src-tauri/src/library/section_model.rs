use serde::{Deserialize, Serialize};

use super::MediaSummary;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
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
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibrarySectionPage {
    pub items: Vec<MediaSummary>,
    pub total_count: i64,
    pub next_offset: Option<i64>,
}
