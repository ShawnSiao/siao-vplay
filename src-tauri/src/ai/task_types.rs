use serde::Deserialize;
use thiserror::Error;

use super::{
    error::{AiCommandError, AiError},
    providers::ProviderFailure,
    types::{AiExecutionTarget, AiMaterialAuthorization},
};
use crate::{
    codex_runner::CodexRunnerError, learning::LearningError, store::StoreError,
    understanding::UnderstandingError,
};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartExplanationTaskInput {
    pub project_id: String,
    pub playback_cutoff_ms: i64,
    pub execution: AiExecutionTarget,
    pub authorization: AiMaterialAuthorization,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLearningTaskInput {
    pub project_id: String,
    pub source_segment_id: String,
    pub selected_text: String,
    pub selection_kind: String,
    pub playback_position_ms: i64,
    pub execution: AiExecutionTarget,
    pub authorization: AiMaterialAuthorization,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeAiTaskInput {
    pub task_id: String,
    pub execution: AiExecutionTarget,
    pub authorization: AiMaterialAuthorization,
}

#[derive(Debug, Error)]
pub enum AiTaskError {
    #[error(transparent)]
    Ai(#[from] AiError),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Database(#[from] rusqlite::Error),
    #[error(transparent)]
    Understanding(#[from] UnderstandingError),
    #[error(transparent)]
    Learning(#[from] LearningError),
    #[error(transparent)]
    Codex(#[from] CodexRunnerError),
    #[error("AI 服务请求失败")]
    Provider(ProviderFailure),
    #[error("AI 任务响应元数据无法保存")]
    Serialization(#[from] serde_json::Error),
    #[error("无法读取已授权的关键帧")]
    FileSystem(#[from] std::io::Error),
}

impl AiTaskError {
    pub fn command_error(self) -> AiCommandError {
        match self {
            Self::Ai(error) => error.into(),
            Self::Provider(failure) => {
                AiCommandError::from(failure.error).with_request_id(failure.provider_request_id)
            }
            Self::Understanding(error) => {
                AiCommandError::task(error.code(), error.to_string(), false, None)
            }
            Self::Learning(error) => {
                AiCommandError::task(error.code(), error.to_string(), false, None)
            }
            Self::Codex(error) => AiCommandError::task(
                error.code(),
                error.to_string(),
                matches!(
                    error,
                    CodexRunnerError::TimedOut | CodexRunnerError::ProcessFailed
                ),
                None,
            ),
            Self::Store(error) => {
                AiCommandError::task("database_error", error.to_string(), false, None)
            }
            Self::Database(error) => {
                AiCommandError::task("database_error", error.to_string(), false, None)
            }
            Self::Serialization(error) => {
                AiCommandError::task("ai_usage_invalid", error.to_string(), false, None)
            }
            Self::FileSystem(error) => AiCommandError::task(
                "authorized_frame_unavailable",
                error.to_string(),
                false,
                None,
            ),
        }
    }
}

impl From<ProviderFailure> for AiTaskError {
    fn from(error: ProviderFailure) -> Self {
        Self::Provider(error)
    }
}
