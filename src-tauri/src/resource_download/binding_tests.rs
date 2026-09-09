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
    let old_partial = old_root.join("downloads").join(format!("{id}.part"));
    fs::write(&old_partial, b"retained-old-root-partial").unwrap();
    {
        let _maintenance = crate::resource_leases::maintain_all().unwrap();
        assert!(
            std::thread::spawn({
                let id = id.clone();
                move || cancel_task(&id).is_err()
            })
            .join()
            .unwrap(),
            "cancellation must not enter resource maintenance concurrently"
        );
        assert_eq!(
            fs::read(&old_partial).unwrap(),
            b"retained-old-root-partial"
        );
    }
    let old_store = fs::read(old_root.join("state").join(TASK_STORE_FILE_NAME)).unwrap();
    let selected = data.path().join("selected");
    fs::create_dir(&selected).unwrap();
    local_resources::configure_location(selected.to_str().unwrap(), true).unwrap();
    let root = local_resources::configured_root().unwrap();
    let new_partial = root.join("downloads").join(format!("{id}.part"));
    let new_staging = root.join("staging").join(&id);
    fs::create_dir(&new_staging).unwrap();
    fs::write(&new_partial, b"new-root-partial").unwrap();
    fs::write(new_staging.join("retained.bin"), b"new-root-staging").unwrap();
    assert!(
        cancel_task(&id).is_err(),
        "old-root cancellation must fail before binding the new root"
    );
    assert_eq!(fs::read(&new_partial).unwrap(), b"new-root-partial");
    assert_eq!(
        fs::read(new_staging.join("retained.bin")).unwrap(),
        b"new-root-staging"
    );
    assert_eq!(
        fs::read(old_root.join("state").join(TASK_STORE_FILE_NAME)).unwrap(),
        old_store
    );
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
    let current_id = with_manager_write(|manager| {
        let resource = local_resources::resource_definition("ffmpeg-cpu")?;
        let (id, _) = manager.ensure_task_record(&resource, "basic_media", None, false)?;
        manager.persist()?;
        Ok(id)
    })
    .unwrap();
    let (partial, staging) = task_paths(&current_id).unwrap();
    fs::write(&partial, b"current").unwrap();
    fs::create_dir(&staging).unwrap();
    fs::write(staging.join("current.bin"), b"current").unwrap();
    assert_eq!(
        cancel_task(&current_id).unwrap().state,
        ResourceDownloadTaskState::Cancelled
    );
    assert!(!partial.exists());
    assert!(!staging.exists());
    assert_eq!(fs::read(&new_partial).unwrap(), b"new-root-partial");
    assert_eq!(
        fs::read(new_staging.join("retained.bin")).unwrap(),
        b"new-root-staging"
    );
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
