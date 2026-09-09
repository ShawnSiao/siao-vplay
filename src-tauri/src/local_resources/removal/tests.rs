use super::*;
use tempfile::{TempDir, tempdir};

fn setup() -> (TempDir, LocalResourceManager, Journal) {
    let data = tempdir().unwrap();
    let mut manager = LocalResourceManager::load(data.path()).unwrap();
    manager
        .configure_location(data.path().to_str().unwrap(), true)
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
    let receipt = manager.active_receipt("ffmpeg-cpu").unwrap().unwrap();
    let previous = manager.configuration.clone().unwrap();
    let root = configuration_root(&previous);
    fs::create_dir_all(root.join(&receipt.install_relative_path)).unwrap();
    fs::write(
        root.join(&receipt.install_relative_path).join("payload"),
        b"original payload",
    )
    .unwrap();
    let receipt_raw = fs::read_to_string(root.join("receipts/ffmpeg-cpu/1.json")).unwrap();
    let mut next = previous.clone();
    next.active_resources.remove("ffmpeg-cpu");
    let journal = Journal {
        schema_version: 1,
        previous,
        next,
        receipt,
        receipt_raw,
        staging_id: uuid::Uuid::new_v4().to_string(),
        had_payload: true,
    };
    (data, manager, journal)
}
fn prepare(manager: &LocalResourceManager, journal: &Journal) {
    files::prepare(&journal_path(&manager.config_path).unwrap(), journal).unwrap();
}
fn stage(journal: &Journal) {
    let (install, stage, _) = paths(journal).unwrap();
    fs::rename(install, stage).unwrap();
}
#[test]
fn startup_restores_precommit_payload_at_both_interruption_boundaries() {
    for staged in [false, true] {
        let (data, manager, journal) = setup();
        prepare(&manager, &journal);
        if staged {
            stage(&journal);
        }
        let reloaded = LocalResourceManager::load(data.path()).unwrap();
        assert_eq!(reloaded.configuration, Some(journal.previous));
        let root = configuration_root(reloaded.configuration.as_ref().unwrap());
        assert_eq!(
            fs::read(root.join("packages/ffmpeg-cpu/1/payload")).unwrap(),
            b"original payload"
        );
        assert_eq!(
            fs::read_to_string(root.join("receipts/ffmpeg-cpu/1.json")).unwrap(),
            journal.receipt_raw
        );
        assert!(!pending(&manager.config_path).unwrap());
    }
}
#[test]
fn startup_finishes_committed_removal_including_receipt_sidecars() {
    for removed_receipt in [false, true] {
        let (data, manager, journal) = setup();
        prepare(&manager, &journal);
        stage(&journal);
        let (install, staged, target) = paths(&journal).unwrap();
        fs::write(target.with_extension("json.bak"), &journal.receipt_raw).unwrap();
        fs::write(target.with_extension("json.part"), b"partial").unwrap();
        if removed_receipt {
            fs::remove_file(&target).unwrap();
        }
        persist_json(&manager.config_path, &journal.next).unwrap();
        let reloaded = LocalResourceManager::load(data.path()).unwrap();
        assert_eq!(reloaded.configuration, Some(journal.next));
        for path in [
            install,
            staged,
            target.clone(),
            target.with_extension("json.bak"),
            target.with_extension("json.part"),
        ] {
            assert!(!path.exists());
        }
        assert!(!pending(&manager.config_path).unwrap());
    }
}
#[test]
fn failed_configuration_save_restores_payload_and_exact_receipt() {
    let (_data, mut manager, journal) = setup();
    fs::create_dir(manager.config_path.with_extension("json.part")).unwrap();
    assert!(remove(&mut manager, "ffmpeg-cpu").is_err());
    let (install, staged, target) = paths(&journal).unwrap();
    assert_eq!(manager.configuration, Some(journal.previous));
    assert_eq!(
        fs::read(install.join("payload")).unwrap(),
        b"original payload"
    );
    assert_eq!(fs::read_to_string(target).unwrap(), journal.receipt_raw);
    assert!(!staged.exists());
    assert!(!pending(&manager.config_path).unwrap());
}
#[test]
fn cleanup_obstruction_retains_journal_and_can_resume() {
    let (_data, manager, journal) = setup();
    prepare(&manager, &journal);
    stage(&journal);
    persist_json(&manager.config_path, &journal.next).unwrap();
    let (_, staged, target) = paths(&journal).unwrap();
    let obstruction = target.with_extension("json.bak");
    fs::create_dir(&obstruction).unwrap();
    assert!(recover(&manager.config_path).is_err());
    assert!(pending(&manager.config_path).unwrap());
    assert!(staged.is_dir());
    assert!(target.is_file());
    fs::remove_dir(obstruction).unwrap();
    recover(&manager.config_path).unwrap();
    assert!(!staged.exists());
    assert!(!target.exists());
    assert!(!pending(&manager.config_path).unwrap());
}
#[test]
fn unrelated_configuration_or_receipt_is_not_overwritten() {
    for changed_configuration in [false, true] {
        let (_data, manager, journal) = setup();
        prepare(&manager, &journal);
        stage(&journal);
        let (_, staged, target) = paths(&journal).unwrap();
        if changed_configuration {
            let mut changed = journal.previous.clone();
            changed.preferred_profile = "fast".into();
            persist_json(&manager.config_path, &changed).unwrap();
        } else {
            fs::write(&target, "unrelated").unwrap();
        }
        let before_config = fs::read(&manager.config_path).unwrap();
        let before_receipt = fs::read(&target).unwrap();
        assert!(recover(&manager.config_path).is_err());
        assert_eq!(fs::read(&manager.config_path).unwrap(), before_config);
        assert_eq!(fs::read(target).unwrap(), before_receipt);
        assert!(staged.is_dir());
        assert!(pending(&manager.config_path).unwrap());
    }
}
#[test]
fn ambiguous_or_missing_precommit_payload_is_preserved_and_rejected() {
    for both in [false, true] {
        let (_data, manager, journal) = setup();
        prepare(&manager, &journal);
        let (install, staged, _) = paths(&journal).unwrap();
        if both {
            fs::create_dir(&staged).unwrap();
            fs::write(staged.join("other"), b"other").unwrap();
        } else {
            fs::rename(&install, install.with_extension("retained")).unwrap();
        }
        assert!(recover(&manager.config_path).is_err());
        assert!(pending(&manager.config_path).unwrap());
        if both {
            assert_eq!(fs::read(staged.join("other")).unwrap(), b"other");
            assert!(install.is_dir());
        }
    }
}
#[test]
fn complete_removal_and_missing_payload_removal_are_idempotent() {
    for missing in [false, true] {
        let (_data, mut manager, journal) = setup();
        let (install, _, target) = paths(&journal).unwrap();
        if missing {
            fs::remove_file(install.join("payload")).unwrap();
            fs::remove_dir(&install).unwrap();
        }
        assert!(remove(&mut manager, "ffmpeg-cpu").unwrap().is_some());
        assert!(remove(&mut manager, "ffmpeg-cpu").unwrap().is_none());
        assert!(!install.exists());
        assert!(!target.exists());
        assert_eq!(manager.configuration, Some(journal.next));
        assert!(!pending(&manager.config_path).unwrap());
    }
}
#[test]
fn journal_rejects_unknown_schema_scope_and_staging_paths() {
    for mutation in 0..4 {
        let (_data, manager, mut journal) = setup();
        match mutation {
            0 => journal.schema_version = 2,
            1 => journal.next.preferred_profile = "fast".into(),
            2 => journal.staging_id = "../outside".into(),
            _ => journal.receipt.install_relative_path = "receipts".into(),
        }
        let path = journal_path(&manager.config_path).unwrap();
        persist_json(&path, &journal).unwrap();
        let before = fs::read(&path).unwrap();
        assert!(recover(&manager.config_path).is_err());
        assert_eq!(fs::read(path).unwrap(), before);
    }
}

