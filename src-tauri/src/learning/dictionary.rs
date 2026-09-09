use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct DictionaryEntry {
    pub id: String,
    pub project_id: String,
    pub task_id: String,
    pub source_version_id: String,
    pub translation_version_id: Option<String>,
    pub source_segment_id: String,
    pub selected_text: String,
    #[cfg_attr(test, schemars(with = "super::wire_schema::SelectionKind"))]
    pub selection_kind: String,
    pub pronunciation: String,
    pub part_of_speech: String,
    pub contextual_meaning: String,
    pub usage_note: Option<String>,
    pub source_sentence: String,
    pub translated_sentence: Option<String>,
    pub language_code: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    pub playback_position_ms: i64,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub created_at_ms: i64,
}
