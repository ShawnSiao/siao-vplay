use std::{
    io::{Read, Write},
    net::{Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

use url::Url;

use crate::remote_media::{self, RemoteMediaError};

pub(crate) struct SafeConnectProxy {
    address: SocketAddr,
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

impl SafeConnectProxy {
    pub(crate) fn start() -> Result<Self, RemoteMediaError> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(request_error)?;
        listener.set_nonblocking(true).map_err(request_error)?;
        let address = listener.local_addr().map_err(request_error)?;
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let worker = thread::spawn(move || {
            while !worker_stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        if stream.set_nonblocking(false).is_err() {
                            continue;
                        }
                        thread::spawn(move || {
                            let _ = handle_proxy_connection(stream);
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            address,
            stop,
            worker: Some(worker),
        })
    }

    pub(crate) fn url(&self) -> String {
        format!("http://{}", self.address)
    }
}

impl Drop for SafeConnectProxy {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = TcpStream::connect(self.address);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn handle_proxy_connection(mut client: TcpStream) -> Result<(), RemoteMediaError> {
    client
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(request_error)?;
    client
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(request_error)?;
    let mut request = Vec::with_capacity(1024);
    let mut byte = [0_u8; 1];
    while request.len() < 16 * 1024 && !request.ends_with(b"\r\n\r\n") {
        if client.read(&mut byte).map_err(request_error)? == 0 {
            return Ok(());
        }
        request.push(byte[0]);
    }
    let first_line = String::from_utf8_lossy(&request)
        .lines()
        .next()
        .unwrap_or_default()
        .to_owned();
    let mut parts = first_line.split_whitespace();
    if parts.next() != Some("CONNECT") {
        reject(&mut client, "403 Forbidden");
        return Ok(());
    }
    let authority = parts.next().ok_or(RemoteMediaError::InvalidUrl)?;
    let target = Url::parse(&format!("https://{authority}/"))
        .map_err(|error| RemoteMediaError::Request(error.to_string()))?;
    let host = target.host_str().ok_or(RemoteMediaError::InvalidUrl)?;
    let port = target.port_or_known_default().unwrap_or(443);
    let addresses = match remote_media::public_addrs(host, port) {
        Ok(addresses) => addresses,
        Err(_) => {
            reject(&mut client, "403 Forbidden");
            return Ok(());
        }
    };
    let upstream = addresses
        .into_iter()
        .find_map(|address| TcpStream::connect_timeout(&address, Duration::from_secs(8)).ok());
    let Some(mut upstream) = upstream else {
        reject(&mut client, "502 Bad Gateway");
        return Ok(());
    };
    for stream in [&client, &upstream] {
        stream
            .set_read_timeout(Some(Duration::from_secs(45)))
            .map_err(request_error)?;
        stream
            .set_write_timeout(Some(Duration::from_secs(45)))
            .map_err(request_error)?;
    }
    client
        .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        .map_err(request_error)?;
    let mut client_reader = client.try_clone().map_err(request_error)?;
    let mut upstream_writer = upstream.try_clone().map_err(request_error)?;
    let upload = thread::spawn(move || {
        let _ = std::io::copy(&mut client_reader, &mut upstream_writer);
        let _ = upstream_writer.shutdown(Shutdown::Write);
    });
    let _ = std::io::copy(&mut upstream, &mut client);
    let _ = client.shutdown(Shutdown::Write);
    let _ = upload.join();
    Ok(())
}

fn reject(client: &mut TcpStream, status: &str) {
    let response = format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    let _ = client.write_all(response.as_bytes());
}

fn request_error(error: impl ToString) -> RemoteMediaError {
    RemoteMediaError::Request(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_proxy_rejects_plain_http_requests() {
        let proxy = SafeConnectProxy::start().unwrap();
        let mut stream = TcpStream::connect(proxy.address).unwrap();
        stream
            .write_all(b"GET https://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 403 Forbidden"));
    }

    #[test]
    fn safe_proxy_rejects_private_connect_targets() {
        let proxy = SafeConnectProxy::start().unwrap();
        let mut stream = TcpStream::connect(proxy.address).unwrap();
        stream
            .write_all(b"CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 403 Forbidden"));
    }
}
