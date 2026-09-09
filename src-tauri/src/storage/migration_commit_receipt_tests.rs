use super::*;
use crate::storage::{migration_copy, migration_receipt};
use std::sync::atomic::AtomicBool;

pub(super) fn reference(f: &Fixture) -> migration_receipt::ReceiptReference {
    let task = &f.intent.task;
    let files = if task.mode == StorageMigrationMode::Copy {
        let entries = migration_copy::scan_files(Path::new(&task.source_root), None).unwrap();
        migration_copy::copy_and_verify(
            &entries,
            Path::new(&task.destination_root),
            &AtomicBool::new(false),
            |_, _| Ok(()),
        )
        .unwrap()
    } else {
        vec![]
    };
    migration_receipt::persist(&f.root, task, files, &AtomicBool::new(false)).unwrap()
}
fn current_fixture(area: StorageArea, mode: StorageMigrationMode) -> Fixture {
    let mut f = fixture_for(area, mode);
    let reference = reference(&f);
    let mut value = serde_json::to_value(&f.intent).unwrap();
    value["version"] = serde_json::json!(2);
    value["receipt"] = serde_json::to_value(reference).unwrap();
    f.intent = serde_json::from_value(value).unwrap();
    f
}
fn receipt_path(f: &Fixture) -> PathBuf {
    f.root.join(format!(
        "storage-migration.{}.receipt.json",
        f.intent.task.id
    ))
}

#[test]
fn production_commit_binds_receipt_into_database_marker() {
    let f = fixture();
    let receipt = reference(&f);
    let expected = serde_json::to_value(&receipt).unwrap();
    f.manager
        .commit_destination(&f.intent.database, &f.intent.task, receipt)
        .unwrap();
    let marker: String = Connection::open(&f.intent.database)
        .unwrap()
        .query_row(
            "SELECT intent_json FROM storage_migration_commits WHERE task_id=?1",
            [&f.intent.task.id],
            |row| row.get(0),
        )
        .unwrap();
    let marker: serde_json::Value = serde_json::from_str(&marker).unwrap();
    assert_eq!(marker["version"], 2);
    assert_eq!(marker["receipt"], expected);
    assert_eq!(marker["receipt"]["taskId"], f.intent.task.id);
    assert_eq!(marker["receipt"]["sha256"].as_str().unwrap().len(), 64);
}

#[test]
fn versioned_receipt_recovery_covers_all_commit_boundaries() {
    for (area, mode) in [
        (StorageArea::RemoteMedia, StorageMigrationMode::Copy),
        (StorageArea::MediaCache, StorageMigrationMode::Copy),
        (StorageArea::MediaCache, StorageMigrationMode::Rebuild),
    ] {
        for phase in 0..=3 {
            let f = current_fixture(area, mode);
            stage(&f, phase);
            let root = f.root.clone();
            let destination = PathBuf::from(&f.intent.task.destination_root);
            let expected_root = PathBuf::from(if phase == 0 {
                &f.intent.task.source_root
            } else {
                &f.intent.task.destination_root
            });
            let receipt = receipt_path(&f);
            drop(f.store);
            drop(f.manager);
            let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
            assert_eq!(
                manager.get_settings().unwrap().revision,
                if phase == 0 { 1 } else { 2 }
            );
            let selected = if area == StorageArea::RemoteMedia {
                manager.remote_media_root().unwrap()
            } else {
                manager.media_cache_root().unwrap()
            };
            assert_eq!(selected, expected_root);
            assert!(
                manager
                    .read_state()
                    .unwrap()
                    .settings
                    .pending_migration_commit
                    .is_none()
            );
            drop(manager);
            // Settled receipts are historical evidence, not constraints on future writes.
            fs::remove_file(receipt).unwrap();
            fs::write(destination.join("source.mp4"), b"later content").unwrap();
            assert!(StorageManager::initialize(&root, root.clone(), None).is_ok());
        }
    }
}

#[test]
fn committed_recovery_preserves_config_until_verified_content_is_restored() {
    for (area, mode) in [
        (StorageArea::RemoteMedia, StorageMigrationMode::Copy),
        (StorageArea::MediaCache, StorageMigrationMode::Copy),
        (StorageArea::MediaCache, StorageMigrationMode::Rebuild),
    ] {
        for phase in [1, 2] {
            for fault in ["receipt", "content"] {
                if fault == "content" && mode == StorageMigrationMode::Rebuild {
                    continue;
                }
                let f = current_fixture(area, mode);
                stage(&f, phase);
                let receipt = receipt_path(&f);
                let receipt_bytes = fs::read(&receipt).unwrap();
                let name = if area == StorageArea::RemoteMedia {
                    "source.mp4"
                } else {
                    "poster.jpg"
                };
                let asset = Path::new(&f.intent.task.destination_root).join(name);
                let asset_bytes = fs::read(&asset).ok();
                if fault == "receipt" {
                    fs::remove_file(&receipt).unwrap();
                } else {
                    fs::write(&asset, vec![b'x'; asset_bytes.as_ref().unwrap().len()]).unwrap();
                }
                let config = f.root.join("storage-settings.json");
                let before = fs::read(&config).unwrap();
                assert!(f.manager.get_settings().is_err());
                assert_eq!(
                    fs::read(&config).unwrap(),
                    before,
                    "{area:?}/{mode:?}/{phase}/{fault}"
                );
                fs::write(&receipt, receipt_bytes).unwrap();
                if let Some(bytes) = asset_bytes {
                    fs::write(&asset, bytes).unwrap();
                }
                assert_eq!(f.manager.get_settings().unwrap().revision, 2);
                assert!(
                    f.manager
                        .read_state()
                        .unwrap()
                        .settings
                        .pending_migration_commit
                        .is_none()
                );
            }
        }
    }
}

