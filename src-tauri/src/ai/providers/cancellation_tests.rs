use super::test_support::{mock_service, read_request};
use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
};

fn input(cancellation: Option<CancellationCheck>) -> GenerationInput {
    GenerationInput {
        model_id: "test".into(),
        system: "test".into(),
        prompt: "authorized fixture".into(),
        schema_name: "test".into(),
        schema: serde_json::json!({"type":"object"}),
        image_data_urls: Vec::new(),
        max_output_tokens: 10,
        timeout: Duration::from_secs(5),
        cancellation,
    }
}

#[test]
fn already_cancelled_generation_opens_no_connection() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let service = mock_service(
        AiProviderId::Openai,
        AiProtocol::OpenaiResponses,
        &format!("http://{}", listener.local_addr().unwrap()),
    );
    let mut request = input(Some(Arc::new(|| Ok(true))));
    request.timeout = Duration::from_millis(150);
    let result = generate(&service, &request);
    assert!(matches!(
        result,
        Err(ProviderFailure {
            error: AiError::Cancelled,
            ..
        })
    ));
    assert!(listener.accept().is_err());
}

#[test]
fn cancelling_generation_closes_the_connection_while_waiting_for_headers_or_body() {
    for headers_sent in [false, true] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let (seen, request_seen) = mpsc::channel();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            read_request(&mut stream);
            if headers_sent {
                stream
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n{")
                    .unwrap();
            }
            seen.send(()).unwrap();
            let closed = matches!(stream.read(&mut [0]), Ok(0));
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
            closed
        });
        let cancelled = Arc::new(AtomicBool::new(false));
        let worker_cancelled = cancelled.clone();
        let (sent, received) = mpsc::channel();
        let worker = thread::spawn(move || {
            let service = mock_service(AiProviderId::Openai, AiProtocol::OpenaiResponses, &address);
            let result = generate(
                &service,
                &input(Some(Arc::new(move || {
                    Ok(worker_cancelled.load(Ordering::Acquire))
                }))),
            );
            sent.send(
                result
                    .map(|_| "completed")
                    .map_err(|error| error.error.code()),
            )
            .unwrap();
        });
        request_seen.recv_timeout(Duration::from_secs(3)).unwrap();
        cancelled.store(true, Ordering::Release);
        let stopped = received.recv_timeout(Duration::from_millis(750));
        let socket_closed = server.join().unwrap();
        worker.join().unwrap();
        assert_eq!(
            stopped,
            Ok(Err("ai_task_cancelled")),
            "headers_sent={headers_sent}"
        );
        assert!(socket_closed, "cancel must close the owned connection");
    }
}
