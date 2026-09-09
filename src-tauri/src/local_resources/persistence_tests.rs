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
