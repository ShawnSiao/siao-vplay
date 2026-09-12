use super::*;
use crate::{
    ai::{
        providers::test_support::{mock_service, read_request},
        types::{AiProtocol, AiProviderId},
    },
    codex_runner, understanding,
};
use std::{
    io::Read,
    net::TcpListener,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

#[test]
fn cancelling_an_active_api_task_closes_http_and_acknowledges_without_a_result() {
    let fixture = understanding::test_fixture::Fixture::new();
    let task = fixture.prepare_with_options(crate::summary::PromptSelection::default(), false);
    fixture
        .store
        .connect()
        .unwrap()
        .execute(
            "UPDATE explanation_tasks SET status = 'queued' WHERE id = ?1",
            [&task.id],
        )
        .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let (seen, request_seen) = mpsc::channel();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        read_request(&mut stream);
        seen.send(()).unwrap();
        matches!(stream.read(&mut [0]), Ok(0))
    });
    let service = mock_service(AiProviderId::Openai, AiProtocol::OpenaiResponses, &address);
    let lease = task_persistence::claim_api(
        &fixture.store,
        AiTaskKind::Explanation,
        &task.id,
        &service,
        1,
        false,
    )
    .unwrap();
    spawn(
        lease,
        fixture.store.clone(),
        task.id.clone(),
        AiTaskKind::Explanation,
        move |store, id| {
            execute(
                store,
                AiTaskKind::Explanation,
                id,
                &service,
                GenerationInput {
                    model_id: "test".into(),
                    system: "test".into(),
                    prompt: "test".into(),
                    schema_name: "test".into(),
                    schema: serde_json::json!({}),
                    image_data_urls: Vec::new(),
                    max_output_tokens: 10,
                    timeout: Duration::from_secs(5),
                    cancellation: None,
                },
            )
        },
    );
    request_seen.recv_timeout(Duration::from_secs(3)).unwrap();
    let requested = codex_runner::cancel_explanation_task(&fixture.store, &task.id).unwrap();
    assert!(matches!(
        requested.stage.as_str(),
        "cancelling" | "cancelled"
    ));
    let deadline = Instant::now() + Duration::from_secs(1);
    let finished = loop {
        let current = understanding::get_explanation_task(&fixture.store, &task.id).unwrap();
        if current.status == "cancelled" || Instant::now() >= deadline {
            break current;
        }
        thread::sleep(Duration::from_millis(10));
    };
    assert!(server.join().unwrap(), "HTTP connection should be closed");
    assert_eq!(finished.status, "cancelled");
    assert!(finished.output_explanation_id.is_none());
    assert!(finished.execution.provider_request_id.is_none());
}

#[test]
fn terminal_api_status_does_not_release_project_before_worker_exit() {
    let fixture = understanding::test_fixture::Fixture::new();
    let task = fixture.prepare_with_options(crate::summary::PromptSelection::default(), false);
    fixture.store.connect().unwrap().execute("UPDATE explanation_tasks SET status = 'queued' WHERE id = ?1", [&task.id]).unwrap();
    let service = mock_service(AiProviderId::Openai, AiProtocol::OpenaiResponses, "http://127.0.0.1:1");
    let lease = task_persistence::claim_api(&fixture.store, AiTaskKind::Explanation, &task.id, &service, 1, false).unwrap();
    let (release, wait) = mpsc::channel();
    let (entered, seen) = mpsc::channel();
    let (done, finished) = mpsc::channel();
    spawn(lease, fixture.store.clone(), task.id.clone(), AiTaskKind::Explanation, move |store, id| {
        store.connect()?.execute("UPDATE explanation_tasks SET status = 'cancelled' WHERE id = ?1", [id])?;
        entered.send(()).unwrap();
        wait.recv_timeout(Duration::from_secs(10)).unwrap();
        done.send(()).unwrap();
        Ok(())
    });
    seen.recv_timeout(Duration::from_secs(10)).unwrap();
    let deletion = fixture.store.delete_project(&fixture.project_id);
    release.send(()).unwrap();
    finished.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(deletion.is_err(), "terminal task status must not authorize deletion while worker owns the project");
    assert!(fixture.store.get_project(&fixture.project_id).is_ok());
}
