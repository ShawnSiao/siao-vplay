use super::*;
use tempfile::tempdir;
fn configuration(root: &Path, profile: &str) -> LocalResourceConfiguration {
    LocalResourceConfiguration { schema_version: CONFIG_SCHEMA_VERSION, selected_parent: path_string(root),
        resource_root: path_string(&root.join(RESOURCE_DIRECTORY_NAME)), preferred_profile: profile.into(),
        active_resources: [("ffmpeg-cpu".into(), "1".into())].into(), legacy_candidate_roots: Vec::new(), proxy_url: None }
}
fn put(path: &Path, configuration: &LocalResourceConfiguration) -> Vec<u8> {
    let bytes = serde_json::to_vec(configuration).unwrap(); fs::write(path, &bytes).unwrap(); bytes
}
#[test]
fn missing_main_recovers_backup_not_uncommitted_part() {
    let root = tempdir().unwrap(); let path = root.path().join(CONFIG_FILE_NAME);
    let old = configuration(root.path(), "standard"); let new = configuration(root.path(), "fast");
    let old_bytes = put(&path.with_extension("json.bak"), &old);
    let new_bytes = put(&path.with_extension("json.part"), &new);
    let restored = LocalResourceManager::load(root.path()).unwrap();
    assert_eq!(restored.configuration, Some(old)); assert_eq!(fs::read(&path).unwrap(), old_bytes);
    assert_eq!(fs::read(path.with_extension("json.part")).unwrap(), new_bytes);
}
#[test]
fn missing_main_recovers_valid_backup_without_part() {
    let root = tempdir().unwrap(); let path = root.path().join(CONFIG_FILE_NAME);
    let old = configuration(root.path(), "fast"); put(&path.with_extension("json.bak"), &old);
    assert_eq!(LocalResourceManager::load(root.path()).unwrap().configuration, Some(old));
    assert!(path.is_file());
}
#[test]
fn interrupted_initial_write_recovers_valid_part() {
    let root = tempdir().unwrap(); let path = root.path().join(CONFIG_FILE_NAME);
    let initial = configuration(root.path(), "fast"); let bytes = put(&path.with_extension("json.part"), &initial);
    assert_eq!(LocalResourceManager::load(root.path()).unwrap().configuration, Some(initial));
    assert_eq!(fs::read(path).unwrap(), bytes);
}
#[test]
fn corrupt_or_future_backup_is_not_skipped_for_a_part() {
    for future in [false, true] {
        let root = tempdir().unwrap(); let path = root.path().join(CONFIG_FILE_NAME);
        let mut value = configuration(root.path(), "standard"); value.schema_version += 1;
        let bytes = if future { serde_json::to_vec(&value).unwrap() } else { b"broken".to_vec() };
        fs::write(path.with_extension("json.bak"), &bytes).unwrap();
        let part = put(&path.with_extension("json.part"), &configuration(root.path(), "fast"));
        assert!(LocalResourceManager::load(root.path()).is_err()); assert!(!path.exists());
        assert_eq!(fs::read(path.with_extension("json.bak")).unwrap(), bytes);
        assert_eq!(fs::read(path.with_extension("json.part")).unwrap(), part);
    }
}
#[test]
fn corrupt_part_and_non_file_main_do_not_become_first_run() {
    for directory in [false, true] {
        let root = tempdir().unwrap(); let path = root.path().join(CONFIG_FILE_NAME);
        if directory { fs::create_dir(&path).unwrap(); fs::write(path.join("retained"), b"keep").unwrap(); }
        else { fs::write(path.with_extension("json.part"), b"broken").unwrap(); }
        assert!(LocalResourceManager::load(root.path()).is_err());
        if directory { assert_eq!(fs::read(path.join("retained")).unwrap(), b"keep"); }
        else { assert_eq!(fs::read(path.with_extension("json.part")).unwrap(), b"broken"); }
    }
}
#[test]
fn committed_main_wins_and_invalid_main_never_downgrades() {
    for valid in [false, true] {
        let root = tempdir().unwrap(); let path = root.path().join(CONFIG_FILE_NAME);
        let main = configuration(root.path(), "fast");
        let bytes = if valid { put(&path, &main) } else { fs::write(&path, b"broken").unwrap(); b"broken".to_vec() };
        let backup = put(&path.with_extension("json.bak"), &configuration(root.path(), "standard"));
        let result = LocalResourceManager::load(root.path());
        if valid { assert_eq!(result.unwrap().configuration, Some(main)); } else { assert!(result.is_err()); }
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(fs::read(path.with_extension("json.bak")).unwrap(), backup);
    }
}
#[test]
fn only_missing_all_candidates_is_unconfigured() {
    let root = tempdir().unwrap(); assert!(LocalResourceManager::load(root.path()).unwrap().configuration.is_none());
}

#[test]
fn future_main_does_not_downgrade_to_valid_backup() {
    let root = tempdir().unwrap(); let path = root.path().join(CONFIG_FILE_NAME);
    let mut main = configuration(root.path(), "fast"); main.schema_version += 1;
    let bytes = put(&path, &main);
    let backup = put(&path.with_extension("json.bak"), &configuration(root.path(), "standard"));
    assert!(LocalResourceManager::load(root.path()).is_err());
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert_eq!(fs::read(path.with_extension("json.bak")).unwrap(), backup);
}
#[test]
fn invalid_backup_directory_is_preserved_without_using_part() {
    let root = tempdir().unwrap(); let path = root.path().join(CONFIG_FILE_NAME);
    let backup = path.with_extension("json.bak"); fs::create_dir(&backup).unwrap();
    fs::write(backup.join("retained"), b"keep").unwrap();
    let part = put(&path.with_extension("json.part"), &configuration(root.path(), "fast"));
    assert!(LocalResourceManager::load(root.path()).is_err()); assert!(!path.exists());
    assert_eq!(fs::read(backup.join("retained")).unwrap(), b"keep");
    assert_eq!(fs::read(path.with_extension("json.part")).unwrap(), part);
}
