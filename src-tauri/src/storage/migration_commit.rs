use std::{path::{Path, PathBuf}, sync::atomic::Ordering};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use super::{StorageArea, StorageError, StorageManager, StorageMigrationMode, StorageMigrationStatus, StorageMigrationTask,
    database, migration_state::{MigrationRuntime, now_ms, persist_task},
    model::StorageSettingsFile, settings::{active_app_data_root, persist_settings}};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CommitIntent {
    version: u32,
    database: PathBuf,
    revision: u64,
    task: StorageMigrationTask,
}

pub(super) fn pending_error() -> StorageError {
    StorageError::MigrationIntegrity("存储切换尚待恢复，请重新读取存储设置；恢复前不能修改存储位置或清理资源".to_owned())
}

impl StorageManager {
    pub(super) fn recover_migration_commit(&self) -> Result<(), StorageError> {
        // All commit/recovery paths lock the task before settings, as cancellation does.
        let mut runtime = self.migration.lock().map_err(|_| StorageError::StatePoisoned)?;
        let mut state = self.state.write().map_err(|_| StorageError::StatePoisoned)?;
        let root = active_app_data_root(&state);
        let path = state.settings_path.clone();
        recover(&path, &mut state.settings, &root, &mut runtime)?;
        Ok(())
    }

    pub(super) fn commit_destination(&self, database: &Path, task: &StorageMigrationTask) -> Result<(), StorageError> {
        let mut runtime = self.migration.lock().map_err(|_| StorageError::StatePoisoned)?;
        let mut state = self.write_state()?;
        if runtime.task.as_ref().is_none_or(|current| current.id != task.id) { return Err(pending_error()); }
        // Cancellation before this boundary prevents commitment. After it, finish the committed switch.
        if runtime.cancelled.load(Ordering::Relaxed) { return Err(StorageError::MigrationCancelled); }
        let root = active_app_data_root(&state);
        let intent = CommitIntent { version: 1, database: dunce::canonicalize(database)?, revision: state.settings.revision, task: task.clone() };
        if intent.database != dunce::canonicalize(root.join("projects/siaovplay.db"))? { return Err(pending_error()); }
        let mut pending = state.settings.clone();
        pending.pending_migration_commit = Some(intent.clone());
        persist_settings(&state.settings_path, &pending)?;
        state.settings = pending;
        let result = apply_database(&intent);
        let path = state.settings_path.clone();
        let committed = recover(&path, &mut state.settings, &root, &mut runtime)?;
        if committed { Ok(()) } else { result }
    }
}

fn apply_database(intent: &CommitIntent) -> Result<(), StorageError> {
    let mut connection = Connection::open_with_flags(&intent.database, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    let transaction = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if intent.task.area == StorageArea::MediaCache && intent.task.mode == StorageMigrationMode::Rebuild {
        transaction.execute_batch("UPDATE media_sources SET poster_path = NULL; DELETE FROM media_artifacts;")?;
    } else {
        database::rewrite_paths_in_transaction(&transaction, intent.task.area, Path::new(&intent.task.source_root), Path::new(&intent.task.destination_root))?;
    }
    transaction.execute_batch("CREATE TABLE IF NOT EXISTS storage_migration_commits (task_id TEXT PRIMARY KEY, intent_json TEXT NOT NULL);")?;
    transaction.execute("INSERT INTO storage_migration_commits (task_id, intent_json) VALUES (?1, ?2)", params![intent.task.id, serde_json::to_string(intent)?])?;
    let violations: i64 = transaction.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| row.get(0))?;
    let integrity: String = transaction.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    if violations != 0 || integrity != "ok" { return Err(StorageError::MigrationIntegrity("切换事务完整性检查未通过".to_owned())); }
    transaction.commit()?;
    Ok(())
}

pub(super) fn recover(path: &Path, settings: &mut StorageSettingsFile, root: &Path, runtime: &mut MigrationRuntime) -> Result<bool, StorageError> {
    let Some(intent) = settings.pending_migration_commit.clone() else { return Ok(false); };
    let task = &intent.task;
    let current = runtime.task.as_ref().ok_or_else(pending_error)?;
    if intent.version != 1 || !matches!(task.area, StorageArea::RemoteMedia | StorageArea::MediaCache)
        || (task.mode == StorageMigrationMode::Rebuild && task.area != StorageArea::MediaCache)
        || task.id != current.id || task.area != current.area || task.mode != current.mode
        || task.source_root != current.source_root || task.destination_root != current.destination_root
        || intent.database != dunce::canonicalize(root.join("projects/siaovplay.db"))?
        || intent.revision.checked_add(1).is_none()
        || (settings.revision != intent.revision && settings.revision != intent.revision + 1) { return Err(pending_error()); }
    let selected = match task.area {
        StorageArea::RemoteMedia => settings.remote_media_root.as_deref().map(PathBuf::from).unwrap_or_else(|| root.join("remote-media")),
        StorageArea::MediaCache => settings.media_cache_root.as_deref().map(PathBuf::from).unwrap_or_else(|| root.join("media-cache")),
        _ => return Err(pending_error()),
    };
    let expected = if settings.revision == intent.revision { &task.source_root } else { &task.destination_root };
    if selected != Path::new(expected) { return Err(pending_error()); }
    let connection = Connection::open_with_flags(&intent.database, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let exists: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='storage_migration_commits')", [], |row| row.get(0))?;
    let marker: Option<String> = if exists {
        connection.query_row("SELECT intent_json FROM storage_migration_commits WHERE task_id=?1", [&task.id], |row| row.get(0)).optional()?
    } else { None };
    if marker.as_ref().is_some_and(|value| serde_json::to_string(&intent).as_ref().ok() != Some(value)) { return Err(pending_error()); }
    let committed = marker.is_some();
    if !committed && settings.revision != intent.revision { return Err(pending_error()); }
    let mut completed_task = None;
    if committed {
        let mut next = settings.clone();
        match task.area {
            StorageArea::RemoteMedia => next.remote_media_root = Some(task.destination_root.clone()),
            StorageArea::MediaCache => next.media_cache_root = Some(task.destination_root.clone()),
            _ => return Err(pending_error()),
        }
        next.revision = intent.revision + 1;
        persist_settings(path, &next)?;
        *settings = next;
        let mut completed = current.clone();
        completed.status = StorageMigrationStatus::Completed;
        completed.error_code = None;
        completed.error_message = None;
        completed.updated_at_ms = now_ms()?;
        persist_task(&runtime.path, &completed)?;
        completed_task = Some(completed);
    }
    let mut settled = settings.clone();
    settled.pending_migration_commit = None;
    persist_settings(path, &settled)?;
    *settings = settled;
    if let Some(completed) = completed_task { runtime.task = Some(completed); runtime.database_owner = None; }
    Ok(committed)
}

#[cfg(test)]
#[path = "migration_commit_recovery_tests.rs"]
mod tests;
