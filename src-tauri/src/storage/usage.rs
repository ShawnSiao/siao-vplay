use std::sync::{Arc, Mutex};
use super::{StorageError, StorageManager, StorageMigrationStatus, migration_state::MigrationRuntime};

#[derive(Clone)]
pub(crate) struct StorageLease {
    _owner: Arc<Owner>,
}
struct Owner(Arc<Mutex<MigrationRuntime>>);
impl Drop for Owner {
    fn drop(&mut self) {
        let mut runtime = self.0.lock().unwrap_or_else(|error| error.into_inner());
        runtime.users -= 1;
    }
}
impl StorageManager {
    pub(crate) fn acquire_usage(&self) -> Result<StorageLease, StorageError> {
        let mut runtime = self.migration.lock().map_err(|_| StorageError::StatePoisoned)?;
        if runtime.task.as_ref().is_some_and(|task| task.status == StorageMigrationStatus::Running) {
            return Err(StorageError::MigrationBusy);
        }
        if self.read_state()?.settings.pending_app_data_root.is_some() { return Err(StorageError::MigrationBusy); }
        runtime.users += 1;
        Ok(StorageLease { _owner: Arc::new(Owner(self.migration.clone())) })
    }
}

#[cfg(test)]
mod tests {
    use crate::{store::ProjectStore, storage::*};
    use std::fs;
    #[test]
    fn worker_lease_blocks_migration_and_cleanup_until_last_owner_finishes() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("app");
        let destination = directory.path().join("destination");
        fs::create_dir_all(&destination).unwrap();
        let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
        let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
        let task = manager.prepare_migration(PrepareStorageMigrationInput { area: StorageArea::MediaCache, mode: StorageMigrationMode::Rebuild, destination_directory: destination.to_string_lossy().into_owned() }).unwrap();
        let lease = manager.acquire_usage().unwrap();
        let worker_lease = lease.clone();
        let (release, wait) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || { let _lease = worker_lease; wait.recv().unwrap(); });
        drop(lease);
        assert!(matches!(manager.start_migration(store.database_path().to_path_buf(), StartStorageMigrationInput { task_id: task.id.clone(), confirmed: true }), Err(StorageError::MigrationBusy)));
        assert!(matches!(maintenance::clear_playback_cache(&manager, store.database_path(), true), Err(StorageError::MigrationBusy)));
        assert!(matches!(manager.save_settings(SaveStorageSettingsInput {
            expected_revision: 1, remote_media_root: None, media_cache_root: None,
            default_subtitle_export_directory: None, default_video_report_export_directory: None,
        }), Err(StorageError::MigrationBusy)));
        release.send(()).unwrap();
        worker.join().unwrap();
        assert_eq!(manager.migration.lock().unwrap().users, 0);
        manager.migration.lock().unwrap().task.as_mut().unwrap().status = StorageMigrationStatus::Running;
        assert!(matches!(manager.acquire_usage(), Err(StorageError::MigrationBusy)));
        manager.migration.lock().unwrap().task.as_mut().unwrap().status = StorageMigrationStatus::Cancelled;
        assert!(manager.acquire_usage().is_ok());
        manager.start_migration(store.database_path().to_path_buf(), StartStorageMigrationInput { task_id: task.id.clone(), confirmed: true }).unwrap();
        for _ in 0..300 {
            if manager.get_migration(&task.id).unwrap().status != StorageMigrationStatus::Running { break; }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert_eq!(manager.get_migration(&task.id).unwrap().status, StorageMigrationStatus::Completed);
    }
}
