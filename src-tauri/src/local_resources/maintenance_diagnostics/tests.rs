use super::*;
use tempfile::{TempDir, tempdir};

fn setup() -> (TempDir, LocalResourceManager, PathBuf) {
    let data = tempdir().unwrap();
    let mut manager = LocalResourceManager::load(data.path()).unwrap();
    manager
        .configure_location(data.path().to_str().unwrap(), true)
        .unwrap();
    let root = configuration_root(manager.configuration.as_ref().unwrap());
    (data, manager, root)
}

#[test]
fn reports_pending_records_and_review_copies_without_mutating_or_disclosing_paths() {
    let (data, manager, root) = setup();
    let files = [
        (
            data.path().join("resource-activation.json.bak"),
            b"unknown private journal".as_slice(),
        ),
        (
            root.join("staging/install-backup-legacy/payload.bin"),
            b"original payload".as_slice(),
        ),
        (
            root.join("staging/version-cleanup-legacy/payload.bin"),
            b"old payload".as_slice(),
        ),
        (
            root.join("staging/removal-legacy/payload.bin"),
            b"pending payload".as_slice(),
        ),
        (
            root.join("staging/running-task/payload.bin"),
            b"running task".as_slice(),
        ),
        (
            root.join("receipts/ffmpeg/1.json.bak"),
            b"private receipt".as_slice(),
        ),
        (
            root.join("receipts/ffmpeg/2.json.part"),
            b"partial receipt".as_slice(),
        ),
        (
            root.join("receipts/ffmpeg/3.json"),
            b"regular receipt".as_slice(),
        ),
    ];
    for (path, bytes) in &files {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }
    let config_before = fs::read(&manager.config_path).unwrap();
    let diagnostic = inspect(&manager).unwrap();
    assert_eq!(
        diagnostic.transaction_state,
        ResourceChangeState::ActivationPending
    );
    assert_eq!(
        diagnostic.scan_state,
        ResourceMaintenanceScanState::Complete
    );
    assert_eq!(diagnostic.staging_review_count, 3);
    assert_eq!(diagnostic.receipt_recovery_copy_count, 2);
    for (path, bytes) in files {
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
    assert_eq!(fs::read(&manager.config_path).unwrap(), config_before);
    assert!(!data.path().join("resource-activation.json").exists());
    let wire = serde_json::to_value(&diagnostic).unwrap();
    assert_eq!(
        wire,
        serde_json::json!({ "transactionState": "activation_pending", "scanState": "complete",
        "stagingReviewCount": 3, "receiptRecoveryCopyCount": 2 })
    );
}

#[test]
fn conflicting_and_malformed_records_remain_present_for_review() {
    let (data, manager, _) = setup();
    fs::write(data.path().join("resource-removal.json.part"), b"not json").unwrap();
    assert_eq!(
        inspect(&manager).unwrap().transaction_state,
        ResourceChangeState::RemovalPending
    );
    fs::create_dir(data.path().join("resource-activation.json")).unwrap();
    assert_eq!(
        inspect(&manager).unwrap().transaction_state,
        ResourceChangeState::Conflicting
    );
    assert!(data.path().join("resource-activation.json").is_dir());
    assert_eq!(
        fs::read(data.path().join("resource-removal.json.part")).unwrap(),
        b"not json"
    );
}

#[test]
fn unconfigured_and_unavailable_roots_do_not_look_like_complete_empty_scans() {
    let data = tempdir().unwrap();
    let mut manager = LocalResourceManager::load(data.path()).unwrap();
    assert_eq!(
        inspect(&manager).unwrap().scan_state,
        ResourceMaintenanceScanState::NotConfigured
    );
    manager
        .configure_location(data.path().to_str().unwrap(), true)
        .unwrap();
    manager.configuration.as_mut().unwrap().resource_root =
        data.path().join("missing").to_string_lossy().into_owned();
    assert_eq!(
        inspect(&manager).unwrap().scan_state,
        ResourceMaintenanceScanState::RootUnavailable
    );
}

#[test]
fn bounded_scan_reports_partial_counts_and_does_not_descend_into_payloads() {
    let (_data, manager, root) = setup();
    for id in 0..5 {
        fs::create_dir_all(root.join(format!("staging/install-backup-{id}/deep/payload"))).unwrap();
    }
    let diagnostic = inspect_with_limit(&manager, 2).unwrap();
    assert_eq!(diagnostic.scan_state, ResourceMaintenanceScanState::Partial);
    assert_eq!(diagnostic.staging_review_count, 2);
    assert_eq!(inspect(&manager).unwrap().staging_review_count, 5);
}

#[test]
fn receipt_directory_obstruction_is_reported_as_partial_without_deletion() {
    let (_data, manager, root) = setup();
    fs::write(root.join("receipts/blocked"), b"keep me").unwrap();
    assert_eq!(
        inspect(&manager).unwrap().scan_state,
        ResourceMaintenanceScanState::Partial
    );
    assert_eq!(fs::read(root.join("receipts/blocked")).unwrap(), b"keep me");
}

#[test]
fn embedded_scan_policy_is_bounded() {
    assert!((1..=1_000_000).contains(&scan_limit().unwrap()));
}
