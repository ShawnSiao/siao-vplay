use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AiError {
    #[error("AI 服务尚未初始化")]
    NotInitialized,
    #[error("配置已经在其他位置发生变化")]
    RevisionConflict,
    #[error("{0}")]
    Validation(String),
    #[error("无法读取 AI 服务配置")]
    ConfigurationRead,
    #[error("无法保存 AI 服务配置")]
    ConfigurationWrite,
    #[error("无法读取安全凭据")]
    CredentialRead,
    #[error("无法保存安全凭据")]
    CredentialWrite,
    #[error("无法删除安全凭据")]
    CredentialDelete,
    #[cfg_attr(windows, allow(dead_code))]
    #[error("当前系统不支持安全凭据存储")]
    CredentialUnsupported,
    #[error("AI 服务不存在")]
    ServiceNotFound,
}

impl AiError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotInitialized => "ai_not_initialized",
            Self::RevisionConflict => "revision_conflict",
            Self::Validation(_) => "validation_failed",
            Self::ConfigurationRead => "configuration_read_failed",
            Self::ConfigurationWrite => "configuration_write_failed",
            Self::CredentialRead => "credential_read_failed",
            Self::CredentialWrite => "credential_write_failed",
            Self::CredentialDelete => "credential_delete_failed",
            Self::CredentialUnsupported => "credential_unsupported",
            Self::ServiceNotFound => "ai_service_not_found",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCommandError {
    pub code: &'static str,
    pub message: String,
}

impl From<AiError> for AiCommandError {
    fn from(error: AiError) -> Self {
        Self {
            code: error.code(),
            message: error.to_string(),
        }
    }
}
