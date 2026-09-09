use serde::{Deserialize, Serialize};

pub use super::result_model::{
    EvidenceKind, SummaryCitation, SummaryEvidence, SummaryResult, SummarySection,
};

use crate::store::StoreError;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisTaskType {
    Understanding,
    Summary,
}

impl AnalysisTaskType {
    pub(crate) fn as_database_value(self) -> &'static str {
        match self {
            Self::Understanding => "understanding",
            Self::Summary => "summary",
        }
    }

    pub(crate) fn from_database(value: &str) -> Result<Self, StoreError> {
        match value {
            "understanding" => Ok(Self::Understanding),
            "summary" => Ok(Self::Summary),
            _ => Err(StoreError::Validation(format!(
                "分析提示词任务类型无效：{value}"
            ))),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisPromptTemplate {
    pub id: String,
    pub task_type: AnalysisTaskType,
    pub base_template_id: String,
    pub name: String,
    pub custom_requirements: String,
    pub is_builtin: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListAnalysisPromptTemplatesInput {
    pub task_type: Option<AnalysisTaskType>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SaveAnalysisPromptTemplateInput {
    pub id: Option<String>,
    pub task_type: AnalysisTaskType,
    pub base_template_id: String,
    pub name: String,
    pub custom_requirements: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAnalysisPromptTemplateInput {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptSnapshot {
    pub schema_version: u32,
    pub task_type: AnalysisTaskType,
    pub system_rules_version: String,
    pub template_id: String,
    pub template_name: String,
    pub base_template_id: String,
    pub template_requirements: String,
    pub one_time_requirements: String,
    pub composed_prompt: String,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PromptSelection {
    pub template_id: String,
    #[serde(default)]
    pub one_time_requirements: String,
}

impl Default for PromptSelection {
    fn default() -> Self {
        Self {
            template_id: "builtin:understanding:balanced".to_owned(),
            one_time_requirements: String::new(),
        }
    }
}

impl PromptSelection {
    pub fn summary_default() -> Self {
        Self {
            template_id: "builtin:summary:automatic".to_owned(),
            one_time_requirements: String::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub enum AnalysisScope {
    CurrentProgress,
    FullVideo,
}

impl AnalysisScope {
    pub(crate) fn as_database_value(self) -> &'static str {
        match self {
            Self::CurrentProgress => "current_progress",
            Self::FullVideo => "full_video",
        }
    }

    pub(crate) fn from_database(value: &str) -> Result<Self, StoreError> {
        match value {
            "current_progress" => Ok(Self::CurrentProgress),
            "full_video" => Ok(Self::FullVideo),
            _ => Err(StoreError::Validation(format!("总结范围无效：{value}"))),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisMode {
    Automatic,
    General,
    ScienceTechnology,
    SoftwareArchitecture,
}

impl AnalysisMode {
    pub(crate) fn as_database_value(self) -> &'static str {
        match self {
            Self::Automatic => "automatic",
            Self::General => "general",
            Self::ScienceTechnology => "science_technology",
            Self::SoftwareArchitecture => "software_architecture",
        }
    }

    pub(crate) fn from_database(value: &str) -> Result<Self, StoreError> {
        match value {
            "automatic" => Ok(Self::Automatic),
            "general" => Ok(Self::General),
            "science_technology" => Ok(Self::ScienceTechnology),
            "software_architecture" => Ok(Self::SoftwareArchitecture),
            _ => Err(StoreError::Validation(format!("总结分析模式无效：{value}"))),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub enum SummaryExecutionKind {
    Manual,
    Codex,
    Api,
}

impl SummaryExecutionKind {
    pub(crate) fn as_database_value(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Codex => "codex",
            Self::Api => "api",
        }
    }

    pub(crate) fn from_database(value: &str) -> Result<Self, StoreError> {
        match value {
            "manual" => Ok(Self::Manual),
            "codex" => Ok(Self::Codex),
            "api" => Ok(Self::Api),
            _ => Err(StoreError::Validation(format!("总结执行方式无效：{value}"))),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrepareSummaryTaskInput {
    pub project_id: String,
    pub scope: AnalysisScope,
    pub playback_cutoff_ms: Option<i64>,
    pub analysis_mode: AnalysisMode,
    pub execution_kind: SummaryExecutionKind,
    #[serde(default = "PromptSelection::summary_default")]
    pub prompt_selection: PromptSelection,
    #[serde(default)]
    pub visual_material_authorized: bool,
    #[serde(default)]
    pub subtitles_authorized: bool,
    #[serde(default)]
    pub spoiler_confirmed: bool,
    pub service_config_id: Option<String>,
    pub service_revision: Option<u64>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SummaryTaskIdInput {
    pub task_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListSummaryTasksInput {
    pub project_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListVideoSummariesInput {
    pub project_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoSummaryIdInput {
    pub summary_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportVideoSummaryInput {
    pub summary_id: String,
    pub directory: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryChunk {
    pub id: String,
    pub ordinal: usize,
    pub start_ms: i64,
    pub end_ms: i64,
    pub segment_ids: Vec<String>,
    pub context_segment_ids: Vec<String>,
    pub status: String,
    pub retry_count: u8,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryTask {
    pub id: String,
    pub project_id: String,
    pub scope: AnalysisScope,
    pub playback_cutoff_ms: Option<i64>,
    pub analysis_mode: AnalysisMode,
    pub execution_kind: SummaryExecutionKind,
    pub prompt_snapshot: PromptSnapshot,
    pub subtitle_version_id: String,
    pub material_manifest_sha256: String,
    pub visual_material_authorized: bool,
    pub spoiler_confirmed: bool,
    pub status: String,
    pub stage: String,
    pub progress: f64,
    pub service_config_id: Option<String>,
    pub service_revision: Option<u64>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub output_summary_id: Option<String>,
    pub cancel_requested: bool,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub chunks: Vec<SummaryChunk>,
    pub materials_directory: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSummary {
    pub id: String,
    pub task_id: String,
    pub project_id: String,
    pub protocol_version: String,
    pub scope: AnalysisScope,
    pub playback_cutoff_ms: Option<i64>,
    pub analysis_mode: AnalysisMode,
    pub subtitle_version_id: String,
    pub material_manifest_sha256: String,
    pub result: SummaryResult,
    pub visual_material_used: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryExport {
    pub directory: String,
    pub report_path: String,
    pub manifest_path: String,
    pub asset_count: usize,
    pub report_sha256: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_type_uses_stable_database_values() {
        for task_type in [AnalysisTaskType::Understanding, AnalysisTaskType::Summary] {
            assert_eq!(
                AnalysisTaskType::from_database(task_type.as_database_value()).unwrap(),
                task_type
            );
        }
    }
}
