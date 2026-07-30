use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use reqwest::{
    Method, StatusCode,
    blocking::{Client, Response},
    header::{
        self, ACCEPT, ACCEPT_ENCODING, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG,
        LAST_MODIFIED, LOCATION, RANGE, USER_AGENT,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;
use url::Url;
use uuid::Uuid;

use crate::{
    domain::Project,
    media::{self, MediaError},
    store::{ProjectStore, StoreError},
};

const MAX_REDIRECTS: usize = 5;
const MAX_MEDIA_BYTES: u64 = 20 * 1024 * 1024 * 1024;
const MAX_PLAYLIST_BYTES: u64 = 2 * 1024 * 1024;
const MAX_HLS_RESOURCES: usize = 20_000;
const MAX_HLS_DEPTH: usize = 3;
const MAX_DEFAULT_HLS_BANDWIDTH: u64 = 4_000_000;
const MAX_REQUEST_RETRIES: usize = 2;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(12);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);
const USER_AGENT_VALUE: &str = "SiaoVPlay/0.1 public-media-import";
static IMPORT_OPERATIONS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

#[derive(Debug, Error)]
pub enum RemoteMediaError {
    #[error("URL 格式无效")]
    InvalidUrl,
    #[error("只接受公开 HTTPS URL")]
    HttpsRequired,
    #[error("URL 不能包含用户名或密码")]
    CredentialsNotAllowed,
    #[error("已拒绝本机、私网或保留地址")]
    PrivateNetwork,
    #[error("无法确认 URL 主机的公开地址：{0}")]
    Dns(String),
    #[error("URL 重定向无效：{0}")]
    InvalidRedirect(String),
    #[error("URL 重定向次数超过 {MAX_REDIRECTS} 次")]
    RedirectLimit,
    #[error("远程媒体请求失败：{0}")]
    Request(String),
    #[error("远程地址返回了不支持的内容：{0}")]
    UnsupportedContent(String),
    #[error("远程媒体超过 20 GB 导入上限")]
    SizeLimit,
    #[error("URL 内容在确认后发生变化，请重新检查")]
    PreviewChanged,
    #[error("URL 导入已取消")]
    Cancelled,
    #[error("HLS 导入失败：{0}")]
    Hls(String),
    #[error("文件系统错误：{0}")]
    FileSystem(#[from] std::io::Error),
    #[error(transparent)]
    Media(#[from] MediaError),
    #[error(transparent)]
    Store(#[from] StoreError),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectRemoteMediaUrlInput {
    pub url: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRemoteMediaUrlInput {
    pub url: String,
    pub expected_preview_token: String,
    pub operation_id: String,
    pub title: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelRemoteMediaImportInput {
    pub operation_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteMediaKind {
    DirectFile,
    Hls,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteMediaPreview {
    pub original_url: String,
    pub final_url: String,
    pub display_name: String,
    pub media_kind: RemoteMediaKind,
    pub content_type: Option<String>,
    pub content_length: Option<u64>,
    pub preview_token: String,
}

struct Preflight {
    preview: RemoteMediaPreview,
}

struct SafeResponse {
    final_url: Url,
    response: Response,
}

struct ImportOperation {
    id: String,
    cancelled: Arc<AtomicBool>,
}

impl ImportOperation {
    fn register(id: &str) -> Result<Self, RemoteMediaError> {
        Uuid::parse_str(id).map_err(|_| RemoteMediaError::InvalidUrl)?;
        let cancelled = Arc::new(AtomicBool::new(false));
        let mut operations = IMPORT_OPERATIONS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|_| RemoteMediaError::Request("导入任务状态不可用".to_owned()))?;
        if operations.contains_key(id) {
            return Err(RemoteMediaError::Request("导入任务标识已在使用".to_owned()));
        }
        operations.insert(id.to_owned(), Arc::clone(&cancelled));
        Ok(Self {
            id: id.to_owned(),
            cancelled,
        })
    }

    fn check(&self) -> Result<(), RemoteMediaError> {
        if self.cancelled.load(Ordering::Relaxed) {
            Err(RemoteMediaError::Cancelled)
        } else {
            Ok(())
        }
    }
}

impl Drop for ImportOperation {
    fn drop(&mut self) {
        if let Ok(mut operations) = IMPORT_OPERATIONS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
        {
            operations.remove(&self.id);
        }
    }
}

#[derive(Default)]
struct SafeHttp {
    clients: HashMap<String, Client>,
}

impl SafeHttp {
    fn send(
        &mut self,
        method: Method,
        initial_url: &Url,
        range: Option<&str>,
    ) -> Result<SafeResponse, RemoteMediaError> {
        let mut current = initial_url.clone();
        for _ in 0..=MAX_REDIRECTS {
            let validated = validate_url_syntax(current.as_str())?;
            let host = validated
                .host_str()
                .ok_or(RemoteMediaError::InvalidUrl)?
                .to_ascii_lowercase();
            let port = validated.port_or_known_default().unwrap_or(443);
            let client_key = format!("{host}:{port}");
            if !self.clients.contains_key(&client_key) {
                let addresses = public_socket_addresses(&host, port)?;
                self.clients
                    .insert(client_key.clone(), pinned_client(&validated, &addresses)?);
            }
            let client = self
                .clients
                .get(&client_key)
                .ok_or_else(|| RemoteMediaError::Request("安全连接初始化失败".to_owned()))?;
            let mut last_error = None;
            let mut response = None;
            for attempt in 0..=MAX_REQUEST_RETRIES {
                let mut request = client
                    .request(method.clone(), validated.clone())
                    .header(USER_AGENT, USER_AGENT_VALUE)
                    .header(ACCEPT, "*/*")
                    .header(ACCEPT_ENCODING, "identity");
                if let Some(range) = range {
                    request = request.header(RANGE, range);
                }
                match request.send() {
                    Ok(candidate)
                        if attempt < MAX_REQUEST_RETRIES
                            && matches!(
                                candidate.status(),
                                StatusCode::BAD_GATEWAY
                                    | StatusCode::SERVICE_UNAVAILABLE
                                    | StatusCode::GATEWAY_TIMEOUT
                            ) =>
                    {
                        continue;
                    }
                    Ok(candidate) => {
                        response = Some(candidate);
                        break;
                    }
                    Err(error) if attempt < MAX_REQUEST_RETRIES => {
                        last_error = Some(error.to_string());
                    }
                    Err(error) => {
                        last_error = Some(error.to_string());
                        break;
                    }
                }
            }
            let response = response.ok_or_else(|| {
                RemoteMediaError::Request(
                    last_error.unwrap_or_else(|| "重试后仍无法连接远程媒体".to_owned()),
                )
            })?;
            if let Some(remote_address) = response.remote_addr() {
                ensure_public_ip(remote_address.ip())?;
            }
            if response.status().is_redirection() {
                let location = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or_else(|| {
                        RemoteMediaError::InvalidRedirect("响应缺少有效的 Location".to_owned())
                    })?;
                current = validated
                    .join(location)
                    .map_err(|error| RemoteMediaError::InvalidRedirect(error.to_string()))?;
                validate_url_syntax(current.as_str())?;
                continue;
            }
            return Ok(SafeResponse {
                final_url: validated,
                response,
            });
        }
        Err(RemoteMediaError::RedirectLimit)
    }
}

pub fn inspect_remote_media_url(
    input: InspectRemoteMediaUrlInput,
) -> Result<RemoteMediaPreview, RemoteMediaError> {
    Ok(preflight_remote_media(&input.url)?.preview)
}

pub fn import_remote_media_url(
    store: &ProjectStore,
    input: ImportRemoteMediaUrlInput,
) -> Result<Project, RemoteMediaError> {
    let operation = ImportOperation::register(&input.operation_id)?;
    let preflight = preflight_remote_media(&input.url)?;
    operation.check()?;
    if preflight.preview.preview_token != input.expected_preview_token {
        return Err(RemoteMediaError::PreviewChanged);
    }

    let import_directory = store
        .data_directory()
        .join("remote-media")
        .join(Uuid::new_v4().to_string());
    fs::create_dir_all(&import_directory)?;

    let result = (|| {
        let media_path = match preflight.preview.media_kind {
            RemoteMediaKind::DirectFile => {
                let extension = safe_extension(&preflight.preview.display_name)
                    .unwrap_or_else(|| "media".to_owned());
                let destination = import_directory.join(format!("source.{extension}"));
                download_direct_media(
                    &preflight.preview.original_url,
                    &preflight.preview.final_url,
                    &destination,
                    &operation.cancelled,
                )?;
                destination
            }
            RemoteMediaKind::Hls => {
                let mirror_directory = import_directory.join("hls");
                fs::create_dir_all(&mirror_directory)?;
                let local_playlist =
                    HlsMirror::new(&mirror_directory, Arc::clone(&operation.cancelled))
                        .mirror(&preflight.preview.final_url)?;
                let destination = import_directory.join("source.mkv");
                operation.check()?;
                media::remux_local_hls(&local_playlist, &destination)?;
                destination
            }
        };

        operation.check()?;
        media::validate_media_path(&media_path)?;
        operation.check()?;
        store
            .create_remote_project(
                &media_path,
                &preflight.preview.original_url,
                &preflight.preview.display_name,
                input.title.as_deref(),
            )
            .map_err(RemoteMediaError::from)
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&import_directory);
    }
    result
}

pub fn cancel_remote_media_import(
    input: CancelRemoteMediaImportInput,
) -> Result<bool, RemoteMediaError> {
    Uuid::parse_str(&input.operation_id).map_err(|_| RemoteMediaError::InvalidUrl)?;
    let operations = IMPORT_OPERATIONS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| RemoteMediaError::Request("导入任务状态不可用".to_owned()))?;
    let Some(cancelled) = operations.get(&input.operation_id) else {
        return Ok(false);
    };
    cancelled.store(true, Ordering::Relaxed);
    Ok(true)
}

fn preflight_remote_media(input: &str) -> Result<Preflight, RemoteMediaError> {
    let original = validate_public_https_url(input)?;
    let mut safe_response = send_with_redirects(Method::HEAD, &original, None)?;
    if matches!(
        safe_response.response.status(),
        StatusCode::FORBIDDEN | StatusCode::METHOD_NOT_ALLOWED | StatusCode::NOT_IMPLEMENTED
    ) {
        safe_response = send_with_redirects(Method::GET, &original, Some("bytes=0-4095"))?;
    }
    ensure_success_status(&safe_response.response)?;

    let content_type = normalized_header(&safe_response.response, CONTENT_TYPE);
    let content_length = response_total_length(&safe_response.response);
    if content_length.is_some_and(|length| length > MAX_MEDIA_BYTES) {
        return Err(RemoteMediaError::SizeLimit);
    }
    let media_kind = classify_media(&safe_response.final_url, content_type.as_deref())?;
    if media_kind == RemoteMediaKind::Hls {
        let playlist = fetch_text(&safe_response.final_url, MAX_PLAYLIST_BYTES)?;
        if !playlist
            .trim_start_matches('\u{feff}')
            .starts_with("#EXTM3U")
        {
            return Err(RemoteMediaError::UnsupportedContent(
                "M3U8 地址没有返回有效的 HLS 清单".to_owned(),
            ));
        }
    }

    let display_name = display_name_from_url(&safe_response.final_url, &media_kind);
    let preview_token = preview_token(
        &original,
        &safe_response.final_url,
        &media_kind,
        content_type.as_deref(),
        content_length,
        normalized_header(&safe_response.response, ETAG).as_deref(),
        normalized_header(&safe_response.response, LAST_MODIFIED).as_deref(),
    );

    Ok(Preflight {
        preview: RemoteMediaPreview {
            original_url: original.to_string(),
            final_url: safe_response.final_url.to_string(),
            display_name,
            media_kind,
            content_type,
            content_length,
            preview_token,
        },
    })
}

fn classify_media(
    url: &Url,
    content_type: Option<&str>,
) -> Result<RemoteMediaKind, RemoteMediaError> {
    let path = url.path().to_ascii_lowercase();
    let content_type = content_type
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if path.ends_with(".m3u8")
        || matches!(
            content_type.as_str(),
            "application/vnd.apple.mpegurl"
                | "application/x-mpegurl"
                | "audio/mpegurl"
                | "audio/x-mpegurl"
        )
    {
        return Ok(RemoteMediaKind::Hls);
    }
    if content_type.starts_with("text/")
        || content_type.contains("html")
        || content_type.contains("json")
        || content_type.contains("xml")
    {
        return Err(RemoteMediaError::UnsupportedContent(
            content_type.to_owned(),
        ));
    }
    Ok(RemoteMediaKind::DirectFile)
}

fn download_direct_media(
    original_url: &str,
    expected_final_url: &str,
    destination: &Path,
    cancelled: &AtomicBool,
) -> Result<(), RemoteMediaError> {
    let original = validate_public_https_url(original_url)?;
    let mut safe_response = send_with_redirects(Method::GET, &original, None)?;
    ensure_success_status(&safe_response.response)?;
    if safe_response.final_url.as_str() != expected_final_url {
        return Err(RemoteMediaError::PreviewChanged);
    }
    if response_total_length(&safe_response.response).is_some_and(|length| length > MAX_MEDIA_BYTES)
    {
        return Err(RemoteMediaError::SizeLimit);
    }
    write_response_atomically(
        &mut safe_response.response,
        destination,
        MAX_MEDIA_BYTES,
        cancelled,
    )?;
    Ok(())
}

fn fetch_text(url: &Url, limit: u64) -> Result<String, RemoteMediaError> {
    let mut safe_response = send_with_redirects(Method::GET, url, None)?;
    ensure_success_status(&safe_response.response)?;
    let bytes = read_response_limited(&mut safe_response.response, limit)?;
    String::from_utf8(bytes).map_err(|_| {
        RemoteMediaError::UnsupportedContent("HLS 清单不是有效的 UTF-8 文本".to_owned())
    })
}

fn send_with_redirects(
    method: Method,
    initial_url: &Url,
    range: Option<&str>,
) -> Result<SafeResponse, RemoteMediaError> {
    SafeHttp::default().send(method, initial_url, range)
}

pub(crate) fn preflight_public_https_page(input: &str) -> Result<Url, RemoteMediaError> {
    let original = validate_public_https_url(input)?;
    let response = send_with_redirects(Method::GET, &original, Some("bytes=0-4095"))?;
    ensure_success_status(&response.response)?;
    Ok(response.final_url)
}

fn pinned_client(url: &Url, addresses: &[SocketAddr]) -> Result<Client, RemoteMediaError> {
    let host = url.host_str().ok_or(RemoteMediaError::InvalidUrl)?;
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .referer(false)
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .resolve_to_addrs(host, addresses)
        .build()
        .map_err(|error| RemoteMediaError::Request(error.to_string()))
}

pub(crate) fn validate_public_https_url(input: &str) -> Result<Url, RemoteMediaError> {
    let url = validate_url_syntax(input)?;
    public_socket_addresses(
        url.host_str().ok_or(RemoteMediaError::InvalidUrl)?,
        url.port_or_known_default().unwrap_or(443),
    )?;
    Ok(url)
}

fn validate_url_syntax(input: &str) -> Result<Url, RemoteMediaError> {
    let url = Url::parse(input.trim()).map_err(|_| RemoteMediaError::InvalidUrl)?;
    if url.scheme() != "https" {
        return Err(RemoteMediaError::HttpsRequired);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(RemoteMediaError::CredentialsNotAllowed);
    }
    if url.host_str().is_none() {
        return Err(RemoteMediaError::InvalidUrl);
    }
    Ok(url)
}

fn public_socket_addresses(host: &str, port: u16) -> Result<Vec<SocketAddr>, RemoteMediaError> {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.ends_with(".home.arpa")
    {
        return Err(RemoteMediaError::PrivateNetwork);
    }
    let addresses = if let Ok(ip) = host.parse::<IpAddr>() {
        ensure_public_ip(ip)?;
        vec![ip]
    } else {
        let addresses = (host.as_str(), port)
            .to_socket_addrs()
            .map_err(|error| RemoteMediaError::Dns(error.to_string()))?
            .map(|address| address.ip())
            .collect::<Vec<_>>();
        if addresses.is_empty() {
            return Err(RemoteMediaError::Dns("主机没有可用地址".to_owned()));
        }
        if addresses.iter().all(|address| fake_tunnel_ip(*address)) {
            resolve_public_dns_over_https(&host)?
        } else {
            addresses
        }
    };
    let mut sockets = Vec::new();
    for address in addresses {
        ensure_public_ip(address)?;
        let socket = SocketAddr::new(address, port);
        if !sockets.contains(&socket) {
            sockets.push(socket);
        }
    }
    Ok(sockets)
}

fn resolve_public_dns_over_https(host: &str) -> Result<Vec<IpAddr>, RemoteMediaError> {
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| RemoteMediaError::Dns(error.to_string()))?;
    let mut addresses = Vec::new();
    for record_type in ["A", "AAAA"] {
        let response = client
            .get("https://cloudflare-dns.com/dns-query")
            .query(&[("name", host), ("type", record_type)])
            .header(ACCEPT, "application/dns-json")
            .send()
            .map_err(|error| RemoteMediaError::Dns(error.to_string()))?;
        if !response.status().is_success() {
            continue;
        }
        let bytes = response
            .bytes()
            .map_err(|error| RemoteMediaError::Dns(error.to_string()))?;
        let payload: Value = serde_json::from_slice(&bytes)
            .map_err(|error| RemoteMediaError::Dns(error.to_string()))?;
        if payload.get("Status").and_then(Value::as_u64) != Some(0) {
            continue;
        }
        addresses.extend(
            payload
                .get("Answer")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|answer| answer.get("data").and_then(Value::as_str))
                .filter_map(|address| address.parse::<IpAddr>().ok()),
        );
    }
    if addresses.is_empty() {
        return Err(RemoteMediaError::Dns(
            "无法通过公开 DNS 确认主机地址".to_owned(),
        ));
    }
    Ok(addresses)
}

fn fake_tunnel_ip(ip: IpAddr) -> bool {
    matches!(ip, IpAddr::V4(ip) if {
        let [a, b, _, _] = ip.octets();
        a == 198 && (b == 18 || b == 19)
    })
}

fn ensure_public_ip(ip: IpAddr) -> Result<(), RemoteMediaError> {
    let public = match ip {
        IpAddr::V4(ip) => public_ipv4(ip),
        IpAddr::V6(ip) => public_ipv6(ip),
    };
    if public {
        Ok(())
    } else {
        Err(RemoteMediaError::PrivateNetwork)
    }
}

fn public_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || a == 10
        || a == 127
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 192 && b == 168)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 224)
}

fn public_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(ipv4) = ip.to_ipv4() {
        return public_ipv4(ipv4);
    }
    let segments = ip.segments();
    if segments[..6] == [0x0064, 0xff9b, 0, 0, 0, 0] {
        return public_ipv4(Ipv4Addr::new(
            (segments[6] >> 8) as u8,
            segments[6] as u8,
            (segments[7] >> 8) as u8,
            segments[7] as u8,
        ));
    }
    if segments[0] == 0x2002 {
        return public_ipv4(Ipv4Addr::new(
            (segments[1] >> 8) as u8,
            segments[1] as u8,
            (segments[2] >> 8) as u8,
            segments[2] as u8,
        ));
    }
    !ip.is_unspecified()
        && !ip.is_loopback()
        && !ip.is_multicast()
        && !(segments[0] == 0x0064 && segments[1] == 0xff9b && segments[2] == 1)
        && !(segments[0] == 0x0100 && segments[1] == 0 && segments[2] == 0 && segments[3] == 0)
        && !(segments[0] == 0x2001 && segments[1] == 0x0002)
        && !(segments[0] == 0x2001 && (segments[1] & 0xfff0) == 0x0010)
        && !(segments[0] == 0x2001 && (segments[1] & 0xfff0) == 0x0020)
        && (segments[0] & 0xfe00) != 0xfc00
        && (segments[0] & 0xffc0) != 0xfe80
        && (segments[0] & 0xffc0) != 0xfec0
        && !(segments[0] == 0x2001 && segments[1] == 0x0db8)
        && (segments[0] & 0xfff0) != 0x3ff0
}

