use super::*;

#[test]
fn summary_execution_has_only_one_owner() {
    let (_directory, store, task) = super::super::test_support::prepared_summary();
    let repository = SummaryTaskRepository::new(&store);
    repository.claim_for_execution(&task.id).unwrap();
    assert!(repository.claim_for_execution(&task.id).is_err());
}

#[test]
fn restart_finishes_a_pending_cancellation_instead_of_resuming_it() {
    let (_directory, store, task) = super::super::test_support::prepared_summary();
    let repository = SummaryTaskRepository::new(&store);
    repository
        .set_task_state(&task.id, "running", "analyzing_chunks", 0.2)
        .unwrap();
    repository.request_cancel(&task.id).unwrap();
    repository.recover_interrupted().unwrap();
    let recovered = repository.get(&task.id).unwrap();
    assert_eq!(recovered.status, "cancelled");
    assert!(
        recovered
            .chunks
            .iter()
            .all(|chunk| chunk.status == "cancelled")
    );
    assert!(repository.claim_for_execution(&task.id).is_err());
}

#[test]
fn cancelled_summary_rejects_late_result_without_persisting_it() {
    let (_directory, store, task) = super::super::test_support::prepared_summary();
    let repository = SummaryTaskRepository::new(&store);
    repository
        .set_task_state(&task.id, "validating", "validating", 0.9)
        .unwrap();
    repository.request_cancel(&task.id).unwrap();
    let results = super::super::result_repository::SummaryResultRepository::new(&store);
    let result =
        serde_json::from_value(serde_json::json!({"title":"test", "overview":"test"})).unwrap();
    assert!(results.save_summary(&task.id, &result, false).is_err());
    assert!(results.list_summaries(&task.project_id).unwrap().is_empty());
    assert_ne!(repository.get(&task.id).unwrap().status, "completed");
}

#[test]
fn completed_summary_cannot_be_overwritten_by_late_cancel_failure_or_result() {
    let (_directory, store, task) = super::super::test_support::prepared_summary();
    let repository = SummaryTaskRepository::new(&store);
    repository
        .set_task_state(&task.id, "validating", "validating", 0.9)
        .unwrap();
    let results = super::super::result_repository::SummaryResultRepository::new(&store);
    let result =
        serde_json::from_value(serde_json::json!({"title":"test", "overview":"test"})).unwrap();
    let saved = results.save_summary(&task.id, &result, false).unwrap();
    repository.request_cancel(&task.id).unwrap();
    repository.finish_cancelled(&task.id).unwrap();
    repository.fail(&task.id, "late", "late failure").unwrap();
    assert_eq!(repository.get(&task.id).unwrap().status, "completed");
    assert!(results.save_summary(&task.id, &result, false).is_err());
    assert_eq!(results.list_summaries(&task.project_id).unwrap().len(), 1);
    assert_eq!(
        repository.get(&task.id).unwrap().output_summary_id,
        Some(saved.id)
    );
}
