use std::fs;
use crate::store::ProjectStore;
use super::*;

#[test]
fn cache_cleanup_cannot_delete_source_of_running_storage_migration() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("app");
    let destination = directory.path().join("destination");
    fs::create_dir_all(&destination).unwrap();
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
    let cache = root.join("media-cache").join("proxy.mp4");
    fs::create_dir_all(cache.parent().unwrap()).unwrap();
    fs::write(&cache, b"migration source must survive").unwrap();
    let task = manager.prepare_migration(PrepareStorageMigrationInput {
        area: StorageArea::MediaCache, mode: StorageMigrationMode::Copy,
        destination_directory: destination.to_string_lossy().into_owned(),
    }).unwrap();
    manager.migration.lock().unwrap().task.as_mut().unwrap().status = StorageMigrationStatus::Running;
    assert!(matches!(maintenance::clear_playback_cache(&manager, store.database_path(), true), Err(StorageError::MigrationBusy)));
    assert_eq!(fs::read(&cache).unwrap(), b"migration source must survive");
    assert_eq!(manager.get_migration(&task.id).unwrap().status, StorageMigrationStatus::Running);
    // After the worker reaches a terminal state the same explicit cleanup can proceed.
    manager.migration.lock().unwrap().task.as_mut().unwrap().status = StorageMigrationStatus::Cancelled;
    let cleaned = maintenance::clear_playback_cache(&manager, store.database_path(), true).unwrap();
    assert_eq!(cleaned.reclaimed_bytes, b"migration source must survive".len() as u64);
    assert!(!cache.exists());
}
