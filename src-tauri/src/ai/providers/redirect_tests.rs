use super::test_support::{mock_service, read_request};
use super::*;
use std::{io::Write, net::TcpListener, thread, time::Instant};

#[test]
fn provider_redirects_never_forward_materials_or_credentials() {
    for generation in [true, false] {
        let origin = TcpListener::bind("127.0.0.1:0").unwrap();
        let sink = TcpListener::bind("127.0.0.1:0").unwrap();
        sink.set_nonblocking(true).unwrap();
        let base = format!("http://{}", origin.local_addr().unwrap());
        let target = format!("http://{}/other-receiver", sink.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut stream, _) = origin.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            read_request(&mut stream);
            write!(stream, "HTTP/1.1 307 Temporary Redirect\r\nLocation: {target}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
            let deadline = Instant::now() + Duration::from_millis(500);
            while Instant::now() < deadline {
                if let Ok((mut stream, _)) = sink.accept() {
                    stream
                        .set_read_timeout(Some(Duration::from_secs(1)))
                        .unwrap();
                    read_request(&mut stream);
                    stream
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
                        )
                        .unwrap();
                    return true;
                }
                thread::sleep(Duration::from_millis(5));
            }
            false
        });
        let service = mock_service(
            AiProviderId::Anthropic,
            AiProtocol::AnthropicMessages,
            &base,
        );
        let failed = if generation {
            generate(
                &service,
                &GenerationInput {
                    model_id: "test".into(),
                    system: "test".into(),
                    prompt: "authorized private fixture".into(),
                    schema_name: "test".into(),
                    schema: serde_json::json!({"type":"object"}),
                    image_data_urls: Vec::new(),
                    max_output_tokens: 10,
                    timeout: Duration::from_secs(2),
                    cancellation: None,
                },
            )
            .is_err()
        } else {
            list_models(&service).is_err()
        };
        assert!(
            !server.join().unwrap(),
            "redirect reached an unconfirmed receiver; generation={generation}"
        );
        assert!(failed);
    }
}
