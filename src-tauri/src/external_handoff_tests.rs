use std::fs;

use tempfile::TempDir;

use super::{
    ActiveManualTask, ExternalAgentResultUpdate, ExternalHandoffError, reconcile_active_tasks_with,
    record_attempt, result_candidate,
};
use crate::store::ProjectStore;

#[test]
fn candidate_retries_only_after_the_result_file_changes() {
    let temporary = TempDir::new().expect("temporary directory should exist");
    let store = ProjectStore::open(
        temporary
            .path()
            .join("app-data")
            .join("projects")
            .join("siaovplay.db"),
    )
    .expect("store should open");
    let task_id = "1bb7ac17-eb44-489e-a7a8-420f75577809";
    let output = store
        .data_directory()
        .join("agent-tasks")
        .join(task_id)
        .join("output");
    fs::create_dir_all(&output).expect("output directory should exist");
    fs::write(output.join("result.json"), b"{\"taskId\":\"first\"}")
        .expect("candidate should be written");

    let first = result_candidate(&store, task_id)
        .expect("candidate should resolve")
        .expect("candidate should exist");
    record_attempt(&first, "validating", "checking").expect("attempt should persist");
    assert!(
        result_candidate(&store, task_id)
            .expect("candidate should resolve")
            .expect("candidate should exist")
            .is_staged()
    );

    record_attempt(&first, "rejected", "invalid").expect("rejection should persist");
    assert!(
        result_candidate(&store, task_id)
            .expect("candidate should resolve")
            .expect("candidate should exist")
            .was_rejected()
    );

    fs::write(output.join("result.json"), b"{\"taskId\":\"second\"}")
        .expect("candidate should change");
    assert!(
        !result_candidate(&store, task_id)
            .expect("candidate should resolve")
            .expect("candidate should exist")
            .was_rejected()
    );
}

#[test]
fn one_broken_task_does_not_block_later_external_results() {
    let tasks = vec![
        ActiveManualTask {
            kind: "translation".to_owned(),
            id: "broken-task".to_owned(),
            project_id: "project-1".to_owned(),
            status: "validating".to_owned(),
        },
        ActiveManualTask {
            kind: "learning".to_owned(),
            id: "valid-task".to_owned(),
            project_id: "project-2".to_owned(),
            status: "validating".to_owned(),
        },
    ];

    let updates = reconcile_active_tasks_with(tasks, |task| {
        if task.id == "broken-task" {
            return Err(ExternalHandoffError::InvalidTask);
        }
        Ok(Some(ExternalAgentResultUpdate {
            task_kind: task.kind.clone(),
            task_id: task.id.clone(),
            project_id: task.project_id.clone(),
            status: "completed".to_owned(),
            output_id: Some("dictionary-entry".to_owned()),
            message: "词义结果已导入".to_owned(),
        }))
    });

    assert_eq!(updates.len(), 1);
    assert_eq!(updates[0].task_id, "valid-task");
    assert_eq!(updates[0].status, "completed");
}

#[test]
fn completed_result_replays_after_reopening_when_delivery_was_lost() {
    let fixture = crate::translation::fixture::TranslationFixture::new();
    let task = fixture.prepare_manual();
    let result = fixture.write_result("result.json", &fixture.result_value(&task));
    let application = crate::translation::import_translation_result(
        &fixture.store,
        crate::translation::ImportTranslationResultInput {
            task_id: task.id.clone(),
            result_path: result.to_string_lossy().into_owned(),
        },
    )
    .unwrap();
    let reopened = ProjectStore::open(fixture.store.database_path()).unwrap();
    for _ in 0..2 {
        let replay =
            super::reconcile_external_agent_results(&reopened, &Default::default()).unwrap();
        assert_eq!(
            replay.len(),
            1,
            "unacknowledged completion must survive a lost response"
        );
        assert_eq!(replay[0].task_id, task.id);
        assert_eq!(replay[0].output_id, application.task.output_version_id);
    }
    let receipt = super::reconcile_external_agent_results(&reopened, &Default::default()).unwrap();
    let mut wrong = receipt.clone();
    wrong[0].output_id = Some("wrong-version".into());
    crate::external_result_delivery::acknowledge(&reopened, &wrong).unwrap();
    assert_eq!(
        super::reconcile_external_agent_results(&reopened, &Default::default())
            .unwrap()
            .len(),
        1
    );
    let mut invalid = receipt[0].clone();
    invalid.status = "validating".into();
    assert!(
        crate::external_result_delivery::acknowledge(&reopened, &[receipt[0].clone(), invalid])
            .is_err()
    );
    assert_eq!(
        super::reconcile_external_agent_results(&reopened, &Default::default())
            .unwrap()
            .len(),
        1
    );
    crate::external_result_delivery::acknowledge(&reopened, &receipt).unwrap();
    crate::external_result_delivery::acknowledge(&reopened, &receipt).unwrap();
    assert!(
        super::reconcile_external_agent_results(&reopened, &Default::default())
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        crate::translation::get_translation_task(&reopened, &task.id)
            .unwrap()
            .status,
        "completed"
    );
}

