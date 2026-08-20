use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    sync::{Arc, Mutex},
    thread,
};

use reqwest::blocking::Client;
use sha2::{Digest, Sha256};
use tempfile::tempdir;

use super::{DownloadControl, DownloadOutcome, download_artifact};
use crate::local_resources::ResourceArtifact;

struct InterruptedServer {
    url: String,
    requests: Arc<Mutex<Vec<String>>>,
    thread: Option<thread::JoinHandle<()>>,
}

impl InterruptedServer {
    fn start(body: Vec<u8>, cutoff: usize) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test listener should bind");
        let address = listener.local_addr().expect("listener should have address");
        let requests = Arc::new(Mutex::new(Vec::new()));
        let request_log = Arc::clone(&requests);
        let server_thread = thread::spawn(move || {
            for request_index in 0..2 {
                let (mut stream, _) = listener.accept().expect("request should arrive");
                let mut request = Vec::new();
                let mut buffer = [0_u8; 1024];
                loop {
                    let count = stream.read(&mut buffer).expect("request should read");
                    if count == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..count]);
                    if request.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&request).into_owned();
                request_log
                    .lock()
                    .expect("request log should lock")
                    .push(request.clone());
                if request_index == 0 {
                    let headers = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    stream
                        .write_all(headers.as_bytes())
                        .expect("headers should write");
                    stream
                        .write_all(&body[..cutoff])
                        .expect("partial body should write");
                    continue;
                }
                let range_start = request
                    .lines()
                    .find_map(|line| {
                        line.strip_prefix("Range: bytes=")
                            .or_else(|| line.strip_prefix("range: bytes="))
                            .and_then(|value| value.trim_end_matches('-').parse::<usize>().ok())
                    })
                    .expect("retry should use a byte range");
                let response_body = &body[range_start..];
                let headers = format!(
                    "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {range_start}-{}/{}\r\nConnection: close\r\n\r\n",
                    response_body.len(),
                    body.len() - 1,
                    body.len()
                );
                stream
                    .write_all(headers.as_bytes())
                    .expect("headers should write");
                stream
                    .write_all(response_body)
                    .expect("remaining body should write");
            }
        });
        Self {
            url: format!("http://{address}/fixture.bin"),
            requests,
            thread: Some(server_thread),
        }
    }

    fn finish(mut self) -> Vec<String> {
        self.thread
            .take()
            .expect("server thread should exist")
            .join()
            .expect("server should finish");
        self.requests
            .lock()
            .expect("request log should lock")
            .clone()
    }
}

#[test]
fn interrupted_response_is_retried_with_a_byte_range() {
    let body = b"automatic retry keeps partial resource downloads";
    let cutoff = 17;
    let server = InterruptedServer::start(body.to_vec(), cutoff);
    let directory = tempdir().expect("download directory");
    let path = directory.path().join("fixture.part");
    let artifact = ResourceArtifact {
        url: server.url.clone(),
        size: body.len() as u64,
        sha256: format!("{:x}", Sha256::digest(body)),
        format: "file".to_owned(),
        strip_components: None,
    };
    let outcome = download_artifact(
        &Client::new(),
        &artifact,
        &path,
        &DownloadControl::default(),
        |_| Ok(()),
    )
    .expect("interrupted download should retry");
    assert_eq!(outcome, DownloadOutcome::Complete);
    assert_eq!(fs::read(path).expect("download should read"), body);
    let requests = server.finish();
    assert_eq!(requests.len(), 2);
    assert!(
        requests[1]
            .to_ascii_lowercase()
            .contains(&format!("range: bytes={cutoff}-"))
    );
}
