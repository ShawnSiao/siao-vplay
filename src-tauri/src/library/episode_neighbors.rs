use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) struct EpisodeReference {
    pub project_id: String,
    pub display_title: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub season_number: Option<i64>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub episode_number: Option<i64>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub absolute_order: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) struct EpisodeNeighbors {
    pub previous: Option<EpisodeReference>,
    pub next: Option<EpisodeReference>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) struct EpisodeNeighborsResult {
    pub collection_id: String,
    pub project_id: String,
    pub neighbors: EpisodeNeighbors,
}
