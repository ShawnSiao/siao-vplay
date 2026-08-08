use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock, RwLock},
};

use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;
use zip::ZipArchive;

use crate::{media, transcription, youtube_media};

pub const DEFAULT_MODEL_KIND: &str = "small";
pub const WHISPER_RUNTIME_VERSION: &str = "1.9.1-siaocut.1";
pub const YT_DLP_VERSION: &str = "2026.06.09";
pub const YT_DLP_SHA256: &str = "3a48cb955d55c8821b60ccbdbbc6f61bc958f2f3d3b7ad5eaf3d83a543293a27";

const SETTINGS_FILE_NAME: &str = "runtime-settings.json";
const FFMPEG_VERSION: &str = "8.1.2-essentials";
const FFMPEG_DOWNLOAD_URL: &str =
    "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip";
const FFMPEG_SOURCE_PAGE: &str = "https://www.gyan.dev/ffmpeg/builds/";
const FFMPEG_SIZE_BYTES: u64 = 109_728_040;
const FFMPEG_SHA256: &str = "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec";
const WHISPER_SOURCE_PAGE: &str =
    "https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md";
const WHISPER_SMALL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin?download=true";
const WHISPER_BASE_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin?download=true";
const WHISPER_SMALL_SIZE_BYTES: u64 = 487_601_967;
const WHISPER_SMALL_SHA256: &str =
    "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b";
const WHISPER_BASE_SIZE_BYTES: u64 = 147_951_465;
const WHISPER_BASE_SHA256: &str =
    "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe";
