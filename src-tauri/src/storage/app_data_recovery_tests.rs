use std::{fs, thread, time::Duration};
use crate::{domain::CreateLocalProjectInput, store::ProjectStore};
use super::*;

#[test]
fn promoted_app_data_finishes_missing_terminal_receipt() {
    for missing_status in [StorageMigrationStatus::Running, StorageMigrationStatus::Interrupted, StorageMigrationStatus::Failed] {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("app");
        let destination = directory.path().join("destination");
        fs::create_dir_all(&destination).unwrap();
        let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
        let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
        let media = directory.path().join("local.mp4");
        fs::write(&media, b"retain local media").unwrap();
        let project = store.create_local_project(CreateLocalProjectInput { media_path: media.to_string_lossy().into_owned(), title: Some("Retained project".to_owned()) }).unwrap();
        let task = manager.prepare_migration(PrepareStorageMigrationInput { area: StorageArea::AppData, mode: StorageMigrationMode::Copy, destination_directory: destination.to_string_lossy().into_owned() }).unwrap();
        manager.start_migration(store.database_path().to_path_buf(), StartStorageMigrationInput { task_id: task.id.clone(), confirmed: true }).unwrap();
        let mut receipt = manager.get_migration(&task.id).unwrap();
        for _ in 0..300 {
            receipt = manager.get_migration(&task.id).unwrap();
            if receipt.status != StorageMigrationStatus::Running { break; }
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(receipt.status, StorageMigrationStatus::RestartRequired);
        assert!(store.create_local_project(CreateLocalProjectInput { media_path: media.to_string_lossy().into_owned(), title: Some("late write".to_owned()) }).is_err());
        assert!(manager.acquire_usage().is_err());
        receipt.status = missing_status;
        receipt.error_code = Some("old_failure".to_owned());
        receipt.error_message = Some("old failure".to_owned());
        fs::write(root.join("storage-migration.json"), serde_json::to_vec(&receipt).unwrap()).unwrap();
        drop(store);
        drop(manager);
        let reopened = StorageManager::initialize(&root, root.clone(), None).unwrap();
        let settled = reopened.get_migration(&task.id).unwrap();
        assert_eq!(settled.status, StorageMigrationStatus::Completed);
        assert!(!settled.restart_required);
        assert!(settled.error_code.is_none() && settled.error_message.is_none());
        assert_eq!(reopened.app_data_root().unwrap(), dunce::canonicalize(&destination).unwrap());
        let migrated = ProjectStore::open(destination.join("projects/siaovplay.db")).unwrap();
        assert_eq!(migrated.get_project(&project.id).unwrap().title, "Retained project");
        assert_eq!(fs::read(&media).unwrap(), b"retain local media");
        let revision = reopened.get_settings().unwrap().revision;
        assert_eq!(reopened.start_migration(migrated.database_path().to_path_buf(), StartStorageMigrationInput { task_id: task.id, confirmed: true }).unwrap().status, StorageMigrationStatus::Completed);
        assert_eq!(reopened.get_settings().unwrap().revision, revision);
    }
}

#[test]
fn environment_override_is_not_evidence_of_committed_app_data_migration() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("app");
    let destination = directory.path().join("destination");
    fs::create_dir_all(&destination).unwrap();
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let mut task = manager.prepare_migration(PrepareStorageMigrationInput { area: StorageArea::AppData, mode: StorageMigrationMode::Copy, destination_directory: destination.to_string_lossy().into_owned() }).unwrap();
    task.status = StorageMigrationStatus::RestartRequired;
    fs::write(root.join("storage-migration.json"), serde_json::to_vec(&task).unwrap()).unwrap();
    let overridden = StorageManager::initialize(&root, root.clone(), Some(destination)).unwrap();
    assert_eq!(overridden.get_migration(&task.id).unwrap().status, StorageMigrationStatus::RestartRequired);
}
