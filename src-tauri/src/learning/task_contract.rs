use serde::Serialize;
use crate::ai::types::AiTaskExecutionInfo;
use super::DictionaryEntry;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct LearningTask {
    pub id: String,
    pub project_id: String,
    #[cfg_attr(test, schemars(with = "super::wire_schema::Handoff"))]
    pub handoff_kind: String,
    pub execution: AiTaskExecutionInfo,
    pub protocol_version: String,
    #[cfg_attr(test, schemars(with = "super::wire_schema::TaskStatus"))]
    pub status: String,
    pub stage: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 1)))]
    pub progress: f64,
    pub receiver_label: String,
    pub material_scope: Vec<String>,
    pub source_version_id: String,
    pub translation_version_id: Option<String>,
    pub source_segment_id: String,
    pub selected_text: String,
    #[cfg_attr(test, schemars(with = "super::wire_schema::SelectionKind"))]
    pub selection_kind: String,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub playback_position_ms: i64,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub expected_project_revision: i64,
    pub output_dictionary_entry_id: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub created_at_ms: i64,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub updated_at_ms: i64,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub started_at_ms: Option<i64>,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub completed_at_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct LearningApplication {
    pub task: LearningTask,
    pub dictionary_entry: DictionaryEntry,
}
