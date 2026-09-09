use std::{fs, path::Path, thread, time::Duration};

use crate::{domain::CreateLocalProjectInput, store::ProjectStore};

use super::*;

#[cfg(windows)]
#[test]
fn app_data_migration_retains_live_webview_data_at_bootstrap() {
    use std::os::windows::fs::OpenOptionsExt;
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("app");
    let destination = directory.path().join("destination");
    fs::create_dir(&destination).unwrap();
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
    let profile = root.join("EBWebView/Default");
    fs::create_dir_all(&profile).unwrap();
    let preferences = profile.join("Preferences");
    fs::write(&preferences, b"retained browser preferences").unwrap();
    fs::write(root.join("asset.txt"), b"user asset").unwrap();
    let held = fs::OpenOptions::new().read(true).share_mode(0).open(&preferences).unwrap();
    let task = prepare(&manager, StorageArea::AppData, &destination, StorageMigrationMode::Copy);
    manager.start_migration(store.database_path().to_path_buf(), StartStorageMigrationInput { task_id: task.id.clone(), confirmed: true }).unwrap();
    let completed = wait_for_task(&manager, &task.id);
    drop(held);
    assert_eq!(completed.status, StorageMigrationStatus::RestartRequired, "{:?}", completed.error_message);
    assert!(!destination.join("EBWebView").exists());
    assert_eq!(fs::read(preferences).unwrap(), b"retained browser preferences");
    assert_eq!(fs::read(destination.join("asset.txt")).unwrap(), b"user asset");
}

fn wait_for_task(manager: &StorageManager, task_id: &str) -> StorageMigrationTask {
    for _ in 0..200 {
        let task = manager.get_migration(task_id).unwrap();
        if !matches!(
            task.status,
            StorageMigrationStatus::Prepared | StorageMigrationStatus::Running
        ) {
            return task;
        }
        thread::sleep(Duration::from_millis(10));
    }
    panic!("storage migration did not complete in time")
}

fn prepare(
    manager: &StorageManager,
    area: StorageArea,
    destination: &Path,
    mode: StorageMigrationMode,
) -> StorageMigrationTask {
    manager
        .prepare_migration(PrepareStorageMigrationInput {
            area,
            destination_directory: destination.to_string_lossy().into_owned(),
            mode,
        })
        .unwrap()
}

#[test]
fn remote_media_migration_updates_database_after_verified_copy() {
    let directory = tempfile::tempdir().unwrap();
    let app_root = directory.path().join("app");
    let destination = directory.path().join("remote-destination");
    fs::create_dir_all(&destination).unwrap();
    let manager = StorageManager::initialize(&app_root, app_root.clone(), None).unwrap();
    let store = ProjectStore::open(app_root.join("projects/siaovplay.db")).unwrap();
    let source = app_root.join("remote-media/project/source.mp4");
    fs::create_dir_all(source.parent().unwrap()).unwrap();
    fs::write(&source, b"remote-media").unwrap();
    let project = store
        .create_remote_project(&source, "https://example.com/video", "source.mp4", None)
        .unwrap();

    let task = prepare(
        &manager,
        StorageArea::RemoteMedia,
        &destination,
        StorageMigrationMode::Copy,
    );
    manager
        .start_migration(
            store.database_path().to_path_buf(),
            StartStorageMigrationInput {
                task_id: task.id.clone(),
                confirmed: true,
            },
        )
        .unwrap();
    let completed = wait_for_task(&manager, &task.id);
    assert_eq!(completed.status, StorageMigrationStatus::Completed);
    assert!(source.exists());
    let migrated = store.get_project(&project.id).unwrap();
    assert!(Path::new(&migrated.media_source.locator).starts_with(&destination));
    assert!(Path::new(&migrated.media_source.locator).is_file());
}

