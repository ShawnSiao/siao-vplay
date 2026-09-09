use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};

use uuid::Uuid;

use super::{
    PrepareStorageMigrationInput, StartStorageMigrationInput, StorageArea, StorageError,
    StorageManager, StorageMigrationMode, StorageMigrationStatus, StorageMigrationTask, database,
    migration_copy,
    migration_state::{now_ms, persist_task},
    paths::{available_space, canonical_existing_directory},
    settings::{active_app_data_root, persist_settings},
};

const SPACE_MARGIN_BYTES: u64 = 64 * 1024 * 1024;

impl StorageManager {
    pub fn prepare_migration(
        &self,
        input: PrepareStorageMigrationInput,
    ) -> Result<StorageMigrationTask, StorageError> {
        self.recover_migration_commit()?;
        if self.read_state()?.settings.pending_app_data_root.is_some() { return Err(StorageError::MigrationBusy); }
        if input.mode == StorageMigrationMode::Rebuild && input.area != StorageArea::MediaCache {
            return Err(StorageError::InvalidPath(
                "只有播放缓存支持在新位置重新生成".to_owned(),
            ));
        }
        let source = self.source_root(input.area)?;
        let destination =
            canonical_existing_directory(Some(input.destination_directory), "迁移目标位置")?
                .map(PathBuf::from)
                .ok_or_else(|| StorageError::InvalidPath("请选择迁移目标位置".to_owned()))?;
        validate_root_pair(&source, &destination)?;
        ensure_empty_directory(&destination)?;
        let database = (input.area == StorageArea::AppData)
            .then(|| source.join("projects").join("siaovplay.db"));
        let files = if input.mode == StorageMigrationMode::Copy {
            self.scan_migration_files(&source, database.as_deref(), &AtomicBool::new(false))?
        } else {
            Vec::new()
        };
        let bytes_to_copy = if input.mode == StorageMigrationMode::Copy {
            super::migration_scope::estimated_bytes(&files, database.as_deref())?
        } else {
            0
        };
        let free_space_bytes = available_space(&destination);
        if let Some(available) = free_space_bytes {
            let required = bytes_to_copy.saturating_add(SPACE_MARGIN_BYTES);
            if bytes_to_copy > 0 && available < required {
                return Err(StorageError::InsufficientSpace {
                    required_bytes: required,
                    available_bytes: available,
                });
            }
        }
        let timestamp = now_ms()?;
        let task = StorageMigrationTask {
            id: Uuid::new_v4().to_string(),
            area: input.area,
            mode: input.mode,
            status: StorageMigrationStatus::Prepared,
            source_root: path_string(&source),
            destination_root: path_string(&destination),
            bytes_to_copy,
            copied_bytes: 0,
            file_count: files.len() + usize::from(database.is_some()),
            verified_file_count: 0,
            free_space_bytes,
            previous_root_retained: true,
            restart_required: input.area == StorageArea::AppData,
            error_code: None,
            error_message: None,
            created_at_ms: timestamp,
            updated_at_ms: timestamp,
        };
        let mut runtime = self
            .migration
            .lock()
            .map_err(|_| StorageError::StatePoisoned)?;
        if runtime.users > 0 || runtime
            .task
            .as_ref()
            .is_some_and(|current| current.status == StorageMigrationStatus::Running)
        {
            return Err(StorageError::MigrationBusy);
        }
        persist_task(&runtime.path, &task)?;
        runtime.cancelled.store(false, Ordering::Relaxed);
        runtime.task = Some(task.clone());
        Ok(task)
    }

    pub fn start_migration(
        &self,
        database_path: PathBuf,
        input: StartStorageMigrationInput,
    ) -> Result<StorageMigrationTask, StorageError> {
        if !input.confirmed {
            return Err(StorageError::ConfirmationRequired);
        }
        self.recover_migration_commit()?;
        let task = {
            let mut runtime = self
                .migration
                .lock()
                .map_err(|_| StorageError::StatePoisoned)?;
            let path = runtime.path.clone();
            let mut task = runtime
                .task
                .as_ref()
                .filter(|task| task.id == input.task_id)
                .cloned()
                .ok_or(StorageError::MigrationNotFound)?;
            if task.status == StorageMigrationStatus::Running {
                return Err(StorageError::MigrationBusy);
            }
            if matches!(
                task.status,
                StorageMigrationStatus::Completed | StorageMigrationStatus::RestartRequired
            ) {
                return Ok(task.clone());
            }
            if runtime.users > 0 { return Err(StorageError::MigrationBusy); }
            let database_owner = super::database_access::exclusive(&database_path)?;
            task.status = StorageMigrationStatus::Running;
            task.error_code = None;
            task.error_message = None;
            task.updated_at_ms = now_ms()?;
            persist_task(&path, &task)?;
            runtime.task = Some(task.clone());
            runtime.database_owner = Some(database_owner);
            runtime.cancelled.store(false, Ordering::Relaxed);
            task
        };
        let manager = self.clone();
        thread::spawn(move || manager.run_migration(database_path, task));
        self.get_migration(&input.task_id)
    }