#[test]
fn delivery_persistence_failure_rolls_back_imported_assets() {
    let fixture = crate::translation::fixture::TranslationFixture::new();
    let task = fixture.prepare_manual();
    let original = fixture.store.get_project(&fixture.project_id).unwrap();
    fixture.store.connect().unwrap().execute_batch("CREATE TRIGGER fail_delivery BEFORE INSERT ON external_result_deliveries BEGIN SELECT RAISE(ABORT,'injected delivery disk failure'); END;").unwrap();
    let result = fixture.write_result("result.json", &fixture.result_value(&task));
    let imported = crate::translation::import_translation_result(
        &fixture.store,
        crate::translation::ImportTranslationResultInput {
            task_id: task.id.clone(),
            result_path: result.to_string_lossy().into_owned(),
        },
    );
    assert!(imported.is_err());
    assert_eq!(
        fixture
            .store
            .get_project(&fixture.project_id)
            .unwrap()
            .revision,
        original.revision
    );
    let connection = fixture.store.connect().unwrap();
    let versions: i64 = connection.query_row("SELECT COUNT(*) FROM subtitle_versions v JOIN subtitle_tracks t ON t.id=v.track_id WHERE t.role='translation'", [], |r| r.get(0)).unwrap();
    assert_eq!(versions, 0);
    assert!(
        crate::external_result_delivery::pending(&fixture.store)
            .unwrap()
            .is_empty()
    );
    let stored = crate::translation::get_translation_task(&fixture.store, &task.id).unwrap();
    assert_eq!(stored.status, "awaiting_external_result");
    assert!(stored.output_version_id.is_none());
}

#[test]
fn version_19_upgrade_preserves_assets_without_replaying_historical_completions() {
    let fixture = crate::translation::fixture::TranslationFixture::new();
    let task = fixture.prepare_manual();
    let result = fixture.write_result("result.json", &fixture.result_value(&task));
    let application = crate::translation::import_translation_result(
        &fixture.store,
        crate::translation::ImportTranslationResultInput {
            task_id: task.id.clone(),
            result_path: result.to_string_lossy().into_owned(),
        },
    )
    .unwrap();
    fixture.store.connect().unwrap().execute_batch("DROP TABLE external_result_deliveries; DELETE FROM schema_migrations WHERE version=20;").unwrap();
    let reopened = ProjectStore::open(fixture.store.database_path()).unwrap();
    assert!(
        super::reconcile_external_agent_results(&reopened, &Default::default())
            .unwrap()
            .is_empty()
    );
    let stored = crate::translation::get_translation_task(&reopened, &task.id).unwrap();
    assert_eq!(stored.output_version_id, application.task.output_version_id);
    assert_eq!(stored.status, "completed");
    let backups: Vec<_> = fs::read_dir(
        reopened
            .database_path()
            .parent()
            .unwrap()
            .join("upgrade-backups"),
    )
    .unwrap()
    .map(|entry| entry.unwrap().path())
    .collect();
    assert_eq!(backups.len(), 1);
    let backup = rusqlite::Connection::open_with_flags(
        &backups[0],
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    assert_eq!(
        crate::database_upgrade::check_version(&backup, 20).unwrap(),
        19
    );
    assert!(matches!(
        crate::database_upgrade::check_version(&reopened.connect().unwrap(), 19),
        Err(crate::store::StoreError::UnsupportedSchema { .. })
    ));
}

#[test]
fn pending_receipts_beyond_the_first_hundred_are_reachable_without_acknowledgement() {
    let fixture = crate::translation::fixture::TranslationFixture::new();
    let connection = fixture.store.connect().unwrap();
    for index in 0..205 {
        connection
            .execute(
                "INSERT INTO external_result_deliveries VALUES ('translation',?1,?2,?1,1)",
                rusqlite::params![format!("task-{index:04}"), fixture.project_id],
            )
            .unwrap();
    }
    let delivery = crate::external_result_delivery::DeliveryQueue::default();
    let mut seen = std::collections::HashSet::new();
    for _ in 0..3 {
        let page = super::reconcile_external_agent_results(&fixture.store, &delivery).unwrap();
        assert!(page.len() <= 100);
        seen.extend(page.into_iter().map(|update| update.task_id));
    }
    assert_eq!(
        seen.len(),
        205,
        "unacknowledged early pages must not starve later results"
    );
    let wrapped = super::reconcile_external_agent_results(&fixture.store, &delivery).unwrap();
    assert_eq!(wrapped.len(), 100);
    assert_eq!(wrapped[0].task_id, "task-0000");
    crate::external_result_delivery::acknowledge(&fixture.store, &wrapped).unwrap();
    let next = super::reconcile_external_agent_results(&fixture.store, &delivery).unwrap();
    assert_eq!(next[0].task_id, "task-0100");
    let fresh = crate::external_result_delivery::DeliveryQueue::default();
    assert_eq!(
        fresh.next_pending(&fixture.store).unwrap()[0].task_id,
        "task-0100"
    );
}
