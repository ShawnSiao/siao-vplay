pub mod commands;
mod model;
mod paths;
mod settings;

use thiserror::Error;

pub use model::{SaveStorageSettingsInput, StorageSettingsView};
pub(crate) use paths::remove_remote_project_directory;
pub use settings::StorageManager;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("存储设置文件错误：{0}")]
    FileSystem(#[from] std::io::Error),
    #[error("存储设置格式错误：{0}")]
    Serialization(#[from] serde_json::Error),
    #[error("不支持的存储设置版本：{0}")]
    UnsupportedVersion(u32),
    #[error("存储位置无效：{0}")]
    InvalidPath(String),
    #[error("存储位置不可用：{0}")]
    RootUnavailable(String),
    #[error("存储设置已被其他操作修改：预期版本 {expected}，当前版本 {actual}")]
    RevisionConflict { expected: u64, actual: u64 },
    #[error("存储设置状态不可用")]
    StatePoisoned,
}
