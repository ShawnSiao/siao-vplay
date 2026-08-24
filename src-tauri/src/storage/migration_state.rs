use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, atomic::AtomicBool},
    time::{SystemTime, UNIX_EPOCH},
};

use uuid::Uuid;

use super::{StorageError, StorageMigrationStatus, StorageMigrationTask};

const MIGRATION_FILE_NAME: &str = "storage-migration.json";

#[derive(Debug)]
pub(crate) struct MigrationRuntime {
    pub(crate) path: PathBuf,
    pub(crate) task: Option<StorageMigrationTask>,
    pub(crate) cancelled: Arc<AtomicBool>,
}

pub(crate) fn load_migration_runtime(
    bootstrap: &Path,
    active_app_root: &Path,
) -> Result<MigrationRuntime, StorageError> {
    let path = bootstrap.join(MIGRATION_FILE_NAME);
    let mut task = if path.is_file() {
        Some(serde_json::from_slice::<StorageMigrationTask>(&fs::read(
            &path,
        )?)?)
    } else {
        None
    };
    if let Some(task) = task.as_mut() {
        if task.status == StorageMigrationStatus::Running {
            task.status = StorageMigrationStatus::Interrupted;
            task.updated_at_ms = now_ms()?;
        } else if task.status == StorageMigrationStatus::RestartRequired
            && Path::new(&task.destination_root) == active_app_root
        {
            task.status = StorageMigrationStatus::Completed;
            task.restart_required = false;
            task.updated_at_ms = now_ms()?;
        }
        persist_task(&path, task)?;
    }
    Ok(MigrationRuntime {
        path,
        task,
        cancelled: Arc::new(AtomicBool::new(false)),
    })
}

pub(crate) fn persist_task(path: &Path, task: &StorageMigrationTask) -> Result<(), StorageError> {
    let suffix = Uuid::new_v4().simple().to_string();
    let temporary = path.with_file_name(format!(".{MIGRATION_FILE_NAME}.{suffix}.part"));
    let previous = path.with_file_name(format!(".{MIGRATION_FILE_NAME}.{suffix}.previous"));
    fs::write(&temporary, serde_json::to_vec_pretty(task)?)?;
    if path.exists() {
        fs::rename(path, &previous)?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if previous.exists() {
            let _ = fs::rename(&previous, path);
        }
        let _ = fs::remove_file(&temporary);
        return Err(error.into());
    }
    if previous.exists() {
        fs::remove_file(previous)?;
    }
    Ok(())
}

pub(crate) fn now_ms() -> Result<i64, StorageError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| StorageError::MigrationIntegrity("系统时间早于 Unix epoch".to_owned()))?;
    i64::try_from(duration.as_millis())
        .map_err(|_| StorageError::MigrationIntegrity("系统时间超出支持范围".to_owned()))
}