fn ensure_success_status(response: &Response) -> Result<(), RemoteMediaError> {
    if response.status().is_success() {
        Ok(())
    } else {
        Err(RemoteMediaError::Request(format!(
            "服务器返回 {}",
            response.status()
        )))
    }
}

fn normalized_header(response: &Response, name: header::HeaderName) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn response_total_length(response: &Response) -> Option<u64> {
    response
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit_once('/'))
        .and_then(|(_, total)| total.parse::<u64>().ok())
        .or_else(|| {
            response
                .headers()
                .get(CONTENT_LENGTH)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
        })
        .or_else(|| response.content_length())
}

fn read_response_limited(response: &mut Response, limit: u64) -> Result<Vec<u8>, RemoteMediaError> {
    let mut bytes = Vec::new();
    let mut limited = response.take(limit + 1);
    limited.read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(if limit == MAX_MEDIA_BYTES {
            RemoteMediaError::SizeLimit
        } else {
            RemoteMediaError::UnsupportedContent("HLS 清单过大".to_owned())
        });
    }
    Ok(bytes)
}

fn write_response_atomically(
    response: &mut Response,
    destination: &Path,
    limit: u64,
    cancelled: &AtomicBool,
) -> Result<u64, RemoteMediaError> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let part_path = destination.with_extension(format!(
        "{}.part",
        destination
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("download")
    ));
    let result = (|| {
        let mut output = File::create(&part_path)?;
        let mut buffer = [0_u8; 1024 * 1024];
        let mut total = 0_u64;
        loop {
            if cancelled.load(Ordering::Relaxed) {
                return Err(RemoteMediaError::Cancelled);
            }
            let read = response.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            total = total.saturating_add(read as u64);
            if total > limit {
                return Err(RemoteMediaError::SizeLimit);
            }
            output.write_all(&buffer[..read])?;
        }
        output.flush()?;
        output.sync_all()?;
        fs::rename(&part_path, destination)?;
        Ok(total)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&part_path);
    }
    result
}

