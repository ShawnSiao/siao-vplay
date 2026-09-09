use super::*;
use tempfile::tempdir;

#[test]
fn unreadable_initialized_proxy_config_is_not_treated_as_no_proxy() {
    let data = tempdir().unwrap();
    let path = data.path().join(SETTINGS_FILE_NAME);
    std::fs::write(&path, b"{broken").unwrap();
    let store = NetworkStore::new(path);
    assert!(matches!(store.effective_proxy(), Err(AiError::ConfigurationRead)));
}

#[test]
fn snapshots_wait_for_the_current_settings_mutation() {
    let data = tempdir().unwrap();
    let store = std::sync::Arc::new(NetworkStore::new(data.path().join(SETTINGS_FILE_NAME)));
    let guard = store.mutation_lock.lock().unwrap();
    let reader = store.clone();
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let (tx, rx) = std::sync::mpsc::channel();
    let thread = std::thread::spawn(move || { started_tx.send(()).unwrap(); tx.send(reader.snapshot()).unwrap(); });
    started_rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
    let early = rx.recv_timeout(std::time::Duration::from_millis(50));
    drop(guard);
    thread.join().unwrap();
    assert!(matches!(early, Err(std::sync::mpsc::RecvTimeoutError::Timeout)));
    assert!(rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap().is_ok());
}

#[test]
fn validates_proxy_and_migrates_legacy_setting_once() {
    let data = tempdir().expect("tempdir");
    let store = NetworkStore::new(data.path().join(SETTINGS_FILE_NAME));
    store
        .migrate_legacy_proxy(Some("http://127.0.0.1:7897"))
        .expect("migration");
    let snapshot = store.snapshot().expect("snapshot");
    assert_eq!(snapshot.revision, 1);
    assert_eq!(
        snapshot.custom_proxy_url.as_deref(),
        Some("http://127.0.0.1:7897")
    );
    assert!(normalize_proxy_url(Some("http://user:secret@proxy.example")).is_err());
}

#[test]
fn windows_proxy_parser_prefers_https_and_normalizes_address() {
    assert_eq!(
        parse_windows_proxy_server("http=127.0.0.1:8080;https=127.0.0.1:7897"),
        Some("http://127.0.0.1:7897".to_owned())
    );
    assert_eq!(
        parse_windows_proxy_server("http://proxy.example:3128"),
        Some("http://proxy.example:3128".to_owned())
    );
    assert_eq!(parse_windows_proxy_server("socks=127.0.0.1:1080"), None);
}

#[test]
fn invalid_stored_settings_stop_both_client_paths_and_preserve_the_file() {
    for content in [
        "{broken",
        r#"{"schemaVersion":2,"revision":0,"customProxyUrl":null}"#,
        r#"{"schemaVersion":1,"revision":9007199254740992,"customProxyUrl":null}"#,
        r#"{"schemaVersion":1,"revision":1,"customProxyUrl":"http://user:fixture@127.0.0.1:1"}"#,
    ] {
        let data = tempdir().unwrap(); let path = data.path().join(SETTINGS_FILE_NAME);
        std::fs::write(&path, content).unwrap(); let store = NetworkStore::new(path.clone());
        let sync_error = apply_to_client_from(Client::builder(), Some(&store)).err().expect("sync path must stop");
        let async_error = build_async_client_from(reqwest::Client::builder(), Some(&store)).err().expect("async path must stop");
        assert!(sync_error.contains("已停止连接")); assert_eq!(async_error, sync_error);
        assert!(store.snapshot().is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), content);
    }
}

#[test]
fn missing_settings_and_valid_custom_proxy_remain_usable() {
    let data = tempdir().unwrap(); let store = NetworkStore::new(data.path().join(SETTINGS_FILE_NAME));
    assert!(resolve_proxy(None).is_ok());
    assert!(apply_to_client_from(Client::builder(), Some(&store)).is_ok());
    let saved = store.set(SetNetworkSettingsInput { expected_revision: 0, custom_proxy_url: Some("http://127.0.0.1:7897".to_owned()) }).unwrap();
    assert_eq!(saved.revision, 1); assert_eq!(saved.effective_source, "custom");
    assert_eq!(store.effective_proxy().unwrap(), (saved.effective_proxy_address, "custom"));
    assert!(apply_to_client_from(Client::builder(), Some(&store)).is_ok());
    assert!(build_async_client_from(reqwest::Client::builder(), Some(&store)).is_ok());
}

#[test]
fn conflicts_and_exhausted_revisions_never_overwrite_current_settings() {
    let data = tempdir().unwrap(); let path = data.path().join(SETTINGS_FILE_NAME); let store = NetworkStore::new(path.clone());
    let first = store.set_compat(Some("http://127.0.0.1:7897")).unwrap();
    let content = std::fs::read(&path).unwrap();
    assert!(matches!(store.set(SetNetworkSettingsInput { expected_revision: 0, custom_proxy_url: None }), Err(AiError::RevisionConflict)));
    assert_eq!(std::fs::read(&path).unwrap(), content);
    assert_eq!(store.snapshot().unwrap(), first);
    store.persist(&NetworkSettingsFile { schema_version: 1, revision: 9_007_199_254_740_991, custom_proxy_url: None }).unwrap();
    let content = std::fs::read(&path).unwrap();
    assert!(store.set_compat(Some("http://127.0.0.1:7898")).is_err());
    assert_eq!(std::fs::read(path).unwrap(), content);
}

#[test]
fn set_acknowledgement_and_resource_status_describe_the_written_settings() {
    let data = tempdir().unwrap(); let store = NetworkStore::new(data.path().join(SETTINGS_FILE_NAME));
    let first = store.set_compat(Some(" http://127.0.0.1:7897/ ")).unwrap();
    let resource_status: crate::resource_download::ResourceNetworkStatus = first.clone().into();
    assert_eq!(resource_status.proxy_source, "custom");
    assert_eq!(resource_status.proxy_address.as_deref(), Some("http://127.0.0.1:7897"));
    let second = store.set_compat(Some("http://127.0.0.1:7898")).unwrap();
    assert_eq!(first.custom_proxy_url.as_deref(), Some("http://127.0.0.1:7897"));
    assert_eq!(second.custom_proxy_url.as_deref(), Some("http://127.0.0.1:7898"));
    assert_eq!(second.revision, first.revision + 1);
}
