use super::*;
use tempfile::{TempDir, tempdir};
fn receipt(version: &str, entry: &str) -> ResourceReceipt {
    ResourceReceipt {
        schema_version: RECEIPT_SCHEMA_VERSION,
        resource_id: "ffmpeg-cpu".into(),
        version: version.into(),
        install_relative_path: format!("packages/ffmpeg-cpu/{version}"),
        entrypoints: [("ffmpeg".into(), entry.into())].into(),
        files: Vec::new(),
        health_status: "passed".into(),
        activated_at_ms: Some(10),
    }
}
pub(super) fn setup(version: &str) -> (TempDir, LocalResourceManager, Journal) {
    let root = tempdir().unwrap();
    let mut manager = LocalResourceManager::load(root.path()).unwrap();
    manager
        .configure_location(root.path().to_str().unwrap(), true)
        .unwrap();
    manager
        .activate_receipt(receipt("1", "bin/old.exe"))
        .unwrap();
    let previous = manager.configuration.clone().unwrap();
    let next_receipt = receipt(version, "bin/new.exe");
    let target = configuration_root(&previous)
        .join("receipts/ffmpeg-cpu")
        .join(format!("{version}.json"));
    let previous_receipt = fs::read_to_string(target).ok();
    let mut next = previous.clone();
    next.active_resources
        .insert("ffmpeg-cpu".into(), version.into());
    let journal = Journal {
        schema_version: 1,
        previous,
        next,
        previous_receipt,
        next_receipt,
        committed: false,
        payload: None,
    };
    (root, manager, journal)
}
fn save(manager: &LocalResourceManager, journal: &Journal) {
    persist_json(&journal_path(&manager.config_path).unwrap(), journal).unwrap();
}
#[test]
fn prepared_activation_preserves_original_receipt() {
    let (_root, manager, journal) = setup("1");
    let target = receipt_path(&journal);
    let before = fs::read(&target).unwrap();
    save(&manager, &journal);
    assert!(pending(&manager.config_path).unwrap());
    assert_eq!(recover(&manager.config_path).unwrap(), Recovery::RolledBack);
    assert_eq!(fs::read(target).unwrap(), before);
    assert!(!pending(&manager.config_path).unwrap());
}
#[test]
fn written_new_receipt_rolls_back_when_configuration_is_old() {
    let (_root, manager, journal) = setup("2");
    let target = receipt_path(&journal);
    save(&manager, &journal);
    persist_json(&target, &journal.next_receipt).unwrap();
    assert_eq!(recover(&manager.config_path).unwrap(), Recovery::RolledBack);
    assert!(!target.exists());
    assert_eq!(
        persistence::load_configuration(&manager.config_path).unwrap(),
        Some(journal.previous)
    );
}
#[test]
fn committed_configuration_retains_new_receipt_even_before_final_marker() {
    let (root, manager, journal) = setup("2");
    let target = receipt_path(&journal);
    save(&manager, &journal);
    persist_json(&target, &journal.next_receipt).unwrap();
    persist_json(&manager.config_path, &journal.next).unwrap();
    let reopened = LocalResourceManager::load(root.path()).unwrap();
    assert_eq!(reopened.configuration, Some(journal.next));
    assert_eq!(
        serde_json::from_slice::<ResourceReceipt>(&fs::read(target).unwrap()).unwrap(),
        journal.next_receipt
    );
    assert!(!pending(&manager.config_path).unwrap());
}
#[test]
fn same_version_uses_durable_commit_marker() {
    for committed in [false, true] {
        let (_root, manager, mut journal) = setup("1");
        journal.committed = committed;
        let target = receipt_path(&journal);
        save(&manager, &journal);
        persist_json(&target, &journal.next_receipt).unwrap();
        assert_eq!(
            recover(&manager.config_path).unwrap(),
            if committed {
                Recovery::Committed
            } else {
                Recovery::RolledBack
            }
        );
        let expected = if committed {
            journal.next_receipt
        } else {
            serde_json::from_str(&journal.previous_receipt.unwrap()).unwrap()
        };
        assert_eq!(
            serde_json::from_slice::<ResourceReceipt>(&fs::read(target).unwrap()).unwrap(),
            expected
        );
    }
}
#[test]
fn committed_journal_can_restore_missing_receipt() {
    let (_root, manager, journal) = setup("2");
    let target = receipt_path(&journal);
    save(&manager, &journal);
    persist_json(&manager.config_path, &journal.next).unwrap();
    assert_eq!(recover(&manager.config_path).unwrap(), Recovery::Committed);
    assert_eq!(
        serde_json::from_slice::<ResourceReceipt>(&fs::read(target).unwrap()).unwrap(),
        journal.next_receipt
    );
}
#[test]
fn unrelated_configuration_or_receipt_is_not_overwritten() {
    for change_configuration in [false, true] {
        let (_root, manager, journal) = setup("2");
        let target = receipt_path(&journal);
        save(&manager, &journal);
        persist_json(&target, &journal.next_receipt).unwrap();
        if change_configuration {
            let mut changed = journal.previous.clone();
            changed.preferred_profile = "fast".into();
            persist_json(&manager.config_path, &changed).unwrap();
        } else {
            persist_json(&target, &receipt("2", "bin/unrelated.exe")).unwrap();
        }
        let before_config = fs::read(&manager.config_path).unwrap();
        let before_receipt = fs::read(&target).unwrap();
        assert!(recover(&manager.config_path).is_err());
        assert_eq!(fs::read(&manager.config_path).unwrap(), before_config);
        assert_eq!(fs::read(target).unwrap(), before_receipt);
        assert!(pending(&manager.config_path).unwrap());
    }
}
#[test]
fn invalid_journal_preserves_all_files() {
    for change_root in [false, true] {
        let (_root, manager, mut journal) = setup("2");
        if change_root {
            journal.next.resource_root.push_str("-other");
        } else {
            journal.schema_version = 3;
        }
        save(&manager, &journal);
        let path = journal_path(&manager.config_path).unwrap();
        let bytes = fs::read(&path).unwrap();
        assert!(recover(&manager.config_path).is_err());
        assert_eq!(fs::read(path).unwrap(), bytes);
        assert!(!receipt_path(&journal).exists());
    }
}

