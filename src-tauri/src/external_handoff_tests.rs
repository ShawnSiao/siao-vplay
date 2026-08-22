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
