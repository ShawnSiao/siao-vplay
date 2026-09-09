use super::*;
use sha2::{Digest, Sha256};

fn receipt_path(root: &Path, task: &StorageMigrationTask) -> std::path::PathBuf {
    root.join(format!("storage-migration.{}.receipt.json", task.id))
}

#[test]
fn receipt_records_destination_database_after_path_rewrite() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("app");
    let destination = directory.path().join("destination");
    fs::create_dir(&destination).unwrap();
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
    let media = root.join("local.mp4");
    fs::write(&media, b"owned media").unwrap();
    let project = store
        .create_local_project(CreateLocalProjectInput {
            media_path: media.to_string_lossy().into_owned(),
            title: None,
        })
        .unwrap();
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
    assert_eq!(
        completed.status,
        StorageMigrationStatus::RestartRequired,
        "{:?}",
        completed.error_message
    );
    let receipt: serde_json::Value = serde_json::from_slice(
        &fs::read(receipt_path(&root, &task)).expect("durable receipt before switching root"),
    )
    .unwrap();
    assert_eq!(receipt["schemaVersion"], 1);
    assert_eq!(receipt["taskId"], task.id);
    let files = receipt["files"].as_array().unwrap();
    let database = files
        .iter()
        .find(|file| file["relative"] == "projects/siaovplay.db")
        .unwrap();
    let bytes = fs::read(destination.join("projects/siaovplay.db")).unwrap();
    assert_eq!(database["sha256"], format!("{:x}", Sha256::digest(&bytes)));
    assert_eq!(database["bytes"], bytes.len() as u64);
    assert_eq!(database["kind"], "rewritten_database");
    let copied = files
        .iter()
        .find(|file| file["relative"] == "local.mp4")
        .unwrap();
    assert_eq!(
        copied["sha256"],
        format!("{:x}", Sha256::digest(b"owned media"))
    );
    assert_eq!(copied["kind"], "copied_file");
    let migrated = ProjectStore::open(destination.join("projects/siaovplay.db")).unwrap();
    assert!(
        Path::new(
            &migrated
                .get_project(&project.id)
                .unwrap()
                .media_source
                .locator
        )
        .starts_with(&destination)
    );
    assert_eq!(fs::read(&media).unwrap(), b"owned media");
}

#[test]
fn unsupported_receipt_is_preserved_and_prevents_root_commit() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("app");
    let destination = directory.path().join("destination");
    fs::create_dir(&destination).unwrap();
    let manager = StorageManager::initialize(&root, root.clone(), None).unwrap();
    let store = ProjectStore::open(root.join("projects/siaovplay.db")).unwrap();
    let source = manager.remote_media_root().unwrap();
    fs::create_dir_all(&source).unwrap();
    fs::write(source.join("video"), b"retain").unwrap();
    let task = prepare(
        &manager,
        StorageArea::RemoteMedia,
        &destination,
        StorageMigrationMode::Copy,
    );
    let path = receipt_path(&root, &task);
    let future = serde_json::to_vec(&serde_json::json!({
        "schemaVersion": 99, "taskId": task.id, "area": task.area, "mode": task.mode,
        "sourceRoot": task.source_root, "destinationRoot": task.destination_root, "files": []
    }))
    .unwrap();
    fs::write(&path, &future).unwrap();
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
    assert_eq!(completed.status, StorageMigrationStatus::Failed);
    assert_eq!(manager.remote_media_root().unwrap(), source);
    assert_eq!(fs::read(path).unwrap(), future);
    assert_eq!(fs::read(source.join("video")).unwrap(), b"retain");
}
