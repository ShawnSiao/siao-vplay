use super::*;

#[test]
fn pending_app_data_rejects_missing_or_modified_verified_content() {
    for fault in [
        "missing_receipt",
        "missing_binding",
        "changed_receipt",
        "changed_file",
        "missing_file",
        "changed_database",
    ] {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("app");
        let destination = directory.path().join("destination");
        fs::create_dir(&destination).unwrap();
        let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
        let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
        fs::write(root.join("asset.txt"), b"original").unwrap();
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
        assert_eq!(
            wait_for_task(&manager, &task.id).status,
            StorageMigrationStatus::RestartRequired
        );
        let receipt = root.join(format!("storage-migration.{}.receipt.json", task.id));
        let original_receipt = fs::read(&receipt).unwrap();
        let original_database = fs::read(destination.join("projects/siaovplay.db")).unwrap();
        let original_settings = fs::read(root.join("storage-settings.json")).unwrap();
        match fault {
            "missing_receipt" => fs::remove_file(&receipt).unwrap(),
            "missing_binding" => {
                let mut value: serde_json::Value =
                    serde_json::from_slice(&original_settings).unwrap();
                value
                    .as_object_mut()
                    .unwrap()
                    .remove("pendingAppDataReceipt");
                fs::write(
                    root.join("storage-settings.json"),
                    serde_json::to_vec(&value).unwrap(),
                )
                .unwrap();
            }
            "changed_receipt" => {
                let mut value: serde_json::Value =
                    serde_json::from_slice(&fs::read(&receipt).unwrap()).unwrap();
                value["files"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|file| file["relative"] != "asset.txt");
                fs::write(&receipt, serde_json::to_vec(&value).unwrap()).unwrap();
            }
            "changed_file" => fs::write(destination.join("asset.txt"), b"modified").unwrap(),
            "missing_file" => fs::remove_file(destination.join("asset.txt")).unwrap(),
            "changed_database" => {
                let connection =
                    rusqlite::Connection::open(destination.join("projects/siaovplay.db")).unwrap();
                connection
                    .execute_batch("CREATE TABLE unexpected_change(id INTEGER);")
                    .unwrap();
            }
            _ => unreachable!(),
        }
        let before = fs::read(root.join("storage-settings.json")).unwrap();
        drop(store);
        drop(manager);
        let reopened = StorageManager::initialize(&root, root.clone(), None);
        assert_eq!(reopened.unwrap_err().code(), "storage_integrity_failed", "{fault}");
        assert_eq!(
            fs::read(root.join("storage-settings.json")).unwrap(),
            before,
            "{fault}"
        );
        assert_eq!(fs::read(root.join("asset.txt")).unwrap(), b"original");
        // Restoring the verified fixture permits retry without rewriting the source.
        fs::write(&receipt, original_receipt).unwrap();
        fs::write(destination.join("asset.txt"), b"original").unwrap();
        fs::write(destination.join("projects/siaovplay.db"), original_database).unwrap();
        fs::write(root.join("storage-settings.json"), original_settings).unwrap();
        let recovered = StorageManager::initialize(&root, root.clone(), None).unwrap();
        assert_eq!(
            recovered.app_data_root().unwrap(),
            dunce::canonicalize(&destination).unwrap()
        );
    }
}

#[test]
fn completed_promotion_does_not_recheck_a_normally_modified_database() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("app");
    let destination = directory.path().join("destination");
    fs::create_dir(&destination).unwrap();
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
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
    assert_eq!(
        wait_for_task(&manager, &task.id).status,
        StorageMigrationStatus::RestartRequired
    );
    drop(store);
    drop(manager);
    let promoted = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let media = directory.path().join("new.mp4");
    fs::write(&media, b"new").unwrap();
    let store = ProjectStore::open(destination.join("projects/siaovplay.db")).unwrap();
    let project = store
        .create_local_project(CreateLocalProjectInput {
            media_path: media.to_string_lossy().into_owned(),
            title: Some("new project".into()),
        })
        .unwrap();
    drop(store);
    drop(promoted);
    let reopened = StorageManager::initialize(&root, root.clone(), None).unwrap();
    assert_eq!(
        reopened.app_data_root().unwrap(),
        dunce::canonicalize(&destination).unwrap()
    );
    let store = ProjectStore::open(destination.join("projects/siaovplay.db")).unwrap();
    assert_eq!(store.get_project(&project.id).unwrap().title, "new project");
}

#[cfg(windows)]
#[test]
fn pending_verification_rejects_a_substituted_directory_junction() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("app");
    let destination = directory.path().join("destination");
    let external = directory.path().join("external");
    fs::create_dir(&destination).unwrap();
    fs::create_dir(&external).unwrap();
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
    fs::create_dir(root.join("assets")).unwrap();
    fs::write(root.join("assets/file"), b"same bytes").unwrap();
    fs::write(external.join("file"), b"same bytes").unwrap();
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
    assert_eq!(
        wait_for_task(&manager, &task.id).status,
        StorageMigrationStatus::RestartRequired
    );
    let junction = destination.join("assets");
    fs::remove_file(junction.join("file")).unwrap();
    fs::remove_dir(&junction).unwrap();
    let output = std::process::Command::new("cmd.exe")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(&junction)
        .arg(&external)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let original = fs::read(root.join("storage-settings.json")).unwrap();
    drop(store);
    drop(manager);
    let result = StorageManager::initialize(&root, root.clone(), None);
    // Remove only the fixture junction, never recurse into its target.
    fs::remove_dir(&junction).unwrap();
    assert!(result.is_err());
    assert_eq!(
        fs::read(root.join("storage-settings.json")).unwrap(),
        original
    );
    assert_eq!(fs::read(external.join("file")).unwrap(), b"same bytes");
}
