use super::*;

fn setup() -> (tempfile::TempDir, LocalResourceManager, Journal) {
    let (data, mut manager, mut journal) = tests::setup();
    let mut active = journal.receipt.clone();
    active.version = "2".into();
    active.install_relative_path = "packages/ffmpeg-cpu/2".into();
    manager.activate_receipt(active).unwrap();
    let root = configuration_root(manager.configuration.as_ref().unwrap());
    fs::create_dir_all(root.join("packages/ffmpeg-cpu/2")).unwrap();
    fs::write(root.join("packages/ffmpeg-cpu/2/active"), b"active").unwrap();
    journal.previous = manager.configuration.clone().unwrap();
    journal.next = journal.previous.clone();
    journal.mode = Mode::Inactive;
    (data, manager, journal)
}
#[test]
fn inactive_precommit_startup_restores_payload_without_changing_active_configuration() {
    for staged in [false, true] {
        let (data, manager, journal) = setup();
        files::prepare(&journal_path(&manager.config_path).unwrap(), &journal).unwrap();
        if staged {
            tests::stage(&journal);
        }
        let before = fs::read(&manager.config_path).unwrap();
        let loaded = LocalResourceManager::load(data.path()).unwrap();
        let (install, staged, target) = paths(&journal).unwrap();
        assert_eq!(
            fs::read(install.join("payload")).unwrap(),
            b"original payload"
        );
        assert!(!staged.exists());
        assert_eq!(fs::read_to_string(target).unwrap(), journal.receipt_raw);
        assert_eq!(fs::read(&manager.config_path).unwrap(), before);
        assert_eq!(loaded.configuration, Some(journal.previous));
        assert!(!pending(&manager.config_path).unwrap());
    }
}
#[test]
fn inactive_committed_startup_finishes_cleanup_and_preserves_active_payload() {
    for receipt_removed in [false, true] {
        let (data, manager, mut journal) = setup();
        files::prepare(&journal_path(&manager.config_path).unwrap(), &journal).unwrap();
        tests::stage(&journal);
        journal.committed = true;
        persist_json(&journal_path(&manager.config_path).unwrap(), &journal).unwrap();
        let (install, staged, target) = paths(&journal).unwrap();
        if receipt_removed {
            fs::remove_file(&target).unwrap();
        }
        let before = fs::read(&manager.config_path).unwrap();
        let loaded = LocalResourceManager::load(data.path()).unwrap();
        assert!(!install.exists());
        assert!(!staged.exists());
        assert!(!target.exists());
        assert_eq!(fs::read(&manager.config_path).unwrap(), before);
        assert_eq!(loaded.configuration, Some(journal.previous.clone()));
        assert_eq!(
            fs::read(configuration_root(&journal.previous).join("packages/ffmpeg-cpu/2/active"))
                .unwrap(),
            b"active"
        );
        assert!(!pending(&manager.config_path).unwrap());
    }
}
#[test]
fn failed_inactive_commit_marker_write_restores_payload_and_retains_obstruction() {
    let (_data, mut manager, journal) = setup();
    let before = fs::read(&manager.config_path).unwrap();
    let result = execute(
        &mut manager,
        journal.receipt.clone(),
        Mode::Inactive,
        |path| {
            fs::create_dir(path.with_extension("json.part"))?;
            Ok(())
        },
    );
    assert!(result.is_err());
    let (install, _, target) = paths(&journal).unwrap();
    assert_eq!(
        fs::read(install.join("payload")).unwrap(),
        b"original payload"
    );
    assert_eq!(fs::read_to_string(target).unwrap(), journal.receipt_raw);
    assert_eq!(fs::read(&manager.config_path).unwrap(), before);
    assert!(pending(&manager.config_path).unwrap());
    fs::remove_dir(
        journal_path(&manager.config_path)
            .unwrap()
            .with_extension("json.part"),
    )
    .unwrap();
    recover(&manager.config_path).unwrap();
    assert!(!pending(&manager.config_path).unwrap());
}
#[test]
fn inactive_request_cannot_remove_active_version() {
    let (_data, mut manager, journal) = setup();
    let before = fs::read(&manager.config_path).unwrap();
    assert!(remove_inactive(&mut manager, "ffmpeg-cpu", "2").is_err());
    assert_eq!(fs::read(&manager.config_path).unwrap(), before);
    assert_eq!(
        fs::read(configuration_root(&journal.previous).join("packages/ffmpeg-cpu/2/active"))
            .unwrap(),
        b"active"
    );
    assert!(!pending(&manager.config_path).unwrap());
}
#[test]
fn old_active_journal_schema_still_recovers_both_sides_of_commit() {
    for committed in [false, true] {
        let (data, manager, journal) = tests::setup();
        tests::stage(&journal);
        let mut legacy = serde_json::to_value(&journal).unwrap();
        let object = legacy.as_object_mut().unwrap();
        object.insert("schemaVersion".into(), 1.into());
        object.remove("mode");
        object.remove("committed");
        persist_json(&journal_path(&manager.config_path).unwrap(), &legacy).unwrap();
        if committed {
            persist_json(&manager.config_path, &journal.next).unwrap();
        }
        LocalResourceManager::load(data.path()).unwrap();
        let (install, staged, target) = paths(&journal).unwrap();
        assert_eq!(install.exists(), !committed);
        assert_eq!(target.exists(), !committed);
        assert!(!staged.exists());
        assert!(!pending(&manager.config_path).unwrap());
    }
}
#[test]
fn inactive_journal_rejects_active_target_or_configuration_delta() {
    for active in [false, true] {
        let (_data, manager, mut journal) = setup();
        if active {
            journal
                .previous
                .active_resources
                .insert("ffmpeg-cpu".into(), "1".into());
            journal.next = journal.previous.clone();
        } else {
            journal.next.preferred_profile = "fast".into();
        }
        let path = journal_path(&manager.config_path).unwrap();
        persist_json(&path, &journal).unwrap();
        let before = fs::read(&path).unwrap();
        assert!(recover(&manager.config_path).is_err());
        assert_eq!(fs::read(path).unwrap(), before);
    }
}

#[test]
fn inactive_marker_rename_boundaries_recover_the_committed_primary_only() {
    for committed_primary in [false, true] {
        let (_data, manager, mut journal) = setup();
        let path = journal_path(&manager.config_path).unwrap();
        files::prepare(&path, &journal).unwrap();
        tests::stage(&journal);
        fs::rename(&path, path.with_extension("json.bak")).unwrap();
        journal.committed = true;
        fs::write(
            path.with_extension("json.part"),
            serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
        if committed_primary {
            fs::rename(path.with_extension("json.part"), &path).unwrap();
        }
        let before = fs::read(&manager.config_path).unwrap();
        recover(&manager.config_path).unwrap();
        let (install, staged, target) = paths(&journal).unwrap();
        assert_eq!(install.exists(), !committed_primary);
        assert_eq!(target.exists(), !committed_primary);
        assert!(!staged.exists());
        assert!(!pending(&manager.config_path).unwrap());
        assert_eq!(fs::read(&manager.config_path).unwrap(), before);
    }
}
#[test]
fn unknown_removal_mode_is_preserved_and_rejected() {
    let (_data, manager, journal) = setup();
    let mut unknown = serde_json::to_value(&journal).unwrap();
    unknown["mode"] = "unknown".into();
    let path = journal_path(&manager.config_path).unwrap();
    persist_json(&path, &unknown).unwrap();
    let before = fs::read(&path).unwrap();
    assert!(recover(&manager.config_path).is_err());
    assert_eq!(fs::read(path).unwrap(), before);
}
