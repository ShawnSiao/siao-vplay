use super::*;

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
