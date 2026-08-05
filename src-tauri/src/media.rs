use std::{
    env,
    fs::{self, File},
    io::{BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Output},
    time::SystemTime,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::{
    component_manager::{self, ComponentLeaseGuard},
    domain::{MediaArtifact, MediaArtifactStatus, PrepareProjectMediaInput},
    store::{ProjectStore, StoreError},
};

const PLAYBACK_PROXY_PROFILE: &str = "h264-yuv420p-aac-v1";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Error)]
pub enum MediaError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("文件系统错误：{0}")]
    FileSystem(#[from] std::io::Error),
    #[error("媒体运行时不可用：{0}")]
    RuntimeUnavailable(String),
    #[error("媒体探测失败：{0}")]
    ProbeFailed(String),
    #[error("媒体在探测期间发生变化，请重新尝试")]
    SourceChanged,
    #[error("媒体不包含可用的视频轨")]
    MissingVideo,
    #[error("播放代理生成失败：{0}")]
    ProxyFailed(String),
    #[error("视频封面生成失败：{0}")]
    PosterFailed(String),
    #[error("找不到媒体内嵌字幕轨：{0}")]
    SubtitleStreamNotFound(i64),
    #[error("暂不支持提取 {0} 内嵌字幕；当前只支持文本字幕")]
    UnsupportedSubtitleCodec(String),
    #[error("内嵌字幕提取失败：{0}")]
    SubtitleExtractionFailed(String),
    #[error("媒体探测结果无法序列化：{0}")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackDecision {
    Direct,
    RuntimeValidationRequired,
    ProxyRequired,
    Unsupported,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackGate {
    pub decision: PlaybackDecision,
    pub reason_codes: Vec<String>,
    pub requires_runtime_video_check: bool,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoStream {
    pub index: i64,
    pub codec_name: String,
    pub profile: Option<String>,
    pub pixel_format: Option<String>,
    pub width: u32,
    pub height: u32,
    pub frame_rate: Option<f64>,
    pub duration_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStream {
    pub index: i64,
    pub codec_name: String,
    pub channels: Option<u32>,
    pub sample_rate_hz: Option<u32>,
    pub duration_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleStream {
    pub index: i64,
    pub codec_name: String,
    pub language: Option<String>,
    #[serde(default)]
    pub kind: EmbeddedSubtitleKind,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EmbeddedSubtitleKind {
    Text,
    Image,
    #[default]
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbe {
    pub container_formats: Vec<String>,
    pub duration_ms: Option<i64>,
    pub size_bytes: Option<u64>,
    pub bit_rate: Option<u64>,
    pub video_streams: Vec<VideoStream>,
    pub audio_streams: Vec<AudioStream>,
    pub subtitle_streams: Vec<SubtitleStream>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInspection {
    pub project_id: String,
    pub media_source_id: String,
    pub source_sha256: String,
    pub probe: MediaProbe,
    pub playback_gate: PlaybackGate,
    pub ffmpeg_version: String,
    pub reused_probe: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackSourceKind {
    Original,
    Proxy,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPreparation {
    pub inspection: MediaInspection,
    pub playback_source_kind: PlaybackSourceKind,
    pub playback_path: String,
    pub proxy_artifact: Option<MediaArtifact>,
    pub reused_proxy: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaRuntimeStatus {
    pub available: bool,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub version: Option<String>,
    pub error_message: Option<String>,
}

pub(crate) struct MediaRuntime {
    _lease: Option<ComponentLeaseGuard>,
    ffmpeg_path: PathBuf,
    ffprobe_path: PathBuf,
    version: String,
}

impl MediaRuntime {
    fn resolve() -> Result<Self, MediaError> {
        if let Ok(manager) = component_manager::global() {
            let lease = manager
                .resolve_component(
                    "ffmpeg",
                    &[
                        ("platform", "windows"),
                        ("architecture", "x86_64"),
                        ("flavor", "lgpl-shared"),
                    ],
                )
                .map_err(|error| MediaError::RuntimeUnavailable(error.to_string()))?;
            let ffmpeg_path = lease
                .entrypoint("ffmpeg")
                .map_err(|error| MediaError::RuntimeUnavailable(error.to_string()))?;
            let ffprobe_path = lease
                .entrypoint("ffprobe")
                .map_err(|error| MediaError::RuntimeUnavailable(error.to_string()))?;
            let version = tool_version(&ffmpeg_path)?;
            return Ok(Self {
                _lease: Some(lease),
                ffmpeg_path,
                ffprobe_path,
                version,
            });
        }
        let ffmpeg_path = resolve_runtime_tool("SIAOVPLAY_FFMPEG", "ffmpeg.exe")?;
        let ffprobe_path = resolve_runtime_tool("SIAOVPLAY_FFPROBE", "ffprobe.exe")?;
        let version = tool_version(&ffmpeg_path)?;
        Ok(Self {
            _lease: None,
            ffmpeg_path,
            ffprobe_path,
            version,
        })
    }

    fn status() -> MediaRuntimeStatus {
        match Self::resolve() {
            Ok(runtime) => MediaRuntimeStatus {
                available: true,
                ffmpeg_path: Some(path_to_string(&runtime.ffmpeg_path)),
                ffprobe_path: Some(path_to_string(&runtime.ffprobe_path)),
                version: Some(runtime.version),
                error_message: None,
            },
            Err(error) => MediaRuntimeStatus {
                available: false,
                ffmpeg_path: None,
                ffprobe_path: None,
                version: None,
                error_message: Some(error.to_string()),
            },
        }
    }

    fn probe(&self, media_path: &Path) -> Result<MediaProbe, MediaError> {
        let output = hidden_command(&self.ffprobe_path)
            .args([
                "-v",
                "error",
                "-show_format",
                "-show_streams",
                "-of",
                "json",
            ])
            .arg(media_path)
            .output()
            .map_err(|error| {
                MediaError::ProbeFailed(format!(
                    "无法启动 {}：{error}",
                    self.ffprobe_path.display()
                ))
            })?;
        if !output.status.success() {
            return Err(MediaError::ProbeFailed(command_error_message(&output)));
        }
        parse_probe_output(&output.stdout)
    }

    pub(crate) fn ffmpeg(&self) -> &Path {
        &self.ffmpeg_path
    }

    pub(crate) fn version(&self) -> &str {
        &self.version
    }
}

pub fn media_runtime_status() -> MediaRuntimeStatus {
    MediaRuntime::status()
}

pub(crate) fn validate_media_path(media_path: &Path) -> Result<MediaProbe, MediaError> {
    let runtime = MediaRuntime::resolve()?;
    let probe = runtime.probe(media_path)?;
    if probe.video_streams.is_empty() {
        return Err(MediaError::MissingVideo);
    }
    Ok(probe)
}

#[allow(dead_code)]
pub(crate) fn ffmpeg_path() -> Result<PathBuf, MediaError> {
    Ok(MediaRuntime::resolve()?.ffmpeg_path)
}

pub(crate) fn resolve_runtime() -> Result<MediaRuntime, MediaError> {
    MediaRuntime::resolve()
}

pub(crate) fn remux_local_hls(playlist_path: &Path, destination: &Path) -> Result<(), MediaError> {
    let runtime = MediaRuntime::resolve()?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let output = hidden_command(&runtime.ffmpeg_path)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-protocol_whitelist",
            "file,crypto,data",
            "-allowed_extensions",
            "ALL",
            "-i",
        ])
        .arg(playlist_path)
        .args([
            "-map", "0:v:0", "-map", "0:a?", "-map", "0:s?", "-dn", "-c", "copy",
        ])
        .arg(destination)
        .output()
        .map_err(|error| MediaError::ProxyFailed(format!("无法启动本地 HLS 封装：{error}")))?;
    if !output.status.success() {
        let _ = fs::remove_file(destination);
        return Err(MediaError::ProxyFailed(format!(
            "本地 HLS 封装失败：{}",
            command_error_message(&output)
        )));
    }
    Ok(())
}

pub fn inspect_project_media(
    store: &ProjectStore,
    project_id: &str,
) -> Result<MediaInspection, MediaError> {
    let runtime = MediaRuntime::resolve()?;
    inspect_with_runtime(store, project_id, &runtime)
}

pub fn prepare_project_media(
    store: &ProjectStore,
    input: PrepareProjectMediaInput,
) -> Result<MediaPreparation, MediaError> {
    let runtime = MediaRuntime::resolve()?;
    let inspection = inspect_with_runtime(store, &input.project_id, &runtime)?;
    let project = store.get_project(&input.project_id)?;
    let source_path = PathBuf::from(&project.media_source.locator);

    if inspection.playback_gate.decision == PlaybackDecision::Unsupported {
        return Err(MediaError::MissingVideo);
    }
    let needs_proxy =
        input.force_proxy || inspection.playback_gate.decision == PlaybackDecision::ProxyRequired;
    if !needs_proxy {
        return Ok(MediaPreparation {
            inspection,
            playback_source_kind: PlaybackSourceKind::Original,
            playback_path: path_to_string(&source_path),
            proxy_artifact: None,
            reused_proxy: false,
        });
    }

    let (artifact, reused_proxy) =
        generate_playback_proxy(store, &runtime, &project, &inspection, &source_path)?;
    Ok(MediaPreparation {
        inspection,
        playback_source_kind: PlaybackSourceKind::Proxy,
        playback_path: artifact.path.clone(),
        proxy_artifact: Some(artifact),
        reused_proxy,
    })
}

pub fn ensure_project_poster(
    store: &ProjectStore,
    project_id: &str,
) -> Result<crate::domain::Project, MediaError> {
    let runtime = MediaRuntime::resolve()?;
    let inspection = inspect_with_runtime(store, project_id, &runtime)?;
    let project = store.get_project(project_id)?;
    let source_path = PathBuf::from(&project.media_source.locator);
    let project_cache = store.data_directory().join("media-cache").join(&project.id);
    fs::create_dir_all(&project_cache)?;
    let fingerprint_prefix = &inspection.source_sha256[..16];
    let final_path = project_cache.join(format!("poster-{fingerprint_prefix}.jpg"));

    if project.media_source.poster_path.as_deref() == Some(path_to_string(&final_path).as_str())
        && valid_poster(&final_path)
    {
        return Ok(project);
    }

    let temporary_path = project_cache.join(format!("poster-{fingerprint_prefix}.part.jpg"));
    remove_controlled_file_if_present(&temporary_path, &project_cache)?;
    remove_controlled_file_if_present(&final_path, &project_cache)?;

    let seek_seconds = inspection
        .probe
        .duration_ms
        .map(|duration_ms| ((duration_ms as f64 / 1_000.0) * 0.08).clamp(0.0, 30.0))
        .unwrap_or(0.0);
    let output = hidden_command(&runtime.ffmpeg_path)
        .args(["-y", "-hide_banner", "-nostdin", "-v", "error", "-ss"])
        .arg(format!("{seek_seconds:.3}"))
        .arg("-i")
        .arg(&source_path)
        .args([
            "-map",
            "0:v:0",
            "-vf",
            "thumbnail=120,scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=0x0b0d12",
            "-frames:v",
            "1",
            "-an",
            "-sn",
            "-q:v",
            "3",
        ])
        .arg(&temporary_path)
        .output()
        .map_err(|error| MediaError::PosterFailed(error.to_string()))?;
    if !output.status.success() || !valid_poster(&temporary_path) {
        let _ = remove_controlled_file_if_present(&temporary_path, &project_cache);
        return Err(MediaError::PosterFailed(command_error_message(&output)));
    }
    fs::rename(&temporary_path, &final_path)?;
    store
        .record_media_poster(
            &project.id,
            &project.media_source.id,
            &inspection.source_sha256,
            &final_path,
        )
        .map_err(Into::into)
}

pub(crate) fn extract_embedded_subtitle_to_vtt(
    store: &ProjectStore,
    project_id: &str,
    stream_index: i64,
    expected_media_sha256: Option<&str>,
    output_path: &Path,
) -> Result<(MediaInspection, SubtitleStream), MediaError> {
    let runtime = MediaRuntime::resolve()?;
    let inspection = inspect_with_runtime(store, project_id, &runtime)?;
    if expected_media_sha256
        .is_some_and(|expected| !expected.eq_ignore_ascii_case(&inspection.source_sha256))
    {
        return Err(MediaError::SourceChanged);
    }
    let stream = inspection
        .probe
        .subtitle_streams
        .iter()
        .find(|stream| stream.index == stream_index)
        .cloned()
        .ok_or(MediaError::SubtitleStreamNotFound(stream_index))?;
    if stream.kind != EmbeddedSubtitleKind::Text {
        return Err(MediaError::UnsupportedSubtitleCodec(
            stream.codec_name.clone(),
        ));
    }
    let project = store.get_project(project_id)?;
    let source_path = PathBuf::from(&project.media_source.locator);
    let before = FileIdentity::read(&source_path)?;
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if output_path.is_file() {
        fs::remove_file(output_path)?;
    }
    let output = hidden_command(&runtime.ffmpeg_path)
        .args(["-y", "-hide_banner", "-nostdin", "-v", "error", "-i"])
        .arg(&source_path)
        .args([
            "-map",
            &format!("0:{stream_index}"),
            "-c:s",
            "webvtt",
            "-f",
            "webvtt",
        ])
        .arg(output_path)
        .output()
        .map_err(|error| MediaError::SubtitleExtractionFailed(error.to_string()))?;
    if !output.status.success() {
        let _ = fs::remove_file(output_path);
        return Err(MediaError::SubtitleExtractionFailed(command_error_message(
            &output,
        )));
    }
    let after = FileIdentity::read(&source_path)?;
    if before != after {
        let _ = fs::remove_file(output_path);
        return Err(MediaError::SourceChanged);
    }
    if !fs::metadata(output_path)
        .map(|metadata| metadata.is_file() && metadata.len() > 6)
        .unwrap_or(false)
    {
        let _ = fs::remove_file(output_path);
        return Err(MediaError::SubtitleExtractionFailed(
            "FFmpeg 没有生成可读取的 WebVTT 字幕".to_owned(),
        ));
    }
    Ok((inspection, stream))
}

fn inspect_with_runtime(
    store: &ProjectStore,
    project_id: &str,
    runtime: &MediaRuntime,
) -> Result<MediaInspection, MediaError> {
    let project = store.get_project(project_id)?;
    if !project.media_source.is_available {
        return Err(MediaError::ProbeFailed(
            "源媒体不可用，需要先重新定位文件".to_owned(),
        ));
    }
    let source_path = PathBuf::from(&project.media_source.locator);
    let before = FileIdentity::read(&source_path)?;
    if let Some(cached) = store.cached_media_probe(project_id, &project.media_source.id)?
        && before.matches_cache(cached.source_size_bytes, cached.source_modified_at_ms)
        && let Ok(mut probe) = serde_json::from_str::<MediaProbe>(&cached.probe_json)
    {
        normalize_subtitle_stream_kinds(&mut probe);
        return Ok(MediaInspection {
            project_id: project_id.to_owned(),
            media_source_id: project.media_source.id,
            source_sha256: cached.source_sha256,
            playback_gate: playback_gate(&probe),
            probe,
            ffmpeg_version: runtime.version.clone(),
            reused_probe: true,
        });
    }
    let source_sha256 = hash_file(&source_path)?;
    let probe = runtime.probe(&source_path)?;
    let after = FileIdentity::read(&source_path)?;
    if before != after {
        return Err(MediaError::SourceChanged);
    }

    let playback_gate = playback_gate(&probe);
    let probe_json = serde_json::to_string(&probe)?;
    store.record_media_probe(
        project_id,
        &project.media_source.id,
        &source_sha256,
        &probe_json,
        before.size,
        before.modified_at_ms(),
    )?;

    Ok(MediaInspection {
        project_id: project_id.to_owned(),
        media_source_id: project.media_source.id,
        source_sha256,
        probe,
        playback_gate,
        ffmpeg_version: runtime.version.clone(),
        reused_probe: false,
    })
}

fn valid_poster(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.is_file() && metadata.len() > 100)
        .unwrap_or(false)
}

fn generate_playback_proxy(
    store: &ProjectStore,
    runtime: &MediaRuntime,
    project: &crate::domain::Project,
    inspection: &MediaInspection,
    source_path: &Path,
) -> Result<(MediaArtifact, bool), MediaError> {
    let project_cache = store.data_directory().join("media-cache").join(&project.id);
    fs::create_dir_all(&project_cache)?;
    let fingerprint_prefix = &inspection.source_sha256[..16];
    let final_path = project_cache.join(format!("playback-{fingerprint_prefix}.mp4"));
    let temporary_path = project_cache.join(format!("playback-{fingerprint_prefix}.part.mp4"));

    if let Some(artifact) = store.find_completed_playback_proxy(
        &project.id,
        &inspection.source_sha256,
        PLAYBACK_PROXY_PROFILE,
    )? && Path::new(&artifact.path) == final_path
        && playback_proxy_is_valid(runtime, &final_path)
    {
        return Ok((artifact, true));
    }

    let artifact = store.begin_playback_proxy(
        &project.id,
        &project.media_source.id,
        &inspection.source_sha256,
        PLAYBACK_PROXY_PROFILE,
        &final_path,
    )?;
    store.update_media_artifact_status(&artifact.id, MediaArtifactStatus::Running, None, None)?;

    remove_controlled_file_if_present(&temporary_path, &project_cache)?;
    remove_controlled_file_if_present(&final_path, &project_cache)?;
    let output = hidden_command(&runtime.ffmpeg_path)
        .args(["-y", "-hide_banner", "-nostdin", "-v", "error", "-i"])
        .arg(source_path)
        .args([
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-force_key_frames",
            "expr:gte(t,n_forced*2)",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
        ])
        .arg(&temporary_path)
        .output()
        .map_err(|error| {
            fail_proxy(
                store,
                &artifact.id,
                &temporary_path,
                &project_cache,
                "ffmpeg_start_failed",
                &format!("无法启动 FFmpeg：{error}"),
            )
        })?;

    if !output.status.success() {
        let message = command_error_message(&output);
        return Err(fail_proxy(
            store,
            &artifact.id,
            &temporary_path,
            &project_cache,
            "ffmpeg_failed",
            &message,
        ));
    }
    if !playback_proxy_is_valid(runtime, &temporary_path) {
        return Err(fail_proxy(
            store,
            &artifact.id,
            &temporary_path,
            &project_cache,
            "proxy_validation_failed",
            "FFmpeg 已结束，但代理文件不满足 H.264 yuv420p 与 AAC MP4 门禁",
        ));
    }

    fs::rename(&temporary_path, &final_path).map_err(|error| {
        fail_proxy(
            store,
            &artifact.id,
            &temporary_path,
            &project_cache,
            "proxy_finalize_failed",
            &format!("无法完成代理文件：{error}"),
        )
    })?;
    let completed = store.update_media_artifact_status(
        &artifact.id,
        MediaArtifactStatus::Completed,
        None,
        None,
    )?;
    Ok((completed, false))
}

fn fail_proxy(
    store: &ProjectStore,
    artifact_id: &str,
    temporary_path: &Path,
    controlled_root: &Path,
    error_code: &str,
    message: &str,
) -> MediaError {
    let _ = remove_controlled_file_if_present(temporary_path, controlled_root);
    let truncated = truncate_message(message, 2_000);
    let _ = store.update_media_artifact_status(
        artifact_id,
        MediaArtifactStatus::Failed,
        Some(error_code),
        Some(&truncated),
    );
    MediaError::ProxyFailed(truncated)
}

fn remove_controlled_file_if_present(
    path: &Path,
    controlled_root: &Path,
) -> Result<(), MediaError> {
    if path.parent() != Some(controlled_root) {
        return Err(MediaError::ProxyFailed(
            "拒绝清理不在项目媒体缓存中的文件".to_owned(),
        ));
    }
    if path.is_file() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn playback_proxy_is_valid(runtime: &MediaRuntime, path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let Ok(probe) = runtime.probe(path) else {
        return false;
    };
    let Some(video) = probe.video_streams.first() else {
        return false;
    };
    let video_valid = video.codec_name == "h264"
        && video.pixel_format.as_deref() == Some("yuv420p")
        && video.width > 0
        && video.height > 0;
    let audio_valid = probe
        .audio_streams
        .first()
        .is_none_or(|audio| audio.codec_name == "aac");
    let container_valid = probe
        .container_formats
        .iter()
        .any(|format| matches!(format.as_str(), "mov" | "mp4"));
    video_valid && audio_valid && container_valid
}

fn playback_gate(probe: &MediaProbe) -> PlaybackGate {
    let Some(video) = probe.video_streams.first() else {
        return PlaybackGate {
            decision: PlaybackDecision::Unsupported,
            reason_codes: vec!["missing_video_stream".to_owned()],
            requires_runtime_video_check: false,
        };
    };
    if video.width == 0 || video.height == 0 {
        return proxy_gate("invalid_video_dimensions");
    }

    let audio_codec = probe
        .audio_streams
        .first()
        .map(|audio| audio.codec_name.as_str());
    let has_format = |expected: &[&str]| {
        probe
            .container_formats
            .iter()
            .any(|format| expected.contains(&format.as_str()))
    };
    match video.codec_name.as_str() {
        "h264"
            if has_format(&["mov", "mp4", "matroska", "webm"])
                && matches!(video.pixel_format.as_deref(), Some("yuv420p" | "yuvj420p"))
                && audio_codec.is_none_or(|codec| codec == "aac") =>
        {
            PlaybackGate {
                decision: PlaybackDecision::Direct,
                reason_codes: vec!["h264_aac_candidate".to_owned()],
                requires_runtime_video_check: true,
            }
        }
        "vp9"
            if has_format(&["matroska", "webm"])
                && audio_codec.is_none_or(|codec| codec == "opus") =>
        {
            PlaybackGate {
                decision: PlaybackDecision::Direct,
                reason_codes: vec!["vp9_opus_candidate".to_owned()],
                requires_runtime_video_check: true,
            }
        }
        "av1"
            if has_format(&["matroska", "webm"])
                && audio_codec.is_none_or(|codec| codec == "opus")
                && video.width <= 1920
                && video.height <= 1080
                && video.frame_rate.is_none_or(|frame_rate| frame_rate <= 30.0) =>
        {
            PlaybackGate {
                decision: PlaybackDecision::RuntimeValidationRequired,
                reason_codes: vec!["av1_requires_runtime_performance_check".to_owned()],
                requires_runtime_video_check: true,
            }
        }
        "hevc" | "h265" => proxy_gate("hevc_not_supported_by_baseline"),
        "prores" => proxy_gate("prores_not_supported_by_baseline"),
        "mpeg4" => proxy_gate("mpeg4_part2_not_supported_by_baseline"),
        "av1" => proxy_gate("av1_exceeds_runtime_gate"),
        "h264" => proxy_gate("h264_container_pixel_or_audio_not_supported"),
        "vp9" => proxy_gate("vp9_container_or_audio_not_supported"),
        _ => proxy_gate("unknown_video_codec"),
    }
}

fn proxy_gate(reason_code: &str) -> PlaybackGate {
    PlaybackGate {
        decision: PlaybackDecision::ProxyRequired,
        reason_codes: vec![reason_code.to_owned()],
        requires_runtime_video_check: false,
    }
}

#[derive(Debug, Deserialize)]
struct RawProbe {
    #[serde(default)]
    streams: Vec<RawStream>,
    format: Option<RawFormat>,
}

#[derive(Debug, Deserialize)]
struct RawStream {
    index: Option<i64>,
    codec_type: Option<String>,
    codec_name: Option<String>,
    profile: Option<String>,
    pix_fmt: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    r_frame_rate: Option<String>,
    duration: Option<String>,
    channels: Option<u32>,
    sample_rate: Option<String>,
    tags: Option<RawTags>,
}

#[derive(Debug, Deserialize)]
struct RawTags {
    language: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawFormat {
    format_name: Option<String>,
    duration: Option<String>,
    size: Option<String>,
    bit_rate: Option<String>,
}

fn parse_probe_output(value: &[u8]) -> Result<MediaProbe, MediaError> {
    let raw: RawProbe = serde_json::from_slice(value)
        .map_err(|error| MediaError::ProbeFailed(format!("FFprobe JSON 无效：{error}")))?;
    let mut video_streams = Vec::new();
    let mut audio_streams = Vec::new();
    let mut subtitle_streams = Vec::new();
    for stream in raw.streams {
        let index = stream.index.unwrap_or(-1);
        let codec_name = stream
            .codec_name
            .unwrap_or_else(|| "unknown".to_owned())
            .to_ascii_lowercase();
        match stream.codec_type.as_deref() {
            Some("video") => video_streams.push(VideoStream {
                index,
                codec_name,
                profile: stream.profile,
                pixel_format: stream.pix_fmt.map(|value| value.to_ascii_lowercase()),
                width: stream.width.unwrap_or(0),
                height: stream.height.unwrap_or(0),
                frame_rate: stream
                    .avg_frame_rate
                    .as_deref()
                    .and_then(parse_ratio)
                    .or_else(|| stream.r_frame_rate.as_deref().and_then(parse_ratio)),
                duration_ms: parse_duration_ms(stream.duration.as_deref()),
            }),
            Some("audio") => audio_streams.push(AudioStream {
                index,
                codec_name,
                channels: stream.channels,
                sample_rate_hz: stream
                    .sample_rate
                    .as_deref()
                    .and_then(|value| value.parse().ok()),
                duration_ms: parse_duration_ms(stream.duration.as_deref()),
            }),
            Some("subtitle") => subtitle_streams.push(SubtitleStream {
                index,
                kind: embedded_subtitle_kind(&codec_name),
                codec_name,
                language: stream.tags.and_then(|tags| tags.language),
            }),
            _ => {}
        }
    }
    let format = raw.format;
    let container_formats = format
        .as_ref()
        .and_then(|format| format.format_name.as_deref())
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .map(|part| part.to_ascii_lowercase())
                .collect()
        })
        .unwrap_or_default();
    let duration_ms = format
        .as_ref()
        .and_then(|format| parse_duration_ms(format.duration.as_deref()))
        .or_else(|| {
            video_streams
                .iter()
                .filter_map(|stream| stream.duration_ms)
                .chain(audio_streams.iter().filter_map(|stream| stream.duration_ms))
                .max()
        });
    Ok(MediaProbe {
        container_formats,
        duration_ms,
        size_bytes: format
            .as_ref()
            .and_then(|format| parse_unsigned(format.size.as_deref())),
        bit_rate: format
            .as_ref()
            .and_then(|format| parse_unsigned(format.bit_rate.as_deref())),
        video_streams,
        audio_streams,
        subtitle_streams,
    })
}

fn embedded_subtitle_kind(codec_name: &str) -> EmbeddedSubtitleKind {
    match codec_name {
        "ass" | "ssa" | "mov_text" | "subrip" | "srt" | "text" | "webvtt" => {
            EmbeddedSubtitleKind::Text
        }
        "dvb_subtitle" | "dvd_subtitle" | "hdmv_pgs_subtitle" | "pgssub" | "xsub" => {
            EmbeddedSubtitleKind::Image
        }
        _ => EmbeddedSubtitleKind::Unknown,
    }
}

fn normalize_subtitle_stream_kinds(probe: &mut MediaProbe) {
    for stream in &mut probe.subtitle_streams {
        stream.kind = embedded_subtitle_kind(&stream.codec_name);
    }
}

fn parse_duration_ms(value: Option<&str>) -> Option<i64> {
    let seconds = value?.parse::<f64>().ok()?;
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    let milliseconds = (seconds * 1_000.0).round();
    if milliseconds > i64::MAX as f64 {
        None
    } else {
        Some(milliseconds as i64)
    }
}

fn parse_unsigned(value: Option<&str>) -> Option<u64> {
    value?.parse().ok()
}

fn parse_ratio(value: &str) -> Option<f64> {
    let (numerator, denominator) = value.split_once('/')?;
    let numerator = numerator.parse::<f64>().ok()?;
    let denominator = denominator.parse::<f64>().ok()?;
    if numerator < 0.0 || denominator <= 0.0 {
        return None;
    }
    let ratio = numerator / denominator;
    ratio.is_finite().then_some(ratio)
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileIdentity {
    size: u64,
    modified: Option<SystemTime>,
}

impl FileIdentity {
    fn read(path: &Path) -> Result<Self, MediaError> {
        let metadata = fs::metadata(path)?;
        Ok(Self {
            size: metadata.len(),
            modified: metadata.modified().ok(),
        })
    }

    fn modified_at_ms(&self) -> Option<i64> {
        let duration = self.modified?.duration_since(SystemTime::UNIX_EPOCH).ok()?;
        i64::try_from(duration.as_millis()).ok()
    }

    fn matches_cache(&self, size: u64, modified_at_ms: Option<i64>) -> bool {
        self.size == size
            && self.modified_at_ms().is_some()
            && self.modified_at_ms() == modified_at_ms
    }
}

fn hash_file(path: &Path) -> Result<String, MediaError> {
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

fn resolve_runtime_tool(
    environment_variable: &str,
    file_name: &str,
) -> Result<PathBuf, MediaError> {
    if let Some(path) = env::var_os(environment_variable)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        if path.is_file() {
            return Ok(path);
        }
        return Err(MediaError::RuntimeUnavailable(format!(
            "{environment_variable} 指向的文件不存在：{}",
            path.display()
        )));
    }
    let runtime_root = env::var_os("SIAOVPLAY_RUNTIME_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(crate::runtime::configured_runtime_root);
    let executable_path = env::current_exe().ok();
    let candidates = runtime_tool_candidates(
        file_name,
        runtime_root.as_deref(),
        executable_path.as_deref(),
    );
    if let Some(path) = candidates.iter().find(|path| path.is_file()) {
        return Ok(path.clone());
    }
    let checked_paths = candidates
        .iter()
        .take(12)
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join("；");
    Err(MediaError::RuntimeUnavailable(format!(
        "找不到 {file_name}。可以设置 {environment_variable}，或将 FFmpeg 放在应用相邻的 runtimes、runtime、resources 或 ffmpeg 目录。已检查：{checked_paths}"
    )))
}

fn runtime_tool_candidates(
    file_name: &str,
    runtime_root: Option<&Path>,
    executable_path: Option<&Path>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(runtime_root) = runtime_root {
        push_unique(
            &mut candidates,
            runtime_root.join("ffmpeg").join("bin").join(file_name),
        );
        push_unique(
            &mut candidates,
            runtime_root
                .join("runtimes")
                .join("ffmpeg")
                .join("bin")
                .join(file_name),
        );
        push_unique(&mut candidates, runtime_root.join("bin").join(file_name));
    }
    if let Some(executable_directory) = executable_path.and_then(Path::parent) {
        for ancestor in executable_directory
            .ancestors()
            .take(5)
            .take_while(|ancestor| ancestor.parent().is_some())
        {
            for relative_directory in [
                Path::new("runtimes").join("ffmpeg").join("bin"),
                Path::new("runtime").join("ffmpeg").join("bin"),
                Path::new("resources").join("ffmpeg").join("bin"),
                Path::new("ffmpeg").join("bin"),
            ] {
                push_unique(
                    &mut candidates,
                    ancestor.join(relative_directory).join(file_name),
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

fn tool_version(path: &Path) -> Result<String, MediaError> {
    let output = hidden_command(path)
        .arg("-version")
        .output()
        .map_err(|error| MediaError::RuntimeUnavailable(error.to_string()))?;
    if !output.status.success() {
        return Err(MediaError::RuntimeUnavailable(command_error_message(
            &output,
        )));
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| MediaError::RuntimeUnavailable("FFmpeg 没有返回版本信息".to_owned()))
}

fn hidden_command(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn command_error_message(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let message = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    if message.is_empty() {
        format!("进程退出码：{}", output.status)
    } else {
        truncate_message(message, 2_000)
    }
}

fn truncate_message(value: &str, max_chars: usize) -> String {
    let mut characters = value.chars();
    let truncated = characters.by_ref().take(max_chars).collect::<String>();
    if characters.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use crate::{
        domain::{CreateLocalProjectInput, MediaArtifactStatus},
        store::ProjectStore,
    };

    use super::*;

    fn probe(codec: &str, audio_codec: &str, format: &str, width: u32, height: u32) -> MediaProbe {
        MediaProbe {
            container_formats: format.split(',').map(ToOwned::to_owned).collect(),
            duration_ms: Some(3_000),
            size_bytes: Some(1_000),
            bit_rate: Some(2_000_000),
            video_streams: vec![VideoStream {
                index: 0,
                codec_name: codec.to_owned(),
                profile: None,
                pixel_format: Some("yuv420p".to_owned()),
                width,
                height,
                frame_rate: Some(30.0),
                duration_ms: Some(3_000),
            }],
            audio_streams: vec![AudioStream {
                index: 1,
                codec_name: audio_codec.to_owned(),
                channels: Some(2),
                sample_rate_hz: Some(48_000),
                duration_ms: Some(3_000),
            }],
            subtitle_streams: Vec::new(),
        }
    }

    #[test]
    fn parses_ffprobe_json_into_typed_tracks() {
        let raw = br#"{
          "streams": [
            {
              "index": 0,
              "codec_name": "h264",
              "profile": "High",
              "codec_type": "video",
              "width": 640,
              "height": 360,
              "pix_fmt": "yuv420p",
              "avg_frame_rate": "30/1",
              "duration": "3.000000"
            },
            {
              "index": 1,
              "codec_name": "aac",
              "codec_type": "audio",
              "sample_rate": "48000",
              "channels": 2,
              "duration": "3.000000"
            },
            {
              "index": 2,
              "codec_name": "subrip",
              "codec_type": "subtitle",
              "tags": { "language": "jpn" }
            }
          ],
          "format": {
            "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
            "duration": "3.000000",
            "size": "285820",
            "bit_rate": "762186"
          }
        }"#;
        let parsed = parse_probe_output(raw).expect("probe should parse");

        assert_eq!(parsed.video_streams[0].codec_name, "h264");
        assert_eq!(parsed.video_streams[0].frame_rate, Some(30.0));
        assert_eq!(parsed.audio_streams[0].sample_rate_hz, Some(48_000));
        assert_eq!(parsed.subtitle_streams[0].language.as_deref(), Some("jpn"));
        assert_eq!(parsed.subtitle_streams[0].kind, EmbeddedSubtitleKind::Text);
        assert_eq!(parsed.duration_ms, Some(3_000));
        assert_eq!(parsed.size_bytes, Some(285_820));
    }

    #[test]
    fn classifies_text_and_image_subtitle_codecs() {
        for codec in ["subrip", "ass", "ssa", "mov_text", "webvtt"] {
            assert_eq!(
                embedded_subtitle_kind(codec),
                EmbeddedSubtitleKind::Text,
                "{codec}"
            );
        }
        for codec in ["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle"] {
            assert_eq!(
                embedded_subtitle_kind(codec),
                EmbeddedSubtitleKind::Image,
                "{codec}"
            );
        }
        assert_eq!(
            embedded_subtitle_kind("mystery"),
            EmbeddedSubtitleKind::Unknown
        );
    }

    #[test]
    fn restores_subtitle_kinds_in_legacy_cached_probe_json() {
        let mut cached_probe = serde_json::from_str::<MediaProbe>(
            r#"{
                "containerFormats":["matroska"],
                "durationMs":3000,
                "sizeBytes":1000,
                "bitRate":null,
                "videoStreams":[],
                "audioStreams":[],
                "subtitleStreams":[
                    {"index":2,"codecName":"subrip","language":"jpn"},
                    {"index":3,"codecName":"hdmv_pgs_subtitle","language":"eng"}
                ]
            }"#,
        )
        .expect("legacy probe should deserialize");
        assert_eq!(
            cached_probe.subtitle_streams[0].kind,
            EmbeddedSubtitleKind::Unknown
        );

        normalize_subtitle_stream_kinds(&mut cached_probe);

        assert_eq!(
            cached_probe.subtitle_streams[0].kind,
            EmbeddedSubtitleKind::Text
        );
        assert_eq!(
            cached_probe.subtitle_streams[1].kind,
            EmbeddedSubtitleKind::Image
        );
    }

    #[test]
    fn allows_h264_aac_and_vp9_opus_as_direct_candidates() {
        let h264 = playback_gate(&probe("h264", "aac", "mov,mp4,m4a,3gp,3g2,mj2", 1920, 1080));
        let vp9 = playback_gate(&probe("vp9", "opus", "matroska,webm", 1920, 1080));

        assert_eq!(h264.decision, PlaybackDecision::Direct);
        assert!(h264.requires_runtime_video_check);
        assert_eq!(vp9.decision, PlaybackDecision::Direct);
    }

    #[test]
    fn requires_proxy_for_known_incompatible_codecs() {
        for codec in ["hevc", "prores", "mpeg4", "unknown"] {
            let gate = playback_gate(&probe(codec, "aac", "mov,mp4", 1920, 1080));
            assert_eq!(gate.decision, PlaybackDecision::ProxyRequired);
            assert!(!gate.requires_runtime_video_check);
        }
    }

    #[test]
    fn av1_requires_runtime_check_only_inside_performance_gate() {
        let regular = playback_gate(&probe("av1", "opus", "matroska,webm", 1920, 1080));
        let oversized = playback_gate(&probe("av1", "opus", "matroska,webm", 3840, 2160));

        assert_eq!(
            regular.decision,
            PlaybackDecision::RuntimeValidationRequired
        );
        assert_eq!(oversized.decision, PlaybackDecision::ProxyRequired);
    }

    #[test]
    fn rejects_audio_only_input_for_video_playback() {
        let mut audio_only = probe("h264", "aac", "mov,mp4", 640, 360);
        audio_only.video_streams.clear();

        assert_eq!(
            playback_gate(&audio_only).decision,
            PlaybackDecision::Unsupported
        );
    }

    #[test]
    fn discovers_runtime_candidates_from_the_executable_ancestors() {
        let executable = Path::new("W:/SiaoVPlay/build/cargo-target/debug/siao-vplay.exe");
        let candidates = runtime_tool_candidates("ffmpeg.exe", None, Some(executable));

        assert!(candidates.contains(&PathBuf::from(
            "W:/SiaoVPlay/runtimes/ffmpeg/bin/ffmpeg.exe"
        )));
    }

    #[test]
    #[ignore = "requires SIAOVPLAY_MEDIA_FIXTURE_DIR and the local FFmpeg runtime"]
    fn real_codec_matrix_and_proxy_pipeline() {
        let fixture_dir = env::var_os("SIAOVPLAY_MEDIA_FIXTURE_DIR")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_MEDIA_FIXTURE_DIR must be set");
        let runtime = MediaRuntime::resolve().expect("FFmpeg runtime should resolve");
        let expected = [
            ("h264-aac.mp4", PlaybackDecision::Direct),
            ("h264-aac.mov", PlaybackDecision::Direct),
            ("h264-aac.mkv", PlaybackDecision::Direct),
            ("vp9-opus.webm", PlaybackDecision::Direct),
            ("av1-opus.webm", PlaybackDecision::RuntimeValidationRequired),
            ("hevc-aac.mp4", PlaybackDecision::ProxyRequired),
            ("prores-pcm.mov", PlaybackDecision::ProxyRequired),
            ("mpeg4-aac.mp4", PlaybackDecision::ProxyRequired),
        ];
        for (name, expected_decision) in expected {
            let media_path = fixture_dir.join(name);
            let actual = playback_gate(
                &runtime
                    .probe(&media_path)
                    .unwrap_or_else(|error| panic!("failed to probe {name}: {error}")),
            );
            assert_eq!(actual.decision, expected_decision, "{name}");
        }

        let source_path = fixture_dir.join("hevc-aac.mp4");
        let source_hash_before = hash_file(&source_path).expect("source should hash");
        let temp_dir = tempfile::tempdir().expect("temp directory should be created");
        let store = ProjectStore::open(temp_dir.path().join("projects").join("siaovplay.db"))
            .expect("store should open");
        let project = store
            .create_local_project(CreateLocalProjectInput {
                media_path: path_to_string(&source_path),
                title: Some("HEVC proxy test".to_owned()),
            })
            .expect("project should be created");
        let first = prepare_project_media(
            &store,
            PrepareProjectMediaInput {
                project_id: project.id.clone(),
                force_proxy: false,
            },
        )
        .expect("proxy should be generated");
        assert_eq!(first.playback_source_kind, PlaybackSourceKind::Proxy);
        assert!(!first.reused_proxy);
        assert_eq!(
            first
                .proxy_artifact
                .as_ref()
                .map(|artifact| &artifact.status),
            Some(&MediaArtifactStatus::Completed)
        );
        assert!(Path::new(&first.playback_path).is_file());
        assert!(playback_proxy_is_valid(
            &runtime,
            Path::new(&first.playback_path)
        ));

        let second = prepare_project_media(
            &store,
            PrepareProjectMediaInput {
                project_id: project.id.clone(),
                force_proxy: false,
            },
        )
        .expect("completed proxy should be reused");
        assert!(second.reused_proxy);
        assert!(second.inspection.reused_probe);

        let project_with_poster =
            ensure_project_poster(&store, &project.id).expect("poster should be generated");
        let poster_path = project_with_poster
            .media_source
            .poster_path
            .expect("poster path should be persisted");
        assert!(valid_poster(Path::new(&poster_path)));
        assert_eq!(
            hash_file(&source_path).expect("source should still hash"),
            source_hash_before
        );
    }
}
