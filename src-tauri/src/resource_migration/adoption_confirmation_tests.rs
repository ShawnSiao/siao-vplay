use super::*;
use std::process::Command;
fn isolated(name: &str, body: impl FnOnce()) {
    if std::env::var("SIAOVPLAY_ADOPTION_TEST").as_deref() == Ok(name) {
        body();
        return;
    }
    let result = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            &format!("resource_migration::adoption_confirmation_tests::{name}"),
            "--nocapture",
        ])
        .env("SIAOVPLAY_ADOPTION_TEST", name)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
}
fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let data = tempfile::tempdir().unwrap();
    local_resources::initialize(data.path()).unwrap();
    local_resources::configure_location(data.path().to_str().unwrap(), true).unwrap();
    resource_download::initialize().unwrap();
    let root = local_resources::configured_root().unwrap();
    let source = data.path().join("source");
    fs::create_dir(&source).unwrap();
    (data, root, source)
}
fn stale_case(change: &str) {
    let (data, root, source) = setup();
    let preview = inspect_resource_migration(InspectResourceMigrationInput {
        source_path: Some(path_string(&source)),
        source_kind: Some("selected_directory".into()),
    })
    .unwrap();
    let fingerprint = preview.plan_fingerprint.clone();
    let mut selected = source.clone();
    if change == "source" {
        selected = data.path().join("other");
        fs::create_dir(&selected).unwrap();
    }
    if change == "configuration" {
        let mut config = local_resources::configuration_snapshot().unwrap();
        config.legacy_candidate_roots.push(path_string(data.path()));
        local_resources::replace_configuration(config).unwrap();
    }
    let before = serde_json::to_value(local_resources::configuration_snapshot()).unwrap();
    let files = move_io::manifest(&root).unwrap();
    let input = serde_json::from_value(serde_json::json!({ "resourceRoot": if change == "target" { path_string(&data.path().join("other-target")) } else { path_string(&root) }, "sourcePath": selected, "sourceKind": "selected_directory", "confirmed": true, "planFingerprint": fingerprint })).unwrap();
    assert!(
        adopt_local_resources(input, "test-request").is_err(),
        "stale adoption confirmation must be rejected"
    );
    assert_eq!(
        serde_json::to_value(local_resources::configuration_snapshot()).unwrap(),
        before
    );
    assert_eq!(move_io::manifest(&root).unwrap(), files);
}
#[test]
fn changed_source_rejects_previous_adoption_confirmation() {
    isolated(
        "changed_source_rejects_previous_adoption_confirmation",
        || stale_case("source"),
    );
}
#[test]
fn changed_configuration_rejects_previous_adoption_confirmation() {
    isolated(
        "changed_configuration_rejects_previous_adoption_confirmation",
        || stale_case("configuration"),
    );
}
#[test]
fn invalid_adoption_must_not_recreate_missing_resource_root() {
    isolated(
        "invalid_adoption_must_not_recreate_missing_resource_root",
        || {
            let (data, root, _) = setup();
            let retained = data.path().join("retained");
            assert!(root.starts_with(data.path()) && retained.starts_with(data.path()));
            fs::rename(&root, &retained).unwrap();
            let before = serde_json::to_value(local_resources::configuration_snapshot()).unwrap();
            let files = move_io::manifest(&retained).unwrap();
            let input = serde_json::from_value(serde_json::json!({ "resourceRoot": root, "sourcePath": data.path().join("absent-source"), "sourceKind": "selected_directory", "confirmed": true, "planFingerprint": "old" })).unwrap();
            assert!(adopt_local_resources(input, "test-request").is_err());
            assert!(!root.exists(), "invalid input must not repair the root");
            assert_eq!(move_io::manifest(&retained).unwrap(), files);
            assert_eq!(
                serde_json::to_value(local_resources::configuration_snapshot()).unwrap(),
                before
            );
        },
    );
}