fn preview_token(
    original: &Url,
    final_url: &Url,
    kind: &RemoteMediaKind,
    content_type: Option<&str>,
    content_length: Option<u64>,
    etag: Option<&str>,
    last_modified: Option<&str>,
) -> String {
    let mut hasher = Sha256::new();
    for value in [
        original.as_str(),
        final_url.as_str(),
        match kind {
            RemoteMediaKind::DirectFile => "direct_file",
            RemoteMediaKind::Hls => "hls",
        },
        content_type.unwrap_or_default(),
        etag.unwrap_or_default(),
        last_modified.unwrap_or_default(),
    ] {
        hasher.update(value.as_bytes());
        hasher.update([0]);
    }
    hasher.update(content_length.unwrap_or_default().to_le_bytes());
    format!("{:x}", hasher.finalize())
}

fn display_name_from_url(url: &Url, kind: &RemoteMediaKind) -> String {
    let fallback = match kind {
        RemoteMediaKind::DirectFile => "url-video.media",
        RemoteMediaKind::Hls => "url-video.m3u8",
    };
    url.path_segments()
        .and_then(|mut segments| segments.next_back())
        .map(sanitize_file_name)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_owned())
}

fn sanitize_file_name(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric()
                || matches!(character, '.' | '-' | '_' | ' ')
                || ('\u{4e00}'..='\u{9fff}').contains(&character)
            {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    sanitized
        .trim_matches([' ', '.'])
        .chars()
        .take(120)
        .collect()
}

fn safe_extension(value: &str) -> Option<String> {
    Path::new(value)
        .extension()
        .and_then(|extension| extension.to_str())
        .filter(|extension| {
            (1..=8).contains(&extension.len())
                && extension
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric())
        })
        .map(|extension| extension.to_ascii_lowercase())
}

