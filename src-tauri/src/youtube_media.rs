use std::{
    collections::HashMap,
    env,
    fs::{self, File},
    io::{BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
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
    remote_media::{self, RemoteMediaError},
    store::{ProjectStore, RemoteImportProvenance, StoreError},
};

const PINNED_YT_DLP_VERSION: &str = "2026.06.09";
const PINNED_YT_DLP_SHA256: &str =
    "3a48cb955d55c8821b60ccbdbbc6f61bc958f2f3d3b7ad5eaf3d83a543293a27";
const FORMAT_SELECTOR: &str = "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b";
const MAX_MEDIA_BYTES: u64 = 20 * 1024 * 1024 * 1024;
const TOOL_TIMEOUT: Duration = Duration::from_secs(10);
const INSPECTION_TIMEOUT: Duration = Duration::from_secs(90);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60 * 60);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(100);
const FILE_OUTPUT_PREFIX: &str = "__SIAOVPLAY_FILE__";
static IMPORT_OPERATIONS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

#[derive(Debug, Error)]
pub enum YouTubeMediaError {
    #[error(transparent)]
    Network(#[from] RemoteMediaError),
    #[error("只支持 YouTube 公开单视频页面")]
    UnsupportedUrl,
    #[error("不支持播放列表或合集，请使用不带播放列表参数的单视频链接")]
    PlaylistNotAllowed,
    #[error("不支持直播、首播等待页或正在进行的直播")]
    LiveNotAllowed,
    #[error("这个视频需要登录、订阅、会员或其他访问权限")]
    Restricted,
    #[error("无法确认这是可公开读取的单个视频")]
    UncertainMedia,
    #[error("公开视频导入运行时不可用：{0}")]
    ToolUnavailable(String),
    #[error("公开视频导入运行时未通过完整性检查")]
    ToolIntegrity,
    #[error("公开视频导入运行时版本不受支持")]
    ToolVersion,
    #[error("公开视频页面检查超时，请稍后重试")]
    InspectionTimeout,
    #[error("公开视频页面无法公开读取：{0}")]
    InspectionFailed(String),
    #[error("公开视频页面返回了无法识别的信息：{0}")]
    MetadataInvalid(String),
    #[error("已选媒体地址未通过公开网络检查")]
    SelectedMediaUnsafe,
    #[error("视频在确认后发生变化，请重新检查")]
    PreviewChanged,
    #[error("视频下载超过 20 GB 导入上限")]
    SizeLimit,
    #[error("公开视频导入超时")]
    DownloadTimeout,
    #[error("公开视频下载失败：{0}")]
    DownloadFailed(String),
    #[error("公开视频导入已取消")]
    Cancelled,
    #[error("文件系统错误：{0}")]
    FileSystem(#[from] std::io::Error),
    #[error(transparent)]
    Media(#[from] MediaError),
    #[error(transparent)]
    Store(#[from] StoreError),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectYouTubeUrlInput {
    pub url: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportYouTubeUrlInput {
    pub url: String,
    pub expected_preview_token: String,
    pub operation_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelYouTubeImportInput {
    pub operation_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeMediaPreview {
    pub original_url: String,
    pub webpage_url: String,
    pub video_id: String,
    pub title: String,
    pub duration_seconds: f64,
    pub file_size_bytes: Option<u64>,
    pub importer_version: String,
    pub importer_sha256: String,
    pub preview_token: String,
}

#[derive(Clone, Debug)]
struct ToolIdentity {
    path: PathBuf,
    version: String,
    sha256: String,
}

struct ImportOperation {
    id: String,
    cancelled: Arc<AtomicBool>,
}

impl ImportOperation {
    fn register(id: &str) -> Result<Self, YouTubeMediaError> {
        Uuid::parse_str(id).map_err(|_| YouTubeMediaError::UnsupportedUrl)?;
        let cancelled = Arc::new(AtomicBool::new(false));
        let mut operations = IMPORT_OPERATIONS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|_| YouTubeMediaError::ToolUnavailable("导入任务状态不可用".to_owned()))?;
        if operations.contains_key(id) {
            return Err(YouTubeMediaError::ToolUnavailable(
                "导入任务标识已在使用".to_owned(),
            ));
        }
        operations.insert(id.to_owned(), Arc::clone(&cancelled));
        Ok(Self {
            id: id.to_owned(),
            cancelled,
        })
    }

    fn check(&self) -> Result<(), YouTubeMediaError> {
        if self.cancelled.load(Ordering::Relaxed) {
            Err(YouTubeMediaError::Cancelled)
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

struct CapturedOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

pub fn inspect_youtube_url(
    input: InspectYouTubeUrlInput,
) -> Result<YouTubeMediaPreview, YouTubeMediaError> {
    let original = validate_youtube_page_url(&input.url)?;
    let final_url = remote_media::preflight_public_https_page(original.as_str())?;
    validate_youtube_page_url(final_url.as_str())?;
    let tool = verify_tool(&resolve_yt_dlp_path()?)?;
    inspect_with_tool(&original, &tool)
}

pub fn import_youtube_url(
    store: &ProjectStore,
    input: ImportYouTubeUrlInput,
) -> Result<Project, YouTubeMediaError> {
    let operation = ImportOperation::register(&input.operation_id)?;
    let original = validate_youtube_page_url(&input.url)?;
    let final_url = remote_media::preflight_public_https_page(original.as_str())?;
    validate_youtube_page_url(final_url.as_str())?;
    operation.check()?;

    let tool = verify_tool(&resolve_yt_dlp_path()?)?;
    let refreshed = inspect_with_tool(&original, &tool)?;
    operation.check()?;
    if refreshed.preview_token != input.expected_preview_token {
        return Err(YouTubeMediaError::PreviewChanged);
    }

    let import_directory = store
        .data_directory()
        .join("remote-media")
        .join(Uuid::new_v4().to_string());
    fs::create_dir_all(&import_directory)?;
    let result = (|| {
        let media_path = download_video(&original, &tool, &import_directory, &operation.cancelled)?;
        operation.check()?;
        let metadata = fs::metadata(&media_path)?;
        if metadata.len() > MAX_MEDIA_BYTES {
            return Err(YouTubeMediaError::SizeLimit);
        }
        media::validate_media_path(&media_path)?;
        operation.check()?;
        store
            .create_remote_project_with_provenance(
                &media_path,
                original.as_str(),
                &format!("{}.mp4", refreshed.title),
                Some(&refreshed.title),
                &RemoteImportProvenance {
                    importer: "yt-dlp".to_owned(),
                    importer_version: tool.version.clone(),
                    importer_sha256: tool.sha256.clone(),
                },
            )
            .map_err(YouTubeMediaError::from)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&import_directory);
    }
    result
}

pub fn cancel_youtube_import(input: CancelYouTubeImportInput) -> Result<bool, YouTubeMediaError> {
    Uuid::parse_str(&input.operation_id).map_err(|_| YouTubeMediaError::UnsupportedUrl)?;
    let operations = IMPORT_OPERATIONS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| YouTubeMediaError::ToolUnavailable("导入任务状态不可用".to_owned()))?;
    let Some(cancelled) = operations.get(&input.operation_id) else {
        return Ok(false);
    };
    cancelled.store(true, Ordering::Relaxed);
    Ok(true)
}

fn inspect_with_tool(
    original: &Url,
    tool: &ToolIdentity,
) -> Result<YouTubeMediaPreview, YouTubeMediaError> {
    let mut command = hidden_command(&tool.path);
    command.args(inspection_arguments(original));
    let output = capture_command(command, INSPECTION_TIMEOUT, None, true)?;
    if !output.status.success() {
        return Err(YouTubeMediaError::InspectionFailed(safe_tool_message(
            &output.stderr,
            &output.stdout,
        )));
    }
    let metadata: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| YouTubeMediaError::MetadataInvalid(error.to_string()))?;
    parse_metadata(original, &metadata, tool)
}

fn parse_metadata(
    original: &Url,
    metadata: &Value,
    tool: &ToolIdentity,
) -> Result<YouTubeMediaPreview, YouTubeMediaError> {
    let source_type = metadata
        .get("_type")
        .and_then(Value::as_str)
        .unwrap_or("video");
    let has_entries = metadata
        .get("entries")
        .and_then(Value::as_array)
        .is_some_and(|entries| !entries.is_empty());
    if source_type != "video" || has_entries {
        return Err(YouTubeMediaError::PlaylistNotAllowed);
    }
    let extractor = metadata
        .get("extractor_key")
        .or_else(|| metadata.get("extractor"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !extractor.eq_ignore_ascii_case("youtube") {
        return Err(YouTubeMediaError::UncertainMedia);
    }
    let live_status = metadata.get("live_status").and_then(Value::as_str);
    if metadata.get("is_live").and_then(Value::as_bool) == Some(true)
        || live_status.is_some_and(|status| !matches!(status, "not_live" | "was_live"))
    {
        return Err(YouTubeMediaError::LiveNotAllowed);
    }
    match metadata.get("availability").and_then(Value::as_str) {
        Some("public") => {}
        Some("private" | "premium_only" | "subscriber_only" | "needs_auth") => {
            return Err(YouTubeMediaError::Restricted);
        }
        _ => return Err(YouTubeMediaError::UncertainMedia),
    }

    let webpage_url = required_text(metadata, "webpage_url", "规范页面 URL")?;
    let webpage_url = validate_youtube_page_url(&webpage_url)?;
    validate_selected_media_urls(metadata)?;
    let video_id = required_text(metadata, "id", "视频标识")?;
    let title = sanitized_title(&required_text(metadata, "title", "视频标题")?);
    let duration_seconds = metadata
        .get("duration")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(|| YouTubeMediaError::MetadataInvalid("无法确认视频时长".to_owned()))?;
    let file_size_bytes = selected_file_size(metadata);
    if file_size_bytes.is_some_and(|size| size > MAX_MEDIA_BYTES) {
        return Err(YouTubeMediaError::SizeLimit);
    }
    let preview_token = preview_token(
        original,
        &webpage_url,
        &video_id,
        &title,
        duration_seconds,
        file_size_bytes,
        tool,
    );
    Ok(YouTubeMediaPreview {
        original_url: original.to_string(),
        webpage_url: webpage_url.to_string(),
        video_id,
        title,
        duration_seconds,
        file_size_bytes,
        importer_version: tool.version.clone(),
        importer_sha256: tool.sha256.clone(),
        preview_token,
    })
}

fn validate_selected_media_urls(metadata: &Value) -> Result<(), YouTubeMediaError> {
    let mut candidates = Vec::new();
    if let Some(downloads) = metadata
        .get("requested_downloads")
        .and_then(Value::as_array)
    {
        for download in downloads {
            collect_media_urls(download, &mut candidates);
            if let Some(formats) = download.get("requested_formats").and_then(Value::as_array) {
                for format in formats {
                    collect_media_urls(format, &mut candidates);
                }
            }
        }
    }
    if candidates.is_empty() {
        return Err(YouTubeMediaError::MetadataInvalid(
            "没有可验证的媒体下载地址".to_owned(),
        ));
    }
    for candidate in candidates {
        remote_media::validate_public_https_url(candidate)
            .map_err(|_| YouTubeMediaError::SelectedMediaUnsafe)?;
    }
    Ok(())
}

fn collect_media_urls<'a>(value: &'a Value, output: &mut Vec<&'a str>) {
    for key in ["url", "manifest_url"] {
        if let Some(candidate) = value
            .get(key)
            .and_then(Value::as_str)
            .filter(|candidate| !candidate.trim().is_empty())
        {
            output.push(candidate);
        }
    }
}

fn download_video(
    original: &Url,
    tool: &ToolIdentity,
    output_directory: &Path,
    cancelled: &Arc<AtomicBool>,
) -> Result<PathBuf, YouTubeMediaError> {
    let ffmpeg_path = media::ffmpeg_path()?;
    let mut command = hidden_command(&tool.path);
    command.args(download_arguments(original, output_directory, &ffmpeg_path));
    let output = capture_command(
        command,
        DOWNLOAD_TIMEOUT,
        Some(Arc::clone(cancelled)),
        false,
    )?;
    if !output.status.success() {
        return Err(YouTubeMediaError::DownloadFailed(safe_tool_message(
            &output.stderr,
            &output.stdout,
        )));
    }
    completed_output_path(output_directory, &output.stdout)
}

fn completed_output_path(
    output_directory: &Path,
    stdout: &[u8],
) -> Result<PathBuf, YouTubeMediaError> {
    let reported = String::from_utf8_lossy(stdout)
        .lines()
        .rev()
        .find_map(|line| line.trim().strip_prefix(FILE_OUTPUT_PREFIX))
        .map(PathBuf::from);
    let candidate = if let Some(reported) = reported {
        reported
    } else {
        let mut candidates = fs::read_dir(output_directory)?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_file()
                    && path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| {
                            name.starts_with("source.")
                                && !name.ends_with(".part")
                                && !name.ends_with(".ytdl")
                        })
            })
            .collect::<Vec<_>>();
        candidates.sort();
        if candidates.len() != 1 {
            return Err(YouTubeMediaError::DownloadFailed(
                "下载完成后没有找到唯一的媒体文件".to_owned(),
            ));
        }
        candidates.remove(0)
    };
    let canonical_directory = dunce::canonicalize(output_directory)?;
    let canonical_candidate = dunce::canonicalize(&candidate)?;
    if canonical_candidate.parent() != Some(canonical_directory.as_path()) {
        return Err(YouTubeMediaError::DownloadFailed(
            "下载结果超出受控目录".to_owned(),
        ));
    }
    Ok(canonical_candidate)
}

fn inspection_arguments(url: &Url) -> Vec<String> {
    [
        "--ignore-config",
        "--no-plugin-dirs",
        "--no-playlist",
        "--no-cache-dir",
        "--proxy",
        "",
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        "--format",
        FORMAT_SELECTOR,
        "--",
        url.as_str(),
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()
}

fn download_arguments(url: &Url, output_directory: &Path, ffmpeg_path: &Path) -> Vec<String> {
    let mut arguments = vec![
        "--ignore-config".to_owned(),
        "--no-plugin-dirs".to_owned(),
        "--no-playlist".to_owned(),
        "--no-cache-dir".to_owned(),
        "--proxy".to_owned(),
        String::new(),
        "--continue".to_owned(),
        "--part".to_owned(),
        "--no-overwrites".to_owned(),
        "--no-progress".to_owned(),
        "--socket-timeout".to_owned(),
        "30".to_owned(),
        "--retries".to_owned(),
        "2".to_owned(),
        "--fragment-retries".to_owned(),
        "2".to_owned(),
        "--max-filesize".to_owned(),
        MAX_MEDIA_BYTES.to_string(),
        "--format".to_owned(),
        FORMAT_SELECTOR.to_owned(),
        "--merge-output-format".to_owned(),
        "mp4".to_owned(),
        "--remux-video".to_owned(),
        "mp4".to_owned(),
        "--print".to_owned(),
        format!("after_move:{FILE_OUTPUT_PREFIX}%(filepath)s"),
        "--paths".to_owned(),
        output_directory.to_string_lossy().into_owned(),
        "--output".to_owned(),
        "source.%(ext)s".to_owned(),
    ];
    if let Some(parent) = ffmpeg_path.parent() {
        arguments.push("--ffmpeg-location".to_owned());
        arguments.push(parent.to_string_lossy().into_owned());
    }
    arguments.push("--".to_owned());
    arguments.push(url.as_str().to_owned());
    arguments
}

fn validate_youtube_page_url(input: &str) -> Result<Url, YouTubeMediaError> {
    let url = Url::parse(input.trim()).map_err(|_| YouTubeMediaError::UnsupportedUrl)?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err(YouTubeMediaError::UnsupportedUrl);
    }
    let host = url
        .host_str()
        .ok_or(YouTubeMediaError::UnsupportedUrl)?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if !matches!(
        host.as_str(),
        "youtube.com" | "www.youtube.com" | "m.youtube.com" | "youtu.be"
    ) {
        return Err(YouTubeMediaError::UnsupportedUrl);
    }
    if url.query_pairs().any(|(key, _)| key == "list")
        || url.path().eq_ignore_ascii_case("/playlist")
    {
        return Err(YouTubeMediaError::PlaylistNotAllowed);
    }
    let valid_shape = if host == "youtu.be" {
        url.path_segments()
            .and_then(|mut segments| segments.next())
            .is_some_and(|segment| !segment.is_empty())
    } else if url.path().eq_ignore_ascii_case("/watch") {
        url.query_pairs()
            .any(|(key, value)| key == "v" && !value.is_empty())
    } else {
        let mut segments = url.path_segments().into_iter().flatten();
        matches!(segments.next(), Some("shorts" | "live"))
            && segments.next().is_some_and(|segment| !segment.is_empty())
    };
    if !valid_shape {
        return Err(YouTubeMediaError::UnsupportedUrl);
    }
    Ok(url)
}

fn selected_file_size(metadata: &Value) -> Option<u64> {
    metadata
        .get("filesize")
        .or_else(|| metadata.get("filesize_approx"))
        .and_then(Value::as_u64)
        .or_else(|| {
            metadata
                .get("requested_downloads")
                .and_then(Value::as_array)
                .and_then(|downloads| {
                    downloads.iter().try_fold(0_u64, |total, download| {
                        download
                            .get("filesize")
                            .or_else(|| download.get("filesize_approx"))
                            .and_then(Value::as_u64)
                            .and_then(|size| total.checked_add(size))
                    })
                })
        })
}

fn required_text(metadata: &Value, key: &str, label: &str) -> Result<String, YouTubeMediaError> {
    metadata
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| YouTubeMediaError::MetadataInvalid(format!("缺少{label}")))
}

fn sanitized_title(value: &str) -> String {
    let mut title = value
        .chars()
        .filter(|character| !character.is_control())
        .take(180)
        .collect::<String>();
    title = title.trim().to_owned();
    if title.is_empty() {
        "YouTube 视频".to_owned()
    } else {
        title
    }
}

fn preview_token(
    original: &Url,
    webpage_url: &Url,
    video_id: &str,
    title: &str,
    duration_seconds: f64,
    file_size_bytes: Option<u64>,
    tool: &ToolIdentity,
) -> String {
    let mut hasher = Sha256::new();
    for value in [
        original.as_str(),
        webpage_url.as_str(),
        video_id,
        title,
        &duration_seconds.to_bits().to_string(),
        &file_size_bytes
            .map(|value| value.to_string())
            .unwrap_or_default(),
        &tool.version,
        &tool.sha256,
    ] {
        hasher.update(value.as_bytes());
        hasher.update([0]);
    }
    format!("{:x}", hasher.finalize())
}

fn resolve_yt_dlp_path() -> Result<PathBuf, YouTubeMediaError> {
    if let Some(path) = env::var_os("SIAOVPLAY_YT_DLP")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        if path.is_file() {
            return Ok(path);
        }
        return Err(YouTubeMediaError::ToolUnavailable(format!(
            "SIAOVPLAY_YT_DLP 指向的文件不存在：{}",
            path.display()
        )));
    }
    let runtime_root = env::var_os("SIAOVPLAY_RUNTIME_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let executable_path = env::current_exe().ok();
    let candidates = yt_dlp_candidates(runtime_root.as_deref(), executable_path.as_deref());
    candidates
        .iter()
        .find(|path| path.is_file())
        .cloned()
        .ok_or_else(|| {
            let checked = candidates
                .iter()
                .take(12)
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join("；");
            YouTubeMediaError::ToolUnavailable(format!(
                "未找到固定运行时。可以设置 SIAOVPLAY_YT_DLP，或放入应用相邻的 yt-dlp 目录。已检查：{checked}"
            ))
        })
}

fn yt_dlp_candidates(runtime_root: Option<&Path>, executable_path: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(runtime_root) = runtime_root {
        push_unique(
            &mut candidates,
            runtime_root.join("yt-dlp").join("yt-dlp.exe"),
        );
        push_unique(&mut candidates, runtime_root.join("bin").join("yt-dlp.exe"));
    }
    if let Some(executable_directory) = executable_path.and_then(Path::parent) {
        for ancestor in executable_directory
            .ancestors()
            .take(5)
            .take_while(|ancestor| ancestor.parent().is_some())
        {
            for relative_directory in [
                Path::new("runtimes").join("yt-dlp"),
                Path::new("runtime").join("yt-dlp"),
                Path::new("resources").join("yt-dlp"),
                PathBuf::from("yt-dlp"),
            ] {
                push_unique(
                    &mut candidates,
                    ancestor.join(relative_directory).join("yt-dlp.exe"),
                );
            }
        }
    }
    candidates
}

fn push_unique(candidates: &mut Vec<PathBuf>, path: PathBuf) {
    if !candidates.contains(&path) {
        candidates.push(path);
    }
}

fn verify_tool(path: &Path) -> Result<ToolIdentity, YouTubeMediaError> {
    if !path.is_file() {
        return Err(YouTubeMediaError::ToolUnavailable(
            path.display().to_string(),
        ));
    }
    let actual_sha256 = hash_file(path)?;
    if actual_sha256 != PINNED_YT_DLP_SHA256 {
        return Err(YouTubeMediaError::ToolIntegrity);
    }
    let command = hidden_command(path);
    let mut command = command;
    command.arg("--version");
    let output = capture_command(command, TOOL_TIMEOUT, None, false)?;
    let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if !output.status.success() || version != PINNED_YT_DLP_VERSION {
        return Err(YouTubeMediaError::ToolVersion);
    }
    Ok(ToolIdentity {
        path: path.to_path_buf(),
        version,
        sha256: actual_sha256,
    })
}

fn hash_file(path: &Path) -> Result<String, YouTubeMediaError> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn capture_command(
    mut command: Command,
    timeout: Duration,
    cancelled: Option<Arc<AtomicBool>>,
    inspection: bool,
) -> Result<CapturedOutput, YouTubeMediaError> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| YouTubeMediaError::ToolUnavailable(error.to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| YouTubeMediaError::ToolUnavailable("无法读取运行时输出".to_owned()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| YouTubeMediaError::ToolUnavailable("无法读取运行时错误".to_owned()))?;
    let stdout_reader = thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).map(|_| bytes)
    });
    let stderr_reader = thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).map(|_| bytes)
    });
    let started = Instant::now();
    let status = loop {
        if cancelled
            .as_ref()
            .is_some_and(|flag| flag.load(Ordering::Relaxed))
        {
            terminate_process_tree(&mut child);
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(YouTubeMediaError::Cancelled);
        }
        if started.elapsed() >= timeout {
            terminate_process_tree(&mut child);
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(if inspection {
                YouTubeMediaError::InspectionTimeout
            } else {
                YouTubeMediaError::DownloadTimeout
            });
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| YouTubeMediaError::ToolUnavailable(error.to_string()))?
        {
            break status;
        }
        thread::sleep(PROCESS_POLL_INTERVAL);
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| YouTubeMediaError::ToolUnavailable("读取运行时输出失败".to_owned()))??;
    let stderr = stderr_reader
        .join()
        .map_err(|_| YouTubeMediaError::ToolUnavailable("读取运行时错误失败".to_owned()))??;
    Ok(CapturedOutput {
        status,
        stdout,
        stderr,
    })
}

