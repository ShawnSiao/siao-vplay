use std::{fs, sync::atomic::Ordering};
use super::*;

#[test]
fn failed_migration_prepare_retains_previous_task_and_cancel_flag() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("app");
    let destination = directory.path().join("destination");
    fs::create_dir_all(&destination).unwrap();
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let input = || PrepareStorageMigrationInput {
        area: StorageArea::MediaCache,
        destination_directory: destination.to_string_lossy().into_owned(),
        mode: StorageMigrationMode::Rebuild,
    };
    let previous = manager.prepare_migration(input()).unwrap();
    let original = fs::read(root.join("storage-migration.json")).unwrap();
    {
        let mut runtime = manager.migration.lock().unwrap();
        runtime.path = root.join("missing/task.json");
        runtime.cancelled.store(true, Ordering::Relaxed);
    }
    assert!(manager.prepare_migration(input()).is_err());
    assert_eq!(manager.current_migration().unwrap().unwrap().id, previous.id);
    assert!(manager.migration.lock().unwrap().cancelled.load(Ordering::Relaxed));
    assert_eq!(fs::read(root.join("storage-migration.json")).unwrap(), original);
}

#[test]
fn failed_migration_start_does_not_publish_running_without_worker() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("app");
    let destination = directory.path().join("destination");
    fs::create_dir_all(&destination).unwrap();
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let task = manager.prepare_migration(PrepareStorageMigrationInput {
        area: StorageArea::MediaCache,
        destination_directory: destination.to_string_lossy().into_owned(),
        mode: StorageMigrationMode::Rebuild,
    }).unwrap();
    let record = root.join("storage-migration.json");
    let original = fs::read(&record).unwrap();
    manager.migration.lock().unwrap().path = root.join("missing/task.json");
    let input = || StartStorageMigrationInput { task_id: task.id.clone(), confirmed: true };
    assert!(manager.start_migration(root.join("projects/siaovplay.db"), input()).is_err());
    assert_eq!(manager.get_migration(&task.id).unwrap().status, StorageMigrationStatus::Prepared);
    assert_eq!(fs::read(&record).unwrap(), original);
    assert_eq!(fs::read_dir(&destination).unwrap().count(), 0);
    manager.migration.lock().unwrap().path = record;
    // A second persistence failure must still be retryable, not MigrationBusy.
    manager.migration.lock().unwrap().path = root.join("missing/retry.json");
    let error = manager.start_migration(root.join("projects/siaovplay.db"), input()).unwrap_err();
    assert!(!matches!(error, StorageError::MigrationBusy));
}