struct HlsMirror<'a> {
    directory: &'a Path,
    http: SafeHttp,
    cancelled: Arc<AtomicBool>,
    resources: HashMap<String, String>,
    resource_count: usize,
    total_bytes: u64,
}

impl<'a> HlsMirror<'a> {
    fn new(directory: &'a Path, cancelled: Arc<AtomicBool>) -> Self {
        Self {
            directory,
            http: SafeHttp::default(),
            cancelled,
            resources: HashMap::new(),
            resource_count: 0,
            total_bytes: 0,
        }
    }

    fn mirror(mut self, input: &str) -> Result<PathBuf, RemoteMediaError> {
        let url = validate_public_https_url(input)?;
        self.mirror_playlist(&url, "master.m3u8", 0)
    }

    fn mirror_playlist(
        &mut self,
        requested_url: &Url,
        local_name: &str,
        depth: usize,
    ) -> Result<PathBuf, RemoteMediaError> {
        if depth > MAX_HLS_DEPTH {
            return Err(RemoteMediaError::Hls("HLS 清单嵌套层级过深".to_owned()));
        }
        self.note_resource()?;
        let mut safe_response = self.http.send(Method::GET, requested_url, None)?;
        ensure_success_status(&safe_response.response)?;
        let body = read_response_limited(&mut safe_response.response, MAX_PLAYLIST_BYTES)?;
        self.add_bytes(body.len() as u64)?;
        let text = String::from_utf8(body)
            .map_err(|_| RemoteMediaError::Hls("HLS 清单不是 UTF-8 文本".to_owned()))?;
        if !text.trim_start_matches('\u{feff}').starts_with("#EXTM3U") {
            return Err(RemoteMediaError::Hls(
                "远程地址没有返回有效的 HLS 清单".to_owned(),
            ));
        }

        let rewritten = if text.contains("#EXT-X-STREAM-INF") {
            self.rewrite_master_playlist(&text, &safe_response.final_url, depth)?
        } else {
            self.rewrite_media_playlist(&text, &safe_response.final_url)?
        };
        let local_path = self.directory.join(local_name);
        fs::write(&local_path, rewritten)?;
        Ok(local_path)
    }

