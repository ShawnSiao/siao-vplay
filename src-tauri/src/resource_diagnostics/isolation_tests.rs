use super::*;
use std::{fs, process::Command};

// Resource managers are process-global. Each case gets its own child process,
// isolated temporary data, and the caller's W-drive temporary-directory policy.
fn isolated(name: &str, body: impl FnOnce()) {
    if std::env::var("SIAOVPLAY_DIAGNOSTIC_TEST").as_deref() == Ok(name) {
        body();
        return;
    }
    let result = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            &format!("resource_diagnostics::isolation_tests::{name}"),
            "--nocapture",
        ])
        .env("SIAOVPLAY_DIAGNOSTIC_TEST", name)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
}

fn setup() -> (tempfile::TempDir, PathBuf) {
    let data = tempfile::tempdir().unwrap();
    local_resources::initialize(data.path()).unwrap();
    local_resources::configure_location(data.path().to_str().unwrap(), true).unwrap();
    resource_download::initialize().unwrap();
    let root = local_resources::configured_root().unwrap();
    (data, root)
}

#[test]
fn unreadable_resource_does_not_hide_other_diagnostics() {
    isolated(
        "unreadable_resource_does_not_hide_other_diagnostics",
        || {
            let (data, root) = setup();
            let id = &local_resources::catalog().unwrap().resources[0].id;
            let blocked = root.join("receipts").join(id);
            fs::write(&blocked, b"preserve obstruction").unwrap();
            let journal = data.path().join("resource-activation.json.bak");
            fs::write(&journal, b"preserve unfinished record").unwrap();
            let result = diagnostics()
                .expect("one unreadable receipt directory must not hide the diagnostic snapshot");
            let wire = serde_json::to_value(&result).unwrap();
            assert_eq!(
                wire["maintenance"]["transactionState"],
                "activation_pending"
            );
            let resource = wire["resources"]
                .as_array()
                .unwrap()
                .iter()
                .find(|r| r["id"] == *id)
                .unwrap();
            assert_eq!(resource["versionsReadable"], false);
            assert_eq!(resource["state"], "repair_required");
            assert!(
                wire["resources"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|r| r["id"] != *id && r["versionsReadable"] == true)
            );
            assert!(diagnostic_summary().unwrap().contains("版本检查未完成"));
            assert_eq!(fs::read(blocked).unwrap(), b"preserve obstruction");
            assert_eq!(fs::read(journal).unwrap(), b"preserve unfinished record");
        },
    );
}

#[test]
fn copied_summary_omits_freeform_task_secrets_and_paths() {
    isolated(
        "copied_summary_omits_freeform_task_secrets_and_paths",
        || {
            let (_data, _root) = setup();
            let mut value = diagnostics().unwrap();
            value.tasks.push(ResourceTaskDiagnostic { id: "private-id".into(), resource_id: value.resources[0].id.clone(),
            version: "1".into(), state: "failed".into(), downloaded_bytes: 0, total_bytes: 0,
            error_code: Some("local_resource_download_failed".into()),
            error_message: Some("failed F:\\private media\\lesson.mp4 http://user:password@private.test/file?signature=private-token Authorization: Bearer private-bearer".into()) });
            value.tasks.push(ResourceTaskDiagnostic {
                id: "private-id".into(),
                resource_id: "private-resource".into(),
                version: "1".into(),
                state: "private-state".into(),
                downloaded_bytes: 0,
                total_bytes: 0,
                error_code: Some("private-code".into()),
                error_message: None,
            });
            let text = summary::render(value).unwrap();
            for private in [
                "private media",
                "lesson.mp4",
                "password",
                "private.test",
                "private-token",
                "private-bearer",
                "private-id",
                "private-resource",
                "private-state",
                "private-code",
            ] {
                assert!(!text.contains(private), "copied summary leaked {private}");
            }
            assert!(text.contains("local_resource_download_failed"));
            assert!(text.contains("失败详情未包含在摘要中"));
        },
    );
}
