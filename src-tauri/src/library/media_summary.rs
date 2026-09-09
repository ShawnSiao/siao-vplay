use serde::Serialize;
use super::ItemAvailability;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) struct MediaSummary {
    pub project_id: String,
    pub project_title: String,
    pub display_name: String,
    pub media_locator: String,
    pub media_available: bool,
    pub poster_path: Option<String>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub position_ms: i64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub duration_ms: Option<i64>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub completed_at_ms: Option<i64>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub last_opened_at_ms: i64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub created_at_ms: i64,
    pub original_subtitle_available: bool,
    pub chinese_translation_available: bool,
    pub collection_id: Option<String>,
    pub collection_title: Option<String>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub season_number: Option<i64>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub episode_number: Option<i64>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub absolute_order: Option<i64>,
    pub episode_title: Option<String>,
    pub item_availability: Option<ItemAvailability>,
}
