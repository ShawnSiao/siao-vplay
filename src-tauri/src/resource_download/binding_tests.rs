use super::*;
fn isolated(name: &str, corrupt: &[u8]) {
    if std::env::var("SIAOVPLAY_DOWNLOAD_BIND_TEST").as_deref() != Ok(name) {
        let result = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                &format!("resource_download::binding_tests::{name}"),
                "--nocapture",
            ])
            .env("SIAOVPLAY_DOWNLOAD_BIND_TEST", name)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
        return;
    }
    let data = tempfile::tempdir().unwrap();
    local_resources::initialize(data.path()).unwrap();
    local_resources::configure_location(data.path().to_str().unwrap(), true).unwrap();
    initialize().unwrap();
    let old_root = local_resources::configured_root().unwrap();
    let id = with_manager_write(|manager| {
        let resource = local_resources::resource_definition("ffmpeg-cpu")?;
        let (id, _) = manager.ensure_task_record(&resource, "basic_media", None, false)?;
        manager.persist()?;
        Ok(id)
    })
    .unwrap();
    let old_store = fs::read(old_root.join("state").join(TASK_STORE_FILE_NAME)).unwrap();
    let selected = data.path().join("selected");
    fs::create_dir(&selected).unwrap();
    local_resources::configure_location(selected.to_str().unwrap(), true).unwrap();
    let root = local_resources::configured_root().unwrap();
    let store = root.join("state").join(TASK_STORE_FILE_NAME);
    fs::write(&store, corrupt).unwrap();
    let configuration = fs::read(data.path().join("local-resources.json")).unwrap();
    assert!(bind_configured_root().is_err());
    assert!(
        list_tasks().is_err(),
        "failed binding must not expose old-root tasks"
    );
    let mut entered = false;
    assert!(
        with_manager_write(|_| {
            entered = true;
            Ok(())
        })
        .is_err()
    );
    assert!(
        !entered,
        "failed binding must reject writes before entering their callback"
    );
    assert!(
        task_paths(&id).is_err(),
        "old task must not resolve under the new root"
    );
    assert_eq!(fs::read(&store).unwrap(), corrupt);
    assert_eq!(
        fs::read(old_root.join("state").join(TASK_STORE_FILE_NAME)).unwrap(),
        old_store
    );
    // Fixture repair permits an explicit binding retry; it never replays configuration writes.
    fs::write(&store, br#"{"schemaVersion":1,"tasks":[]}"#).unwrap();
    bind_configured_root().unwrap();
    assert!(list_tasks().unwrap().is_empty());
    assert!(task_paths(&id).is_err());
    assert_eq!(
        fs::read(data.path().join("local-resources.json")).unwrap(),
        configuration
    );
    assert_eq!(
        fs::read(old_root.join("state").join(TASK_STORE_FILE_NAME)).unwrap(),
        old_store
    );
}
#[test]
fn malformed_store_blocks_stale_manager_until_rebound() {
    isolated(
        "malformed_store_blocks_stale_manager_until_rebound",
        b"{broken",
    );
}
#[test]
fn future_store_blocks_stale_manager_until_rebound() {
    isolated(
        "future_store_blocks_stale_manager_until_rebound",
        br#"{"schemaVersion":999,"tasks":[]}"#,
    );
}
