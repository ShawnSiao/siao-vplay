use std::fs;
use crate::{instance_lock::InstanceLock, store::ProjectStore};
use super::*;

#[test]
fn occupied_pending_root_does_not_promote_or_upgrade_bootstrap_settings() {
    // Zero denotes an unversioned legacy JSON fixture, not a supported version zero.
    for version in [0, 1, 2] {
        let directory = tempfile::tempdir().unwrap();
        let bootstrap = directory.path().join("bootstrap");
        let destination = directory.path().join("destination");
        fs::create_dir_all(&bootstrap).unwrap();
        let store = ProjectStore::open(destination.join("projects/siaovplay.db")).unwrap();
        drop(store);
        let mut settings = model::StorageSettingsFile::default();
        settings.version = version;
        settings.pending_app_data_root = Some(destination.to_string_lossy().into_owned());
        let path = bootstrap.join("storage-settings.json");
        settings_io::persist_settings(&path, &settings).unwrap();
        if version == 0 {
            let mut legacy: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            legacy.as_object_mut().unwrap().remove("version");
            fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
        }
        let original = fs::read(&path).unwrap();
        let owner = InstanceLock::acquire(&destination).unwrap();
        assert!(StorageManager::initialize_owned(&bootstrap, bootstrap.clone(), None).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        drop(owner);
        let (manager, retained_owner) = StorageManager::initialize_owned(&bootstrap, bootstrap.clone(), None).unwrap();
        assert!(retained_owner.is_some());
        assert!(InstanceLock::acquire(&destination).is_err());
        assert_eq!(manager.app_data_root().unwrap(), destination);
        assert_eq!(manager.get_settings().unwrap().revision, 2);
        assert!(manager.get_settings().unwrap().pending_app_data_root.is_none());
        assert_eq!(manager.read_state().unwrap().settings.version, model::settings_version());
    }
}

#[test]
fn unavailable_pending_root_refuses_start_without_creation_or_promotion() {
    let directory = tempfile::tempdir().unwrap();
    let bootstrap = directory.path().join("bootstrap");
    let unavailable = directory.path().join("disconnected");
    fs::create_dir_all(&bootstrap).unwrap();
    let mut settings = model::StorageSettingsFile::default();
    settings.pending_app_data_root = Some(unavailable.to_string_lossy().into_owned());
    let path = bootstrap.join("storage-settings.json");
    settings_io::persist_settings(&path, &settings).unwrap();
    let before = fs::read(&path).unwrap();
    assert!(StorageManager::initialize_owned(&bootstrap, bootstrap.clone(), None).is_err());
    assert!(StorageManager::initialize_owned(&bootstrap, bootstrap.clone(), Some(bootstrap.clone())).is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
    assert!(!unavailable.exists());
}

#[test]
fn failed_target_verification_releases_owner_and_preserves_settings() {
    let directory = tempfile::tempdir().unwrap();
    let bootstrap = directory.path().join("bootstrap");
    let destination = directory.path().join("destination");
    fs::create_dir_all(&bootstrap).unwrap();
    fs::create_dir_all(destination.join("projects")).unwrap();
    let database = destination.join("projects/siaovplay.db");
    fs::write(&database, b"invalid database fixture").unwrap();
    let mut settings = model::StorageSettingsFile::default();
    settings.version = 2; // Exercise the legacy SQLite check, not a missing new receipt.
    settings.pending_app_data_root = Some(destination.to_string_lossy().into_owned());
    let path = bootstrap.join("storage-settings.json");
    settings_io::persist_settings(&path, &settings).unwrap();
    let before = fs::read(&path).unwrap();
    assert!(StorageManager::initialize_owned(&bootstrap, bootstrap.clone(), None).is_err());
    assert_eq!(fs::read(path).unwrap(), before);
    assert_eq!(fs::read(database).unwrap(), b"invalid database fixture");
    assert!(InstanceLock::acquire(&destination).is_ok());
}
