use super::*;
use std::fs;

fn interrupted_settings(directory: &std::path::Path, suffix: &str) -> std::path::PathBuf {
    let backup = directory.join(format!(".storage-settings.json.{suffix}.previous"));
    let mut settings = super::model::StorageSettingsFile::default();
    settings.revision = 8;
    fs::write(&backup, serde_json::to_vec(&settings).unwrap()).unwrap();
    backup
}

#[test]
fn interrupted_replacement_restores_committed_settings_instead_of_defaults() {
    let directory = tempfile::tempdir().unwrap();
    let backup = interrupted_settings(directory.path(), &"a".repeat(32));
    let before = fs::read(&backup).unwrap();
    let partial = directory.path().join(format!(".storage-settings.json.{}.part", "a".repeat(32)));
    fs::write(&partial, b"unfinished candidate").unwrap();
    let data = directory.path().join("data");
    let manager = StorageManager::initialize(directory.path(), data.clone(), None).unwrap();
    assert_eq!(manager.get_settings().unwrap().revision, 8);
    assert_eq!(fs::read(&backup).unwrap(), before);
    assert_eq!(fs::read(&partial).unwrap(), b"unfinished candidate");
    let reopened = StorageManager::initialize(directory.path(), data, None).unwrap();
    assert_eq!(reopened.get_settings().unwrap().revision, 8);
    assert!(directory.path().join("storage-settings.json").is_file());
}

#[test]
fn ambiguous_or_corrupt_recovery_never_selects_default_settings() {
    for ambiguous in [false, true] {
        let directory = tempfile::tempdir().unwrap();
        let first = interrupted_settings(directory.path(), &"a".repeat(32));
        if ambiguous { interrupted_settings(directory.path(), &"b".repeat(32)); }
        else { fs::write(&first, b"damaged settings").unwrap(); }
        assert!(StorageManager::initialize(directory.path(), directory.path().join("data"), None).is_err());
        assert!(!directory.path().join("storage-settings.json").exists());
        assert!(first.exists());
    }
}


#[test]
fn active_settings_take_precedence_over_old_recovery_materials() {
    let directory = tempfile::tempdir().unwrap();
    let backup = interrupted_settings(directory.path(), &"a".repeat(32));
    let path = directory.path().join("storage-settings.json");
    let mut active = super::model::StorageSettingsFile::default();
    active.revision = 12;
    super::settings_io::persist_settings(&path, &active).unwrap();
    fs::write(&backup, b"old corrupt backup").unwrap();
    assert_eq!(super::settings_io::load_settings(&path).unwrap().revision, 12);
    active.revision = 13;
    super::settings_io::persist_settings(&path, &active).unwrap();
    assert_eq!(super::settings_io::load_settings(&path).unwrap().revision, 13);
    assert_eq!(fs::read(&backup).unwrap(), b"old corrupt backup");
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
}

#[test]
fn future_recovery_version_is_preserved_without_activation() {
    let directory = tempfile::tempdir().unwrap();
    let backup = interrupted_settings(directory.path(), &"a".repeat(32));
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&backup).unwrap()).unwrap();
    value["version"] = serde_json::json!(999);
    let bytes = serde_json::to_vec(&value).unwrap();
    fs::write(&backup, &bytes).unwrap();
    assert!(StorageManager::initialize(directory.path(), directory.path().join("data"), None).is_err());
    assert_eq!(fs::read(&backup).unwrap(), bytes);
    assert!(!directory.path().join("storage-settings.json").exists());
}
