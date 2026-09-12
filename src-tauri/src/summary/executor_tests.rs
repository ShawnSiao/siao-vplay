use super::*;

#[test]
fn reopening_after_chunk_failure_only_requests_unfinished_chunks() {
    let (_directory, store, task) = super::super::test_support::prepared_summary();
    // Isolated two-chunk fixture using the same authorized sentence in both chunks.
    store.connect().unwrap().execute(
        "INSERT INTO summary_chunks(id,task_id,ordinal,start_ms,end_ms,segment_ids_json,context_segment_ids_json,frame_manifest_json,material_sha256,status,created_at_ms,updated_at_ms)
         SELECT 'second-chunk',task_id,1,start_ms,end_ms,segment_ids_json,context_segment_ids_json,frame_manifest_json,material_sha256,'prepared',created_at_ms,updated_at_ms FROM summary_chunks WHERE id=?1",
        [&task.chunks[0].id],
    ).unwrap();
    let section = serde_json::json!({"title":"mechanism", "body":"Verified explanation of the original source and its limitations. ".repeat(20),
        "evidence":[{"kind":"video_statement","claim":"source evidence","subtitleIds":["past"]}]});
    let result = |coverage: Vec<usize>| serde_json::json!({
        "formatVersion":2,"title":"report","overview":"Detailed source overview. ".repeat(30),
        "coveredChunkOrdinals":coverage,"speakerNarrative":[section.clone()],"coreConcepts":[section.clone()],
        "principlesOrArchitecture":[section.clone()],"examplesAndScenarios":[section.clone()],"designTradeoffs":[section.clone()]
    }).to_string();
    let mut calls = Vec::new();
    let first = execute_with_request(&store, &task.id, |_, _, name, _, _, _, _| {
        calls.push(name.to_owned());
        if name == "chunk-1" { return Err(StoreError::Validation("isolated provider failure".into()).into()); }
        Ok(result(vec![1]))
    });
    assert!(first.is_err());
    assert_eq!(calls, ["chunk-0", "chunk-1"]);
    SummaryTaskRepository::new(&store).fail(&task.id, "provider_failed", "isolated failure").unwrap();
    let reopened = ProjectStore::open(store.database_path()).unwrap();
    let tasks = SummaryTaskRepository::new(&reopened);
    assert_eq!(tasks.get(&task.id).unwrap().chunks[0].status, "completed");
    tasks.claim_for_execution(&task.id).unwrap();
    calls.clear();
    execute_with_request(&reopened, &task.id, |_, _, name, _, _, prompt, _| {
        calls.push(name.to_owned());
        assert!(!prompt.is_empty());
        Ok(result(if name == "final" { vec![1, 2] } else { vec![2] }))
    }).unwrap();
    assert_eq!(calls, ["chunk-1", "final"]);
    assert_eq!(tasks.get(&task.id).unwrap().status, "completed");
    assert_eq!(SummaryResultRepository::new(&reopened).list_summaries(&task.project_id).unwrap().len(), 1);
}

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