    pub fn get_migration(&self, task_id: &str) -> Result<StorageMigrationTask, StorageError> {
        let runtime = self
            .migration
            .lock()
            .map_err(|_| StorageError::StatePoisoned)?;
        runtime
            .task
            .as_ref()
            .filter(|task| task.id == task_id)
            .cloned()
            .ok_or(StorageError::MigrationNotFound)
    }

    pub fn current_migration(&self) -> Result<Option<StorageMigrationTask>, StorageError> {
        let runtime = self
            .migration
            .lock()
            .map_err(|_| StorageError::StatePoisoned)?;
        Ok(runtime.task.clone())
    }

    pub fn cancel_migration(&self, task_id: &str) -> Result<StorageMigrationTask, StorageError> {
        let runtime = self
            .migration
            .lock()
            .map_err(|_| StorageError::StatePoisoned)?;
        let task = runtime
            .task
            .as_ref()
            .filter(|task| task.id == task_id)
            .cloned()
            .ok_or(StorageError::MigrationNotFound)?;
        runtime.cancelled.store(true, Ordering::Relaxed);
        Ok(task)
    }

    fn run_migration(&self, current_database: PathBuf, task: StorageMigrationTask) {
        let result = self.execute_migration(&current_database, &task);
        let _ = self.finish_task(&task.id, result);
    }

    fn execute_migration(
        &self,
        current_database: &Path,
        task: &StorageMigrationTask,
    ) -> Result<StorageMigrationStatus, StorageError> {
        database::ensure_idle(current_database)?;
        let source = PathBuf::from(&task.source_root);
        let destination = PathBuf::from(&task.destination_root);
        let source_database = source.join("projects").join("siaovplay.db");
        let skip_database =
            (task.area == StorageArea::AppData).then_some(source_database.as_path());
        let cancelled = self.cancel_flag()?;
        let entries = if task.mode == StorageMigrationMode::Copy {
            self.scan_migration_files(&source, skip_database, &cancelled)?
        } else {
            Vec::new()
        };
        let mut verified = migration_copy::copy_and_verify(&entries, &destination, &cancelled, |bytes, files| {
            self.update_progress(bytes, files)
        })?;
        if cancelled.load(Ordering::Relaxed) {
            return Err(StorageError::MigrationCancelled);
        }
        match task.area {
            StorageArea::AppData => {
                let destination_database = destination.join("projects").join("siaovplay.db");
                database::backup_database(&source_database, &destination_database, || cancelled.load(Ordering::Relaxed))?;
                database::rewrite_managed_paths(
                    &destination_database,
                    StorageArea::AppData,
                    &source,
                    &destination,
                )?;
                verified.push(super::migration_receipt::VerifiedFile::database(&destination, &cancelled)?);
                let receipt = self.persist_migration_receipt(task, verified, &cancelled)?;
                self.update_progress(task.bytes_to_copy, task.file_count)?;
                self.commit_app_data_destination(task, receipt)?;
                Ok(StorageMigrationStatus::RestartRequired)
            }
            StorageArea::RemoteMedia | StorageArea::MediaCache => {
                let receipt = self.persist_migration_receipt(task, verified, &cancelled)?;
                self.commit_destination(current_database, task, receipt)?;
                Ok(StorageMigrationStatus::Completed)
            }
        }
    }

    fn persist_migration_receipt(&self, task: &StorageMigrationTask, files: Vec<super::migration_receipt::VerifiedFile>, cancelled: &AtomicBool) -> Result<super::migration_receipt::ReceiptReference, StorageError> {
        let bootstrap = self.read_state()?.settings_path.parent().map(Path::to_path_buf)
            .ok_or_else(|| StorageError::InvalidPath("启动配置目录缺失".to_owned()))?;
        super::migration_receipt::persist(&bootstrap, task, files, cancelled)
    }

