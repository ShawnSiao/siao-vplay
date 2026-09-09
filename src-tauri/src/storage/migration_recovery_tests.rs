use std::{fs, path::Path};
use super::{*, migration_state::{load_migration_runtime, persist_task}};

fn fixture(root: &Path) -> StorageMigrationTask {
    let app = root.join("app");
    let destination = root.join("destination");
    fs::create_dir_all(&destination).unwrap();
    StorageManager::initialize(&app, app.clone(), None).unwrap()
        .prepare_migration(PrepareStorageMigrationInput {
            area: StorageArea::MediaCache, mode: StorageMigrationMode::Rebuild,
            destination_directory: destination.to_string_lossy().into_owned(),
        }).unwrap()
}

#[test]
fn migration_record_directory_is_never_adopted_or_moved() {
    let dir = tempfile::tempdir().unwrap();
    let task = fixture(dir.path());
    let bootstrap = dir.path().join("isolated");
    let path = bootstrap.join("storage-migration.json");
    fs::create_dir_all(&path).unwrap();
    fs::write(path.join("owned.txt"), b"keep").unwrap();
    assert!(load_migration_runtime(&bootstrap, &bootstrap).is_err());
    assert!(persist_task(&path, &task).is_err());
    assert_eq!(fs::read(path.join("owned.txt")).unwrap(), b"keep");
    assert_eq!(fs::read_dir(&bootstrap).unwrap().count(), 1);
}

#[test]
fn interrupted_legacy_record_is_recovered_without_adopting_partial_candidate() {
    let dir = tempfile::tempdir().unwrap();
    let mut task = fixture(dir.path());
    task.status = StorageMigrationStatus::Running;
    let bootstrap = dir.path().join("isolated");
    fs::create_dir_all(&bootstrap).unwrap();
    let backup = bootstrap.join(".storage-migration.json.0123456789abcdef0123456789abcdef.previous");
    let bytes = serde_json::to_vec(&task).unwrap();
    fs::write(&backup, &bytes).unwrap();
    fs::write(bootstrap.join(".storage-migration.json.unfinished.part"), b"incomplete").unwrap();
    let recovered = load_migration_runtime(&bootstrap, &bootstrap).unwrap().task.unwrap();
    assert_eq!(recovered.id, task.id);
    assert_eq!(recovered.status, StorageMigrationStatus::Interrupted);
    assert_eq!(fs::read(&backup).unwrap(), bytes);
    let persisted: StorageMigrationTask = serde_json::from_slice(&fs::read(bootstrap.join("storage-migration.json")).unwrap()).unwrap();
    assert_eq!(persisted.status, StorageMigrationStatus::Interrupted);
}

#[test]
fn ambiguous_or_corrupt_legacy_records_fail_closed() {
    let dir = tempfile::tempdir().unwrap();
    let task = fixture(dir.path());
    let bootstrap = dir.path().join("isolated");
    fs::create_dir_all(&bootstrap).unwrap();
    let first = bootstrap.join(".storage-migration.json.0123456789abcdef0123456789abcdef.previous");
    fs::write(&first, b"corrupt").unwrap();
    assert!(load_migration_runtime(&bootstrap, &bootstrap).is_err());
    fs::write(&first, serde_json::to_vec(&task).unwrap()).unwrap();
    fs::write(bootstrap.join(".storage-migration.json.1123456789abcdef0123456789abcdef.previous"), serde_json::to_vec(&task).unwrap()).unwrap();
    assert!(load_migration_runtime(&bootstrap, &bootstrap).is_err());
    assert!(!bootstrap.join("storage-migration.json").exists());
}

#[test]
fn valid_main_record_wins_and_replacement_leaves_no_side_files() {
    let dir = tempfile::tempdir().unwrap();
    let task = fixture(dir.path());
    let bootstrap = dir.path().join("isolated");
    fs::create_dir_all(&bootstrap).unwrap();
    let path = bootstrap.join("storage-migration.json");
    persist_task(&path, &task).unwrap();
    persist_task(&path, &task).unwrap();
    assert_eq!(fs::read_dir(&bootstrap).unwrap().count(), 1);
    fs::write(bootstrap.join(".storage-migration.json.0123456789abcdef0123456789abcdef.previous"), b"corrupt").unwrap();
    assert_eq!(load_migration_runtime(&bootstrap, &bootstrap).unwrap().task.unwrap().id, task.id);
}
