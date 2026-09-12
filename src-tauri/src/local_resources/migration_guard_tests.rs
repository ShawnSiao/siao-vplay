use super::*;
use crate::{storage::*, store::ProjectStore};
use std::{thread, time::Duration};

#[test]
fn resource_mutation_is_frozen_after_app_data_migration() {
    let data = tempfile::tempdir().unwrap();
    let root = data.path().join("app");
    let destination = data.path().join("destination");
    fs::create_dir_all(&destination).unwrap();
    let storage = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let db = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
    let mut manager = LocalResourceManager::load(&root).unwrap();
    manager.storage = Some(storage.clone());
    manager.mutate(|manager| manager.configure_location(data.path().to_str().unwrap(), true)).unwrap();
    let before = fs::read(&manager.config_path).unwrap();
    let task = storage.prepare_migration(PrepareStorageMigrationInput { area: StorageArea::AppData,
        mode: StorageMigrationMode::Copy, destination_directory: destination.to_string_lossy().into_owned() }).unwrap();
    manager.mutate(|_| {
        assert!(matches!(storage.start_migration(db.database_path().to_path_buf(),
            StartStorageMigrationInput { task_id: task.id.clone(), confirmed: true }), Err(StorageError::MigrationBusy)));
        Ok(())
    }).unwrap();
    storage.start_migration(db.database_path().to_path_buf(), StartStorageMigrationInput { task_id: task.id.clone(), confirmed: true }).unwrap();
    for _ in 0..300 {
        if storage.get_migration(&task.id).unwrap().status != StorageMigrationStatus::Running { break; }
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(storage.get_migration(&task.id).unwrap().status, StorageMigrationStatus::RestartRequired);
    let mut called = false;
    let result = manager.mutate(|manager| { called = true; manager.set_preferred_profile("fast") });
    assert!(result.is_err(), "resource preferences must not save to the old app directory");
    assert!(!called, "freeze must precede recovery and resource side effects");
    assert_eq!(fs::read(&manager.config_path).unwrap(), before);
    assert!(manager.status().is_ok());
    drop(manager); drop(storage); drop(db);
    let storage = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let mut manager = LocalResourceManager::load(&destination).unwrap();
    manager.storage = Some(storage);
    manager.mutate(|manager| manager.set_preferred_profile("fast")).unwrap();
    assert_eq!(manager.configuration.as_ref().unwrap().preferred_profile, "fast");
}
