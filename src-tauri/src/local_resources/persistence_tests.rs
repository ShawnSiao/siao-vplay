use super::*;
use tempfile::{tempdir, TempDir};
fn setup() -> (TempDir, TempDir, LocalResourceManager) {
    let data = tempdir().unwrap(); let parent = tempdir().unwrap();
    let mut manager = LocalResourceManager::load(data.path()).unwrap();
    manager.configure_location(parent.path().to_str().unwrap(), true).unwrap();
    manager.activate_receipt(receipt("1")).unwrap();
    (data, parent, manager)
}
fn receipt(version: &str) -> ResourceReceipt {
    ResourceReceipt { schema_version: RECEIPT_SCHEMA_VERSION, resource_id: "ffmpeg-cpu".into(),
        version: version.into(), install_relative_path: format!("packages/ffmpeg-cpu/{version}"),
        entrypoints: [("ffmpeg".into(), "bin/ffmpeg.exe".into())].into(), files: Vec::new(), health_status: "passed".into(), activated_at_ms: None }
}
fn assert_failed_save_keeps_configuration(mut manager: LocalResourceManager, operation: impl FnOnce(&mut LocalResourceManager) -> Result<(), LocalResourceError>) {
    let before = manager.configuration.clone();
    let bytes = fs::read(&manager.config_path).unwrap();
    fs::create_dir(manager.config_path.with_extension("json.part")).unwrap();
    assert!(operation(&mut manager).is_err());
    assert_eq!(manager.configuration, before, "a failed save must not change the live configuration");
    assert_eq!(fs::read(&manager.config_path).unwrap(), bytes);
    let reloaded = LocalResourceManager::load(manager.config_path.parent().unwrap()).unwrap();
    assert_eq!(reloaded.configuration, manager.configuration);
}
#[test]
fn failed_profile_save_preserves_live_and_persisted_configuration() {
    let (_data, _parent, manager) = setup();
    assert_failed_save_keeps_configuration(manager, |manager| manager.set_preferred_profile("fast").map(|_| ()));
}
#[test]
fn failed_activation_save_preserves_live_and_persisted_configuration() {
    let (_data, _parent, manager) = setup();
    assert_failed_save_keeps_configuration(manager, |manager| manager.activate_receipt(receipt("2")));
}
#[test]
fn failed_deactivation_save_preserves_live_and_persisted_configuration() {
    let (_data, _parent, manager) = setup();
    assert_failed_save_keeps_configuration(manager, |manager| manager.deactivate_resource("ffmpeg-cpu").map(|_| ()));
}
#[test]
fn failed_root_repair_save_preserves_live_and_persisted_configuration() {
    let (_data, parent, manager) = setup();
    fs::rename(configuration_root(manager.configuration.as_ref().unwrap()), parent.path().join("retained-root")).unwrap();
    assert_failed_save_keeps_configuration(manager, |manager| manager.repair_configured_root(true).map(|_| ()));
}

#[test]
fn failed_same_version_activation_restores_original_receipt() {
    let (_data, _parent, mut manager) = setup();
    let path = configuration_root(manager.configuration.as_ref().unwrap()).join("receipts/ffmpeg-cpu/1.json");
    let before = fs::read(&path).unwrap();
    fs::create_dir(manager.config_path.with_extension("json.part")).unwrap();
    let mut changed = receipt("1"); changed.entrypoints.insert("ffmpeg".into(), "bin/changed.exe".into());
    assert!(manager.activate_receipt(changed).is_err());
    assert_eq!(fs::read(path).unwrap(), before);
}
#[test]
fn failed_new_version_activation_does_not_leave_a_committed_receipt() {
    let (_data, _parent, mut manager) = setup();
    let path = configuration_root(manager.configuration.as_ref().unwrap()).join("receipts/ffmpeg-cpu/2.json");
    fs::create_dir(manager.config_path.with_extension("json.part")).unwrap();
    assert!(manager.activate_receipt(receipt("2")).is_err()); assert!(!path.exists());
}

#[test]
fn inactive_receipt_removal_clears_recovery_sidecars_even_without_primary() {
    for primary in [true, false] {
        let (_data, _parent, mut manager) = setup();
        manager.activate_receipt(receipt("2")).unwrap();
        let path = configuration_root(manager.configuration.as_ref().unwrap()).join("receipts/ffmpeg-cpu/1.json");
        let bytes = fs::read(&path).unwrap();
        for extension in ["json.bak", "json.part"] { fs::write(path.with_extension(extension), &bytes).unwrap(); }
        if !primary { fs::remove_file(&path).unwrap(); }
        assert!(manager.remove_inactive_receipt("ffmpeg-cpu", "1").unwrap());
        for candidate in [&path, &path.with_extension("json.bak"), &path.with_extension("json.part")] { assert!(!candidate.exists(), "removed receipt must not remain recoverable: {}", candidate.display()); }
    }
}

#[test]
fn inactive_receipt_removal_rejects_non_file_sidecar_before_deleting_primary() {
    let (_data, _parent, mut manager) = setup();
    manager.activate_receipt(receipt("2")).unwrap();
    let path = configuration_root(manager.configuration.as_ref().unwrap()).join("receipts/ffmpeg-cpu/1.json");
    let before = fs::read(&path).unwrap();
    fs::create_dir(path.with_extension("json.bak")).unwrap();
    assert!(manager.remove_inactive_receipt("ffmpeg-cpu", "1").is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn active_removal_preflight_failure_preserves_configuration_and_payload() {
    let (_data, _parent, mut manager) = setup();
    let root = configuration_root(manager.configuration.as_ref().unwrap());
    let install = root.join("packages/ffmpeg-cpu/1");
    fs::create_dir_all(&install).unwrap(); fs::write(install.join("payload"), b"keep").unwrap();
    let target = root.join("receipts/ffmpeg-cpu/1.json");
    let before = fs::read(&manager.config_path).unwrap();
    fs::create_dir(target.with_extension("json.bak")).unwrap();
    assert!(manager.deactivate_resource("ffmpeg-cpu").is_err());
    assert_eq!(fs::read(&manager.config_path).unwrap(), before);
    assert_eq!(fs::read(install.join("payload")).unwrap(), b"keep");
    assert!(target.is_file());
}
