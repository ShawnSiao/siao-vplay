use serde::Serialize;
use crate::{ai::AiTaskExecutionInfo, understanding_v2::{ExplanationEntry, ExplanationMaterialSummary}};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ExplanationFrame {
    pub id: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub ordinal: usize,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub timestamp_ms: i64,
    pub path: String,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ExplanationTask {
    pub id: String,
    pub project_id: String,
    #[cfg_attr(test, schemars(with = "crate::ai::types::AiExecutionKind"))]
    pub handoff_kind: String,
    pub execution: AiTaskExecutionInfo,
    pub protocol_version: String,
    #[cfg_attr(test, schemars(with = "TaskStatus"))]
    pub status: String,
    pub stage: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 1)))]
    pub progress: f64,
    pub receiver_label: String,
    pub material_scope: Vec<String>,
    pub source_version_id: String,
    pub translation_version_id: Option<String>,
    pub authorized_segment_ids: Vec<String>,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub playback_cutoff_ms: i64,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub scene_start_ms: i64,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub expected_project_revision: i64,
    pub output_explanation_id: Option<String>,
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
    pub frames: Vec<ExplanationFrame>,
    pub material_summary: ExplanationMaterialSummary,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct Explanation {
    pub id: String,
    pub project_id: String,
    pub task_id: String,
    pub source_version_id: String,
    pub translation_version_id: Option<String>,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub playback_cutoff_ms: i64,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub scene_start_ms: i64,
    pub protocol_version: String,
    pub material_summary: ExplanationMaterialSummary,
    pub confirmed_facts: Vec<ExplanationEntry>,
    pub possible_interpretations: Vec<ExplanationEntry>,
    pub withheld_reason: Option<String>,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub created_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ExplanationApplication {
    pub task: ExplanationTask,
    pub explanation: Explanation,
}

#[cfg(test)]
#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Schema vocabulary for persisted task statuses")]
enum TaskStatus { AwaitingExternalResult, Queued, Running, Validating, Completed, Failed, Cancelled, Interrupted }