#[test]
fn conflicting_journals_are_preserved_before_any_recovery() {
    let (data, manager, journal) = setup();
    prepare(&manager, &journal);
    stage(&journal);
    let activation = data.path().join("resource-activation.json");
    fs::write(&activation, b"conflicting").unwrap();
    assert!(LocalResourceManager::load(data.path()).is_err());
    assert_eq!(fs::read(activation).unwrap(), b"conflicting");
    assert!(pending(&manager.config_path).unwrap());
    let (install, staged, _) = paths(&journal).unwrap();
    assert!(!install.exists());
    assert!(staged.is_dir());
}
#[test]
fn non_directory_payload_or_staging_parent_blocks_before_mutation() {
    for payload in [false, true] {
        let (_data, mut manager, journal) = setup();
        let root = configuration_root(&journal.previous);
        let target = if payload {
            root.join("packages/ffmpeg-cpu/1")
        } else {
            root.join("staging")
        };
        if payload {
            fs::remove_file(target.join("payload")).unwrap();
        }
        fs::remove_dir(&target).unwrap();
        fs::write(&target, b"retained").unwrap();
        assert!(remove(&mut manager, "ffmpeg-cpu").is_err());
        assert_eq!(fs::read(target).unwrap(), b"retained");
        assert_eq!(manager.configuration, Some(journal.previous));
        assert!(!pending(&manager.config_path).unwrap());
    }
}
#[test]
fn initial_journal_preparation_does_not_replace_existing_sidecar() {
    let (_data, manager, journal) = setup();
    let path = journal_path(&manager.config_path).unwrap();
    let part = path.with_extension("json.part");
    fs::write(&part, b"retained").unwrap();
    assert!(files::prepare(&path, &journal).is_err());
    assert_eq!(fs::read(part).unwrap(), b"retained");
    assert!(!path.exists());
    assert_eq!(manager.configuration, Some(journal.previous));
}