#[test]
fn journal_finalization_failure_does_not_instruct_installer_to_undo_committed_version() {
    let (_root, mut manager, journal) = setup("2");
    let result = activate_inner(&mut manager, journal.next_receipt, |path| {
        fs::create_dir(path.with_extension("json.part"))?;
        Ok(())
    });
    assert!(
        result.is_ok(),
        "configuration is committed; installer must not roll back its files"
    );
    assert_eq!(
        manager
            .configuration
            .as_ref()
            .unwrap()
            .active_resources
            .get("ffmpeg-cpu")
            .map(String::as_str),
        Some("2")
    );
    assert!(pending(&manager.config_path).unwrap());
    fs::remove_dir(
        journal_path(&manager.config_path)
            .unwrap()
            .with_extension("json.part"),
    )
    .unwrap();
    assert_eq!(recover(&manager.config_path).unwrap(), Recovery::Committed);
    assert_eq!(
        manager.read_receipt("ffmpeg-cpu", "2").unwrap().version,
        "2"
    );
}

#[test]
fn receipt_sidecar_obstruction_keeps_recovery_journal() {
    let (_root, manager, mut journal) = setup("2");
    journal.committed = true;
    let target = receipt_path(&journal);
    save(&manager, &journal);
    persist_json(&target, &journal.next_receipt).unwrap();
    persist_json(&manager.config_path, &journal.next).unwrap();
    let obstruction = target.with_extension("json.bak");
    fs::create_dir(&obstruction).unwrap();
    assert!(recover(&manager.config_path).is_err());
    assert!(pending(&manager.config_path).unwrap());
    assert_eq!(
        manager.read_receipt("ffmpeg-cpu", "2").unwrap(),
        journal.next_receipt
    );
    fs::remove_dir(obstruction).unwrap();
    assert_eq!(recover(&manager.config_path).unwrap(), Recovery::Committed);
}
