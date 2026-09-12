use super::{execution, policy, repository};
use crate::translation::{self, PrepareTranslationTaskInput, fixture::TranslationFixture};
use serde_json::{Value, json};

fn prepared() -> (TranslationFixture, translation::TranslationTask) {
    let fixture = TranslationFixture::new();
    let task = translation::prepare_translation_task(
        &fixture.store,
        PrepareTranslationTaskInput {
            project_id: fixture.project_id.clone(),
            handoff_kind: "api".into(),
            source_language_code: "ja".into(),
            target_language_code: "zh-cn".into(),
            segment_ids: None,
        },
    )
    .unwrap();
    let mut policy = policy::load().unwrap();
    policy.max_segments_per_batch = 1;
    repository::prepare_batches(&fixture.store, &task.id, &policy).unwrap();
    fixture
        .store
        .connect()
        .unwrap()
        .execute(
            "UPDATE agent_tasks SET status = 'running' WHERE id = ?1",
            [&task.id],
        )
        .unwrap();
    (fixture, task)
}

fn translated(prompt: &Value) -> Value {
    json!({"protocolVersion": prompt["protocolVersion"], "taskId": prompt["taskId"], "sourceVersionId": prompt["sourceVersionId"],
        "targetLanguageCode": prompt["targetLanguageCode"], "translations": prompt["segments"].as_array().unwrap().iter()
            .map(|segment| json!({"segmentId": segment["id"], "translatedText": "明天在车站见。"})).collect::<Vec<_>>()})
}

#[test]
fn interrupted_retry_only_sends_unfinished_batches_and_preserves_original_version() {
    let (fixture, task) = prepared();
    let mut calls = 0;
    let first = execution::run_with(&fixture.store, &task.id, |prompt, _| {
        calls += 1;
        if calls == 2 {
            return Err(super::super::AiError::Timeout.into());
        }
        Ok(translated(prompt).to_string())
    });
    assert!(first.is_err());
    assert_eq!(
        repository::batches(&fixture.store, &task.id)
            .unwrap()
            .iter()
            .filter(|batch| batch.result.is_some())
            .count(),
        1
    );
    assert!(
        translation::get_translation_task(&fixture.store, &task.id)
            .unwrap()
            .output_version_id
            .is_none()
    );
    repository::recover(&fixture.store).unwrap();
    assert_eq!(
        translation::get_translation_task(&fixture.store, &task.id)
            .unwrap()
            .status,
        "interrupted"
    );
    fixture
        .store
        .connect()
        .unwrap()
        .execute(
            "UPDATE agent_tasks SET status = 'running' WHERE id = ?1",
            [&task.id],
        )
        .unwrap();
    let mut retried = 0;
    execution::run_with(&fixture.store, &task.id, |prompt, _| {
        retried += 1;
        Ok(translated(prompt).to_string())
    })
    .unwrap();
    assert_eq!(retried, 1);
    let completed = translation::get_translation_task(&fixture.store, &task.id).unwrap();
    assert_eq!(completed.status, "completed");
    assert_ne!(
        completed.output_version_id.as_ref(),
        Some(&fixture.source_version_id)
    );
    let original: String = fixture.store.connect().unwrap().query_row("SELECT current_version_id FROM subtitle_tracks WHERE project_id = ?1 AND role = 'original'", [&fixture.project_id], |row| row.get(0)).unwrap();
    assert_eq!(original, fixture.source_version_id);
}

#[test]
fn invalid_batch_output_never_creates_a_subtitle_version() {
    for fault in ["missing", "duplicate", "language", "foreign", "empty"] {
        let (fixture, task) = prepared();
        let result = execution::run_with(&fixture.store, &task.id, |prompt, _| {
            let mut output = translated(prompt);
            match fault {
                "missing" => output["translations"] = json!([]),
                "duplicate" => {
                    let item = output["translations"][0].clone();
                    output["translations"].as_array_mut().unwrap().push(item);
                }
                "language" => output["targetLanguageCode"] = json!("en"),
                "foreign" => output["translations"][0]["segmentId"] = json!("unrelated"),
                _ => output["translations"][0]["translatedText"] = json!(""),
            }
            Ok(output.to_string())
        });
        assert!(result.is_err(), "{fault}");
        assert!(
            translation::get_translation_task(&fixture.store, &task.id)
                .unwrap()
                .output_version_id
                .is_none()
        );
        assert!(
            repository::batches(&fixture.store, &task.id)
                .unwrap()
                .iter()
                .all(|batch| batch.result.is_none())
        );
    }
}

#[test]
fn cancellation_before_batch_persistence_rejects_the_result_and_survives_restart() {
    let (fixture, task) = prepared();
    let result = execution::run_with(&fixture.store, &task.id, |prompt, _| {
        fixture
            .store
            .connect()
            .unwrap()
            .execute(
                "UPDATE agent_tasks SET cancel_requested_at_ms = 1 WHERE id = ?1",
                [&task.id],
            )
            .unwrap();
        Ok(translated(prompt).to_string())
    });
    assert!(result.is_err());
    repository::recover(&fixture.store).unwrap();
    let task = translation::get_translation_task(&fixture.store, &task.id).unwrap();
    assert_eq!(task.status, "cancelled");
    assert!(task.output_version_id.is_none());
}

#[test]
fn modified_source_material_is_rejected_before_any_request() {
    let (fixture, task) = prepared();
    let directory = translation::task_directory(&fixture.store, &task.id).unwrap();
    std::fs::write(directory.join("input/segments.json"), b"[]").unwrap();
    let result = execution::run_with(&fixture.store, &task.id, |_, _| {
        panic!("must not send changed materials")
    });
    assert!(result.is_err());
}

#[test]
fn project_revision_changed_during_api_request_rejects_final_application() {
    let (fixture, task) = prepared();
    let mut changed = false;
    let result = execution::run_with(&fixture.store, &task.id, |prompt, _| {
        if !changed {
            fixture
                .store
                .connect()
                .unwrap()
                .execute(
                    "UPDATE projects SET revision = revision + 1 WHERE id = ?1",
                    [&fixture.project_id],
                )
                .unwrap();
            changed = true;
        }
        Ok(translated(prompt).to_string())
    });
    assert!(result.is_err());
    let reopened = crate::store::ProjectStore::open(fixture.store.database_path()).unwrap();
    assert!(
        translation::get_translation_task(&reopened, &task.id)
            .unwrap()
            .output_version_id
            .is_none()
    );
    let versions =
        crate::subtitles::list_subtitle_versions(&reopened, &fixture.project_id).unwrap();
    assert_eq!(versions.len(), 1);
    assert_eq!(versions[0].id, fixture.source_version_id);
    assert_eq!(versions[0].role, "original");
    assert!(versions[0].is_current);
}