#[test]
fn missing_binding_is_not_accepted_as_legacy_when_intent_version_is_two() {
    let mut f = current_fixture(StorageArea::RemoteMedia, StorageMigrationMode::Copy);
    let mut value = serde_json::to_value(&f.intent).unwrap();
    value.as_object_mut().unwrap().remove("receipt");
    f.intent = serde_json::from_value(value).unwrap();
    stage(&f, 1);
    let path = f.root.join("storage-settings.json");
    let before = fs::read(&path).unwrap();
    assert!(f.manager.get_settings().is_err());
    assert_eq!(fs::read(path).unwrap(), before);
}

#[test]
fn a_valid_receipt_from_another_task_cannot_authorize_recovery() {
    let mut f = current_fixture(StorageArea::RemoteMedia, StorageMigrationMode::Copy);
    let mut other = f.intent.task.clone();
    other.id = uuid::Uuid::new_v4().to_string();
    let entries = migration_copy::scan_files(Path::new(&other.source_root), None).unwrap();
    let files = migration_copy::copy_and_verify(
        &entries,
        Path::new(&other.destination_root),
        &AtomicBool::new(false),
        |_, _| Ok(()),
    )
    .unwrap();
    let reference =
        migration_receipt::persist(&f.root, &other, files, &AtomicBool::new(false)).unwrap();
    let mut value = serde_json::to_value(&f.intent).unwrap();
    value["receipt"] = serde_json::to_value(reference).unwrap();
    f.intent = serde_json::from_value(value).unwrap();
    assert!(
        f.manager
            .commit_destination(
                &f.intent.database,
                &f.intent.task,
                f.intent.receipt.clone().unwrap()
            )
            .is_err()
    );
    assert!(
        f.manager
            .read_state()
            .unwrap()
            .settings
            .pending_migration_commit
            .is_none()
    );
    let locator: String = Connection::open(&f.intent.database)
        .unwrap()
        .query_row("SELECT locator FROM media_sources", [], |row| row.get(0))
        .unwrap();
    assert_eq!(locator, f.original_locator);
    stage(&f, 1);
    let config = f.root.join("storage-settings.json");
    let before = fs::read(&config).unwrap();
    assert!(f.manager.get_settings().is_err());
    assert_eq!(fs::read(config).unwrap(), before);
}

#[test]
fn unsupported_reference_is_preserved_even_before_database_commit() {
    for replacement in [
        serde_json::json!({"version": 99}),
        serde_json::json!({"sha256": "invalid"}),
    ] {
        let mut f = current_fixture(StorageArea::RemoteMedia, StorageMigrationMode::Copy);
        let mut value = serde_json::to_value(&f.intent).unwrap();
        for (key, field) in replacement.as_object().unwrap() {
            value["receipt"][key] = field.clone();
        }
        f.intent = serde_json::from_value(value).unwrap();
        stage(&f, 0);
        let config = f.root.join("storage-settings.json");
        let before = fs::read(&config).unwrap();
        assert!(f.manager.get_settings().is_err());
        assert_eq!(fs::read(config).unwrap(), before);
    }
}

#[test]
fn legacy_marker_encoding_survives_version_two_settings_upgrade() {
    let f = fixture();
    // Exact predecessor encoding: do not add even a null receipt to old markers.
    let legacy = format!(
        r#"{{"version":1,"database":{},"revision":1,"task":{}}}"#,
        serde_json::to_string(&f.intent.database).unwrap(),
        serde_json::to_string(&f.intent.task).unwrap()
    );
    assert_eq!(serde_json::to_string(&f.intent).unwrap(), legacy);
    stage(&f, 1);
    Connection::open(&f.intent.database)
        .unwrap()
        .execute(
            "UPDATE storage_migration_commits SET intent_json=?1",
            [&legacy],
        )
        .unwrap();
    {
        let mut state = f.manager.state.write().unwrap();
        state.settings.version = 2;
        persist_settings(&state.settings_path, &state.settings).unwrap();
    }
    let root = f.root.clone();
    let destination = PathBuf::from(&f.intent.task.destination_root);
    drop(f.store);
    drop(f.manager);
    let reopened = StorageManager::initialize(&root, root.clone(), None).unwrap();
    assert_eq!(reopened.remote_media_root().unwrap(), destination);
    assert_eq!(reopened.get_settings().unwrap().revision, 2);
}
