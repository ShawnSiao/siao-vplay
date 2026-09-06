use std::{
    io::{Read, Write},
    net::TcpListener,
    thread::{self, JoinHandle},
    time::Duration,
};

use serde_json::json;

use super::GenerationInput;
use crate::ai::types::{AiProtocol, AiProviderId, ResolvedAiService};

pub struct MockServer {
    pub url: String,
    handle: JoinHandle<String>,
}

pub fn serve_once(status: u16, body: &'static str) -> MockServer {
    serve_once_after(status, body, Duration::ZERO)
}

pub fn serve_once_after(status: u16, body: &'static str, delay: Duration) -> MockServer {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock provider");
    let address = listener.local_addr().expect("mock address");
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept request");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("read timeout");
        let request = read_request(&mut stream);
        thread::sleep(delay);
        let reason = if status == 200 { "OK" } else { "Error" };
        let response = format!(
            "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(response.as_bytes());
        request
    });
    MockServer {
        url: format!("http://{address}"),
        handle,
    }
}

pub(crate) fn read_request(stream: &mut impl Read) -> String {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 4096];
    loop {
        match stream.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => {
                bytes.extend_from_slice(&buffer[..count]);
                let text = String::from_utf8_lossy(&bytes);
                let Some((headers, body)) = text.split_once("\r\n\r\n") else {
                    continue;
                };
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(str::trim)
                            .and_then(|value| value.parse::<usize>().ok())
                    })
                    .unwrap_or_default();
                if body.len() >= content_length {
                    break;
                }
            }
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

impl MockServer {
    pub fn generation_input(&self) -> GenerationInput {
        GenerationInput {
            model_id: "test-model".to_owned(),
            system: "系统指令".to_owned(),
            prompt: "固定测试内容".to_owned(),
            schema_name: "connection_test".to_owned(),
            schema: json!({
                "type": "object",
                "properties": {"ok": {"type": "boolean"}},
                "required": ["ok"],
                "additionalProperties": false
            }),
            image_data_urls: Vec::new(),
            max_output_tokens: 2_048,
            timeout: Duration::from_secs(90),
            cancellation: None,
        }
    }

    pub fn finish(self) -> String {
        self.handle.join().expect("join mock provider")
    }
}

pub fn mock_service(
    provider_id: AiProviderId,
    protocol: AiProtocol,
    url: &str,
) -> ResolvedAiService {
    ResolvedAiService {
        service_config_id: None,
        provider_id,
        protocol,
        base_url: url.to_owned(),
        model_id: Some("test-model".to_owned()),
        api_key: "test-key".to_owned(),
    }
}
