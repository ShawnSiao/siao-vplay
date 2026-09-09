use std::{
    fs, io,
    path::Path,
    sync::{OnceLock, RwLock},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{local_resources, media, transcription, youtube_media};

pub const DEFAULT_MODEL_KIND: &str = "small";
pub const LEGACY_WHISPER_RUNTIME_VERSION: &str = "1.9.1-siaocut.1";
pub const YT_DLP_VERSION: &str = "2026.08.19";
pub const YT_DLP_SHA256: &str = "66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a";

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

struct RuntimeState {
    settings: RuntimeSettings,
}

static RUNTIME_STATE: OnceLock<RwLock<RuntimeState>> = OnceLock::new();

pub fn initialize(data_directory: &Path) -> Result<(), RuntimeError> {
    fs::create_dir_all(data_directory)?;
    let settings_path = data_directory.join(SETTINGS_FILE_NAME);
    let settings = load_settings(&settings_path)?;
    let state = RUNTIME_STATE.get_or_init(|| {
        RwLock::new(RuntimeState {
            settings: settings.clone(),
        })
    });
    let mut state = state
        .write()
        .map_err(|_| io::Error::other("运行时设置锁不可用"))?;
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

#[cfg(test)]
pub fn configured_runtime_root() -> Option<std::path::PathBuf> {
    local_resources::configured_root().or_else(|| {
        persisted_settings_snapshot()
            .storage_root
            .map(std::path::PathBuf::from)
    })
}

pub fn preferred_model_kind() -> String {
    settings_snapshot().preferred_model
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

// Resource configuration owns the current root; legacy settings are a read fallback only.
fn settings_snapshot() -> RuntimeSettings {
    let mut settings = persisted_settings_snapshot();
    if let Some(root) = local_resources::configured_root() {
        settings.storage_root = Some(root.to_string_lossy().into_owned());
    }
    settings
}

fn persisted_settings_snapshot() -> RuntimeSettings {
    RUNTIME_STATE
        .get()
        .and_then(|state| state.read().ok().map(|state| state.settings.clone()))
        .unwrap_or_default()
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
        version: LEGACY_WHISPER_RUNTIME_VERSION.to_owned(),
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

}
