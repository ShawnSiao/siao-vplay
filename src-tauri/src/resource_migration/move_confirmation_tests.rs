use super::*;
use std::process::Command;
fn isolated(name: &str, body: impl FnOnce()) {
    if std::env::var("SIAOVPLAY_MOVE_CONFIRM_TEST").as_deref() == Ok(name) {
        body();
        return;
    }
    let result = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            &format!("resource_migration::move_confirmation_tests::{name}"),
            "--nocapture",
            "--include-ignored",
        ])
        .env("SIAOVPLAY_MOVE_CONFIRM_TEST", name)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
}

#[test]
#[ignore = "writes and verifies a 1 GiB isolated resource tree; requires explicit W: TEMP"]
fn gibibyte_move_preserves_hashes_and_reopens_selected_root() {
    isolated("gibibyte_move_preserves_hashes_and_reopens_selected_root", || {
        use std::io::Write;
        assert!(std::env::temp_dir().to_string_lossy().to_ascii_lowercase().starts_with("w:"));
        let data = tempfile::tempdir().unwrap();
        local_resources::initialize(data.path()).unwrap();
        local_resources::configure_location(data.path().to_str().unwrap(), true).unwrap();
        resource_download::initialize().unwrap();
        crate::runtime::initialize(data.path()).unwrap();
        let root = local_resources::configured_root().unwrap();
        let payload = root.join("large-fixture.bin");
        let mut file = fs::File::create(&payload).unwrap();
        let block: Vec<u8> = (0..1024 * 1024).map(|index| (index % 251) as u8).collect();
        for _ in 0..1024 { file.write_all(&block).unwrap(); }
        file.sync_all().unwrap();
        drop(file);
        let before = move_io::manifest(&root).unwrap();
        let target = data.path().join("destination");
        fs::create_dir(&target).unwrap();
        let plan = plan_resource_root_move(target.to_str().unwrap()).unwrap();
        assert!(plan.bytes_to_copy >= 1024 * 1024 * 1024);
        let cancelled_id = Uuid::new_v4().to_string();
        let registration = move_control::register(&cancelled_id).unwrap();
        let input = MoveLocalResourceRootInput { parent_path: plan.selected_parent.clone(),
            plan_fingerprint: plan.plan_fingerprint.clone(), confirmed: true };
        let worker_id = cancelled_id.clone();
        let (send, receive) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let result = registration.run(|| move_resource_root(input, &worker_id));
            send.send(result).unwrap();
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
        loop {
            let writing = fs::read_dir(&target).unwrap().filter_map(Result::ok).any(|entry| {
                entry.file_name().to_string_lossy().starts_with(".SiaoVPlay-moving-") &&
                fs::metadata(entry.path().join("large-fixture.bin"))
                    .is_ok_and(|metadata| metadata.len() > 0 && metadata.len() < 1024 * 1024 * 1024)
            });
            if writing { break; }
            assert!(!worker.is_finished(), "move completed before an in-progress copy was observed");
            assert!(std::time::Instant::now() < deadline, "copy did not start within 60 seconds");
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        assert!(move_control::cancel(&cancelled_id).unwrap());
        let cancelled = receive.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        worker.join().unwrap();
        assert!(matches!(cancelled, Err(ResourceMigrationError::Cancelled)));
        assert_eq!(local_resources::configured_root().unwrap(), root);
        assert!(!Path::new(&plan.resource_root).exists());
        let id = Uuid::new_v4().to_string();
        let result = move_control::register(&id).unwrap().run(|| move_resource_root(
            MoveLocalResourceRootInput { parent_path: plan.selected_parent,
                plan_fingerprint: plan.plan_fingerprint, confirmed: true }, &id)).unwrap();
        let moved = PathBuf::from(&result.current_root);
        let after = move_io::manifest(&moved).unwrap();
        for entry in &before {
            let copied = after.iter().find(|value| value.relative_path == entry.relative_path).unwrap();
            assert_eq!(copied.size, entry.size);
            assert_eq!(copied.sha256, entry.sha256);
        }
        let retained = move_io::manifest(&root).unwrap();
        assert_eq!(serde_json::to_value(&retained).unwrap(), serde_json::to_value(&before).unwrap());
        local_resources::initialize(data.path()).unwrap();
        crate::runtime::initialize(data.path()).unwrap();
        assert_eq!(local_resources::configured_root().unwrap(), moved);
        assert_eq!(crate::runtime::configured_runtime_root().unwrap(), moved);
        println!("verified_bytes={} verified_files={}", result.copied_bytes, result.verified_file_count);
    });
}
fn stale_case(change: &str) {
    let data = tempfile::tempdir().unwrap();
    local_resources::initialize(data.path()).unwrap();
    local_resources::configure_location(data.path().to_str().unwrap(), true).unwrap();
    resource_download::initialize().unwrap();
    crate::runtime::initialize(data.path()).unwrap();
    let root = local_resources::configured_root().unwrap();
    let file = root.join("fixture.bin");
    fs::write(&file, b"old").unwrap();
    let target = data.path().join("destination");
    fs::create_dir(&target).unwrap();
    let plan = plan_resource_root_move(target.to_str().unwrap()).unwrap();
    let fingerprint = plan.plan_fingerprint.clone();
    let mut selected = target.clone();
    if change == "payload" {
        fs::write(&file, b"new").unwrap();
    }
    if change == "configuration" {
        let mut config = local_resources::configuration_snapshot().unwrap();
        config
            .legacy_candidate_roots
            .push(data.path().to_string_lossy().into_owned());
        local_resources::replace_configuration(config).unwrap();
    }
    if change == "target" {
        selected = data.path().join("other-destination");
        fs::create_dir(&selected).unwrap();
    }
    let before = local_resources::configuration_snapshot().unwrap();
    let input = serde_json::from_value(serde_json::json!({ "parentPath": selected, "confirmed": true, "planFingerprint": fingerprint })).unwrap();
    let result = move_resource_root(input, &Uuid::new_v4().to_string());
    assert!(
        matches!(result, Err(ResourceMigrationError::PlanChanged)),
        "a changed reviewed plan must not execute: {result:?}"
    );
    assert_eq!(
        serde_json::to_value(local_resources::configuration_snapshot().unwrap()).unwrap(),
        serde_json::to_value(before).unwrap()
    );
    assert_eq!(
        fs::read(&file).unwrap(),
        if change == "payload" { b"new" } else { b"old" }
    );
    assert_eq!(
        fs::read_dir(&selected).unwrap().count(),
        0,
        "no staging or target may be created"
    );
}
#[test]
fn changed_payload_rejects_old_confirmation_before_writing() {
    isolated(
        "changed_payload_rejects_old_confirmation_before_writing",
        || stale_case("payload"),
    );
}
#[test]
fn changed_configuration_rejects_old_confirmation_before_writing() {
    isolated(
        "changed_configuration_rejects_old_confirmation_before_writing",
        || stale_case("configuration"),
    );
}
#[test]
fn changed_target_rejects_old_confirmation_before_writing() {
    isolated(
        "changed_target_rejects_old_confirmation_before_writing",
        || stale_case("target"),
    );
}

#[test]
fn confirmed_move_returns_bound_identity_and_preserves_original() {
    isolated(
        "confirmed_move_returns_bound_identity_and_preserves_original",
        || {
            let data = tempfile::tempdir().unwrap();
            local_resources::initialize(data.path()).unwrap();
            local_resources::configure_location(data.path().to_str().unwrap(), true).unwrap();
            resource_download::initialize().unwrap();
            crate::runtime::initialize(data.path()).unwrap();
            let root = local_resources::configured_root().unwrap();
            fs::write(root.join("fixture.bin"), b"keep").unwrap();
            let target = data.path().join("destination");
            fs::create_dir(&target).unwrap();
            let plan = plan_resource_root_move(target.to_str().unwrap()).unwrap();
            let config = local_resources::configuration_snapshot().unwrap();
            let files = move_io::manifest(&root).unwrap();
            let mut space_changed = plan.clone();
            space_changed.free_space_bytes = Some(1);
            assert_eq!(
                move_confirmation::fingerprint(&config, &space_changed, &files).unwrap(),
                plan.plan_fingerprint
            );
            let mut changed_copy = files.clone();
            changed_copy[0].sha256 = "f".repeat(64);
            assert!(
                move_confirmation::verify(
                    &plan.plan_fingerprint,
                    &move_confirmation::fingerprint(&config, &plan, &changed_copy).unwrap()
                )
                .is_err()
            );
            let id = Uuid::new_v4().to_string();
            let input = MoveLocalResourceRootInput {
                parent_path: target.to_string_lossy().into_owned(),
                confirmed: true,
                plan_fingerprint: plan.plan_fingerprint.clone(),
            };
            let result = move_control::register(&id)
                .unwrap()
                .run(|| move_resource_root(input, &id))
                .unwrap();
            assert_eq!(result.plan_fingerprint, plan.plan_fingerprint);
            assert_eq!(result.request_id, id);
            assert_eq!(result.previous_root, plan.previous_root);
            assert_eq!(result.current_root, plan.resource_root);
            assert_eq!(result.copied_bytes, plan.bytes_to_copy);
            assert_eq!(result.verified_file_count, plan.file_count);
            assert_eq!(fs::read(root.join("fixture.bin")).unwrap(), b"keep");
            assert_eq!(
                fs::read(Path::new(&result.current_root).join("fixture.bin")).unwrap(),
                b"keep"
            );
            assert_eq!(
                local_resources::configured_root().unwrap(),
                PathBuf::from(result.current_root)
            );
        },
    );
}
#[test]
fn move_requires_explicit_reviewed_fingerprint() {
    assert!(
        serde_json::from_value::<MoveLocalResourceRootInput>(
            serde_json::json!({"parentPath": "W:/new", "confirmed": true})
        )
        .is_err()
    );
}

#[test]
fn copy_changed_after_preflight_requires_new_confirmation_and_can_resume() {
    isolated(
        "copy_changed_after_preflight_requires_new_confirmation_and_can_resume",
        || {
            let data = tempfile::tempdir().unwrap();
            local_resources::initialize(data.path()).unwrap();
            local_resources::configure_location(data.path().to_str().unwrap(), true).unwrap();
            resource_download::initialize().unwrap();
            crate::runtime::initialize(data.path()).unwrap();
            let root = local_resources::configured_root().unwrap();
            let source_file = root.join("fixture.bin");
            fs::write(&source_file, b"old").unwrap();
            let target = data.path().join("destination");
            fs::create_dir(&target).unwrap();
            let plan = plan_resource_root_move(target.to_str().unwrap()).unwrap();
            move_confirmation::BEFORE_COPY.with(|hook| {
                hook.replace(Some(Box::new(move || {
                    fs::write(source_file, b"new").unwrap()
                })));
            });
            let input = MoveLocalResourceRootInput {
                parent_path: target.to_string_lossy().into_owned(),
                confirmed: true,
                plan_fingerprint: plan.plan_fingerprint.clone(),
            };
            let id = Uuid::new_v4().to_string();
            let result = move_control::register(&id)
                .unwrap()
                .run(|| move_resource_root(input, &id));
            assert!(matches!(result, Err(ResourceMigrationError::PlanChanged)));
            assert_eq!(local_resources::configured_root().unwrap(), root);
            assert!(!Path::new(&plan.resource_root).exists());
            assert_eq!(fs::read(root.join("fixture.bin")).unwrap(), b"new");
            let fresh = plan_resource_root_move(target.to_str().unwrap()).unwrap();
            assert_ne!(fresh.plan_fingerprint, plan.plan_fingerprint);
            let input = MoveLocalResourceRootInput {
                parent_path: target.to_string_lossy().into_owned(),
                confirmed: true,
                plan_fingerprint: fresh.plan_fingerprint.clone(),
            };
            let id = Uuid::new_v4().to_string();
            let result = move_control::register(&id)
                .unwrap()
                .run(|| move_resource_root(input, &id))
                .unwrap();
            assert_eq!(result.plan_fingerprint, fresh.plan_fingerprint);
            assert_eq!(
                fs::read(Path::new(&result.current_root).join("fixture.bin")).unwrap(),
                b"new"
            );
            assert_eq!(fs::read(root.join("fixture.bin")).unwrap(), b"new");
        },
    );
}
