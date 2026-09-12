use super::*;
use crate::{storage::*, store::ProjectStore};
use std::{fs, thread, time::Duration};
#[test]
fn resource_maintenance_blocks_data_migration_until_worker_finishes() {
    let data = tempfile::tempdir().unwrap();
    let root = data.path().join("app");
    let destination = data.path().join("destination");
    fs::create_dir_all(&destination).unwrap();
    let storage = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let db = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
    let registry = Arc::new(ResourceUsage::default());
    let task = storage.prepare_migration(PrepareStorageMigrationInput { area: StorageArea::AppData,
        mode: StorageMigrationMode::Copy, destination_directory: destination.to_string_lossy().into_owned() }).unwrap();
    let start = || storage.start_migration(db.database_path().to_path_buf(), StartStorageMigrationInput { task_id: task.id.clone(), confirmed: true });
    for scope in [Scope::All, Scope::Policy, Scope::Resource("ffmpeg-cpu".into())] {
        let lease = maintain(&registry, Some(storage.clone()), scope).unwrap();
        assert!(matches!(start(), Err(StorageError::MigrationBusy)), "maintenance must exclude data migration");
        drop(lease);
    }
    let storage_lease = acquire_storage(Some(storage.clone())).unwrap();
    let (release, wait) = std::sync::mpsc::channel();
    let worker = thread::spawn(move || {
        let _storage_lease = storage_lease;
        wait.recv_timeout(Duration::from_secs(10)).unwrap();
    });
    let admission = start();
    release.send(()).unwrap();
    worker.join().unwrap();
    assert!(matches!(admission, Err(StorageError::MigrationBusy)));
    start().unwrap();
    for _ in 0..300 {
        if storage.get_migration(&task.id).unwrap().status != StorageMigrationStatus::Running { break; }
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(storage.get_migration(&task.id).unwrap().status, StorageMigrationStatus::RestartRequired);
    assert!(maintain(&registry, Some(storage.clone()), Scope::All).is_err());
    drop(storage); drop(db);
    let reopened = StorageManager::initialize(&root, root.clone(), None).unwrap();
    assert!(maintain(&registry, Some(reopened), Scope::All).is_ok());
}