#[test]
fn empty_confirmed_adoption_is_bound_and_read_only() {
    isolated("empty_confirmed_adoption_is_bound_and_read_only", || {
        let (_data, root, source) = setup();
        let preview = inspect_resource_migration(InspectResourceMigrationInput {
            source_path: Some(path_string(&source)),
            source_kind: Some("selected_directory".into()),
        })
        .unwrap();
        assert_eq!(
            preview.resource_root.as_deref(),
            Some(path_string(&root).as_str())
        );
        let files = move_io::manifest(&root).unwrap();
        let input = AdoptLocalResourcesInput {
            source_path: Some(path_string(&source)),
            source_kind: Some("selected_directory".into()),
            confirmed: true,
            plan_fingerprint: preview.plan_fingerprint.clone(),
            resource_root: path_string(&root),
        };
        let result = adopt_local_resources(input, "request-1").unwrap();
        assert_eq!(result.plan_fingerprint, preview.plan_fingerprint);
        assert_eq!(result.request_id, "request-1");
        assert_eq!(result.resource_root, path_string(&root));
        assert!(result.adopted_resource_ids.is_empty());
        assert_eq!(move_io::manifest(&root).unwrap(), files);
    });
}
#[test]
fn reviewed_files_and_versions_change_adoption_identity() {
    let data = tempfile::tempdir().unwrap();
    let file = data.path().join("fixture.bin");
    fs::write(&file, b"verified-model").unwrap();
    let resource =
        super::tests::fixture_resource("fixture-model", "fixture.bin", b"verified-model");
    let payload = CandidatePayload::File(file);
    let files = verify_candidate_payload(&resource, &payload).unwrap();
    let source = CandidateSource {
        kind: "selected_directory".into(),
        root: data.path().to_owned(),
    };
    let candidate = public_candidate(&source, &resource, payload, files);
    let preview = ResourceMigrationPreview {
        resource_root: None,
        plan_fingerprint: String::new(),
        sources: vec![ResourceMigrationSource {
            kind: source.kind,
            path: path_string(&source.root),
        }],
        candidates: vec![candidate.public.clone()],
        verified_resource_ids: vec![resource.id],
        reusable_bytes: 14,
        rejected_count: 0,
    };
    let fingerprint =
        adoption_confirmation::fingerprint(&None, &preview, &[candidate.clone()]).unwrap();
    let mut changed = candidate.clone();
    changed.definition.version.push_str("-changed");
    assert!(
        adoption_confirmation::verify(
            &fingerprint,
            &adoption_confirmation::fingerprint(&None, &preview, &[changed]).unwrap()
        )
        .is_err()
    );
    let mut changed = candidate.clone();
    changed.files[0].sha256 = "f".repeat(64);
    assert!(
        adoption_confirmation::verify(
            &fingerprint,
            &adoption_confirmation::fingerprint(&None, &preview, &[changed.clone()]).unwrap()
        )
        .is_err()
    );
    assert!(adoption_confirmation::verify_files(&candidate.files, &changed.files).is_err());
    assert!(adoption_confirmation::verify_files(&candidate.files, &candidate.files).is_ok());
}
#[test]
fn adoption_requires_the_reviewed_fingerprint_and_target() {
    assert!(
        serde_json::from_value::<AdoptLocalResourcesInput>(serde_json::json!({"confirmed": true}))
            .is_err()
    );
}

#[test]
fn changed_displayed_target_rejects_adoption_before_writing() {
    isolated(
        "changed_displayed_target_rejects_adoption_before_writing",
        || stale_case("target"),
    );
}
#[test]
fn new_candidate_after_preview_invalidates_confirmation() {
    isolated(
        "new_candidate_after_preview_invalidates_confirmation",
        || {
            let (_data, root, source) = setup();
            let preview = inspect_resource_migration(InspectResourceMigrationInput {
                source_path: Some(path_string(&source)),
                source_kind: Some("selected_directory".into()),
            })
            .unwrap();
            let name = local_resources::catalog()
                .unwrap()
                .resources
                .iter()
                .filter(|resource| {
                    resource.kind != "archive"
                        && resource.health_check != "whisper-runtime-metadata-and-timeline"
                })
                .find_map(expected_file_name)
                .unwrap();
            fs::write(source.join(name), b"unverified fixture").unwrap();
            let next = inspect_resource_migration(InspectResourceMigrationInput {
                source_path: Some(path_string(&source)),
                source_kind: Some("selected_directory".into()),
            })
            .unwrap();
            assert!(next.rejected_count > preview.rejected_count);
            assert_ne!(next.plan_fingerprint, preview.plan_fingerprint);
            let files = move_io::manifest(&root).unwrap();
            let input = AdoptLocalResourcesInput {
                source_path: Some(path_string(&source)),
                source_kind: Some("selected_directory".into()),
                confirmed: true,
                plan_fingerprint: preview.plan_fingerprint,
                resource_root: path_string(&root),
            };
            assert!(matches!(
                adopt_local_resources(input, "request-1"),
                Err(ResourceMigrationError::AdoptionPlanChanged)
            ));
            assert_eq!(move_io::manifest(&root).unwrap(), files);
        },
    );
}
