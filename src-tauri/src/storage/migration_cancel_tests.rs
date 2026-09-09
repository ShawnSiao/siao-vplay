use super::*;

fn fixture() -> (tempfile::TempDir, StorageManager, StorageMigrationTask, PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("app");
    let destination = directory.path().join("destination");
    fs::create_dir_all(&destination).unwrap();
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let task = manager.prepare_migration(PrepareStorageMigrationInput {
        area: StorageArea::AppData, mode: StorageMigrationMode::Copy,
        destination_directory: destination.to_string_lossy().into_owned(),
    }).unwrap();
    manager.migration.lock().unwrap().task.as_mut().unwrap().status = StorageMigrationStatus::Running;
    (directory, manager, task, destination)
}

#[test]
fn cancellation_before_app_data_commit_preserves_settings() {
    let (_directory, manager, task, _destination) = fixture();
    let before = serde_json::to_value(&manager.read_state().unwrap().settings).unwrap();
    manager.cancel_migration(&task.id).unwrap();
    assert!(matches!(manager.commit_app_data_destination(&task, receipt(&task)), Err(StorageError::MigrationCancelled)));
    assert_eq!(serde_json::to_value(&manager.read_state().unwrap().settings).unwrap(), before);
    assert!(manager.get_settings().unwrap().pending_app_data_root.is_none());
}

#[test]
fn stale_app_data_worker_cannot_commit_another_task() {
    let (_directory, manager, task, _destination) = fixture();
    manager.migration.lock().unwrap().task.as_mut().unwrap().id = "new-task".to_owned();
    assert!(matches!(manager.commit_app_data_destination(&task, receipt(&task)), Err(StorageError::MigrationNotFound)));
    assert!(manager.get_settings().unwrap().pending_app_data_root.is_none());
    assert_eq!(manager.get_settings().unwrap().revision, 1);
}

#[test]
fn cancellation_after_app_data_commit_does_not_revert_published_root() {
    let (_directory, manager, task, _destination) = fixture();
    manager.commit_app_data_destination(&task, receipt(&task)).unwrap();
    manager.cancel_migration(&task.id).unwrap();
    manager.finish_task(&task.id, Ok(StorageMigrationStatus::RestartRequired)).unwrap();
    assert_eq!(manager.get_settings().unwrap().pending_app_data_root.as_deref(), Some(task.destination_root.as_str()));
    assert_eq!(manager.get_migration(&task.id).unwrap().status, StorageMigrationStatus::RestartRequired);
    assert_eq!(manager.get_settings().unwrap().revision, 2);
}

// These tests isolate the cancellation/identity commit boundary; content verification
// is exercised by migration_receipt_recovery_tests with actual copied files.
fn receipt(task: &StorageMigrationTask) -> super::super::migration_receipt::ReceiptReference {
    serde_json::from_value(serde_json::json!({
        "version": 1, "taskId": task.id, "sha256": "a".repeat(64)
    })).unwrap()
}