fn terminate_process_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = hidden_command(Path::new("taskkill.exe"))
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn safe_tool_message(stderr: &[u8], stdout: &[u8]) -> String {
    let stderr = String::from_utf8_lossy(stderr);
    let stdout = String::from_utf8_lossy(stdout);
    let message = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    if message.is_empty() {
        "运行时没有返回更多信息".to_owned()
    } else {
        message.chars().take(1200).collect()
    }
}

fn hidden_command(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RealUrlFixture {
        url: String,
        expected_video_id: String,
    }

    fn tool() -> ToolIdentity {
        ToolIdentity {
            path: PathBuf::from("yt-dlp.exe"),
            version: PINNED_YT_DLP_VERSION.to_owned(),
            sha256: PINNED_YT_DLP_SHA256.to_owned(),
        }
    }

    fn public_metadata() -> Value {
        serde_json::json!({
            "_type": "video",
            "id": "jNQXAC9IVRw",
            "title": "Me at the zoo",
            "extractor_key": "Youtube",
            "availability": "public",
            "live_status": "not_live",
            "is_live": false,
            "duration": 19.0,
            "filesize_approx": 533_067,
            "webpage_url": "https://www.youtube.com/watch?v=jNQXAC9IVRw",
            "requested_downloads": [{
                "filesize_approx": 533_067,
                "requested_formats": [{
                    "url": "https://1.1.1.1/video.mp4"
                }]
            }]
        })
    }

    #[test]
    fn accepts_only_single_video_page_shapes() {
        assert!(validate_youtube_page_url("https://www.youtube.com/watch?v=jNQXAC9IVRw").is_ok());
        assert!(validate_youtube_page_url("https://youtu.be/jNQXAC9IVRw").is_ok());
        assert!(validate_youtube_page_url("https://www.youtube.com/shorts/jNQXAC9IVRw").is_ok());
        assert!(matches!(
            validate_youtube_page_url("https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PL123"),
            Err(YouTubeMediaError::PlaylistNotAllowed)
        ));
        assert!(matches!(
            validate_youtube_page_url("https://www.youtube.com/@creator"),
            Err(YouTubeMediaError::UnsupportedUrl)
        ));
        assert!(matches!(
            validate_youtube_page_url("https://example.com/watch?v=jNQXAC9IVRw"),
            Err(YouTubeMediaError::UnsupportedUrl)
        ));
    }

    #[test]
    fn arguments_disable_user_configuration_cookies_plugins_and_playlists() {
        let url = Url::parse("https://www.youtube.com/watch?v=jNQXAC9IVRw").unwrap();
        let inspect = inspection_arguments(&url);
        let download = download_arguments(
            &url,
            Path::new("W:/SiaoVPlay/app-data/remote-media/test"),
            Path::new("W:/SiaoVPlay/runtimes/ffmpeg/bin/ffmpeg.exe"),
        );
        for arguments in [&inspect, &download] {
            assert!(arguments.contains(&"--ignore-config".to_owned()));
            assert!(arguments.contains(&"--no-plugin-dirs".to_owned()));
            assert!(arguments.contains(&"--no-playlist".to_owned()));
            assert!(arguments.contains(&"--no-cache-dir".to_owned()));
            assert!(
                arguments
                    .windows(2)
                    .any(|pair| pair[0] == "--proxy" && pair[1].is_empty())
            );
            let joined = arguments.join(" ");
            for forbidden in [
                "--cookies",
                "--cookies-from-browser",
                "--username",
                "--password",
                "--video-password",
                "--update",
            ] {
                assert!(
                    !joined.contains(forbidden),
                    "{forbidden} must stay disabled"
                );
            }
        }
    }

    #[test]
    fn parses_a_public_video_and_binds_preview_to_tool_identity() {
        let original = Url::parse("https://www.youtube.com/watch?v=jNQXAC9IVRw").unwrap();
        let preview = parse_metadata(&original, &public_metadata(), &tool()).unwrap();

        assert_eq!(preview.video_id, "jNQXAC9IVRw");
        assert_eq!(preview.file_size_bytes, Some(533_067));
        assert_eq!(preview.preview_token.len(), 64);
        assert_eq!(preview.importer_version, PINNED_YT_DLP_VERSION);
    }

    #[test]
    fn rejects_playlist_live_restricted_and_uncertain_metadata() {
        let original = Url::parse("https://www.youtube.com/watch?v=jNQXAC9IVRw").unwrap();

        let mut playlist = public_metadata();
        playlist["_type"] = Value::String("playlist".to_owned());
        assert!(matches!(
            parse_metadata(&original, &playlist, &tool()),
            Err(YouTubeMediaError::PlaylistNotAllowed)
        ));

        let mut live = public_metadata();
        live["live_status"] = Value::String("is_live".to_owned());
        assert!(matches!(
            parse_metadata(&original, &live, &tool()),
            Err(YouTubeMediaError::LiveNotAllowed)
        ));

        let mut archived_live = public_metadata();
        archived_live["live_status"] = Value::String("was_live".to_owned());
        assert!(
            parse_metadata(&original, &archived_live, &tool()).is_ok(),
            "an archived public live replay should import like other on-demand media"
        );

        let mut restricted = public_metadata();
        restricted["availability"] = Value::String("needs_auth".to_owned());
        assert!(matches!(
            parse_metadata(&original, &restricted, &tool()),
            Err(YouTubeMediaError::Restricted)
        ));

        let mut uncertain = public_metadata();
        uncertain.as_object_mut().unwrap().remove("availability");
        assert!(matches!(
            parse_metadata(&original, &uncertain, &tool()),
            Err(YouTubeMediaError::UncertainMedia)
        ));
    }

    #[test]
    fn discovers_the_w_drive_runtime_layout() {
        let candidates = yt_dlp_candidates(
            Some(Path::new("W:/SiaoVPlay/runtimes")),
            Some(Path::new(
                "W:/SiaoVPlay/build/cargo-target/debug/siao-vplay.exe",
            )),
        );
        assert_eq!(
            candidates.first().unwrap(),
            Path::new("W:/SiaoVPlay/runtimes/yt-dlp/yt-dlp.exe")
        );
    }

    #[test]
    fn active_youtube_import_can_be_cancelled_by_operation_id() {
        let operation_id = Uuid::new_v4().to_string();
        let operation = ImportOperation::register(&operation_id).unwrap();

        assert!(
            cancel_youtube_import(CancelYouTubeImportInput {
                operation_id: operation_id.clone(),
            })
            .unwrap()
        );
        assert!(matches!(
            operation.check(),
            Err(YouTubeMediaError::Cancelled)
        ));
        drop(operation);
        assert!(!cancel_youtube_import(CancelYouTubeImportInput { operation_id }).unwrap());
    }

    #[test]
    #[ignore = "requires SIAOVPLAY_RUNTIME_DIR and network access"]
    fn inspects_a_real_public_youtube_video_without_cookies() {
        let preview = inspect_youtube_url(InspectYouTubeUrlInput {
            url: "https://www.youtube.com/watch?v=jNQXAC9IVRw".to_owned(),
        })
        .expect("public video should inspect");
        assert_eq!(preview.video_id, "jNQXAC9IVRw");
        assert!(preview.duration_seconds > 0.0);
    }

    #[test]
    #[ignore = "requires an authorized URL manifest, SIAOVPLAY_RUNTIME_DIR, and network access"]
    fn inspects_authorized_public_youtube_manifest() {
        let manifest_path = env::var_os("SIAOVPLAY_YOUTUBE_ACCEPTANCE_MANIFEST")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_YOUTUBE_ACCEPTANCE_MANIFEST must be set");
        let fixtures: Vec<RealUrlFixture> =
            serde_json::from_slice(&fs::read(manifest_path).expect("URL manifest should load"))
                .expect("URL manifest should parse");

        for fixture in fixtures {
            let preview = inspect_youtube_url(InspectYouTubeUrlInput { url: fixture.url })
                .expect("authorized public video should inspect");
            assert_eq!(preview.video_id, fixture.expected_video_id);
            assert!(preview.duration_seconds > 0.0);
            assert!(
                preview
                    .file_size_bytes
                    .is_none_or(|size| size <= MAX_MEDIA_BYTES)
            );
        }
    }

    #[test]
    #[ignore = "requires an authorized URL, a W: acceptance store, pinned runtimes, and network access"]
    fn imports_authorized_public_youtube_url_to_persistent_store() {
        let url = env::var("SIAOVPLAY_YOUTUBE_ACCEPTANCE_URL")
            .expect("SIAOVPLAY_YOUTUBE_ACCEPTANCE_URL must be set");
        let store_path = env::var_os("SIAOVPLAY_YOUTUBE_ACCEPTANCE_STORE")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_YOUTUBE_ACCEPTANCE_STORE must be set");
        let evidence_path = env::var_os("SIAOVPLAY_YOUTUBE_ACCEPTANCE_EVIDENCE")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_YOUTUBE_ACCEPTANCE_EVIDENCE must be set");
        let store = ProjectStore::open(store_path).expect("acceptance store should open");

        let project = store
            .list_projects()
            .expect("projects should be readable")
            .into_iter()
            .find(|project| project.media_source.origin_url.as_deref() == Some(url.as_str()))
            .unwrap_or_else(|| {
                let preview = inspect_youtube_url(InspectYouTubeUrlInput { url: url.clone() })
                    .expect("authorized public video should inspect");
                import_youtube_url(
                    &store,
                    ImportYouTubeUrlInput {
                        url: url.clone(),
                        expected_preview_token: preview.preview_token,
                        operation_id: Uuid::new_v4().to_string(),
                    },
                )
                .expect("authorized public video should import")
            });
        let inspection = media::inspect_project_media(&store, &project.id)
            .expect("imported video should pass media inspection");
        let media_path = PathBuf::from(&project.media_source.locator);
        let evidence = serde_json::json!({
            "url": url,
            "projectId": project.id,
            "title": project.title,
            "mediaPath": project.media_source.locator,
            "mediaSizeBytes": fs::metadata(&media_path)
                .expect("imported media should exist")
                .len(),
            "durationMs": inspection.probe.duration_ms,
            "videoStreamCount": inspection.probe.video_streams.len(),
            "audioStreamCount": inspection.probe.audio_streams.len(),
            "sourceSha256": inspection.source_sha256,
            "importerVersion": PINNED_YT_DLP_VERSION,
            "importerSha256": PINNED_YT_DLP_SHA256
        });
        fs::create_dir_all(
            evidence_path
                .parent()
                .expect("acceptance evidence path should have a parent"),
        )
        .expect("acceptance evidence directory should exist");
        fs::write(
            &evidence_path,
            serde_json::to_vec_pretty(&evidence).expect("evidence should serialize"),
        )
        .expect("acceptance evidence should be written");
        println!(
            "{}",
            serde_json::to_string_pretty(&evidence).expect("evidence should serialize")
        );
    }

    #[test]
    #[ignore = "requires SIAOVPLAY_RUNTIME_DIR, FFmpeg and network access"]
    fn imports_probes_persists_and_cleans_a_real_public_youtube_video() {
        let temporary = tempfile::tempdir().expect("temp directory should be created");
        let store = ProjectStore::open(temporary.path().join("projects").join("siaovplay.sqlite3"))
            .expect("store should open");
        let url = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
        let preview = inspect_youtube_url(InspectYouTubeUrlInput {
            url: url.to_owned(),
        })
        .expect("public video should inspect");

        let project = import_youtube_url(
            &store,
            ImportYouTubeUrlInput {
                url: url.to_owned(),
                expected_preview_token: preview.preview_token,
                operation_id: Uuid::new_v4().to_string(),
            },
        )
        .expect("public video should import");

        assert_eq!(project.media_source.origin_url.as_deref(), Some(url));
        assert!(Path::new(&project.media_source.locator).is_file());
        let connection = store.connect().expect("database should open");
        let provenance = connection
            .query_row(
                "SELECT importer_version, importer_sha256
                 FROM media_source_imports WHERE media_source_id=?1",
                [&project.media_source.id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .expect("provenance should exist");
        assert_eq!(provenance.0, PINNED_YT_DLP_VERSION);
        assert_eq!(provenance.1, PINNED_YT_DLP_SHA256);
        drop(connection);

        let media_path = PathBuf::from(&project.media_source.locator);
        let deleted = store
            .delete_project(&project.id)
            .expect("project should delete");
        assert!(deleted.cached_media_deleted);
        assert!(!media_path.exists());
    }
}
