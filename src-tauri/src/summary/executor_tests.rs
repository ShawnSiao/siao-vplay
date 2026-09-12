use super::*;

#[test]
fn worker_launch_failure_releases_project_and_leaves_task_retryable() {
    let (_directory, store, task) = super::super::test_support::prepared_summary();
    let repository = SummaryTaskRepository::new(&store);
    let result: SummaryResult = serde_json::from_value(
        serde_json::json!({"title":"saved", "overview":"completed chunk"}),
    ).unwrap();
    SummaryResultRepository::new(&store).save_chunk(&task.chunks[0].id, &result).unwrap();
    repository.claim_for_execution(&task.id).unwrap();
    let operation = crate::project_operations::Operation::acquire(&store, &task.project_id).unwrap();
    let error = launch_worker(&store, &task.id, operation, |_worker| {
        Err(std::io::Error::other("test: worker unavailable"))
    }).unwrap_err();
    assert!(error.to_string().contains("worker unavailable"));
    let failed = repository.get(&task.id).unwrap();
    assert_eq!(failed.status, "failed");
    assert_eq!(failed.error_code.as_deref(), Some("summary_worker_start_failed"));
    assert_eq!(failed.chunks[0].status, "completed");
    assert_eq!(SummaryResultRepository::new(&store).completed_chunk_results(&task.id)
        .unwrap()[0].overview, "completed chunk");
    let deleting = crate::project_operations::Deletion::acquire(&store, &task.project_id).unwrap();
    drop(deleting);
    repository.claim_for_execution(&task.id).unwrap();
    assert_eq!(repository.get(&task.id).unwrap().status, "queued");
}

#[test]
fn cancelled_summary_never_attempts_to_resolve_or_send_to_a_provider() {
    let (_directory, store, mut task) = super::super::test_support::prepared_summary();
    task.execution_kind = SummaryExecutionKind::Api;
    SummaryTaskRepository::new(&store)
        .request_cancel(&task.id)
        .unwrap();
    let error = run_request(
        &store,
        &task,
        "final",
        None,
        Vec::new(),
        "private material".into(),
        100,
    )
    .unwrap_err();
    assert!(error.to_string().contains("已取消"), "{error}");
}

#[test]
fn backoff_observes_persisted_cancellation_without_loading_task_chunks() {
    use std::time::{Duration, Instant};
    let (_directory, store, task) = super::super::test_support::prepared_summary();
    let repository = SummaryTaskRepository::new(&store);
    assert!(!repository.cancellation_requested(&task.id).unwrap());
    let start = Instant::now();
    let mut checks = 0;
    let result = super::super::retry_policy::load()
        .unwrap()
        .wait(Duration::from_secs(2), || {
            checks += 1;
            if checks == 2 {
                repository.request_cancel(&task.id)?;
            }
            repository.cancellation_requested(&task.id)
        });
    assert!(result.is_err());
    assert!(start.elapsed() < Duration::from_secs(1));
    assert!(repository.cancellation_requested("missing-task").is_err());
}
