use std::fs;
use crate::store::ProjectStore;
use super::*;

#[test]
fn cache_cleanup_preserves_untracked_user_files() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("app");
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
    let cache = root.join("media-cache");
    fs::create_dir_all(cache.join("personal")).unwrap();
    let user_file = cache.join("personal/notes.txt");
    fs::write(&user_file, b"user asset").unwrap();
    let result = maintenance::clear_playback_cache(&manager, store.database_path(), true).unwrap();
    assert_eq!(fs::read(&user_file).unwrap(), b"user asset");
    assert_eq!(result.reclaimed_bytes, 0);
}

#[test]
fn cache_cleanup_cannot_delete_source_of_running_storage_migration() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("app");
    let destination = directory.path().join("destination");
    fs::create_dir_all(&destination).unwrap();
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
    let media = root.join("source.mp4");
    fs::write(&media, b"source").unwrap();
    let project = store.create_remote_project(&media, "https://example.com/fixture", "source.mp4", None).unwrap();
    let cache = root.join("media-cache").join(&project.id).join("poster-aaaaaaaaaaaaaaaa.jpg");
    let connection = rusqlite::Connection::open(store.database_path()).unwrap();
    connection.execute("UPDATE media_sources SET poster_path = ?1, source_sha256 = ?2", rusqlite::params![cache.to_string_lossy(), "a".repeat(64)]).unwrap();
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
