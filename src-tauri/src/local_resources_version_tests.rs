use std::{collections::BTreeMap, fs};

use tempfile::tempdir;

use super::{
    LocalResourceCapabilityState, LocalResourceError, LocalResourceManager, RECEIPT_SCHEMA_VERSION,
    RESOURCE_DIRECTORY_NAME, ResourceReceipt, resource_definition,
};

fn fixture_receipt(version: &str, health_status: &str) -> ResourceReceipt {
    ResourceReceipt {
        schema_version: RECEIPT_SCHEMA_VERSION,
        resource_id: "ffmpeg-cpu".to_owned(),
        version: version.to_owned(),
        install_relative_path: format!("packages/ffmpeg-cpu/{version}"),
        entrypoints: BTreeMap::from([
            ("ffmpeg".to_owned(), "bin/ffmpeg.exe".to_owned()),
            ("ffprobe".to_owned(), "bin/ffprobe.exe".to_owned()),
        ]),
        files: Vec::new(),
        health_status: health_status.to_owned(),
        activated_at_ms: None,
    }
}

#[test]
fn failed_new_version_keeps_the_previous_version_active_and_update_is_visible() {
    let data = tempdir().expect("data directory");
    let parent = tempdir().expect("resource parent");
    let mut manager = LocalResourceManager::load(data.path()).expect("manager should load");
    manager
        .configure_location(parent.path().to_str().expect("UTF-8 path"), true)
        .expect("configuration should succeed");
    let root = parent.path().join(RESOURCE_DIRECTORY_NAME);
    let current_version = resource_definition("ffmpeg-cpu")
        .expect("FFmpeg resource should exist")
        .version;
    for version in ["7.0", current_version.as_str()] {
        let install = root.join(format!("packages/ffmpeg-cpu/{version}/bin"));
        fs::create_dir_all(&install).expect("install directory should create");
        fs::write(install.join("ffmpeg.exe"), b"ffmpeg").expect("ffmpeg should write");
        fs::write(install.join("ffprobe.exe"), b"ffprobe").expect("ffprobe should write");
    }
    manager
        .activate_receipt(fixture_receipt("7.0", "passed"))
        .expect("old version should activate");
    assert!(manager.resource_update_available("ffmpeg-cpu"));
    assert_eq!(
        manager
            .status()
            .expect("status should resolve")
            .capabilities
            .iter()
            .find(|capability| capability.id == "basic_media")
            .expect("basic media should exist")
            .state,
        LocalResourceCapabilityState::UpdateAvailable
    );

    let error = manager
        .activate_receipt(fixture_receipt(&current_version, "failed"))
        .expect_err("failed health must not activate");
    assert!(matches!(error, LocalResourceError::InvalidReceipt(_)));
    assert_eq!(
        manager
            .configuration
            .as_ref()
            .and_then(|configuration| configuration.active_resources.get("ffmpeg-cpu"))
            .map(String::as_str),
        Some("7.0")
    );
    assert!(
        !root
            .join(format!("receipts/ffmpeg-cpu/{current_version}.json"))
            .exists()
    );

    manager
        .activate_receipt(fixture_receipt(&current_version, "passed"))
        .expect("healthy new version should activate");
    assert_eq!(
        manager
            .configuration
            .as_ref()
            .and_then(|configuration| configuration.active_resources.get("ffmpeg-cpu"))
            .map(String::as_str),
        Some(current_version.as_str())
    );
    assert!(root.join("receipts/ffmpeg-cpu/7.0.json").is_file());
    assert!(!manager.resource_update_available("ffmpeg-cpu"));
}