    fn rewrite_master_playlist(
        &mut self,
        text: &str,
        base_url: &Url,
        depth: usize,
    ) -> Result<String, RemoteMediaError> {
        let lines = text.lines().collect::<Vec<_>>();
        let variant = select_variant(&lines)
            .ok_or_else(|| RemoteMediaError::Hls("主清单没有可用的视频变体".to_owned()))?;
        let variant_url = base_url
            .join(lines[variant.uri_index].trim())
            .map_err(|error| RemoteMediaError::Hls(error.to_string()))?;
        let variant_name = "video.m3u8";
        self.mirror_playlist(&variant_url, variant_name, depth + 1)?;

        let mut output = vec!["#EXTM3U".to_owned()];
        if let Some(version) = lines
            .iter()
            .find(|line| line.starts_with("#EXT-X-VERSION:"))
        {
            output.push((*version).to_owned());
        }
        for (group_attribute, media_type, local_name) in [
            ("AUDIO", "AUDIO", "audio.m3u8"),
            ("SUBTITLES", "SUBTITLES", "subtitles.m3u8"),
        ] {
            let Some(group_id) = attribute_value(lines[variant.tag_index], group_attribute) else {
                continue;
            };
            let Some(media_line) = select_media_line(&lines, media_type, &group_id) else {
                continue;
            };
            let Some(uri) = attribute_value(media_line, "URI") else {
                continue;
            };
            let media_url = base_url
                .join(&uri)
                .map_err(|error| RemoteMediaError::Hls(error.to_string()))?;
            self.mirror_playlist(&media_url, local_name, depth + 1)?;
            output.push(replace_uri_attribute(media_line, local_name)?);
        }
        if let Some(group_id) = attribute_value(lines[variant.tag_index], "CLOSED-CAPTIONS")
            && group_id != "NONE"
            && let Some(media_line) = select_any_media_line(&lines, "CLOSED-CAPTIONS", &group_id)
        {
            output.push(media_line.to_owned());
        }
        output.push(lines[variant.tag_index].to_owned());
        output.push(variant_name.to_owned());
        Ok(format!("{}\n", output.join("\n")))
    }

