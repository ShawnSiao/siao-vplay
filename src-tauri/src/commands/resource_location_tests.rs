use super::*;
use crate::resource_migration;
use std::{fs, process::Command};
fn isolated(name: &str, mode: &str) {
    if std::env::var("SIAOVPLAY_LOCATION_SYNC_TEST").as_deref() != Ok(name) {
        let result = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                &format!("commands::resource_location_tests::{name}"),
                "--nocapture",
            ])
            .env("SIAOVPLAY_LOCATION_SYNC_TEST", name)
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
    let legacy = data.path().join("runtime-settings.json");
    let content = br#"{"storageRoot":null,"preferredModel":"small"}"#;
    fs::write(&legacy, content).unwrap();
    local_resources::initialize(data.path()).unwrap();
    local_resources::configure_location(data.path().to_str().unwrap(), true).unwrap();
    resource_download::initialize().unwrap();
    runtime::initialize(data.path()).unwrap();
    // A directory at the legacy temporary-file path reproduces failed duplicate writes.
    fs::create_dir(data.path().join("runtime-settings.json.part")).unwrap();
    let target = data.path().join("selected");
    fs::create_dir(&target).unwrap();
    match mode {
        "configure" | "binding" => {
            if mode == "binding" {
                let state = target.join("SiaoVPlay").join("state");
                fs::create_dir_all(&state).unwrap();
                fs::write(state.join("download-tasks.json"), b"{broken").unwrap();
            }
            let plan = local_resources::plan_location(target.to_str().unwrap()).unwrap();
            let result = tauri::async_runtime::block_on(configure_local_resource_root(ConfigureLocalResourceRootInput {
                parent_path: plan.selected_parent,
                resource_root: plan.resource_root,
                plan_fingerprint: plan.plan_fingerprint,
                confirmed: true,
            }))
            .expect("saved location must not fail because legacy settings cannot be rewritten");
            if mode == "binding" {
                assert!(result.binding_error.is_some());
                assert!(result.task_snapshot.is_none());
                let root = result.status.resource_root.clone().unwrap();
                let snapshot = fs::read(data.path().join("local-resources.json")).unwrap();
                let task_store = std::path::Path::new(&root).join("state/download-tasks.json");
                resource_download::initialize_for_startup().unwrap();
                assert!(resource_download::list_tasks().is_err());
                assert!(
                    crate::resource_location::inspect()
                        .unwrap()
                        .binding_error
                        .is_some()
                );
                let input = || crate::resource_location::RetryResourceBindingInput {
                    resource_root: root.clone(),
                    configuration_fingerprint: result.configuration_fingerprint.clone(),
                };
                let mut stale = input();
                stale.configuration_fingerprint = "0".repeat(64);
                assert!(crate::resource_location::retry(stale).is_err());
                {
                    let _maintenance = crate::resource_leases::maintain_all().unwrap();
                    let input = input();
                    assert!(
                        std::thread::spawn(move || crate::resource_location::retry(input).is_err())
                            .join()
                            .unwrap()
                    );
                }
                assert_eq!(fs::read(&task_store).unwrap(), b"{broken");
                let still_failed = crate::resource_location::retry(input()).unwrap();
                assert!(still_failed.binding_error.is_some());
                fs::write(&task_store, br#"{"schemaVersion":1,"tasks":[]}"#).unwrap();
                let recovered = crate::resource_location::retry(input()).unwrap();
                assert!(recovered.binding_error.is_none());
                assert!(recovered.task_snapshot.is_some());
                assert_eq!(
                    fs::read(data.path().join("local-resources.json")).unwrap(),
                    snapshot
                );
            }
        }
        "repair" => {
            tauri::async_runtime::block_on(repair_local_resource_root(ConfirmLocalResourceOperationInput { confirmed: true }))
                .unwrap();
        }
        "reconnect" => {
            let root = target.join("SiaoVPlay");
            fs::create_dir(&root).unwrap();
            for path in local_resources::resource_subdirectories() {
                fs::create_dir(root.join(path)).unwrap();
            }
            resource_migration::reconnect_resource_root(
                resource_migration::ReconnectLocalResourceRootInput {
                    parent_path: target.to_string_lossy().into_owned(),
                    confirmed: true,
                },
            )
            .unwrap();
        }
        "move" => {
            let plan =
                resource_migration::plan_resource_root_move(target.to_str().unwrap()).unwrap();
            resource_migration::move_resource_root(
                resource_migration::MoveLocalResourceRootInput {
                    parent_path: plan.selected_parent,
                    plan_fingerprint: plan.plan_fingerprint,
                    confirmed: true,
                },
                "fixture-request",
            )
            .unwrap();
        }
        _ => unreachable!(),
    }
    let expected = local_resources::configured_root().unwrap();
    assert_eq!(runtime::configured_runtime_root().unwrap(), expected);
    assert_eq!(
        std::path::PathBuf::from(runtime::catalog().unwrap().settings.storage_root.unwrap()),
        expected
    );
    assert_eq!(fs::read(&legacy).unwrap(), content);
    local_resources::initialize(data.path()).unwrap();
    runtime::initialize(data.path()).unwrap();
    assert_eq!(runtime::configured_runtime_root().unwrap(), expected);
    assert_eq!(
        std::path::PathBuf::from(runtime::catalog().unwrap().settings.storage_root.unwrap()),
        expected
    );
    assert!(data.path().join("runtime-settings.json.part").is_dir());
}
#[test]
fn configure_uses_authoritative_resource_settings() {
    isolated(
        "configure_uses_authoritative_resource_settings",
        "configure",
    );
}
#[test]
fn repair_uses_authoritative_resource_settings() {
    isolated("repair_uses_authoritative_resource_settings", "repair");
}
#[test]
fn reconnect_uses_authoritative_resource_settings() {
    isolated(
        "reconnect_uses_authoritative_resource_settings",
        "reconnect",
    );
}
#[test]
fn move_uses_authoritative_resource_settings() {
    isolated("move_uses_authoritative_resource_settings", "move");
}

#[test]
fn saved_location_survives_task_binding_failure() {
    isolated("saved_location_survives_task_binding_failure", "binding");
}
