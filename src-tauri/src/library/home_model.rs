use serde::Serialize;
use super::{MediaSummary, CollectionSummary, LibraryRootSummary};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) struct LibraryHome {
    pub continue_watching: Vec<MediaSummary>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub continue_watching_count: i64,
    #[cfg_attr(test, schemars(length(max = 4)))]
    pub collections: Vec<CollectionSummary>,
    #[cfg_attr(test, schemars(length(max = 4)))]
    pub folders: Vec<LibraryRootSummary>,
    pub unclassified: Vec<MediaSummary>,
    pub recently_added: Vec<MediaSummary>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub total_project_count: i64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub collection_count: i64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub folder_count: i64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub watch_later_count: i64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub collection_item_count: i64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub unclassified_count: i64,
}


// Match the persisted library schema constraints for these string columns.
#[cfg(test)]
#[allow(dead_code)]
#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CollectionSystemKey { WatchLater }
#[cfg(test)]
#[allow(dead_code)]
#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RootAvailability { Available, Offline }