const WHISPER_RUNTIME_SOURCE_PAGE: &str = "https://github.com/ggml-org/whisper.cpp";
const YT_DLP_SOURCE_PAGE: &str = "https://github.com/yt-dlp/yt-dlp/releases";
const LICENSE_MIT: &str = "MIT";
const LICENSE_GPL: &str = "GPL-3.0-or-later";
const LICENSE_WHISPER_MODEL: &str = "MIT / OpenAI Whisper model terms";

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("运行时设置文件操作失败：{0}")]
    FileSystem(#[from] io::Error),
    #[error("运行时设置序列化失败：{0}")]
    Serialization(#[from] serde_json::Error),
    #[error("运行时组件不存在：{0}")]
    UnknownComponent(String),
    #[error("运行时存储目录无效：{0}")]
    InvalidStorageRoot(String),
    #[error("不支持的 Whisper 模型：{0}")]
    InvalidModel(String),
    #[error("运行时组件下载失败：{0}")]
    Download(String),
    #[error("运行时组件完整性校验失败：{0}")]
    Integrity(String),
    #[error("FFmpeg 压缩包处理失败：{0}")]
    Archive(String),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSettings {
    pub storage_root: Option<String>,
    pub preferred_model: String,
}

impl Default for RuntimeSettings {
    fn default() -> Self {
        Self {
            storage_root: None,
            preferred_model: DEFAULT_MODEL_KIND.to_owned(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeComponent {
    pub id: String,
    pub title: String,
    pub component_kind: String,
    pub version: String,
    pub available: bool,
    pub installed_path: Option<String>,
    pub expected_size_bytes: u64,
    pub installed_size_bytes: Option<u64>,
    pub expected_sha256: String,
    pub source_url: String,
    pub source_page: String,
    pub license: String,
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCatalog {
    pub settings: RuntimeSettings,
    pub components: Vec<RuntimeComponent>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetRuntimeStorageRootInput {
    pub path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPreferredModelInput {
    pub model_kind: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRuntimeComponentInput {
    pub component_id: String,
}

struct RuntimeState {
    settings_path: PathBuf,
    settings: RuntimeSettings,
}

static RUNTIME_STATE: OnceLock<RwLock<RuntimeState>> = OnceLock::new();
static DOWNLOAD_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub fn initialize(data_directory: &Path) -> Result<(), RuntimeError> {
    fs::create_dir_all(data_directory)?;
    let settings_path = data_directory.join(SETTINGS_FILE_NAME);
    let settings = load_settings(&settings_path)?;
    let state = RUNTIME_STATE.get_or_init(|| {
        RwLock::new(RuntimeState {
            settings_path: settings_path.clone(),
            settings: settings.clone(),
        })
    });
    let mut state = state
        .write()
        .map_err(|_| io::Error::other("运行时设置锁不可用"))?;
    state.settings_path = settings_path;
    state.settings = settings;
    Ok(())
}

pub fn catalog() -> Result<RuntimeCatalog, RuntimeError> {
    let settings = settings_snapshot();
    Ok(RuntimeCatalog {
        settings,
        components: vec![
            bundled_whisper_component("whisper-cpu", "Whisper CPU", "cpu"),
            bundled_whisper_component("whisper-vulkan", "Whisper Vulkan", "vulkan"),
            bundled_yt_dlp_component(),
            downloadable_ffmpeg_component(),
            downloadable_model_component("whisper-small", "Whisper Small", "small"),
            downloadable_model_component("whisper-base", "Whisper Base", "base"),
        ],
    })
}

pub fn set_storage_root(path: &str) -> Result<RuntimeCatalog, RuntimeError> {
    let path = path.trim();
    if path.is_empty() {
        return Err(RuntimeError::InvalidStorageRoot("目录不能为空".to_owned()));
    }
    let path = PathBuf::from(path);
    fs::create_dir_all(&path)?;
    if !path.is_dir() {
        return Err(RuntimeError::InvalidStorageRoot(format!(
            "不是目录：{}",
            path.display()
        )));
    }
    let path = fs::canonicalize(path)?;
    update_settings(|settings| settings.storage_root = Some(path.to_string_lossy().into_owned()))?;
    catalog()
}

pub fn set_preferred_model(model_kind: &str) -> Result<RuntimeCatalog, RuntimeError> {
    validate_model_kind(model_kind)?;
    update_settings(|settings| settings.preferred_model = model_kind.to_owned())?;
    catalog()
}

pub fn configured_runtime_root() -> Option<PathBuf> {
    settings_snapshot().storage_root.map(PathBuf::from)
}

pub fn configured_model_root() -> Option<PathBuf> {
    configured_runtime_root().map(|root| root.join("models"))
}

pub fn preferred_model_kind() -> String {
    settings_snapshot().preferred_model
}

pub fn download_component(component_id: &str) -> Result<RuntimeCatalog, RuntimeError> {
    let _guard = DOWNLOAD_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| io::Error::other("运行时下载锁不可用"))?;
    let storage_root = configured_runtime_root().ok_or_else(|| {
        RuntimeError::InvalidStorageRoot("请先选择运行时和模型的存储目录".to_owned())
    })?;

    match component_id {
        "ffmpeg" => download_ffmpeg(&storage_root)?,
        "whisper-small" => download_model(
            &storage_root,
            "ggml-small.bin",
            WHISPER_SMALL_URL,
            WHISPER_SMALL_SIZE_BYTES,
            WHISPER_SMALL_SHA256,
        )?,
        "whisper-base" => download_model(
            &storage_root,
            "ggml-base.bin",
            WHISPER_BASE_URL,
            WHISPER_BASE_SIZE_BYTES,
            WHISPER_BASE_SHA256,
        )?,
        "whisper-cpu" | "whisper-vulkan" | "yt-dlp" => {
            return Err(RuntimeError::UnknownComponent(format!(
                "{component_id} 已随安装包提供，无需下载"
            )));
        }
        other => return Err(RuntimeError::UnknownComponent(other.to_owned())),
    }
    catalog()
}

fn load_settings(path: &Path) -> Result<RuntimeSettings, RuntimeError> {
    if !path.is_file() {
        return Ok(RuntimeSettings::default());
    }
    let contents = fs::read(path)?;
    let settings = serde_json::from_slice::<RuntimeSettings>(&contents).unwrap_or_default();
    Ok(normalize_settings(settings))
}

fn normalize_settings(mut settings: RuntimeSettings) -> RuntimeSettings {
    if settings.preferred_model != "small" && settings.preferred_model != "base" {
        settings.preferred_model = DEFAULT_MODEL_KIND.to_owned();
    }
    settings.storage_root = settings.storage_root.filter(|path| !path.trim().is_empty());
    settings
}

fn settings_snapshot() -> RuntimeSettings {
    RUNTIME_STATE
        .get()
        .and_then(|state| state.read().ok().map(|state| state.settings.clone()))
        .unwrap_or_default()
}

fn update_settings(
    update: impl FnOnce(&mut RuntimeSettings),
) -> Result<RuntimeSettings, RuntimeError> {
    let state = RUNTIME_STATE.get_or_init(|| {
        RwLock::new(RuntimeState {
            settings_path: PathBuf::new(),
            settings: RuntimeSettings::default(),
        })
    });
    let mut state = state
        .write()
        .map_err(|_| io::Error::other("运行时设置锁不可用"))?;
    if state.settings_path.as_os_str().is_empty() {
        return Err(RuntimeError::InvalidStorageRoot(
            "应用尚未完成运行时设置初始化".to_owned(),
        ));
    }
    let mut settings = state.settings.clone();
    update(&mut settings);
    settings = normalize_settings(settings);
    persist_settings(&state.settings_path, &settings)?;
    state.settings = settings.clone();
    Ok(settings)
}

fn persist_settings(path: &Path, settings: &RuntimeSettings) -> Result<(), RuntimeError> {
    let temporary_path = path.with_extension("json.part");
    let contents = serde_json::to_vec_pretty(settings)?;
    let mut file = File::create(&temporary_path)?;
    file.write_all(&contents)?;
    file.sync_all()?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(temporary_path, path)?;
    Ok(())
}

fn bundled_whisper_component(id: &str, title: &str, backend: &str) -> RuntimeComponent {
    let path = transcription::runtime_directory_for_status(backend).ok();
    let available = path
        .as_deref()
        .is_some_and(|path| path.join("whisper-cli.exe").is_file());
    RuntimeComponent {
        id: id.to_owned(),
        title: title.to_owned(),
        component_kind: "bundled".to_owned(),
        version: WHISPER_RUNTIME_VERSION.to_owned(),
        available,
        installed_path: path.map(|path| path.to_string_lossy().into_owned()),
        expected_size_bytes: 0,
        installed_size_bytes: None,
        expected_sha256: String::new(),
        source_url: WHISPER_RUNTIME_SOURCE_PAGE.to_owned(),
        source_page: WHISPER_RUNTIME_SOURCE_PAGE.to_owned(),
        license: LICENSE_MIT.to_owned(),
        error_message: (!available).then(|| "随包运行时尚未找到或缺少 whisper-cli.exe".to_owned()),
    }
}

fn bundled_yt_dlp_component() -> RuntimeComponent {
    let path = youtube_media::yt_dlp_path_for_status().ok();
    let available = path.as_deref().is_some_and(Path::is_file);
    RuntimeComponent {
        id: "yt-dlp".to_owned(),
        title: "yt-dlp".to_owned(),
        component_kind: "bundled".to_owned(),
        version: YT_DLP_VERSION.to_owned(),
        available,
        installed_path: path.map(|path| path.to_string_lossy().into_owned()),
        expected_size_bytes: 0,
        installed_size_bytes: None,
        expected_sha256: YT_DLP_SHA256.to_owned(),
        source_url: YT_DLP_SOURCE_PAGE.to_owned(),
        source_page: YT_DLP_SOURCE_PAGE.to_owned(),
        license: LICENSE_UNLICENSE.to_owned(),
        error_message: (!available).then(|| "随包工具尚未找到".to_owned()),
    }
}

const LICENSE_UNLICENSE: &str = "Unlicense";

fn downloadable_ffmpeg_component() -> RuntimeComponent {
    let status = media::media_runtime_status();
    RuntimeComponent {
        id: "ffmpeg".to_owned(),
        title: "FFmpeg".to_owned(),
        component_kind: "download".to_owned(),
        version: FFMPEG_VERSION.to_owned(),
        available: status.available,
        installed_path: status.ffmpeg_path,
        expected_size_bytes: FFMPEG_SIZE_BYTES,
        installed_size_bytes: None,
        expected_sha256: FFMPEG_SHA256.to_owned(),
        source_url: FFMPEG_DOWNLOAD_URL.to_owned(),
        source_page: FFMPEG_SOURCE_PAGE.to_owned(),
        license: LICENSE_GPL.to_owned(),
        error_message: status.error_message,
    }
}

fn downloadable_model_component(id: &str, title: &str, model_kind: &str) -> RuntimeComponent {
    let (expected_size_bytes, expected_sha256, source_url) = match model_kind {
        "small" => (
            WHISPER_SMALL_SIZE_BYTES,
            WHISPER_SMALL_SHA256,
            WHISPER_SMALL_URL,
        ),
        "base" => (
            WHISPER_BASE_SIZE_BYTES,
            WHISPER_BASE_SHA256,
            WHISPER_BASE_URL,
        ),
        _ => unreachable!("catalog only uses known model kinds"),
    };
    let path = transcription::model_path_for_status(model_kind).ok();
    let installed_size_bytes = path
        .as_deref()
        .and_then(|path| fs::metadata(path).ok().map(|metadata| metadata.len()));
    let available = installed_size_bytes == Some(expected_size_bytes);
    RuntimeComponent {
        id: id.to_owned(),
        title: title.to_owned(),
        component_kind: "download".to_owned(),
        version: "whisper.cpp pinned model".to_owned(),
        available,
        installed_path: path.map(|path| path.to_string_lossy().into_owned()),
        expected_size_bytes,
        installed_size_bytes,
        expected_sha256: expected_sha256.to_owned(),
        source_url: source_url.to_owned(),
        source_page: WHISPER_SOURCE_PAGE.to_owned(),
        license: LICENSE_WHISPER_MODEL.to_owned(),
        error_message: if available {
            None
        } else {
            Some("未找到固定大小的模型文件；开始转写前仍会执行 SHA-256 校验".to_owned())
        },
    }
}

fn validate_model_kind(model_kind: &str) -> Result<(), RuntimeError> {
    if matches!(model_kind, "small" | "base") {
        Ok(())
    } else {
        Err(RuntimeError::InvalidModel(model_kind.to_owned()))
    }
}

fn download_model(
    storage_root: &Path,
    file_name: &str,
    source_url: &str,
    expected_size: u64,
    expected_sha256: &str,
) -> Result<(), RuntimeError> {
    let destination = storage_root.join("models").join("whisper").join(file_name);
    download_to_verified_file(source_url, &destination, expected_size, expected_sha256)
}

fn download_ffmpeg(storage_root: &Path) -> Result<(), RuntimeError> {
    let archive_path = storage_root
        .join("downloads")
        .join("ffmpeg-8.1.2-essentials_build.zip");
    download_to_verified_file(
        FFMPEG_DOWNLOAD_URL,
        &archive_path,
        FFMPEG_SIZE_BYTES,
        FFMPEG_SHA256,
    )?;

    let staging_root = storage_root
        .join("runtimes")
        .join(format!(".ffmpeg-staging-{}", Uuid::new_v4()));
    fs::create_dir_all(&staging_root)?;
    let extraction_result = extract_ffmpeg_archive(&archive_path, &staging_root).and_then(|_| {
        install_runtime_directory(&staging_root, &storage_root.join("runtimes").join("ffmpeg"))
    });
    if extraction_result.is_err() {
        let _ = fs::remove_dir_all(&staging_root);
    }
    extraction_result
}

fn download_to_verified_file(
    source_url: &str,
    destination: &Path,
    expected_size: u64,
    expected_sha256: &str,
) -> Result<(), RuntimeError> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary_path = destination.with_extension("part");
    if temporary_path.exists() {
        fs::remove_file(&temporary_path)?;
    }
    let client = Client::builder()
        .user_agent("SiaoVPlay runtime manager/0.2")
        .build()
        .map_err(|error| RuntimeError::Download(error.to_string()))?;
    let mut response = client
        .get(source_url)
        .send()
        .map_err(|error| RuntimeError::Download(format!("{source_url}：{error}")))?;
    if !response.status().is_success() {
        return Err(RuntimeError::Download(format!(
            "{source_url} 返回 HTTP {}",
            response.status()
        )));
    }
    let mut file = File::create(&temporary_path)?;
    io::copy(&mut response, &mut file)
        .map_err(|error| RuntimeError::Download(format!("写入下载文件失败：{error}")))?;
    file.sync_all()?;
    let (actual_size, actual_sha256) = file_digest(&temporary_path)?;
    if actual_size != expected_size {
        let _ = fs::remove_file(&temporary_path);
        return Err(RuntimeError::Integrity(format!(
            "{} 大小为 {actual_size}，预期为 {expected_size}",
            destination.display()
        )));
    }
    if !actual_sha256.eq_ignore_ascii_case(expected_sha256) {
        let _ = fs::remove_file(&temporary_path);
        return Err(RuntimeError::Integrity(format!(
            "{} 的 SHA-256 不匹配",
            destination.display()
        )));
    }
    replace_file(&temporary_path, destination)
}

fn extract_ffmpeg_archive(archive_path: &Path, staging_root: &Path) -> Result<(), RuntimeError> {
    let file = File::open(archive_path)?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| RuntimeError::Archive(error.to_string()))?;
    let mut found_ffmpeg = false;
    let mut found_ffprobe = false;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| RuntimeError::Archive(error.to_string()))?;
        if entry.is_dir() {
            continue;
        }
        let entry_name = entry.name().replace('\\', "/");
        if has_unsafe_archive_path(&entry_name) {
            return Err(RuntimeError::Archive(format!(
                "压缩包包含不安全路径：{entry_name}"
            )));
        }
        let file_name = if entry_name.ends_with("/bin/ffmpeg.exe") || entry_name == "bin/ffmpeg.exe"
        {
            "ffmpeg.exe"
        } else if entry_name.ends_with("/bin/ffprobe.exe") || entry_name == "bin/ffprobe.exe" {
            "ffprobe.exe"
        } else {
            continue;
        };
        let destination = staging_root.join("bin").join(file_name);
        fs::create_dir_all(
            destination
                .parent()
                .expect("staging bin should have a parent"),
        )?;
        let mut output = File::create(&destination)?;
        io::copy(&mut entry, &mut output)?;
        output.sync_all()?;
        if file_name == "ffmpeg.exe" {
            found_ffmpeg = true;
        } else {
            found_ffprobe = true;
        }
    }
    if !found_ffmpeg || !found_ffprobe {
        return Err(RuntimeError::Archive(
            "压缩包缺少 ffmpeg.exe 或 ffprobe.exe".to_owned(),
        ));
    }
    let metadata = serde_json::json!({
        "schemaVersion": 1,
        "version": FFMPEG_VERSION,
        "sourceUrl": FFMPEG_DOWNLOAD_URL,
        "sha256": FFMPEG_SHA256,
        "license": LICENSE_GPL,
    });
    fs::write(
        staging_root.join("runtime.json"),
        serde_json::to_vec_pretty(&metadata)?,
    )?;
    Ok(())
}

fn has_unsafe_archive_path(path: &str) -> bool {
    let path = Path::new(path);
    path.components().any(|component| {
        matches!(
            component,
            Component::Prefix(_) | Component::RootDir | Component::ParentDir
        )
    })
}

fn install_runtime_directory(staging_root: &Path, destination: &Path) -> Result<(), RuntimeError> {
    let parent = destination
        .parent()
        .ok_or_else(|| RuntimeError::Archive("FFmpeg 目标目录没有父目录".to_owned()))?;
    fs::create_dir_all(parent)?;
    let backup = parent.join(format!(".ffmpeg-backup-{}", Uuid::new_v4()));
    if destination.exists() {
        fs::rename(destination, &backup)?;
    }
    let install_result = fs::rename(staging_root, destination);
    match install_result {
        Ok(()) => {
            if backup.exists() {
                fs::remove_dir_all(backup)?;
            }
            Ok(())
        }
        Err(error) => {
            if backup.exists() && !destination.exists() {
                let _ = fs::rename(&backup, destination);
            }
            Err(RuntimeError::FileSystem(error))
        }
    }
}

fn replace_file(temporary_path: &Path, destination: &Path) -> Result<(), RuntimeError> {
    if destination.exists() {
        fs::remove_file(destination)?;
    }
    fs::rename(temporary_path, destination)?;
    Ok(())
}

fn file_digest(path: &Path) -> Result<(u64, String), RuntimeError> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut size = 0_u64;
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        size += count as u64;
        hasher.update(&buffer[..count]);
    }
    Ok((size, format!("{:x}", hasher.finalize())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_keep_model_selection_stable() {
        assert_eq!(RuntimeSettings::default().preferred_model, "small");
        assert_eq!(
            normalize_settings(RuntimeSettings {
                storage_root: Some(String::new()),
                preferred_model: "unexpected".to_owned(),
            }),
            RuntimeSettings::default()
        );
    }

    #[test]
    fn catalog_metadata_uses_pinned_downloads() {
        assert_eq!(FFMPEG_SIZE_BYTES, 109_728_040);
        assert_eq!(WHISPER_BASE_SIZE_BYTES, 147_951_465);
        assert_eq!(WHISPER_SMALL_SIZE_BYTES, 487_601_967);
        assert_eq!(YT_DLP_SHA256.len(), 64);
        assert!(FFMPEG_DOWNLOAD_URL.ends_with("ffmpeg-8.1.2-essentials_build.zip"));
    }

    #[test]
    fn archive_path_validation_rejects_escape_entries() {
        assert!(has_unsafe_archive_path("../ffmpeg.exe"));
        assert!(has_unsafe_archive_path("C:/Windows/ffmpeg.exe"));
        assert!(has_unsafe_archive_path("/absolute/ffmpeg.exe"));
        assert!(!has_unsafe_archive_path("ffmpeg-8.1.2/bin/ffmpeg.exe"));
    }
}
