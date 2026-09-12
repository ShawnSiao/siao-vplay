use serde::{Deserialize, Serialize};
use super::{CollectionSummary, LibraryRootSummary};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub(crate) struct OverviewPageInput {
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    pub offset: i64,
    #[cfg_attr(test, schemars(regex(pattern = "^[a-f0-9]{64}$")))]
    pub expected_snapshot_token: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(test, derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub(crate) struct CollectionOverviewInput {
    pub root_linked: bool,
    #[serde(default)]
    pub query: String,
    #[serde(flatten)]
    pub page: OverviewPageInput,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) enum OverviewScope { Collections, Roots }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) struct OverviewPage<T> {
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    pub offset: i64,
    #[cfg_attr(test, schemars(regex(pattern = "^[a-f0-9]{64}$")))]
    pub snapshot_token: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    pub total_count: i64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    pub next_offset: Option<i64>,
    #[cfg_attr(test, schemars(length(max = 24)))]
    pub items: Vec<T>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) struct CollectionOverviewPage {
    pub scope: OverviewScope,
    pub root_linked: bool,
    pub query: String,
    #[serde(flatten)]
    pub page: OverviewPage<CollectionSummary>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) struct RootOverviewPage {
    pub scope: OverviewScope,
    #[serde(flatten)]
    pub page: OverviewPage<LibraryRootSummary>,
}
