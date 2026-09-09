use super::*;
use tempfile::{TempDir, tempdir};
fn setup() -> (TempDir, LocalResourceManager, PathBuf) {
    let root = tempdir().unwrap();
    let mut manager = LocalResourceManager::load(root.path()).unwrap();
    manager
        .configure_location(root.path().to_str().unwrap(), true)
        .unwrap();
    manager
        .activate_receipt(ResourceReceipt {
            schema_version: RECEIPT_SCHEMA_VERSION,
            resource_id: "ffmpeg-cpu".into(),
            version: "1".into(),
            install_relative_path: "packages/ffmpeg-cpu/1".into(),
            entrypoints: [("ffmpeg".into(), "bin/ffmpeg.exe".into())].into(),
            files: Vec::new(),
            health_status: "passed".into(),
            activated_at_ms: None,
        })
        .unwrap();
    let target = configuration_root(manager.configuration.as_ref().unwrap())
        .join("receipts/ffmpeg-cpu/1.json");
    (root, manager, target)
}
#[test]
fn active_backup_is_readable_without_mutating_files_under_read_access() {
    let (_root, manager, target) = setup();
    let bytes = fs::read(&target).unwrap();
    let backup = target.with_extension("json.bak");
    fs::rename(&target, &backup).unwrap();
    assert_eq!(
        manager.read_receipt("ffmpeg-cpu", "1").unwrap().version,
        "1"
    );
    assert_eq!(manager.installed_receipts("ffmpeg-cpu").unwrap().len(), 1);
    assert!(!target.exists());
    assert_eq!(fs::read(backup).unwrap(), bytes);
}
#[test]
fn historical_list_rejects_filename_identity_mismatch() {
    let (_root, manager, target) = setup();
    let bytes = fs::read(&target).unwrap();
    fs::write(target.parent().unwrap().join("2.json"), bytes).unwrap();
    let receipts = manager.installed_receipts("ffmpeg-cpu").unwrap();
    assert_eq!(
        receipts.len(),
        1,
        "a differently named copy must not appear as another installed revision"
    );
}

#[test]
fn primary_wins_and_invalid_primary_never_falls_back() {
    for invalid_primary in [false, true] {
        let (_root, manager, target) = setup();
        let original = fs::read(&target).unwrap();
        fs::write(target.with_extension("json.bak"), &original).unwrap();
        if invalid_primary {
            let mut value: ResourceReceipt = serde_json::from_slice(&original).unwrap();
            value.schema_version += 1;
            fs::write(&target, serde_json::to_vec(&value).unwrap()).unwrap();
        } else {
            fs::write(target.with_extension("json.bak"), b"broken").unwrap();
        }
        let before = fs::read(&target).unwrap();
        assert_eq!(
            manager.read_receipt("ffmpeg-cpu", "1").is_err(),
            invalid_primary
        );
        assert_eq!(fs::read(target).unwrap(), before);
    }
}
#[test]
fn uncommitted_part_and_invalid_backup_are_not_selected() {
    for backup in [false, true] {
        let (_root, manager, target) = setup();
        let bytes = fs::read(&target).unwrap();
        fs::remove_file(&target).unwrap();
        fs::write(target.with_extension("json.part"), &bytes).unwrap();
        if backup {
            fs::write(target.with_extension("json.bak"), b"broken").unwrap();
        }
        assert!(manager.read_receipt("ffmpeg-cpu", "1").is_err());
        assert!(manager.installed_receipts("ffmpeg-cpu").unwrap().is_empty());
        assert!(!target.exists());
        assert_eq!(fs::read(target.with_extension("json.part")).unwrap(), bytes);
    }
}
#[test]
fn inactive_orphan_backup_does_not_resurrect_a_historical_version() {
    let (_root, mut manager, target) = setup();
    let mut next = manager.read_receipt("ffmpeg-cpu", "1").unwrap();
    next.version = "2".into();
    next.install_relative_path = "packages/ffmpeg-cpu/2".into();
    manager.activate_receipt(next).unwrap();
    let bytes = fs::read(&target).unwrap();
    fs::rename(&target, target.with_extension("json.bak")).unwrap();
    assert!(manager.read_receipt("ffmpeg-cpu", "1").is_err());
    let receipts = manager.installed_receipts("ffmpeg-cpu").unwrap();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].version, "2");
    assert!(!target.exists());
    assert_eq!(fs::read(target.with_extension("json.bak")).unwrap(), bytes);
}
#[test]
fn explicit_active_deletion_removes_the_selected_backup_and_stays_deleted_after_restart() {
    let (root, mut manager, target) = setup();
    fs::rename(&target, target.with_extension("json.bak")).unwrap();
    assert!(manager.deactivate_resource("ffmpeg-cpu").unwrap().is_some());
    let loaded = LocalResourceManager::load(root.path()).unwrap();
    assert!(loaded.active_receipt("ffmpeg-cpu").unwrap().is_none());
    assert!(loaded.installed_receipts("ffmpeg-cpu").unwrap().is_empty());
    for candidate in [
        &target,
        &target.with_extension("json.bak"),
        &target.with_extension("json.part"),
    ] {
        assert!(!candidate.exists());
    }
}
#[test]
fn concurrent_readers_never_rename_the_legacy_backup() {
    let (_root, manager, target) = setup();
    let bytes = fs::read(&target).unwrap();
    fs::rename(&target, target.with_extension("json.bak")).unwrap();
    std::thread::scope(|scope| {
        for _ in 0..8 {
            let manager = &manager;
            scope.spawn(move || {
                for _ in 0..8 {
                    assert_eq!(
                        manager.read_receipt("ffmpeg-cpu", "1").unwrap().version,
                        "1"
                    );
                }
            });
        }
    });
    assert!(!target.exists());
    assert_eq!(fs::read(target.with_extension("json.bak")).unwrap(), bytes);
}
#[test]
fn backup_identity_mismatch_is_rejected_without_mutation() {
    let (_root, manager, target) = setup();
    let mut wrong = manager.read_receipt("ffmpeg-cpu", "1").unwrap();
    wrong.version = "other".into();
    let bytes = serde_json::to_vec(&wrong).unwrap();
    fs::remove_file(&target).unwrap();
    fs::write(target.with_extension("json.bak"), &bytes).unwrap();
    assert!(manager.read_receipt("ffmpeg-cpu", "1").is_err());
    assert!(!target.exists());
    assert_eq!(fs::read(target.with_extension("json.bak")).unwrap(), bytes);
}