#[test]
fn cache_rebuild_switches_root_without_copying_or_deleting_old_cache() {
    let directory = tempfile::tempdir().unwrap();
    let app_root = directory.path().join("app");
    let destination = directory.path().join("cache-destination");
    fs::create_dir_all(&destination).unwrap();
    let manager = StorageManager::initialize(&app_root, app_root.clone(), None).unwrap();
    let store = ProjectStore::open(app_root.join("projects/siaovplay.db")).unwrap();
    let old_cache = app_root.join("media-cache/old-proxy.mp4");
    fs::create_dir_all(old_cache.parent().unwrap()).unwrap();
    fs::write(&old_cache, b"cache").unwrap();

    let task = prepare(
        &manager,
        StorageArea::MediaCache,
        &destination,
        StorageMigrationMode::Rebuild,
    );
    manager
        .start_migration(
            store.database_path().to_path_buf(),
            StartStorageMigrationInput {
                task_id: task.id.clone(),
                confirmed: true,
            },
        )
        .unwrap();
    let completed = wait_for_task(&manager, &task.id);
    assert_eq!(completed.status, StorageMigrationStatus::Completed);
    assert!(old_cache.exists());
    assert_eq!(
        manager.media_cache_root().unwrap(),
        dunce::canonicalize(destination).unwrap()
    );
}

#[test]
fn app_data_migration_switches_only_after_reinitialization() {
    let directory = tempfile::tempdir().unwrap();
    let app_root = directory.path().join("app");
    let destination = directory.path().join("app-destination");
    let local_media = directory.path().join("local.mp4");
    fs::create_dir_all(&destination).unwrap();
    fs::write(&local_media, b"local-media").unwrap();
    let manager = StorageManager::initialize(&app_root, app_root.clone(), None).unwrap();
    let store = ProjectStore::open(app_root.join("projects/siaovplay.db")).unwrap();
    let project = store
        .create_local_project(CreateLocalProjectInput {
            media_path: local_media.to_string_lossy().into_owned(),
            title: Some("Migration fixture".to_owned()),
        })
        .unwrap();
    fs::write(app_root.join("retained-file.txt"), b"retained").unwrap();

    let task = prepare(
        &manager,
        StorageArea::AppData,
        &destination,
        StorageMigrationMode::Copy,
    );
    manager
        .start_migration(
            store.database_path().to_path_buf(),
            StartStorageMigrationInput {
                task_id: task.id.clone(),
                confirmed: true,
            },
        )
        .unwrap();
    let completed = wait_for_task(&manager, &task.id);
    assert_eq!(completed.status, StorageMigrationStatus::RestartRequired);
    assert_eq!(manager.app_data_root().unwrap(), app_root);
    assert!(destination.join("retained-file.txt").is_file());

    drop(store);
    let restarted = StorageManager::initialize(&app_root, app_root.clone(), None).unwrap();
    assert_eq!(
        restarted.app_data_root().unwrap(),
        dunce::canonicalize(&destination).unwrap()
    );
    let migrated_store = ProjectStore::open(destination.join("projects/siaovplay.db")).unwrap();
    assert_eq!(
        migrated_store.get_project(&project.id).unwrap().title,
        "Migration fixture"
    );
    assert_eq!(
        restarted.get_migration(&task.id).unwrap().status,
        StorageMigrationStatus::Completed
    );
}

#[test]
fn running_migration_is_recovered_as_interrupted() {
    let directory = tempfile::tempdir().unwrap();
    let app_root = directory.path().join("app");
    let destination = directory.path().join("destination");
    fs::create_dir_all(&destination).unwrap();
    let manager = StorageManager::initialize(&app_root, app_root.clone(), None).unwrap();
    let mut task = prepare(
        &manager,
        StorageArea::RemoteMedia,
        &destination,
        StorageMigrationMode::Copy,
    );
    task.status = StorageMigrationStatus::Running;
    fs::write(
        app_root.join("storage-migration.json"),
        serde_json::to_vec_pretty(&task).unwrap(),
    )
    .unwrap();
    drop(manager);

    let restarted = StorageManager::initialize(&app_root, app_root.clone(), None).unwrap();
    assert_eq!(
        restarted.get_migration(&task.id).unwrap().status,
        StorageMigrationStatus::Interrupted
    );
}

#[path = "migration_receipt_tests.rs"]
mod receipt_tests;

#[path = "migration_receipt_recovery_tests.rs"]
mod receipt_recovery_tests;

#[path = "migration_library_roundtrip_tests.rs"]
mod library_roundtrip_tests;

#[path = "migration_area_reference_tests.rs"]
mod area_reference_tests;

#[path = "migration_configuration_tests.rs"]
mod configuration_tests;

#[path = "migration_material_tests.rs"]
mod material_tests;
