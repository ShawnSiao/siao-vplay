use std::{
    fs, io::Write,
    path::{Path, PathBuf},
    sync::{Arc, atomic::AtomicBool},
    time::{SystemTime, UNIX_EPOCH},
};

use uuid::Uuid;

use super::{StorageArea, StorageError, StorageMigrationStatus, StorageMigrationTask};

const MIGRATION_FILE_NAME: &str = "storage-migration.json";

#[derive(Debug)]
pub(crate) struct MigrationRuntime {
    pub(crate) users: usize,
    pub(crate) database_owner: Option<super::database_access::Exclusive>,
    pub(crate) path: PathBuf,
    pub(crate) task: Option<StorageMigrationTask>,
    pub(crate) cancelled: Arc<AtomicBool>,
}

pub(crate) fn load_migration_runtime(
    bootstrap: &Path,
    committed_app_root: Option<&Path>,
) -> Result<MigrationRuntime, StorageError> {
    let path = bootstrap.join(MIGRATION_FILE_NAME);
    let mut task = load_task(&path)?;
    if let Some(task) = task.as_mut() {
        let promoted = task.area == StorageArea::AppData
            && committed_app_root == Some(Path::new(&task.destination_root))
            && matches!(task.status, StorageMigrationStatus::Running | StorageMigrationStatus::Interrupted
                | StorageMigrationStatus::Failed | StorageMigrationStatus::RestartRequired);
        if promoted {
            task.status = StorageMigrationStatus::Completed;
            task.restart_required = false;
            task.error_code = None;
            task.error_message = None;
            task.updated_at_ms = now_ms()?;
        } else if task.status == StorageMigrationStatus::Running {
            task.status = StorageMigrationStatus::Interrupted;
            task.updated_at_ms = now_ms()?;
        }
        persist_task(&path, task)?;
    }
    Ok(MigrationRuntime {
        users: 0,
        database_owner: None,
        path,
        task,
        cancelled: Arc::new(AtomicBool::new(false)),
    })
}

fn ordinary_file(path: &Path) -> Result<bool, StorageError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(true),
        Ok(_) => Err(StorageError::MigrationIntegrity("迁移记录路径不是普通文件，未修改原有内容".to_owned())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

fn load_task(path: &Path) -> Result<Option<StorageMigrationTask>, StorageError> {
    if ordinary_file(path)? {
        return Ok(Some(serde_json::from_slice(&fs::read(path)?)?));
    }
    let parent = path.parent().ok_or_else(|| StorageError::MigrationIntegrity("迁移记录目录缺失".to_owned()))?;
    let prefix = format!(".{MIGRATION_FILE_NAME}.");
    let mut previous = None;
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue; };
        let Some(id) = name.strip_prefix(&prefix).and_then(|name| name.strip_suffix(".previous")) else { continue; };
        if id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) { continue; }
        if previous.is_some() {
            return Err(StorageError::MigrationIntegrity("发现多份中断的迁移记录备份，无法确定恢复来源；已保留文件".to_owned()));
        }
        ordinary_file(&entry.path())?;
        previous = Some(entry.path());
    }
    // Only a committed legacy backup can be recovered. Never promote a .part candidate.
    previous.map(|previous| Ok(serde_json::from_slice(&fs::read(previous)?)?)).transpose()
}

pub(crate) fn persist_task(path: &Path, task: &StorageMigrationTask) -> Result<(), StorageError> {
    ordinary_file(path)?;
    let suffix = Uuid::new_v4().simple().to_string();
    let temporary = path.with_file_name(format!(".{MIGRATION_FILE_NAME}.{suffix}.part"));
    let bytes = serde_json::to_vec_pretty(task)?;
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
    let result: Result<(), StorageError> = (|| {
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        // Keep the committed record in place until same-directory replacement succeeds.
        fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}

pub(crate) fn now_ms() -> Result<i64, StorageError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| StorageError::MigrationIntegrity("系统时间早于 Unix epoch".to_owned()))?;
    i64::try_from(duration.as_millis())
        .map_err(|_| StorageError::MigrationIntegrity("系统时间超出支持范围".to_owned()))
}