    fn rewrite_media_playlist(
        &mut self,
        text: &str,
        base_url: &Url,
    ) -> Result<String, RemoteMediaError> {
        if !text.lines().any(|line| line.trim() == "#EXT-X-ENDLIST") {
            return Err(RemoteMediaError::Hls(
                "暂不导入直播或仍在增长的 HLS 清单".to_owned(),
            ));
        }
        let mut output = Vec::new();
        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                output.push(String::new());
                continue;
            }
            if trimmed.starts_with("#EXT-X-KEY:") || trimmed.starts_with("#EXT-X-MAP:") {
                if let Some(uri) = attribute_value(trimmed, "URI") {
                    let remote_url = base_url
                        .join(&uri)
                        .map_err(|error| RemoteMediaError::Hls(error.to_string()))?;
                    let local_name = self.mirror_asset(&remote_url)?;
                    output.push(replace_uri_attribute(trimmed, &local_name)?);
                } else {
                    output.push(trimmed.to_owned());
                }
            } else if trimmed.starts_with('#') {
                output.push(trimmed.to_owned());
            } else {
                let remote_url = base_url
                    .join(trimmed)
                    .map_err(|error| RemoteMediaError::Hls(error.to_string()))?;
                output.push(self.mirror_asset(&remote_url)?);
            }
        }
        Ok(format!("{}\n", output.join("\n")))
    }

    fn mirror_asset(&mut self, requested_url: &Url) -> Result<String, RemoteMediaError> {
        if let Some(existing) = self.resources.get(requested_url.as_str()) {
            return Ok(existing.clone());
        }
        self.note_resource()?;
        let mut safe_response = self.http.send(Method::GET, requested_url, None)?;
        ensure_success_status(&safe_response.response)?;
        if response_total_length(&safe_response.response)
            .is_some_and(|length| self.total_bytes.saturating_add(length) > MAX_MEDIA_BYTES)
        {
            return Err(RemoteMediaError::SizeLimit);
        }
        let extension =
            safe_extension(safe_response.final_url.path()).unwrap_or_else(|| "bin".to_owned());
        let local_name = format!("asset-{:05}.{extension}", self.resource_count);
        let local_path = self.directory.join(&local_name);
        let remaining = MAX_MEDIA_BYTES.saturating_sub(self.total_bytes);
        let written = write_response_atomically(
            &mut safe_response.response,
            &local_path,
            remaining,
            &self.cancelled,
        )?;
        self.add_bytes(written)?;
        self.resources
            .insert(requested_url.to_string(), local_name.clone());
        Ok(local_name)
    }

    fn note_resource(&mut self) -> Result<(), RemoteMediaError> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Err(RemoteMediaError::Cancelled);
        }
        self.resource_count += 1;
        if self.resource_count > MAX_HLS_RESOURCES {
            return Err(RemoteMediaError::Hls("HLS 资源数量超过安全上限".to_owned()));
        }
        Ok(())
    }

    fn add_bytes(&mut self, bytes: u64) -> Result<(), RemoteMediaError> {
        self.total_bytes = self.total_bytes.saturating_add(bytes);
        if self.total_bytes > MAX_MEDIA_BYTES {
            return Err(RemoteMediaError::SizeLimit);
        }
        Ok(())
    }
}