    fn scan_migration_files(&self, source: &Path, database: Option<&Path>, cancelled: &AtomicBool) -> Result<Vec<migration_copy::CopyEntry>, StorageError> {
        let bootstrap = self.read_state()?.settings_path.parent().map(Path::to_path_buf)
            .ok_or_else(|| StorageError::InvalidPath("启动配置目录缺失".to_owned()))?;
        super::migration_scope::scan(source, database, &bootstrap, cancelled)
    }

    fn source_root(&self, area: StorageArea) -> Result<PathBuf, StorageError> {
        match area {
            StorageArea::AppData => {
                let state = self.read_state()?;
                if state.environment_app_data_root.is_some() {
                    return Err(StorageError::EnvironmentLocked);
                }
                Ok(active_app_data_root(&state))
            }
            StorageArea::RemoteMedia => self.remote_media_root(),
            StorageArea::MediaCache => self.media_cache_root(),
        }
    }

    fn commit_app_data_destination(&self, task: &StorageMigrationTask, receipt: super::migration_receipt::ReceiptReference) -> Result<(), StorageError> {
        let runtime = self.migration.lock().map_err(|_| StorageError::StatePoisoned)?;
        if runtime.task.as_ref().is_none_or(|current| current.id != task.id
            || current.area != StorageArea::AppData || current.status != StorageMigrationStatus::Running
            || current.source_root != task.source_root || current.destination_root != task.destination_root) {
            return Err(StorageError::MigrationNotFound);
        }
        // Keep cancellation and final settings publication under the same task lock.
        if runtime.cancelled.load(Ordering::Relaxed) { return Err(StorageError::MigrationCancelled); }
        let mut state = self.write_state()?;
        let mut next = state.settings.clone();
        next.pending_app_data_root = Some(task.destination_root.clone());
        next.pending_app_data_receipt = Some(receipt);
        next.revision = next.revision.saturating_add(1);
        persist_settings(&state.settings_path, &next)?;
        state.settings = next;
        Ok(())
    }

    fn update_progress(&self, bytes: u64, files: usize) -> Result<(), StorageError> {
        let mut runtime = self
            .migration
            .lock()
            .map_err(|_| StorageError::StatePoisoned)?;
        let path = runtime.path.clone();
        let task = runtime
            .task
            .as_mut()
            .ok_or(StorageError::MigrationNotFound)?;
        task.copied_bytes = bytes;
        task.verified_file_count = files;
        task.updated_at_ms = now_ms()?;
        persist_task(&path, task)
    }

    fn cancel_flag(&self) -> Result<Arc<AtomicBool>, StorageError> {
        let runtime = self
            .migration
            .lock()
            .map_err(|_| StorageError::StatePoisoned)?;
        Ok(Arc::clone(&runtime.cancelled))
    }

    fn finish_task(
        &self,
        task_id: &str,
        result: Result<StorageMigrationStatus, StorageError>,
    ) -> Result<(), StorageError> {
        let mut runtime = self
            .migration
            .lock()
            .map_err(|_| StorageError::StatePoisoned)?;
        let path = runtime.path.clone();
        let task = runtime
            .task
            .as_mut()
            .filter(|task| task.id == task_id)
            .ok_or(StorageError::MigrationNotFound)?;
        match result {
            Ok(status) => task.status = status,
            Err(StorageError::MigrationCancelled) => {
                task.status = StorageMigrationStatus::Cancelled
            }
            Err(error) => {
                task.status = StorageMigrationStatus::Failed;
                task.error_code = Some(error.code().to_owned());
                task.error_message = Some(error.to_string());
            }
        }
        task.updated_at_ms = now_ms()?;
        let keep_owner = task.status == StorageMigrationStatus::RestartRequired
            || self.state.read().map_err(|_| StorageError::StatePoisoned)?.settings.pending_migration_commit.is_some();
        let persisted = persist_task(&path, task);
        if !keep_owner { runtime.database_owner = None; }
        persisted
    }
}

fn validate_root_pair(source: &Path, destination: &Path) -> Result<(), StorageError> {
    let source = if source.exists() {
        dunce::canonicalize(source)?
    } else {
        source.to_path_buf()
    };
    if source == destination || source.starts_with(destination) || destination.starts_with(&source)
    {
        return Err(StorageError::InvalidPath(
            "迁移目标不能与来源相同，也不能互相嵌套".to_owned(),
        ));
    }
    Ok(())
}

fn ensure_empty_directory(path: &Path) -> Result<(), StorageError> {
    if fs::read_dir(path)?.next().is_some() {
        return Err(StorageError::DestinationNotEmpty(path_string(path)));
    }
    Ok(())
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
#[path = "migration_cancel_tests.rs"]
mod cancel_tests;
