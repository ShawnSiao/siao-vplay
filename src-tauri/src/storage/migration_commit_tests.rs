use std::{fs, thread, time::Duration};
use crate::store::ProjectStore;
use super::*;

fn assert_failed_commit_preserves_references(area: StorageArea) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("app");
    let destination = dir.path().join("destination");
    fs::create_dir_all(&destination).unwrap();
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
    let media = root.join("remote-media/sample/source.mp4");
    let poster = root.join("media-cache/sample/poster.jpg");
    fs::create_dir_all(media.parent().unwrap()).unwrap();
    fs::create_dir_all(poster.parent().unwrap()).unwrap();
    fs::write(&media, b"authorized isolated test bytes").unwrap();
    fs::write(&poster, b"isolated poster bytes").unwrap();
    let project = store.create_remote_project(&media, "https://example.com/fixture", "source.mp4", None).unwrap();
    let original_locator = store.get_project(&project.id).unwrap().media_source.locator;
    let connection = rusqlite::Connection::open(store.database_path()).unwrap();
    connection.execute("UPDATE media_sources SET poster_path = ?1", [poster.to_string_lossy().as_ref()]).unwrap();
    let task = manager.prepare_migration(PrepareStorageMigrationInput {
        area,
        mode: if area == StorageArea::MediaCache { StorageMigrationMode::Rebuild } else { StorageMigrationMode::Copy },
        destination_directory: destination.to_string_lossy().into_owned(),
    }).unwrap();
    manager.write_state().unwrap().settings_path = dir.path().join("missing/settings.json");
    manager.start_migration(store.database_path().to_path_buf(), StartStorageMigrationInput {
        task_id: task.id.clone(), confirmed: true,
    }).unwrap();
    for _ in 0..300 {
        if manager.get_migration(&task.id).unwrap().status != StorageMigrationStatus::Running { break; }
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(manager.get_migration(&task.id).unwrap().status, StorageMigrationStatus::Failed);
    assert_eq!(manager.get_settings().unwrap().revision, 1);
    assert_eq!(fs::read(&media).unwrap(), b"authorized isolated test bytes");
    assert_eq!(fs::read(&poster).unwrap(), b"isolated poster bytes");
    if area == StorageArea::RemoteMedia {
        assert_eq!(store.get_project(&project.id).unwrap().media_source.locator, original_locator);
    } else {
        let stored: Option<String> = connection.query_row("SELECT poster_path FROM media_sources", [], |row| row.get(0)).unwrap();
        assert_eq!(stored.as_deref(), Some(poster.to_string_lossy().as_ref()));
    }
}

#[test]
fn failed_remote_commit_does_not_publish_database_paths() { assert_failed_commit_preserves_references(StorageArea::RemoteMedia); }
#[test]
fn failed_cache_commit_does_not_delete_database_references() { assert_failed_commit_preserves_references(StorageArea::MediaCache); }