#[derive(Clone, Copy)]
struct Variant {
    tag_index: usize,
    uri_index: usize,
    bandwidth: u64,
}

fn select_variant(lines: &[&str]) -> Option<Variant> {
    let mut variants = Vec::new();
    for (tag_index, line) in lines.iter().enumerate() {
        if !line.starts_with("#EXT-X-STREAM-INF:") {
            continue;
        }
        let Some((uri_index, _)) =
            lines
                .iter()
                .enumerate()
                .skip(tag_index + 1)
                .find(|(_, candidate)| {
                    let candidate = candidate.trim();
                    !candidate.is_empty() && !candidate.starts_with('#')
                })
        else {
            continue;
        };
        variants.push(Variant {
            tag_index,
            uri_index,
            bandwidth: attribute_value(line, "AVERAGE-BANDWIDTH")
                .or_else(|| attribute_value(line, "BANDWIDTH"))
                .and_then(|value| value.parse().ok())
                .unwrap_or_default(),
        });
    }
    variants
        .iter()
        .copied()
        .filter(|variant| variant.bandwidth <= MAX_DEFAULT_HLS_BANDWIDTH)
        .max_by_key(|variant| variant.bandwidth)
        .or_else(|| variants.into_iter().min_by_key(|variant| variant.bandwidth))
}

fn select_media_line<'a>(
    lines: &'a [&'a str],
    media_type: &str,
    group_id: &str,
) -> Option<&'a str> {
    let mut candidates = lines.iter().copied().filter(|line| {
        line.starts_with("#EXT-X-MEDIA:")
            && attribute_value(line, "TYPE").as_deref() == Some(media_type)
            && attribute_value(line, "GROUP-ID").as_deref() == Some(group_id)
            && attribute_value(line, "URI").is_some()
    });
    candidates
        .clone()
        .find(|line| attribute_value(line, "DEFAULT").as_deref() == Some("YES"))
        .or_else(|| candidates.next())
}

fn select_any_media_line<'a>(
    lines: &'a [&'a str],
    media_type: &str,
    group_id: &str,
) -> Option<&'a str> {
    lines.iter().copied().find(|line| {
        line.starts_with("#EXT-X-MEDIA:")
            && attribute_value(line, "TYPE").as_deref() == Some(media_type)
            && attribute_value(line, "GROUP-ID").as_deref() == Some(group_id)
    })
}

fn attribute_value(line: &str, name: &str) -> Option<String> {
    let attributes = line.split_once(':')?.1;
    let bytes = attributes.as_bytes();
    let mut start = 0;
    while start < bytes.len() {
        let mut end = start;
        let mut quoted = false;
        while end < bytes.len() {
            match bytes[end] {
                b'"' => quoted = !quoted,
                b',' if !quoted => break,
                _ => {}
            }
            end += 1;
        }
        let part = attributes[start..end].trim();
        if let Some((key, value)) = part.split_once('=')
            && key.trim() == name
        {
            return Some(value.trim().trim_matches('"').to_owned());
        }
        start = end.saturating_add(1);
    }
    None
}

