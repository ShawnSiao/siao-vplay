use std::{fs, path::Path};

use super::*;

#[test]
fn owned_startup_locks_shared_data_before_reading_migration_state() {
    let directory = tempfile::tempdir().unwrap();
    let bootstrap = directory.path().join("bootstrap");
    let data = directory.path().join("shared-data");
    fs::create_dir_all(&bootstrap).unwrap();
    fs::write(
        bootstrap.join("storage-migration.json"),
        b"unread migration sentinel",
    )
    .unwrap();
    let _owner = crate::instance_lock::InstanceLock::acquire(&data).unwrap();
    let result = StorageManager::initialize_owned(&bootstrap, data.clone(), Some(data));
    assert!(matches!(result, Err(StorageError::FileSystem(_))));
    assert_eq!(
        fs::read(bootstrap.join("storage-migration.json")).unwrap(),
        b"unread migration sentinel"
    );
}

#[test]
fn migration_does_not_copy_instance_ownership() {
    let directory = tempfile::tempdir().unwrap();
    let _owner = crate::instance_lock::InstanceLock::acquire(directory.path()).unwrap();
    fs::write(directory.path().join("asset.txt"), b"preserve me").unwrap();
    let files = super::migration_copy::scan_files(directory.path(), None).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].relative, Path::new("asset.txt"));
}

fn manager(directory: &Path) -> StorageManager {
    let default_root = directory.join("default-data");
    fs::create_dir_all(&default_root).unwrap();
    StorageManager::initialize(directory, default_root, None).unwrap()
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn save_input(revision: u64) -> SaveStorageSettingsInput {
    SaveStorageSettingsInput {
        expected_revision: revision,
        remote_media_root: None,
        media_cache_root: None,
        default_subtitle_export_directory: None,
        default_video_report_export_directory: None,
    }
}

#[test]
fn defaults_preserve_legacy_layout() {
    let directory = tempfile::tempdir().unwrap();
    let view = manager(directory.path()).get_settings().unwrap();
    assert!(view.remote_media_root.ends_with("remote-media"));
    assert!(view.media_cache_root.ends_with("media-cache"));
    assert_eq!(view.revision, 1);
}

#[test]
fn saves_and_reloads_configured_locations() {
    let directory = tempfile::tempdir().unwrap();
    let media = directory.path().join("media");
    let cache = directory.path().join("cache");
    let exports = directory.path().join("exports");
    for path in [&media, &cache, &exports] {
        fs::create_dir_all(path).unwrap();
    }
    let manager = manager(directory.path());
    let mut input = save_input(1);
    input.remote_media_root = Some(path_string(&media));
    input.media_cache_root = Some(path_string(&cache));
    input.default_subtitle_export_directory = Some(path_string(&exports));
    input.default_video_report_export_directory = Some(path_string(&exports));
    assert_eq!(manager.save_settings(input).unwrap().revision, 2);
    let reloaded = StorageManager::initialize(
        directory.path(),
        directory.path().join("default-data"),
        None,
    )
    .unwrap();
    assert_eq!(
        reloaded.remote_media_root().unwrap(),
        dunce::canonicalize(media).unwrap()
    );
}

#[test]
fn rejects_stale_revisions() {
    let directory = tempfile::tempdir().unwrap();
    let error = manager(directory.path())
        .save_settings(save_input(9))
        .unwrap_err();
    assert!(matches!(error, StorageError::RevisionConflict { .. }));
}

#[test]
fn environment_root_has_precedence() {
    let directory = tempfile::tempdir().unwrap();
    let environment_root = directory.path().join("environment-data");
    fs::create_dir_all(&environment_root).unwrap();
    let manager = StorageManager::initialize(
        directory.path(),
        directory.path().join("default-data"),
        Some(environment_root.clone()),
    )
    .unwrap();
    assert_eq!(manager.app_data_root().unwrap(), environment_root);
    assert!(
        manager
            .get_settings()
            .unwrap()
            .app_data_root_locked_by_environment
    );
}

#[test]
fn missing_custom_root_is_not_recreated_silently() {
    let directory = tempfile::tempdir().unwrap();
    let media = directory.path().join("media");
    let cache = directory.path().join("cache");
    fs::create_dir_all(&media).unwrap();
    fs::create_dir_all(&cache).unwrap();
    let manager = manager(directory.path());
    let mut input = save_input(1);
    input.remote_media_root = Some(path_string(&media));
    input.media_cache_root = Some(path_string(&cache));
    manager.save_settings(input).unwrap();
    fs::remove_dir_all(&media).unwrap();
    assert!(matches!(
        manager.remote_media_root_for_write().unwrap_err(),
        StorageError::RootUnavailable(_)
    ));
    assert!(!media.exists());
}

#[test]
fn managed_roots_with_files_require_migration() {
    let directory = tempfile::tempdir().unwrap();
    let manager = manager(directory.path());
    let current = directory.path().join("default-data/remote-media");
    let destination = directory.path().join("new-media");
    fs::create_dir_all(&current).unwrap();
    fs::create_dir_all(&destination).unwrap();
    fs::write(current.join("source.mp4"), b"media").unwrap();
    let mut input = save_input(1);
    input.remote_media_root = Some(path_string(&destination));
    assert!(matches!(
        manager.save_settings(input).unwrap_err(),
        StorageError::ManagedRootChangeRequiresMigration
    ));
}


#[test]
fn failed_settings_write_keeps_live_revision_and_paths_unchanged() {
    let directory = tempfile::tempdir().unwrap();
    let manager = manager(directory.path());
    let exports = directory.path().join("exports");
    fs::create_dir(&exports).unwrap();
    let before = serde_json::to_value(manager.get_settings().unwrap()).unwrap();
    let actual_path = manager.read_state().unwrap().settings_path.clone();
    // A regular file in place of the parent makes the first write fail without touching user files.
    let blocked = directory.path().join("blocked-parent");
    fs::write(&blocked, b"retain this sentinel").unwrap();
    manager.write_state().unwrap().settings_path = blocked.join("storage-settings.json");
    let mut input = save_input(1);
    input.default_subtitle_export_directory = Some(path_string(&exports));
    assert!(manager.save_settings(input).is_err());
    let after = manager.get_settings().unwrap();
    assert_eq!(after.revision, before["revision"].as_u64().unwrap());
    assert_eq!(after.default_subtitle_export_directory, None);
    assert_eq!(fs::read(&blocked).unwrap(), b"retain this sentinel");
    manager.write_state().unwrap().settings_path = actual_path;
    let mut retry = save_input(1);
    retry.default_subtitle_export_directory = Some(path_string(&exports));
    assert_eq!(manager.save_settings(retry).unwrap().revision, 2);
    let reloaded = StorageManager::initialize(directory.path(), directory.path().join("default-data"), None).unwrap();
    assert_eq!(reloaded.get_settings().unwrap().default_subtitle_export_directory,
        manager.get_settings().unwrap().default_subtitle_export_directory);
}


#[test]
fn settings_save_refuses_an_existing_directory_without_moving_it() {
    let directory = tempfile::tempdir().unwrap();
    let manager = manager(directory.path());
    let target = manager.read_state().unwrap().settings_path.clone();
    fs::create_dir(&target).unwrap();
    fs::write(target.join("sentinel"), b"retain unrelated content").unwrap();
    assert!(manager.save_settings(save_input(1)).is_err());
    assert!(target.is_dir());
    assert_eq!(fs::read(target.join("sentinel")).unwrap(), b"retain unrelated content");
    assert_eq!(manager.get_settings().unwrap().revision, 1);
}
