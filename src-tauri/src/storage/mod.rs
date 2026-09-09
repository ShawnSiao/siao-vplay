pub mod commands;
mod database;
mod maintenance;
mod migration;
mod migration_copy;
mod migration_state;
mod model;
mod paths;
mod settings;
mod settings_io;
#[cfg(test)]
mod settings_recovery_tests;

#[cfg(test)]
#[path = "migration_tests.rs"]
mod migration_tests;

#[cfg(test)]
#[path = "settings_tests.rs"]
mod settings_tests;

use thiserror::Error;

pub use model::{
    ClearPlaybackCacheInput, ClearPlaybackCacheResult, PrepareStorageMigrationInput,
    SaveStorageSettingsInput, StartStorageMigrationInput, StorageArea, StorageLocationInput,
    StorageLocationKind, StorageMigrationMode, StorageMigrationStatus, StorageMigrationTask,
    StorageMigrationTaskInput, StorageSettingsView,
};
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
    #[error("数据库迁移操作失败：{0}")]
    Database(#[from] rusqlite::Error),
    #[error("已有存储迁移正在执行")]
    MigrationBusy,
    #[error("找不到存储迁移任务")]
    MigrationNotFound,
    #[error("执行存储迁移前需要明确确认")]
    ConfirmationRequired,
    #[error("应用数据位置由 SIAOVPLAY_DATA_DIR 锁定，不能在应用内迁移")]
    EnvironmentLocked,
    #[error("此位置已有应用管理的文件，请使用迁移功能更改位置")]
    ManagedRootChangeRequiresMigration,
    #[error("迁移目标文件夹不是空文件夹：{0}")]
    DestinationNotEmpty(String),
    #[error("目标磁盘空间不足：需要 {required_bytes} 字节，可用 {available_bytes} 字节")]
    InsufficientSpace {
        required_bytes: u64,
        available_bytes: u64,
    },
    #[error("存储迁移完整性校验失败：{0}")]
    MigrationIntegrity(String),
    #[error("存储迁移已取消；来源数据未删除")]
    MigrationCancelled,
}

impl StorageError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidPath(_) => "storage_path_invalid",
            Self::RootUnavailable(_) => "storage_root_unavailable",
            Self::RevisionConflict { .. } => "storage_revision_conflict",
            Self::UnsupportedVersion(_) => "storage_version_unsupported",
            Self::FileSystem(_) => "storage_filesystem_error",
            Self::Serialization(_) => "storage_serialization_error",
            Self::StatePoisoned => "storage_state_unavailable",
            Self::Database(_) => "storage_database_error",
            Self::MigrationBusy => "storage_migration_busy",
            Self::MigrationNotFound => "storage_migration_not_found",
            Self::ConfirmationRequired => "storage_confirmation_required",
            Self::EnvironmentLocked => "storage_environment_locked",
            Self::ManagedRootChangeRequiresMigration => "storage_migration_required",
            Self::DestinationNotEmpty(_) => "storage_destination_not_empty",
            Self::InsufficientSpace { .. } => "storage_space_insufficient",
            Self::MigrationIntegrity(_) => "storage_integrity_failed",
            Self::MigrationCancelled => "storage_migration_cancelled",
        }
    }
}

#[cfg(test)]
mod migration_write_tests;

#[cfg(test)]
mod migration_recovery_tests;
