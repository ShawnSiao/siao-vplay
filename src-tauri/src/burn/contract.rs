use serde::Serialize;
use super::SubtitleBurnMode;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct SubtitleBurnJob {
    pub id: String,
    pub project_id: String,
    #[cfg_attr(test, schemars(with = "TaskStatus"))]
    pub status: String,
    pub stage: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 1)))]
    pub progress: f64,
    pub mode: SubtitleBurnMode,
    pub source_version_id: Option<String>,
    pub translation_version_id: String,
    pub output_path: Option<String>,
    pub manifest_path: Option<String>,
    pub output_sha256: Option<String>,
    pub runtime_version: String,
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

#[cfg(test)]
#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Schema vocabulary for persisted task statuses")]
enum TaskStatus { Queued, Running, Validating, Completed, Failed, Cancelled, Interrupted }
