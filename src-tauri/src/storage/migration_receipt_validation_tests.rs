use super::super::StorageMigrationStatus;
use super::*;
use serde_json::{Value, json};

fn task() -> StorageMigrationTask {
    StorageMigrationTask {
        id: uuid::Uuid::new_v4().to_string(),
        area: StorageArea::RemoteMedia,
        mode: StorageMigrationMode::Copy,
        status: StorageMigrationStatus::Running,
        source_root: "source".into(),
        destination_root: "destination".into(),
        bytes_to_copy: 1,
        copied_bytes: 1,
        file_count: 1,
        verified_file_count: 1,
        free_space_bytes: None,
        previous_root_retained: true,
        restart_required: false,
        error_code: None,
        error_message: None,
        created_at_ms: 0,
        updated_at_ms: 0,
    }
}
fn files() -> Vec<VerifiedFile> {
    vec![VerifiedFile {
        relative: "video.mp4".into(),
        bytes: 1,
        sha256: "a".repeat(64),
        kind: FileKind::CopiedFile,
    }]
}
fn path(root: &Path, task: &StorageMigrationTask) -> PathBuf {
    root.join(format!("storage-migration.{}.receipt.json", task.id))
}
fn value(root: &Path, task: &StorageMigrationTask) -> Value {
    serde_json::from_slice(&fs::read(path(root, task)).unwrap()).unwrap()
}

#[test]
fn same_identity_retry_replaces_receipt_and_cancellation_preserves_it() {
    let directory = tempfile::tempdir().unwrap();
    let task = task();
    let cancelled = AtomicBool::new(false);
    persist(directory.path(), &task, files(), &cancelled).unwrap();
    let mut next = files();
    next[0].bytes = 2;
    next[0].sha256 = "b".repeat(64);
    persist(directory.path(), &task, next, &cancelled).unwrap();
    assert_eq!(value(directory.path(), &task)["files"][0]["bytes"], 2);
    let prior = fs::read(path(directory.path(), &task)).unwrap();
    assert!(matches!(
        persist(directory.path(), &task, files(), &AtomicBool::new(true)),
        Err(StorageError::MigrationCancelled)
    ));
    assert_eq!(fs::read(path(directory.path(), &task)).unwrap(), prior);
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn invalid_existing_records_are_never_replaced() {
    let directory = tempfile::tempdir().unwrap();
    let task = task();
    let cancelled = AtomicBool::new(false);
    persist(directory.path(), &task, files(), &cancelled).unwrap();
    let base = value(directory.path(), &task);
    let mut variants = vec![];
    for (field, replacement) in [
        ("schemaVersion", json!(2)),
        ("schemaVersion", Value::Null),
        ("taskId", json!(uuid::Uuid::new_v4().to_string())),
        ("sourceRoot", json!("other")),
        ("destinationRoot", json!("other")),
        ("area", json!("media_cache")),
        ("mode", json!("rebuild")),
    ] {
        let mut changed = base.clone();
        changed[field] = replacement;
        variants.push(changed);
    }
    for relative in [
        "../outside",
        "/absolute",
        "C:/outside",
        "a\\b",
        "a//b",
        "a/./b",
        "",
    ] {
        let mut changed = base.clone();
        changed["files"][0]["relative"] = json!(relative);
        variants.push(changed);
    }
    let mut changed = base.clone();
    changed["files"][0]["sha256"] = json!("z".repeat(64));
    variants.push(changed);
    let mut changed = base.clone();
    changed["files"]
        .as_array_mut()
        .unwrap()
        .push(base["files"][0].clone());
    variants.push(changed);
    for changed in variants {
        let bytes = serde_json::to_vec(&changed).unwrap();
        fs::write(path(directory.path(), &task), &bytes).unwrap();
        assert!(
            persist(directory.path(), &task, files(), &cancelled).is_err(),
            "{changed}"
        );
        assert_eq!(fs::read(path(directory.path(), &task)).unwrap(), bytes);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }
    fs::write(path(directory.path(), &task), b"broken json").unwrap();
    assert!(persist(directory.path(), &task, files(), &cancelled).is_err());
    assert_eq!(
        fs::read(path(directory.path(), &task)).unwrap(),
        b"broken json"
    );
}

#[test]
fn failed_publication_removes_only_the_temporary_record() {
    let directory = tempfile::tempdir().unwrap();
    let task = task();
    let target = path(directory.path(), &task);
    fs::create_dir(&target).unwrap();
    fs::write(target.join("retain"), b"retain").unwrap();
    let receipt = Receipt {
        schema_version: 1,
        task_id: task.id.clone(),
        area: task.area,
        mode: task.mode,
        source_root: task.source_root.clone(),
        destination_root: task.destination_root.clone(),
        files: files(),
    };
    assert!(write_atomic(&target, &receipt, &AtomicBool::new(false)).is_err());
    assert!(persist(directory.path(), &task, files(), &AtomicBool::new(false)).is_err());
    assert_eq!(fs::read(target.join("retain")).unwrap(), b"retain");
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn database_and_rebuild_receipts_require_their_actual_transfer_kind() {
    let directory = tempfile::tempdir().unwrap();
    let mut task = task();
    task.area = StorageArea::AppData;
    assert!(persist(directory.path(), &task, files(), &AtomicBool::new(false)).is_err());
    task.area = StorageArea::MediaCache;
    task.mode = StorageMigrationMode::Rebuild;
    assert!(persist(directory.path(), &task, files(), &AtomicBool::new(false)).is_err());
    persist(directory.path(), &task, vec![], &AtomicBool::new(false)).unwrap();
    assert_eq!(value(directory.path(), &task)["files"], json!([]));
}