fn replace_uri_attribute(line: &str, local_name: &str) -> Result<String, RemoteMediaError> {
    let marker = "URI=\"";
    let start = line
        .find(marker)
        .ok_or_else(|| RemoteMediaError::Hls("HLS URI 属性无效".to_owned()))?
        + marker.len();
    let end = line[start..]
        .find('"')
        .map(|offset| start + offset)
        .ok_or_else(|| RemoteMediaError::Hls("HLS URI 属性无效".to_owned()))?;
    Ok(format!("{}{}{}", &line[..start], local_name, &line[end..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_ip_filter_rejects_private_and_documentation_ranges() {
        for address in [
            "127.0.0.1",
            "10.0.0.4",
            "172.20.1.1",
            "192.168.1.3",
            "169.254.4.2",
            "100.64.0.1",
            "198.18.0.1",
            "203.0.113.10",
            "::1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
        ] {
            assert!(
                ensure_public_ip(address.parse().unwrap()).is_err(),
                "{address} should be blocked"
            );
        }
        assert!(ensure_public_ip("1.1.1.1".parse().unwrap()).is_ok());
        assert!(ensure_public_ip("2606:4700:4700::1111".parse().unwrap()).is_ok());
    }

    #[test]
    fn url_validation_rejects_non_https_credentials_and_private_hosts() {
        assert!(matches!(
            validate_public_https_url("http://example.com/video.mp4"),
            Err(RemoteMediaError::HttpsRequired)
        ));
        assert!(matches!(
            validate_public_https_url("https://name:secret@example.com/video.mp4"),
            Err(RemoteMediaError::CredentialsNotAllowed)
        ));
        assert!(matches!(
            validate_public_https_url("https://127.0.0.1/video.mp4"),
            Err(RemoteMediaError::PrivateNetwork)
        ));
        assert!(matches!(
            validate_public_https_url("https://media.local/video.mp4"),
            Err(RemoteMediaError::PrivateNetwork)
        ));
    }

    #[test]
    fn hls_master_selects_highest_bandwidth_and_default_audio() {
        let lines = [
            "#EXTM3U",
            "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"stereo\",NAME=\"Thai\",DEFAULT=YES,URI=\"audio-th.m3u8\"",
            "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"stereo\",NAME=\"English\",DEFAULT=NO,URI=\"audio-en.m3u8\"",
            "#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO=\"stereo\"",
            "low.m3u8",
            "#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=2400000,AUDIO=\"stereo\"",
            "high.m3u8",
            "#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=8200000,AUDIO=\"stereo\"",
            "oversized-default.m3u8",
        ];
        let variant = select_variant(&lines).unwrap();
        assert_eq!(variant.uri_index, 6);
        assert_eq!(select_media_line(&lines, "AUDIO", "stereo"), Some(lines[1]));
    }

    #[test]
    fn hls_attribute_parser_preserves_quoted_commas() {
        let line =
            "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"stereo\",NAME=\"Thai, main\",URI=\"audio.m3u8\"";
        assert_eq!(attribute_value(line, "NAME").as_deref(), Some("Thai, main"));
        assert_eq!(
            replace_uri_attribute(line, "audio-local.m3u8").unwrap(),
            "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"stereo\",NAME=\"Thai, main\",URI=\"audio-local.m3u8\""
        );
    }

    #[test]
    fn active_remote_import_can_be_cancelled_by_operation_id() {
        let operation_id = Uuid::new_v4().to_string();
        let operation = ImportOperation::register(&operation_id).unwrap();

        assert!(
            cancel_remote_media_import(CancelRemoteMediaImportInput {
                operation_id: operation_id.clone(),
            })
            .unwrap()
        );
        assert!(matches!(
            operation.check(),
            Err(RemoteMediaError::Cancelled)
        ));
        drop(operation);
        assert!(
            !cancel_remote_media_import(CancelRemoteMediaImportInput { operation_id }).unwrap()
        );
    }

    #[test]
    #[ignore = "requires an explicitly authorized public HTTPS media URL"]
    fn real_https_direct_media_can_be_inspected() {
        let url = std::env::var("SIAOVPLAY_TEST_REMOTE_URL")
            .expect("set SIAOVPLAY_TEST_REMOTE_URL to an authorized direct media URL");
        let preview = inspect_remote_media_url(InspectRemoteMediaUrlInput { url }).unwrap();
        assert_eq!(preview.media_kind, RemoteMediaKind::DirectFile);
        assert_eq!(preview.preview_token.len(), 64);
    }

    #[test]
    #[ignore = "requires an explicitly authorized public HTTPS media URL and FFmpeg"]
    fn real_https_direct_media_can_be_imported_probed_and_cleaned_up() {
        let url = std::env::var("SIAOVPLAY_TEST_REMOTE_URL")
            .expect("set SIAOVPLAY_TEST_REMOTE_URL to an authorized direct media URL");
        let temporary = tempfile::tempdir().unwrap();
        let store = ProjectStore::open(temporary.path().join("projects").join("test.db")).unwrap();
        let preview =
            inspect_remote_media_url(InspectRemoteMediaUrlInput { url: url.clone() }).unwrap();

        let project = import_remote_media_url(
            &store,
            ImportRemoteMediaUrlInput {
                url,
                expected_preview_token: preview.preview_token,
                operation_id: Uuid::new_v4().to_string(),
                title: None,
            },
        )
        .unwrap();

        let cached_path = PathBuf::from(&project.media_source.locator);
        assert!(cached_path.is_file());
        assert_eq!(
            project.media_source.origin_url.as_deref(),
            Some(preview.original_url.as_str())
        );
        let deleted = store.delete_project(&project.id).unwrap();
        assert!(deleted.deleted);
        assert!(deleted.cached_media_deleted);
        assert!(!cached_path.exists());
    }

    #[test]
    #[ignore = "requires an explicitly authorized public HTTPS HLS VOD URL and FFmpeg"]
    fn real_https_hls_vod_can_be_mirrored_remuxed_and_probed() {
        let url = std::env::var("SIAOVPLAY_TEST_HLS_URL")
            .expect("set SIAOVPLAY_TEST_HLS_URL to an authorized HLS VOD URL");
        let temporary = tempfile::tempdir().unwrap();
        let store = ProjectStore::open(temporary.path().join("projects").join("test.db")).unwrap();
        let preview =
            inspect_remote_media_url(InspectRemoteMediaUrlInput { url: url.clone() }).unwrap();
        assert_eq!(preview.media_kind, RemoteMediaKind::Hls);

        let project = import_remote_media_url(
            &store,
            ImportRemoteMediaUrlInput {
                url,
                expected_preview_token: preview.preview_token,
                operation_id: Uuid::new_v4().to_string(),
                title: None,
            },
        )
        .unwrap();

        assert!(Path::new(&project.media_source.locator).is_file());
        assert_eq!(
            Path::new(&project.media_source.locator)
                .extension()
                .and_then(|value| value.to_str()),
            Some("mkv")
        );
    }
}
