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
