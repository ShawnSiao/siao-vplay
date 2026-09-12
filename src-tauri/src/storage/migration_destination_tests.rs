use std::{fs, thread, time::Duration};
use crate::store::ProjectStore;
use super::*;

fn wait(manager: &StorageManager, id: &str) -> StorageMigrationTask {
    for _ in 0..300 {
        let task = manager.get_migration(id).unwrap();
        if task.status != StorageMigrationStatus::Running { return task; }
        thread::sleep(Duration::from_millis(10));
    }
    panic!("migration did not terminate");
}

fn failed_destination_write(area: StorageArea) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("app");
    let destination = dir.path().join("destination");
    fs::create_dir_all(&destination).unwrap();
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
    let task = manager.prepare_migration(PrepareStorageMigrationInput {
        area, mode: if area == StorageArea::MediaCache { StorageMigrationMode::Rebuild } else { StorageMigrationMode::Copy },
        destination_directory: destination.to_string_lossy().into_owned(),
    }).unwrap();
    let original = serde_json::to_value(&manager.read_state().unwrap().settings).unwrap();
    let settings_path = manager.read_state().unwrap().settings_path.clone();
    manager.write_state().unwrap().settings_path = dir.path().join("missing/settings.json");
    let input = || StartStorageMigrationInput { task_id: task.id.clone(), confirmed: true };
    manager.start_migration(store.database_path().to_path_buf(), input()).unwrap();
    assert_eq!(wait(&manager, &task.id).status, StorageMigrationStatus::Failed);
    assert_eq!(serde_json::to_value(&manager.read_state().unwrap().settings).unwrap(), original);
    assert!(!settings_path.exists());
    // Retry the same task after restoring persistence; the revision advances only once.
    manager.write_state().unwrap().settings_path = settings_path.clone();
    manager.start_migration(store.database_path().to_path_buf(), input()).unwrap();
    let finished = wait(&manager, &task.id);
    assert_eq!(finished.status, if area == StorageArea::AppData { StorageMigrationStatus::RestartRequired } else { StorageMigrationStatus::Completed });
    let state = manager.read_state().unwrap();
    assert_eq!(state.settings.revision, original["revision"].as_u64().unwrap() + 1);
    let persisted: serde_json::Value = serde_json::from_slice(&fs::read(settings_path).unwrap()).unwrap();
    assert_eq!(persisted, serde_json::to_value(&state.settings).unwrap());
}

#[test]
fn failed_app_destination_write_keeps_settings_retryable() { failed_destination_write(StorageArea::AppData); }
#[test]
fn failed_remote_destination_write_keeps_settings_retryable() { failed_destination_write(StorageArea::RemoteMedia); }
#[test]
fn failed_cache_destination_write_keeps_settings_retryable() { failed_destination_write(StorageArea::MediaCache); }
