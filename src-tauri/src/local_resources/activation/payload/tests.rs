use super::*;
use tempfile::TempDir;

fn setup(same: bool, existing: bool) -> (TempDir, LocalResourceManager, Journal) {
    let (data, manager, mut journal) = super::super::tests::setup(if same { "1" } else { "2" });
    let root = configuration_root(&journal.previous);
    let stage = root.join("staging/test-install/payload");
    fs::create_dir_all(&stage).unwrap();
    fs::write(stage.join("new"), b"new payload").unwrap();
    let destination = root.join(&journal.next_receipt.install_relative_path);
    if existing {
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join("old"), b"old payload").unwrap();
    }
    journal.schema_version = 2;
    journal.payload = Some(prepare(&journal, &stage).unwrap());
    (data, manager, journal)
}
#[test]
fn startup_rolls_back_each_payload_rename_before_commit() {
    for same in [false, true] {
        for existing in [false, true] {
            for phase in 0..3 {
                if phase == 1 && !existing {
                    continue;
                }
                let (data, manager, journal) = setup(same, existing);
                let payload = journal.payload.as_ref().unwrap();
                let (stage, destination, backup) = paths(&journal, payload).unwrap();
                super::super::prepare::prepare(
                    &journal_path(&manager.config_path).unwrap(),
                    &journal,
                )
                .unwrap();
                if phase >= 1 && existing {
                    fs::rename(&destination, &backup).unwrap();
                }
                if phase == 2 {
                    fs::rename(&stage, &destination).unwrap();
                    persist_json(&receipt_path(&journal), &journal.next_receipt).unwrap();
                    if same {
                        persist_json(&manager.config_path, &journal.next).unwrap();
                    }
                }
                let loaded = LocalResourceManager::load(data.path()).unwrap();
                assert_eq!(loaded.configuration, Some(journal.previous.clone()));
                assert_eq!(fs::read(stage.join("new")).unwrap(), b"new payload");
                assert_eq!(destination.exists(), existing);
                if existing {
                    assert_eq!(fs::read(destination.join("old")).unwrap(), b"old payload");
                }
                assert!(!backup.exists());
                assert!(!pending(&manager.config_path).unwrap());
                if let Some(raw) = &journal.previous_receipt {
                    assert_eq!(fs::read_to_string(receipt_path(&journal)).unwrap(), *raw);
                } else {
                    assert!(!receipt_path(&journal).exists());
                }
            }
        }
    }
}
#[test]
fn startup_finishes_committed_new_or_same_version_payload() {
    for same in [false, true] {
        for existing in [false, true] {
            let (data, manager, mut journal) = setup(same, existing);
            let payload = journal.payload.as_ref().unwrap();
            let (stage, destination, backup) = paths(&journal, payload).unwrap();
            super::super::prepare::prepare(&journal_path(&manager.config_path).unwrap(), &journal)
                .unwrap();
            apply(&journal, payload).unwrap();
            persist_json(&receipt_path(&journal), &journal.next_receipt).unwrap();
            persist_json(&manager.config_path, &journal.next).unwrap();
            if same {
                journal.committed = true;
                persist_json(&journal_path(&manager.config_path).unwrap(), &journal).unwrap();
            }
            let loaded = LocalResourceManager::load(data.path()).unwrap();
            assert_eq!(loaded.configuration, Some(journal.next.clone()));
            assert_eq!(fs::read(destination.join("new")).unwrap(), b"new payload");
            assert!(!stage.exists());
            assert!(!backup.exists());
            assert!(!pending(&manager.config_path).unwrap());
        }
    }
}
#[test]
fn configuration_save_failure_restores_old_payload_and_keeps_new_staging() {
    for same in [false, true] {
        let (_data, mut manager, journal) = setup(same, true);
        let (stage, destination, _) = paths(&journal, journal.payload.as_ref().unwrap()).unwrap();
        fs::create_dir(manager.config_path.with_extension("json.part")).unwrap();
        assert!(install(&mut manager, journal.next_receipt.clone(), &stage).is_err());
        assert_eq!(manager.configuration, Some(journal.previous));
        assert_eq!(fs::read(stage.join("new")).unwrap(), b"new payload");
        assert_eq!(fs::read(destination.join("old")).unwrap(), b"old payload");
        assert!(!pending(&manager.config_path).unwrap());
    }
}
#[test]
fn finalization_error_retains_committed_new_version_and_rolls_back_uncommitted_reinstall() {
    for same in [false, true] {
        let (_data, mut manager, journal) = setup(same, true);
        let (stage, destination, _) = paths(&journal, journal.payload.as_ref().unwrap()).unwrap();
        let result = execute(
            &mut manager,
            journal.next_receipt.clone(),
            Some(&stage),
            |_| Err(io::Error::other("injected checkpoint failure").into()),
        );
        assert_eq!(result.is_err(), same);
        if same {
            assert_eq!(fs::read(destination.join("old")).unwrap(), b"old payload");
            assert_eq!(fs::read(stage.join("new")).unwrap(), b"new payload");
        } else {
            assert_eq!(fs::read(destination.join("new")).unwrap(), b"new payload");
            assert!(!stage.exists());
        }
        assert!(!pending(&manager.config_path).unwrap());
    }
}
#[test]
fn ambiguous_payload_paths_are_retained() {
    let (_data, manager, journal) = setup(true, true);
    let (stage, destination, backup) = paths(&journal, journal.payload.as_ref().unwrap()).unwrap();
    super::super::prepare::prepare(&journal_path(&manager.config_path).unwrap(), &journal).unwrap();
    fs::create_dir(&backup).unwrap();
    fs::write(backup.join("unrelated"), b"keep").unwrap();
    assert!(super::super::recover(&manager.config_path).is_err());
    assert_eq!(fs::read(backup.join("unrelated")).unwrap(), b"keep");
    assert!(stage.is_dir());
    assert!(destination.is_dir());
    assert!(pending(&manager.config_path).unwrap());
}
#[test]
fn outside_staging_or_wrong_install_identity_is_rejected_before_move() {
    let (_data, mut manager, journal) = setup(true, true);
    let (stage, destination, _) = paths(&journal, journal.payload.as_ref().unwrap()).unwrap();
    let mut receipt = journal.next_receipt.clone();
    receipt.install_relative_path = "packages/other/1".into();
    assert!(install(&mut manager, receipt, &stage).is_err());
    assert!(install(&mut manager, journal.next_receipt.clone(), &destination).is_err());
    assert_eq!(fs::read(stage.join("new")).unwrap(), b"new payload");
    assert_eq!(fs::read(destination.join("old")).unwrap(), b"old payload");
    assert!(!pending(&manager.config_path).unwrap());
}
#[cfg(windows)]
#[test]
fn locked_old_payload_retains_committed_install_until_cleanup_can_resume() {
    use std::os::windows::fs::OpenOptionsExt;
    let (_data, mut manager, journal) = setup(true, true);
    let (stage, destination, _) = paths(&journal, journal.payload.as_ref().unwrap()).unwrap();
    let root = configuration_root(&journal.previous);
    let mut held = None;
    execute(
        &mut manager,
        journal.next_receipt.clone(),
        Some(&stage),
        |_| {
            let backup = fs::read_dir(root.join("staging"))?
                .filter_map(Result::ok)
                .find(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("install-backup-")
                })
                .unwrap()
                .path();
            held = Some(
                fs::OpenOptions::new()
                    .read(true)
                    .share_mode(3)
                    .open(backup.join("old"))?,
            );
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(fs::read(destination.join("new")).unwrap(), b"new payload");
    assert!(pending(&manager.config_path).unwrap());
    drop(held);
    super::super::recover(&manager.config_path).unwrap();
    assert_eq!(fs::read(destination.join("new")).unwrap(), b"new payload");
    assert!(!pending(&manager.config_path).unwrap());
}

#[test]
fn legacy_metadata_journal_without_payload_field_remains_recoverable() {
    let (data, manager, journal) = super::super::tests::setup("2");
    let mut legacy = serde_json::to_value(&journal).unwrap();
    legacy.as_object_mut().unwrap().remove("payload");
    persist_json(&journal_path(&manager.config_path).unwrap(), &legacy).unwrap();
    let loaded = LocalResourceManager::load(data.path()).unwrap();
    assert_eq!(loaded.configuration, Some(journal.previous));
    assert!(!pending(&manager.config_path).unwrap());
}
#[test]
fn receipt_parent_obstruction_prevents_payload_replacement() {
    let (_data, mut manager, journal) = setup(false, true);
    let (stage, destination, _) = paths(&journal, journal.payload.as_ref().unwrap()).unwrap();
    let root = configuration_root(&journal.previous);
    let parent = root.join("receipts/ffmpeg-cpu");
    fs::rename(&parent, root.join("retained-receipts")).unwrap();
    fs::write(&parent, b"retained").unwrap();
    assert!(install(&mut manager, journal.next_receipt.clone(), &stage).is_err());
    assert_eq!(fs::read(parent).unwrap(), b"retained");
    assert_eq!(fs::read(destination.join("old")).unwrap(), b"old payload");
    assert_eq!(fs::read(stage.join("new")).unwrap(), b"new payload");
    assert!(!pending(&manager.config_path).unwrap());
}
