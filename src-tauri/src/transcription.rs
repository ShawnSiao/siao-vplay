use std::{
    collections::HashMap,
    env,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;

use crate::{
    media::{self, MediaError},
    store::{ProjectStore, StoreError},
    subtitles::{
        self, GeneratedSubtitleCue, GeneratedSubtitleWord, PersistTranscriptionInput, SubtitleCue,
        SubtitleError,
    },
};

const WHISPER_RUNTIME_VERSION: &str = "1.9.1-siaocut.1";
const WHISPER_CLI_VERSION: &str = "1.9.1";
const WHISPER_SOURCE_COMMIT: &str = "080bbbe85230f624f0b52127f1ae1218247989f9";
const VULKAN_METADATA_SHA256: &str =
    "a5b8f595ef3321e68d4b72e4242c2a49bf229904c2cf73e3ed9eff5dd6a9d3d6";
const CPU_METADATA_SHA256: &str =
    "1d91160aeb1ad211c51eda4e80c373c0fab6cb8cb0307b2a104786eeb4ce6443";
const SMALL_MODEL_SIZE: u64 = 487_601_967;
const SMALL_MODEL_SHA256: &str = "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b";
const BASE_MODEL_SIZE: u64 = 147_951_465;
const BASE_MODEL_SHA256: &str = "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe";
const VAD_MODEL_FILE_NAME: &str = "ggml-silero-v6.2.0.bin";
const VAD_MODEL_SIZE: u64 = 885_098;
const VAD_MODEL_SHA256: &str = "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987";
const VAD_TIMELINE_FIXTURE_SHA256: &str =
    "e2d55c32ca5900c677bf86c541dedd98e7e67c31cc0d967d7509b0eba36871cb";
const VAD_TIMELINE_VERIFIER: &str = "tools/test-whisper-vad-timeline.ps1";
const POLL_INTERVAL: Duration = Duration::from_millis(100);

static ACTIVE_JOBS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

#[derive(Debug, Error)]
pub enum TranscriptionError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Media(#[from] MediaError),
    #[error(transparent)]
    Subtitle(#[from] SubtitleError),
    #[error("转写文件操作失败：{0}")]
    FileSystem(#[from] std::io::Error),
    #[error("转写运行时不可用：{0}")]
    RuntimeUnavailable(String),
    #[error("转写运行时完整性校验失败：{0}")]
    RuntimeIntegrity(String),
    #[error("转写模型不可用：{0}")]
    ModelUnavailable(String),
    #[error("转写模型完整性校验失败：{0}")]
    ModelIntegrity(String),
    #[error("转写语言无效：{0}")]
    InvalidLanguage(String),
    #[error("转写模型无效：{0}")]
    InvalidModel(String),
    #[error("当前媒体没有可转写的音轨")]
    MissingAudio,
    #[error("项目已有原文字幕，替换当前版本前需要明确确认")]
    ReplaceConfirmationRequired,
    #[error("项目已有进行中的转写任务")]
    ActiveJobExists,
    #[error("找不到转写任务：{0}")]
    JobNotFound(String),
    #[error("转写任务当前状态不允许此操作：{0}")]
    InvalidJobState(String),
    #[error("项目或媒体已发生变化，转写结果没有写入")]
    SourceChanged,
    #[error("音频提取失败：{0}")]
    AudioExtractionFailed(String),
    #[error("本地转写失败：{0}")]
    TranscriptionFailed(String),
    #[error("转写结果无效：{0}")]
    InvalidOutput(String),
    #[error("转写任务已取消")]
    Cancelled,
    #[error("转写数据序列化失败：{0}")]
    Serialization(#[from] serde_json::Error),
}

impl From<rusqlite::Error> for TranscriptionError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Store(StoreError::Database(error))
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TranscriptionLanguage {
    Auto,
    En,
    Th,
    Ja,
    Ko,
}

impl TranscriptionLanguage {
    fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::En => "en",
            Self::Th => "th",
            Self::Ja => "ja",
            Self::Ko => "ko",
        }
    }

    fn parse(value: &str) -> Result<Self, TranscriptionError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "auto" => Ok(Self::Auto),
            "en" => Ok(Self::En),
            "th" => Ok(Self::Th),
            "ja" => Ok(Self::Ja),
            "ko" => Ok(Self::Ko),
            _ => Err(TranscriptionError::InvalidLanguage(value.to_owned())),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TranscriptionModelKind {
    Small,
    Base,
}

impl TranscriptionModelKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Small => "small",
            Self::Base => "base",
        }
    }

    fn parse(value: &str) -> Result<Self, TranscriptionError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "small" => Ok(Self::Small),
            "base" => Ok(Self::Base),
            _ => Err(TranscriptionError::InvalidModel(value.to_owned())),
        }
    }

    fn expected(self) -> (u64, &'static str) {
        match self {
            Self::Small => (SMALL_MODEL_SIZE, SMALL_MODEL_SHA256),
            Self::Base => (BASE_MODEL_SIZE, BASE_MODEL_SHA256),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTranscriptionInput {
    pub project_id: String,
    pub language_code: String,
    #[serde(default = "default_model_kind")]
    pub model_kind: String,
    #[serde(default)]
    pub confirm_replace_original: bool,
}

fn default_model_kind() -> String {
    crate::runtime::preferred_model_kind()
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionJobInput {
    pub job_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionJob {
    pub id: String,
    pub project_id: String,
    pub status: String,
    pub stage: String,
    pub progress: f64,
    pub language_code: String,
    pub model_kind: String,
    pub runtime_backend: String,
    pub runtime_version: String,
    pub subtitle_version_id: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub started_at_ms: Option<i64>,
    pub completed_at_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionRuntimeOption {
    pub backend: String,
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionModelStatus {
    pub model_kind: String,
    pub available: bool,
    pub path: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionRuntimeStatus {
    pub available: bool,
    pub preferred_backend: Option<String>,
    pub runtimes: Vec<TranscriptionRuntimeOption>,
    pub models: Vec<TranscriptionModelStatus>,
}

#[derive(Clone, Debug)]
struct RuntimeBundle {
    directory: PathBuf,
    executable: PathBuf,
    backend: &'static str,
    version: String,
    executable_sha256: String,
    metadata_sha256: String,
    vad_timeline_verified: bool,
}

#[derive(Clone, Debug)]
struct ModelBundle {
    path: PathBuf,
    kind: TranscriptionModelKind,
    sha256: String,
}

#[derive(Clone, Debug)]
struct VadModelBundle {
    path: PathBuf,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeMetadata {
    schema_version: u32,
    version: String,
    backend: String,
    source_commit: String,
    executable_sha256: String,
    source_capabilities: RuntimeCapabilities,
    vad_timeline_verification: VadTimelineVerification,
    files: Vec<RuntimeFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeCapabilities {
    segment_timestamp_domain: String,
    token_api_timestamp_domain: String,
    cli_json_token_timestamp_domain: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VadTimelineVerification {
    status: String,
    time_domain: String,
    fixture_sha256: String,
    verifier: String,
}

#[derive(Debug, Deserialize)]
struct RuntimeFile {
    name: String,
    size: u64,
    sha256: String,
}

#[derive(Clone, Debug)]
struct StoredJob {
    public: TranscriptionJob,
    source_media_id: String,
    model_path: PathBuf,
    model_sha256: String,
    runtime_path: PathBuf,
    runtime_sha256: String,
    runtime_metadata_sha256: String,
    parameters_json: String,
    expected_project_revision: i64,
    expected_media_sha256: String,
    media_duration_ms: i64,
    cancel_requested_at_ms: Option<i64>,
}

fn active_jobs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    ACTIVE_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> Result<i64, TranscriptionError> {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| {
                TranscriptionError::FileSystem(std::io::Error::other(error.to_string()))
            })?
            .as_millis(),
    )
    .map_err(|_| TranscriptionError::FileSystem(std::io::Error::other("系统时间超出支持范围")))
}

fn hash_file(path: &Path) -> Result<String, TranscriptionError> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn hidden_command(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

fn runtime_directory(backend: &str) -> Result<PathBuf, TranscriptionError> {
    let override_name = if backend == "vulkan" {
        "SIAOVPLAY_WHISPER_VULKAN_DIR"
    } else {
        "SIAOVPLAY_WHISPER_CPU_DIR"
    };
    if let Some(path) = env::var_os(override_name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        return Ok(path);
    }
    let runtime_root = env::var_os("SIAOVPLAY_RUNTIME_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(crate::runtime::configured_runtime_root);
    let executable_path = env::current_exe().ok();
    resolve_runtime_directory(backend, runtime_root.as_deref(), executable_path.as_deref())
}

pub(crate) fn runtime_directory_for_status(backend: &str) -> Result<PathBuf, TranscriptionError> {
    runtime_directory(backend)
}

fn resolve_runtime_directory(
    backend: &str,
    runtime_root: Option<&Path>,
    executable_path: Option<&Path>,
) -> Result<PathBuf, TranscriptionError> {
    let directory_name = if backend == "vulkan" {
        "whisper-vulkan"
    } else {
        "whisper"
    };
    let candidates = runtime_directory_candidates(directory_name, runtime_root, executable_path);
    candidates
        .iter()
        .find(|path| path.is_dir())
        .cloned()
        .ok_or_else(|| {
            let checked = candidates
                .iter()
                .take(16)
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join("；");
            TranscriptionError::RuntimeUnavailable(format!(
                "找不到 Whisper {backend} 运行时。可以设置 {override_name} 或 SIAOVPLAY_RUNTIME_DIR，或将运行时放在应用相邻的 runtimes、runtime 或 resources 目录。已检查：{checked}",
                override_name = if backend == "vulkan" {
                    "SIAOVPLAY_WHISPER_VULKAN_DIR"
                } else {
                    "SIAOVPLAY_WHISPER_CPU_DIR"
                }
            ))
        })
}

fn runtime_directory_candidates(
    directory_name: &str,
    runtime_root: Option<&Path>,
    executable_path: Option<&Path>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(runtime_root) = runtime_root {
        push_unique(&mut candidates, runtime_root.join(directory_name));
        push_unique(
            &mut candidates,
            runtime_root.join("runtimes").join(directory_name),
        );
    }
    if let Some(executable_directory) = executable_path.and_then(Path::parent) {
        for ancestor in executable_directory
            .ancestors()
            .take(5)
            .take_while(|ancestor| ancestor.parent().is_some())
        {
            for relative_directory in [
                Path::new("runtimes").join(directory_name),
                Path::new("runtime").join(directory_name),
                Path::new("resources").join("runtimes").join(directory_name),
                Path::new("resources").join("runtime").join(directory_name),
                Path::new("resources").join(directory_name),
                PathBuf::from(directory_name),
            ] {
                push_unique(&mut candidates, ancestor.join(relative_directory));
            }
        }
    }
    candidates
}

fn verify_runtime(backend: &'static str) -> Result<RuntimeBundle, TranscriptionError> {
    let directory = runtime_directory(backend)?;
    let metadata_path = directory.join("runtime-metadata.json");
    if !metadata_path.is_file() {
        return Err(TranscriptionError::RuntimeUnavailable(format!(
            "缺少 {}",
            metadata_path.display()
        )));
    }
    let expected_metadata_hash = if backend == "vulkan" {
        VULKAN_METADATA_SHA256
    } else {
        CPU_METADATA_SHA256
    };
    let metadata_hash = hash_file(&metadata_path)?;
    if !metadata_hash.eq_ignore_ascii_case(expected_metadata_hash) {
        return Err(TranscriptionError::RuntimeIntegrity(format!(
            "{} 的元数据哈希不匹配",
            metadata_path.display()
        )));
    }
    let metadata: RuntimeMetadata = serde_json::from_slice(&fs::read(&metadata_path)?)?;
    if metadata.schema_version != 1
        || metadata.version != WHISPER_RUNTIME_VERSION
        || metadata.backend != backend
        || metadata.source_commit != WHISPER_SOURCE_COMMIT
        || metadata.source_capabilities.segment_timestamp_domain != "original_media"
        || metadata.source_capabilities.token_api_timestamp_domain != "original_media"
        || metadata.source_capabilities.cli_json_token_timestamp_domain != "original_media"
        || metadata.vad_timeline_verification.status != "verified"
        || metadata.vad_timeline_verification.time_domain != "original_media"
        || !metadata
            .vad_timeline_verification
            .fixture_sha256
            .eq_ignore_ascii_case(VAD_TIMELINE_FIXTURE_SHA256)
        || metadata.vad_timeline_verification.verifier != VAD_TIMELINE_VERIFIER
    {
        return Err(TranscriptionError::RuntimeIntegrity(format!(
            "{} 的版本、后端或时间轴能力不符合固定基线",
            metadata_path.display()
        )));
    }
    for entry in &metadata.files {
        if Path::new(&entry.name).components().count() != 1 {
            return Err(TranscriptionError::RuntimeIntegrity(
                "运行时元数据包含越界文件名".to_owned(),
            ));
        }
        let path = directory.join(&entry.name);
        let actual_size = fs::metadata(&path)
            .map_err(|_| TranscriptionError::RuntimeIntegrity(format!("缺少 {}", path.display())))?
            .len();
        if actual_size != entry.size || !hash_file(&path)?.eq_ignore_ascii_case(&entry.sha256) {
            return Err(TranscriptionError::RuntimeIntegrity(format!(
                "{} 的大小或哈希不匹配",
                path.display()
            )));
        }
    }
    let executable = directory.join("whisper-cli.exe");
    let executable_hash = hash_file(&executable)?;
    if !executable_hash.eq_ignore_ascii_case(&metadata.executable_sha256) {
        return Err(TranscriptionError::RuntimeIntegrity(
            "whisper-cli.exe 与运行时元数据不一致".to_owned(),
        ));
    }
    let output = hidden_command(&executable)
        .current_dir(&directory)
        .arg("--version")
        .output()
        .map_err(|error| {
            TranscriptionError::RuntimeUnavailable(format!(
                "{} 无法启动：{error}",
                executable.display()
            ))
        })?;
    let version_output = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() || !version_output.contains(WHISPER_CLI_VERSION) {
        return Err(TranscriptionError::RuntimeIntegrity(format!(
            "{} 未报告固定版本 {}",
            executable.display(),
            WHISPER_CLI_VERSION
        )));
    }
    Ok(RuntimeBundle {
        directory,
        executable,
        backend,
        version: metadata.version,
        executable_sha256: executable_hash,
        metadata_sha256: metadata_hash,
        vad_timeline_verified: true,
    })
}

fn model_path(kind: TranscriptionModelKind) -> Result<PathBuf, TranscriptionError> {
    let override_name = match kind {
        TranscriptionModelKind::Small => "SIAOVPLAY_WHISPER_SMALL_MODEL",
        TranscriptionModelKind::Base => "SIAOVPLAY_WHISPER_BASE_MODEL",
    };
    if let Some(path) = env::var_os(override_name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        return Ok(path);
    }
    let model_root = env::var_os("SIAOVPLAY_MODEL_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(crate::runtime::configured_model_root);
    let executable_path = env::current_exe().ok();
    resolve_model_path(kind, model_root.as_deref(), executable_path.as_deref())
}

pub(crate) fn model_path_for_status(model_kind: &str) -> Result<PathBuf, TranscriptionError> {
    let kind = TranscriptionModelKind::parse(model_kind)?;
    model_path(kind)
}

fn resolve_model_path(
    kind: TranscriptionModelKind,
    model_root: Option<&Path>,
    executable_path: Option<&Path>,
) -> Result<PathBuf, TranscriptionError> {
    let file_name = format!("ggml-{}.bin", kind.as_str());
    let candidates = model_candidates(&file_name, model_root, executable_path);
    candidates
        .iter()
        .find(|path| path.is_file())
        .cloned()
        .ok_or_else(|| {
            let checked = candidates
                .iter()
                .take(16)
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join("；");
            TranscriptionError::ModelUnavailable(
                format!(
                    "找不到 Whisper {} 模型。可以设置 SIAOVPLAY_MODEL_DIR 或对应的模型文件环境变量，或将模型放在应用相邻的 models 目录。已检查：{checked}",
                    kind.as_str()
                ),
            )
        })
}

fn model_candidates(
    file_name: &str,
    model_root: Option<&Path>,
    executable_path: Option<&Path>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(model_root) = model_root {
        push_unique(&mut candidates, model_root.join("whisper").join(file_name));
        push_unique(&mut candidates, model_root.join(file_name));
    }
    if let Some(executable_directory) = executable_path.and_then(Path::parent) {
        for ancestor in executable_directory
            .ancestors()
            .take(5)
            .take_while(|ancestor| ancestor.parent().is_some())
        {
            for relative_file in [
                Path::new("models").join("whisper").join(file_name),
                Path::new("resources")
                    .join("models")
                    .join("whisper")
                    .join(file_name),
                Path::new("resources")
                    .join("whisper-models")
                    .join(file_name),
                Path::new("whisper-models").join(file_name),
                Path::new("resources").join("whisper").join(file_name),
            ] {
                push_unique(&mut candidates, ancestor.join(relative_file));
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

fn verify_model(kind: TranscriptionModelKind) -> Result<ModelBundle, TranscriptionError> {
    let path = model_path(kind)?;
    let (expected_size, expected_hash) = kind.expected();
    let size = fs::metadata(&path)
        .map_err(|_| TranscriptionError::ModelUnavailable(format!("缺少 {}", path.display())))?
        .len();
    if size != expected_size {
        return Err(TranscriptionError::ModelIntegrity(format!(
            "{} 的大小不符合固定模型基线",
            path.display()
        )));
    }
    let sha256 = hash_file(&path)?;
    if !sha256.eq_ignore_ascii_case(expected_hash) {
        return Err(TranscriptionError::ModelIntegrity(format!(
            "{} 的哈希不符合固定模型基线",
            path.display()
        )));
    }
    Ok(ModelBundle { path, kind, sha256 })
}

fn vad_model_path() -> Result<PathBuf, TranscriptionError> {
    if let Some(path) = env::var_os("SIAOVPLAY_WHISPER_VAD_MODEL")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        return Ok(path);
    }
    let runtime_root = env::var_os("SIAOVPLAY_RUNTIME_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(crate::runtime::configured_runtime_root);
    let executable_path = env::current_exe().ok();
    let cpu_runtime_directory = runtime_directory("cpu").ok();
    resolve_vad_model_path(
        runtime_root.as_deref(),
        executable_path.as_deref(),
        cpu_runtime_directory.as_deref(),
    )
}

fn resolve_vad_model_path(
    runtime_root: Option<&Path>,
    executable_path: Option<&Path>,
    cpu_runtime_directory: Option<&Path>,
) -> Result<PathBuf, TranscriptionError> {
    let mut candidates = Vec::new();
    if let Some(cpu_runtime_directory) = cpu_runtime_directory {
        push_unique(
            &mut candidates,
            cpu_runtime_directory.join(VAD_MODEL_FILE_NAME),
        );
    }
    if let Some(runtime_root) = runtime_root {
        push_unique(
            &mut candidates,
            runtime_root.join("whisper").join(VAD_MODEL_FILE_NAME),
        );
        push_unique(
            &mut candidates,
            runtime_root
                .join("runtimes")
                .join("whisper")
                .join(VAD_MODEL_FILE_NAME),
        );
        push_unique(&mut candidates, runtime_root.join(VAD_MODEL_FILE_NAME));
    }
    if let Some(executable_directory) = executable_path.and_then(Path::parent) {
        for ancestor in executable_directory
            .ancestors()
            .take(5)
            .take_while(|ancestor| ancestor.parent().is_some())
        {
            for relative_file in [
                Path::new("runtimes")
                    .join("whisper")
                    .join(VAD_MODEL_FILE_NAME),
                Path::new("runtime")
                    .join("whisper")
                    .join(VAD_MODEL_FILE_NAME),
                Path::new("resources")
                    .join("runtimes")
                    .join("whisper")
                    .join(VAD_MODEL_FILE_NAME),
                Path::new("resources")
                    .join("whisper")
                    .join(VAD_MODEL_FILE_NAME),
                Path::new("whisper").join(VAD_MODEL_FILE_NAME),
            ] {
                push_unique(&mut candidates, ancestor.join(relative_file));
            }
        }
    }
    candidates
        .iter()
        .find(|path| path.is_file())
        .cloned()
        .ok_or_else(|| {
            let checked = candidates
                .iter()
                .take(16)
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join("；");
            TranscriptionError::ModelUnavailable(format!(
                "找不到 Whisper VAD 模型。可以设置 SIAOVPLAY_WHISPER_VAD_MODEL，或将 {VAD_MODEL_FILE_NAME} 放在 CPU 运行时目录。已检查：{checked}"
            ))
        })
}

fn verify_vad_model() -> Result<VadModelBundle, TranscriptionError> {
    let path = vad_model_path()?;
    let size = fs::metadata(&path)
        .map_err(|_| TranscriptionError::ModelUnavailable(format!("缺少 {}", path.display())))?
        .len();
    if size != VAD_MODEL_SIZE {
        return Err(TranscriptionError::ModelIntegrity(format!(
            "{} 的大小不符合固定 VAD 模型基线",
            path.display()
        )));
    }
    let sha256 = hash_file(&path)?;
    if !sha256.eq_ignore_ascii_case(VAD_MODEL_SHA256) {
        return Err(TranscriptionError::ModelIntegrity(format!(
            "{} 的哈希不符合固定 VAD 模型基线",
            path.display()
        )));
    }
    Ok(VadModelBundle { path, sha256 })
}

fn preferred_runtime() -> Result<RuntimeBundle, TranscriptionError> {
    match verify_runtime("vulkan") {
        Ok(runtime) => Ok(runtime),
        Err(vulkan_error) => verify_runtime("cpu").map_err(|cpu_error| {
            TranscriptionError::RuntimeUnavailable(format!(
                "Vulkan：{vulkan_error}；CPU：{cpu_error}"
            ))
        }),
    }
}

pub fn transcription_runtime_status() -> TranscriptionRuntimeStatus {
    let vad_status = verify_vad_model()
        .map(|_| ())
        .map_err(|error| error.to_string());
    let runtimes = ["vulkan", "cpu"]
        .into_iter()
        .map(|backend| match verify_runtime(backend) {
            Ok(runtime) => TranscriptionRuntimeOption {
                backend: backend.to_owned(),
                available: vad_status.is_ok(),
                path: Some(runtime.directory.to_string_lossy().into_owned()),
                version: Some(runtime.version),
                error_message: vad_status.as_ref().err().cloned(),
            },
            Err(error) => TranscriptionRuntimeOption {
                backend: backend.to_owned(),
                available: false,
                path: None,
                version: None,
                error_message: Some(error.to_string()),
            },
        })
        .collect::<Vec<_>>();
    let models = [TranscriptionModelKind::Small, TranscriptionModelKind::Base]
        .into_iter()
        .map(|kind| match verify_model(kind) {
            Ok(_) => TranscriptionModelStatus {
                model_kind: kind.as_str().to_owned(),
                available: true,
                path: model_path(kind)
                    .ok()
                    .map(|path| path.to_string_lossy().into_owned()),
                error_message: None,
            },
            Err(error) => TranscriptionModelStatus {
                model_kind: kind.as_str().to_owned(),
                available: false,
                path: model_path(kind)
                    .ok()
                    .map(|path| path.to_string_lossy().into_owned()),
                error_message: Some(error.to_string()),
            },
        })
        .collect::<Vec<_>>();
    let preferred_backend = runtimes
        .iter()
        .find(|runtime| runtime.available)
        .map(|runtime| runtime.backend.clone());
    TranscriptionRuntimeStatus {
        available: preferred_backend.is_some() && models.iter().any(|model| model.available),
        preferred_backend,
        runtimes,
        models,
    }
}

fn transcription_parameters(
    language_code: &str,
    vad_model: &VadModelBundle,
) -> Result<String, TranscriptionError> {
    Ok(serde_json::to_string(&serde_json::json!({
        "audioStream": "0:a:0",
        "sampleFormat": "pcm_s16le",
        "sampleRateHz": 16000,
        "channels": 1,
        "language": language_code,
        "output": "json_full",
        "splitOnWord": true,
        "maxSegmentCharacters": 60,
        "vad": true,
        "vadModelPath": vad_model.path.to_string_lossy(),
        "vadModelSha256": vad_model.sha256,
        "vadTimelineDomain": "original_media",
        "vadMinSilenceDurationMs": 250,
        "vadSpeechPadMs": 80
    }))?)
}

pub fn start_transcription(
    store: &ProjectStore,
    input: StartTranscriptionInput,
) -> Result<TranscriptionJob, TranscriptionError> {
    let language = TranscriptionLanguage::parse(&input.language_code)?;
    let model_kind = TranscriptionModelKind::parse(&input.model_kind)?;
    let runtime = preferred_runtime()?;
    let model = verify_model(model_kind)?;
    let vad_model = verify_vad_model()?;
    if !runtime.vad_timeline_verified {
        return Err(TranscriptionError::RuntimeIntegrity(
            "当前转写运行时没有通过 VAD 原媒体时间轴验证".to_owned(),
        ));
    }
    let inspection = media::inspect_project_media(store, &input.project_id)?;
    if inspection.probe.audio_streams.is_empty() {
        return Err(TranscriptionError::MissingAudio);
    }
    let media_duration_ms = inspection
        .probe
        .duration_ms
        .filter(|duration| *duration > 0)
        .ok_or_else(|| TranscriptionError::InvalidOutput("媒体没有可用的正时长".to_owned()))?;
    let project = store.get_project(&input.project_id)?;
    let connection = store.connect()?;
    let original_exists = connection
        .query_row(
            "SELECT 1 FROM subtitle_tracks
             WHERE project_id = ?1 AND role = 'original' AND current_version_id IS NOT NULL",
            params![project.id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if original_exists && !input.confirm_replace_original {
        return Err(TranscriptionError::ReplaceConfirmationRequired);
    }
    let active_exists = connection
        .query_row(
            "SELECT 1 FROM transcription_jobs
             WHERE project_id = ?1
               AND status IN ('queued', 'extracting', 'transcribing', 'validating')",
            params![project.id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if active_exists {
        return Err(TranscriptionError::ActiveJobExists);
    }

    let timestamp = now_ms()?;
    let job_id = Uuid::new_v4().to_string();
    let parameters_json = transcription_parameters(language.as_str(), &vad_model)?;
    connection
        .execute(
            "INSERT INTO transcription_jobs (
                id, project_id, source_media_id, status, stage, progress,
                language_code, model_kind, model_path, model_sha256,
                runtime_path, runtime_backend, runtime_version, runtime_sha256,
                runtime_metadata_sha256, parameters_json,
                expected_project_revision, expected_media_sha256, media_duration_ms,
                confirm_replace_original, subtitle_version_id, cancel_requested_at_ms,
                error_code, error_message, created_at_ms, updated_at_ms,
                started_at_ms, completed_at_ms
             ) VALUES (
                ?1, ?2, ?3, 'queued', 'queued', 0.0,
                ?4, ?5, ?6, ?7,
                ?8, ?9, ?10, ?11,
                ?12, ?13,
                ?14, ?15, ?16,
                ?17, NULL, NULL,
                NULL, NULL, ?18, ?18,
                NULL, NULL
             )",
            params![
                job_id,
                project.id,
                inspection.media_source_id,
                language.as_str(),
                model.kind.as_str(),
                model.path.to_string_lossy(),
                model.sha256,
                runtime.executable.to_string_lossy(),
                runtime.backend,
                runtime.version,
                runtime.executable_sha256,
                runtime.metadata_sha256,
                parameters_json,
                project.revision,
                inspection.source_sha256,
                media_duration_ms,
                input.confirm_replace_original,
                timestamp,
            ],
        )
        .map_err(|error| {
            if error
                .to_string()
                .contains("one_active_transcription_per_project")
            {
                TranscriptionError::ActiveJobExists
            } else {
                error.into()
            }
        })?;
    get_transcription_job(store, &job_id)
}

pub fn get_transcription_job(
    store: &ProjectStore,
    job_id: &str,
) -> Result<TranscriptionJob, TranscriptionError> {
    Ok(load_stored_job(store, job_id)?.public)
}

pub fn list_transcription_jobs(
    store: &ProjectStore,
    project_id: &str,
) -> Result<Vec<TranscriptionJob>, TranscriptionError> {
    store.get_project(project_id)?;
    let connection = store.connect()?;
    let mut statement = connection.prepare(
        "SELECT
            id, project_id, status, stage, progress, language_code, model_kind,
            runtime_backend, runtime_version, subtitle_version_id,
            error_code, error_message, created_at_ms, updated_at_ms,
            started_at_ms, completed_at_ms
         FROM transcription_jobs
         WHERE project_id = ?1
         ORDER BY created_at_ms DESC, id DESC",
    )?;
    statement
        .query_map(params![project_id], map_public_job)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn map_public_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<TranscriptionJob> {
    Ok(TranscriptionJob {
        id: row.get(0)?,
        project_id: row.get(1)?,
        status: row.get(2)?,
        stage: row.get(3)?,
        progress: row.get(4)?,
        language_code: row.get(5)?,
        model_kind: row.get(6)?,
        runtime_backend: row.get(7)?,
        runtime_version: row.get(8)?,
        subtitle_version_id: row.get(9)?,
        error_code: row.get(10)?,
        error_message: row.get(11)?,
        created_at_ms: row.get(12)?,
        updated_at_ms: row.get(13)?,
        started_at_ms: row.get(14)?,
        completed_at_ms: row.get(15)?,
    })
}

fn load_stored_job(store: &ProjectStore, job_id: &str) -> Result<StoredJob, TranscriptionError> {
    let connection = store.connect()?;
    connection
        .query_row(
            "SELECT
                id, project_id, status, stage, progress, language_code, model_kind,
                runtime_backend, runtime_version, subtitle_version_id,
                error_code, error_message, created_at_ms, updated_at_ms,
                started_at_ms, completed_at_ms,
                source_media_id, model_path, model_sha256, runtime_path,
                runtime_sha256, runtime_metadata_sha256, parameters_json,
                expected_project_revision, expected_media_sha256, media_duration_ms,
                cancel_requested_at_ms
             FROM transcription_jobs
             WHERE id = ?1",
            params![job_id],
            |row| {
                Ok(StoredJob {
                    public: map_public_job(row)?,
                    source_media_id: row.get(16)?,
                    model_path: PathBuf::from(row.get::<_, String>(17)?),
                    model_sha256: row.get(18)?,
                    runtime_path: PathBuf::from(row.get::<_, String>(19)?),
                    runtime_sha256: row.get(20)?,
                    runtime_metadata_sha256: row.get(21)?,
                    parameters_json: row.get(22)?,
                    expected_project_revision: row.get(23)?,
                    expected_media_sha256: row.get(24)?,
                    media_duration_ms: row.get(25)?,
                    cancel_requested_at_ms: row.get(26)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| TranscriptionError::JobNotFound(job_id.to_owned()))
}

pub fn spawn_transcription_job(
    store: ProjectStore,
    job_id: String,
) -> Result<(), TranscriptionError> {
    let job = load_stored_job(&store, &job_id)?;
    if job.public.status != "queued" {
        return Err(TranscriptionError::InvalidJobState(job.public.status));
    }
    let cancellation = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = active_jobs()
            .lock()
            .map_err(|_| TranscriptionError::InvalidJobState("任务锁已损坏".to_owned()))?;
        if jobs.contains_key(&job_id) {
            return Err(TranscriptionError::ActiveJobExists);
        }
        jobs.insert(job_id.clone(), cancellation.clone());
    }
    let worker_job_id = job_id.clone();
    let failure_store = store.clone();
    let spawn_result = thread::Builder::new()
        .name(format!("transcription-{job_id}"))
        .spawn(move || {
            let result = run_job(&store, &worker_job_id, &cancellation);
            if let Err(error) = result {
                let _ = finish_with_error(&store, &worker_job_id, &error);
            }
            if let Ok(mut jobs) = active_jobs().lock() {
                jobs.remove(&worker_job_id);
            }
        });
    match spawn_result {
        Ok(_) => Ok(()),
        Err(error) => {
            if let Ok(mut jobs) = active_jobs().lock() {
                jobs.remove(&job_id);
            }
            let error = TranscriptionError::FileSystem(error);
            let _ = finish_with_error(&failure_store, &job_id, &error);
            Err(error)
        }
    }
}

pub fn cancel_transcription_job(
    store: &ProjectStore,
    job_id: &str,
) -> Result<TranscriptionJob, TranscriptionError> {
    let job = load_stored_job(store, job_id)?;
    if matches!(
        job.public.status.as_str(),
        "completed" | "failed" | "cancelled" | "interrupted"
    ) {
        return Err(TranscriptionError::InvalidJobState(job.public.status));
    }
    let timestamp = now_ms()?;
    store.connect()?.execute(
        "UPDATE transcription_jobs
         SET cancel_requested_at_ms = ?2, stage = 'cancelling', updated_at_ms = ?2
         WHERE id = ?1
           AND status IN ('queued', 'extracting', 'transcribing', 'validating')",
        params![job_id, timestamp],
    )?;
    if let Ok(jobs) = active_jobs().lock()
        && let Some(flag) = jobs.get(job_id)
    {
        flag.store(true, Ordering::SeqCst);
    }
    if job.public.status == "queued" {
        mark_cancelled(store, job_id)?;
    }
    get_transcription_job(store, job_id)
}

pub fn cancel_project_transcriptions(
    store: &ProjectStore,
    project_id: &str,
) -> Result<usize, TranscriptionError> {
    let ids = {
        let connection = store.connect()?;
        let mut statement = connection.prepare(
            "SELECT id FROM transcription_jobs
             WHERE project_id = ?1
               AND status IN ('queued', 'extracting', 'transcribing', 'validating')",
        )?;
        statement
            .query_map(params![project_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?
    };
    for id in &ids {
        let _ = cancel_transcription_job(store, id);
    }
    for _ in 0..100 {
        let active = store.connect()?.query_row(
            "SELECT COUNT(*) FROM transcription_jobs
             WHERE project_id = ?1
               AND status IN ('queued', 'extracting', 'transcribing', 'validating')",
            params![project_id],
            |row| row.get::<_, i64>(0),
        )?;
        if active == 0 {
            return Ok(ids.len());
        }
        thread::sleep(POLL_INTERVAL);
    }
    Err(TranscriptionError::InvalidJobState(
        "取消转写任务超时，项目尚未删除".to_owned(),
    ))
}

pub fn resume_transcription_job(
    store: &ProjectStore,
    job_id: &str,
) -> Result<TranscriptionJob, TranscriptionError> {
    let job = load_stored_job(store, job_id)?;
    if !matches!(
        job.public.status.as_str(),
        "failed" | "cancelled" | "interrupted"
    ) {
        return Err(TranscriptionError::InvalidJobState(job.public.status));
    }
    validate_baseline(store, &job)?;
    let active_exists = store
        .connect()?
        .query_row(
            "SELECT 1 FROM transcription_jobs
             WHERE project_id = ?1 AND id <> ?2
               AND status IN ('queued', 'extracting', 'transcribing', 'validating')",
            params![job.public.project_id, job_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if active_exists {
        return Err(TranscriptionError::ActiveJobExists);
    }
    let language = TranscriptionLanguage::parse(&job.public.language_code)?;
    let model_kind = TranscriptionModelKind::parse(&job.public.model_kind)?;
    let runtime = preferred_runtime()?;
    let model = verify_model(model_kind)?;
    let vad_model = verify_vad_model()?;
    if !runtime.vad_timeline_verified {
        return Err(TranscriptionError::RuntimeIntegrity(
            "当前转写运行时没有通过 VAD 原媒体时间轴验证".to_owned(),
        ));
    }
    let parameters_json = transcription_parameters(language.as_str(), &vad_model)?;
    let timestamp = now_ms()?;
    let changed = store.connect()?.execute(
        "UPDATE transcription_jobs
         SET status = 'queued', stage = 'queued', progress = 0.0,
             subtitle_version_id = NULL, cancel_requested_at_ms = NULL,
             error_code = NULL, error_message = NULL, updated_at_ms = ?2,
             started_at_ms = NULL, completed_at_ms = NULL,
             model_path = ?3, model_sha256 = ?4,
             runtime_path = ?5, runtime_backend = ?6, runtime_version = ?7,
             runtime_sha256 = ?8, runtime_metadata_sha256 = ?9,
             parameters_json = ?10
         WHERE id = ?1
           AND status IN ('failed', 'cancelled', 'interrupted')",
        params![
            job_id,
            timestamp,
            model.path.to_string_lossy(),
            model.sha256,
            runtime.executable.to_string_lossy(),
            runtime.backend,
            runtime.version,
            runtime.executable_sha256,
            runtime.metadata_sha256,
            parameters_json,
        ],
    )?;
    if changed != 1 {
        return Err(TranscriptionError::InvalidJobState(job.public.status));
    }
    get_transcription_job(store, job_id)
}

pub fn recover_transcription_jobs(store: &ProjectStore) -> Result<usize, TranscriptionError> {
    let timestamp = now_ms()?;
    let ids = {
        let connection = store.connect()?;
        let mut statement = connection.prepare(
            "SELECT id FROM transcription_jobs
             WHERE status IN ('queued', 'extracting', 'transcribing', 'validating')",
        )?;
        statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?
    };
    let changed = store.connect()?.execute(
        "UPDATE transcription_jobs
         SET status = 'interrupted', stage = 'interrupted',
             error_code = 'app_interrupted',
             error_message = '应用退出前任务尚未完成，可以重新开始',
             updated_at_ms = ?1, completed_at_ms = ?1
         WHERE status IN ('queued', 'extracting', 'transcribing', 'validating')",
        params![timestamp],
    )?;
    for id in ids {
        let _ = remove_job_directory(store, &id);
    }
    Ok(changed)
}

fn validate_baseline(store: &ProjectStore, job: &StoredJob) -> Result<PathBuf, TranscriptionError> {
    let project = store.get_project(&job.public.project_id)?;
    if project.revision != job.expected_project_revision
        || project.media_source.id != job.source_media_id
        || !project.media_source.is_available
    {
        return Err(TranscriptionError::SourceChanged);
    }
    let media_path = PathBuf::from(project.media_source.locator);
    if !hash_file(&media_path)?.eq_ignore_ascii_case(&job.expected_media_sha256) {
        return Err(TranscriptionError::SourceChanged);
    }
    Ok(media_path)
}

fn verify_job_assets(
    job: &StoredJob,
) -> Result<(RuntimeBundle, ModelBundle, VadModelBundle), TranscriptionError> {
    let backend: &'static str = match job.public.runtime_backend.as_str() {
        "vulkan" => "vulkan",
        "cpu" => "cpu",
        value => {
            return Err(TranscriptionError::RuntimeIntegrity(format!(
                "任务记录了未知后端：{value}"
            )));
        }
    };
    let runtime = verify_runtime(backend)?;
    if runtime.executable != job.runtime_path
        || !runtime
            .executable_sha256
            .eq_ignore_ascii_case(&job.runtime_sha256)
        || !runtime
            .metadata_sha256
            .eq_ignore_ascii_case(&job.runtime_metadata_sha256)
        || runtime.version != job.public.runtime_version
    {
        return Err(TranscriptionError::RuntimeIntegrity(
            "任务固定的运行时身份与当前文件不一致".to_owned(),
        ));
    }
    let kind = TranscriptionModelKind::parse(&job.public.model_kind)?;
    let model = verify_model(kind)?;
    if model.path != job.model_path || !model.sha256.eq_ignore_ascii_case(&job.model_sha256) {
        return Err(TranscriptionError::ModelIntegrity(
            "任务固定的模型身份与当前文件不一致".to_owned(),
        ));
    }
    let parameters: serde_json::Value = serde_json::from_str(&job.parameters_json)?;
    if parameters.get("language").and_then(|value| value.as_str())
        != Some(job.public.language_code.as_str())
        || parameters.get("vad").and_then(|value| value.as_bool()) != Some(true)
        || parameters
            .get("vadTimelineDomain")
            .and_then(|value| value.as_str())
            != Some("original_media")
        || parameters
            .get("vadMinSilenceDurationMs")
            .and_then(|value| value.as_u64())
            != Some(250)
        || parameters
            .get("vadSpeechPadMs")
            .and_then(|value| value.as_u64())
            != Some(80)
    {
        return Err(TranscriptionError::InvalidOutput(
            "任务参数与固定转写基线不一致".to_owned(),
        ));
    }
    if !runtime.vad_timeline_verified {
        return Err(TranscriptionError::RuntimeIntegrity(
            "任务运行时没有通过 VAD 原媒体时间轴验证".to_owned(),
        ));
    }
    let vad_model = verify_vad_model()?;
    let recorded_vad_path = parameters
        .get("vadModelPath")
        .and_then(|value| value.as_str())
        .map(PathBuf::from);
    let recorded_vad_sha256 = parameters
        .get("vadModelSha256")
        .and_then(|value| value.as_str());
    if recorded_vad_path.as_deref() != Some(vad_model.path.as_path())
        || recorded_vad_sha256.is_none_or(|value| !value.eq_ignore_ascii_case(&vad_model.sha256))
    {
        return Err(TranscriptionError::ModelIntegrity(
            "任务固定的 VAD 模型身份与当前文件不一致".to_owned(),
        ));
    }
    Ok((runtime, model, vad_model))
}

pub(crate) fn run_job(
    store: &ProjectStore,
    job_id: &str,
    cancellation: &AtomicBool,
) -> Result<(), TranscriptionError> {
    let job = load_stored_job(store, job_id)?;
    if job.public.status != "queued" {
        return Err(TranscriptionError::InvalidJobState(job.public.status));
    }
    if job.cancel_requested_at_ms.is_some() || cancellation.load(Ordering::SeqCst) {
        return Err(TranscriptionError::Cancelled);
    }
    transition_job(
        store,
        job_id,
        "queued",
        "extracting",
        "extracting_audio",
        0.05,
    )?;
    let media_path = validate_baseline(store, &job)?;
    let (mut runtime, model, vad_model) = verify_job_assets(&job)?;
    let work_directory = reset_job_directory(store, job_id)?;
    let audio_path = work_directory.join("audio-16khz-mono.wav");
    let ffmpeg_log = work_directory.join("ffmpeg.log");
    let ffmpeg_path = media::ffmpeg_path()?;
    let mut extraction = hidden_command(&ffmpeg_path);
    extraction
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"])
        .arg(&media_path)
        .args([
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
        ])
        .arg(&audio_path);
    let extraction_status = run_child(store, job_id, cancellation, &mut extraction, &ffmpeg_log)?;
    if !extraction_status.success()
        || fs::metadata(&audio_path)
            .map(|metadata| metadata.len() <= 44)
            .unwrap_or(true)
    {
        return Err(TranscriptionError::AudioExtractionFailed(read_log_tail(
            &ffmpeg_log,
        )));
    }

    check_cancelled(store, job_id, cancellation)?;
    transition_job(
        store,
        job_id,
        "extracting",
        "transcribing",
        "transcribing",
        0.3,
    )?;
    let output_prefix = work_directory.join("whisper-result");
    let mut whisper_log = work_directory.join("whisper-vulkan.log");
    let mut transcription_status = run_whisper(
        store,
        job_id,
        cancellation,
        &runtime,
        &model,
        &vad_model,
        &audio_path,
        &job.public.language_code,
        &output_prefix,
        &whisper_log,
    )?;
    if !transcription_status.success() && runtime.backend == "vulkan" {
        check_cancelled(store, job_id, cancellation)?;
        let cpu_runtime = verify_runtime("cpu")?;
        update_job_runtime(store, job_id, &cpu_runtime)?;
        runtime = cpu_runtime;
        let _ = fs::remove_file(output_prefix.with_extension("json"));
        whisper_log = work_directory.join("whisper-cpu.log");
        transcription_status = run_whisper(
            store,
            job_id,
            cancellation,
            &runtime,
            &model,
            &vad_model,
            &audio_path,
            &job.public.language_code,
            &output_prefix,
            &whisper_log,
        )?;
    }
    let output_path = output_prefix.with_extension("json");
    if !transcription_status.success() || !output_path.is_file() {
        return Err(TranscriptionError::TranscriptionFailed(read_log_tail(
            &whisper_log,
        )));
    }

    check_cancelled(store, job_id, cancellation)?;
    transition_job(
        store,
        job_id,
        "transcribing",
        "validating",
        "validating_output",
        0.85,
    )?;
    let output_hash = hash_file(&output_path)?;
    let parsed = parse_whisper_output(
        &output_path,
        &job.public.language_code,
        job.media_duration_ms,
    )?;
    let report = subtitles::inspect_generated_cues(&parsed.cues, Some(job.media_duration_ms));
    if report.error_count > 0 {
        return Err(TranscriptionError::InvalidOutput(format!(
            "字幕预检包含 {} 项错误",
            report.error_count
        )));
    }
    check_cancelled(store, job_id, cancellation)?;
    validate_baseline(store, &job)?;
    let version = subtitles::persist_transcription(
        store,
        PersistTranscriptionInput {
            project_id: job.public.project_id.clone(),
            source_label: format!("本地转写 · {} · {}", job.public.model_kind, runtime.backend),
            source_sha256: output_hash,
            language_code: parsed.language_code,
            expected_project_revision: job.expected_project_revision,
            expected_media_sha256: job.expected_media_sha256.clone(),
            media_duration_ms: Some(job.media_duration_ms),
            cues: parsed.cues,
        },
    )?;
    let timestamp = now_ms()?;
    let changed = store.connect()?.execute(
        "UPDATE transcription_jobs
         SET status = 'completed', stage = 'completed', progress = 1.0,
             subtitle_version_id = ?2, error_code = NULL, error_message = NULL,
             cancel_requested_at_ms = NULL,
             updated_at_ms = ?3, completed_at_ms = ?3
         WHERE id = ?1 AND status = 'validating'",
        params![job_id, version.id, timestamp],
    )?;
    if changed != 1 {
        return Err(TranscriptionError::InvalidJobState(
            "完成写入时任务状态已变化".to_owned(),
        ));
    }
    remove_job_directory(store, job_id)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn run_whisper(
    store: &ProjectStore,
    job_id: &str,
    cancellation: &AtomicBool,
    runtime: &RuntimeBundle,
    model: &ModelBundle,
    vad_model: &VadModelBundle,
    audio_path: &Path,
    language_code: &str,
    output_prefix: &Path,
    log_path: &Path,
) -> Result<ExitStatus, TranscriptionError> {
    let mut whisper = hidden_command(&runtime.executable);
    whisper
        .current_dir(&runtime.directory)
        .arg("-m")
        .arg(&model.path)
        .arg("-f")
        .arg(audio_path)
        .args(["-ojf", "-sow", "-ml", "60"])
        .args(["--vad", "-vm"])
        .arg(&vad_model.path)
        .args([
            "--vad-min-silence-duration-ms",
            "250",
            "--vad-speech-pad-ms",
            "80",
            "-l",
        ])
        .arg(language_code)
        .arg("-of")
        .arg(output_prefix);
    run_child(store, job_id, cancellation, &mut whisper, log_path)
}

fn update_job_runtime(
    store: &ProjectStore,
    job_id: &str,
    runtime: &RuntimeBundle,
) -> Result<(), TranscriptionError> {
    let timestamp = now_ms()?;
    let changed = store.connect()?.execute(
        "UPDATE transcription_jobs
         SET runtime_path = ?2, runtime_backend = ?3, runtime_version = ?4,
             runtime_sha256 = ?5, runtime_metadata_sha256 = ?6,
             stage = 'transcribing_cpu_fallback', updated_at_ms = ?7
         WHERE id = ?1 AND status = 'transcribing'
           AND cancel_requested_at_ms IS NULL",
        params![
            job_id,
            runtime.executable.to_string_lossy(),
            runtime.backend,
            runtime.version,
            runtime.executable_sha256,
            runtime.metadata_sha256,
            timestamp,
        ],
    )?;
    if changed == 1 {
        Ok(())
    } else if cancellation_requested(store, job_id)? {
        Err(TranscriptionError::Cancelled)
    } else {
        Err(TranscriptionError::InvalidJobState(
            "切换 CPU 转写后端时任务状态已变化".to_owned(),
        ))
    }
}

fn transition_job(
    store: &ProjectStore,
    job_id: &str,
    expected_status: &str,
    status: &str,
    stage: &str,
    progress: f64,
) -> Result<(), TranscriptionError> {
    let timestamp = now_ms()?;
    let changed = store.connect()?.execute(
        "UPDATE transcription_jobs
         SET status = ?3, stage = ?4, progress = ?5, updated_at_ms = ?6,
             started_at_ms = COALESCE(started_at_ms, ?6)
         WHERE id = ?1 AND status = ?2 AND cancel_requested_at_ms IS NULL",
        params![job_id, expected_status, status, stage, progress, timestamp],
    )?;
    if changed != 1 {
        let job = load_stored_job(store, job_id)?;
        if job.cancel_requested_at_ms.is_some() {
            Err(TranscriptionError::Cancelled)
        } else {
            Err(TranscriptionError::InvalidJobState(job.public.status))
        }
    } else {
        Ok(())
    }
}

fn cancellation_requested(store: &ProjectStore, job_id: &str) -> Result<bool, TranscriptionError> {
    store
        .connect()?
        .query_row(
            "SELECT cancel_requested_at_ms IS NOT NULL
             FROM transcription_jobs WHERE id = ?1",
            params![job_id],
            |row| row.get::<_, bool>(0),
        )
        .optional()?
        .ok_or_else(|| TranscriptionError::JobNotFound(job_id.to_owned()))
}

fn check_cancelled(
    store: &ProjectStore,
    job_id: &str,
    cancellation: &AtomicBool,
) -> Result<(), TranscriptionError> {
    if cancellation.load(Ordering::SeqCst) || cancellation_requested(store, job_id)? {
        Err(TranscriptionError::Cancelled)
    } else {
        Ok(())
    }
}

fn run_child(
    store: &ProjectStore,
    job_id: &str,
    cancellation: &AtomicBool,
    command: &mut Command,
    log_path: &Path,
) -> Result<ExitStatus, TranscriptionError> {
    let log = File::create(log_path)?;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone()?))
        .stderr(Stdio::from(log));
    let mut child = command.spawn()?;
    let mut process_group = ProcessGroup::assign(&child)?;
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        if cancellation.load(Ordering::SeqCst) || cancellation_requested(store, job_id)? {
            process_group.terminate();
            let _ = child.wait();
            return Err(TranscriptionError::Cancelled);
        }
        thread::sleep(POLL_INTERVAL);
    }
}

#[cfg(windows)]
struct ProcessGroup {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
impl ProcessGroup {
    fn assign(child: &Child) -> Result<Self, TranscriptionError> {
        use std::{mem, os::windows::io::AsRawHandle, ptr};
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
                SetInformationJobObject,
            },
        };
        let handle = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
        if handle.is_null() {
            return Err(TranscriptionError::FileSystem(
                std::io::Error::last_os_error(),
            ));
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            unsafe { CloseHandle(handle) };
            return Err(TranscriptionError::FileSystem(
                std::io::Error::last_os_error(),
            ));
        }
        let assigned = unsafe { AssignProcessToJobObject(handle, child.as_raw_handle() as _) };
        if assigned == 0 {
            unsafe { CloseHandle(handle) };
            return Err(TranscriptionError::FileSystem(
                std::io::Error::last_os_error(),
            ));
        }
        Ok(Self { handle })
    }

    fn terminate(&mut self) {
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;
        unsafe {
            TerminateJobObject(self.handle, 1);
        }
    }
}

#[cfg(windows)]
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

#[cfg(not(windows))]
struct ProcessGroup;

#[cfg(not(windows))]
impl ProcessGroup {
    fn assign(_child: &Child) -> Result<Self, TranscriptionError> {
        Ok(Self)
    }

    fn terminate(&mut self) {}
}

fn read_log_tail(path: &Path) -> String {
    let Ok(value) = fs::read_to_string(path) else {
        return "没有可用的运行日志".to_owned();
    };
    let tail = value.chars().rev().take(2_000).collect::<String>();
    tail.chars().rev().collect::<String>().trim().to_owned()
}

fn job_directory(store: &ProjectStore, job_id: &str) -> Result<PathBuf, TranscriptionError> {
    Uuid::parse_str(job_id).map_err(|_| TranscriptionError::JobNotFound(job_id.to_owned()))?;
    Ok(store
        .data_directory()
        .join("transcription-jobs")
        .join(job_id))
}

fn reset_job_directory(store: &ProjectStore, job_id: &str) -> Result<PathBuf, TranscriptionError> {
    remove_job_directory(store, job_id)?;
    let directory = job_directory(store, job_id)?;
    fs::create_dir_all(&directory)?;
    Ok(directory)
}

fn remove_job_directory(store: &ProjectStore, job_id: &str) -> Result<(), TranscriptionError> {
    let directory = job_directory(store, job_id)?;
    if directory.exists() {
        fs::remove_dir_all(directory)?;
    }
    Ok(())
}

fn finish_with_error(
    store: &ProjectStore,
    job_id: &str,
    error: &TranscriptionError,
) -> Result<(), TranscriptionError> {
    if matches!(error, TranscriptionError::Cancelled) {
        mark_cancelled(store, job_id)?;
    } else {
        let timestamp = now_ms()?;
        store.connect()?.execute(
            "UPDATE transcription_jobs
             SET status = 'failed', stage = 'failed',
                 error_code = ?2, error_message = ?3,
                 updated_at_ms = ?4, completed_at_ms = ?4
             WHERE id = ?1
               AND status IN ('queued', 'extracting', 'transcribing', 'validating')",
            params![job_id, error_code(error), error.to_string(), timestamp],
        )?;
    }
    let _ = remove_job_directory(store, job_id);
    Ok(())
}

fn mark_cancelled(store: &ProjectStore, job_id: &str) -> Result<(), TranscriptionError> {
    let timestamp = now_ms()?;
    store.connect()?.execute(
        "UPDATE transcription_jobs
         SET status = 'cancelled', stage = 'cancelled',
             error_code = 'cancelled', error_message = '转写任务已取消',
             updated_at_ms = ?2, completed_at_ms = ?2
         WHERE id = ?1
           AND status IN ('queued', 'extracting', 'transcribing', 'validating')",
        params![job_id, timestamp],
    )?;
    let _ = remove_job_directory(store, job_id);
    Ok(())
}

fn error_code(error: &TranscriptionError) -> &'static str {
    match error {
        TranscriptionError::RuntimeUnavailable(_) => "runtime_unavailable",
        TranscriptionError::RuntimeIntegrity(_) => "runtime_integrity",
        TranscriptionError::ModelUnavailable(_) => "model_unavailable",
        TranscriptionError::ModelIntegrity(_) => "model_integrity",
        TranscriptionError::MissingAudio => "missing_audio",
        TranscriptionError::SourceChanged => "source_changed",
        TranscriptionError::AudioExtractionFailed(_) => "audio_extraction_failed",
        TranscriptionError::TranscriptionFailed(_) => "transcription_failed",
        TranscriptionError::InvalidOutput(_) => "invalid_output",
        TranscriptionError::Cancelled => "cancelled",
        TranscriptionError::FileSystem(_) => "filesystem_error",
        TranscriptionError::Store(_) => "database_error",
        TranscriptionError::Media(_) => "media_error",
        TranscriptionError::Subtitle(_) => "subtitle_error",
        TranscriptionError::Serialization(_) => "serialization_error",
        TranscriptionError::InvalidLanguage(_)
        | TranscriptionError::InvalidModel(_)
        | TranscriptionError::ReplaceConfirmationRequired
        | TranscriptionError::ActiveJobExists
        | TranscriptionError::JobNotFound(_)
        | TranscriptionError::InvalidJobState(_) => "validation_error",
    }
}

#[derive(Debug, Deserialize)]
struct WhisperOutput {
    result: WhisperResult,
    transcription: Vec<WhisperSegment>,
}

#[derive(Debug, Deserialize)]
struct WhisperResult {
    language: String,
}

#[derive(Debug, Deserialize)]
struct WhisperSegment {
    offsets: WhisperOffsets,
    text: String,
    #[serde(default)]
    tokens: Vec<WhisperToken>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
struct WhisperOffsets {
    from: i64,
    to: i64,
}

#[derive(Debug, Deserialize)]
struct WhisperToken {
    text: String,
    offsets: WhisperOffsets,
    #[serde(default)]
    p: Option<f64>,
}

struct ParsedWhisperOutput {
    language_code: String,
    cues: Vec<GeneratedSubtitleCue>,
}

fn parse_whisper_output(
    path: &Path,
    expected_language: &str,
    media_duration_ms: i64,
) -> Result<ParsedWhisperOutput, TranscriptionError> {
    let bytes = fs::read(path)?;
    let output: WhisperOutput = serde_json::from_slice(&bytes).map_err(|error| {
        TranscriptionError::InvalidOutput(format!("Whisper JSON 无法解析：{error}"))
    })?;
    let detected_language = output.result.language.trim().to_ascii_lowercase();
    if detected_language.len() < 2
        || detected_language.len() > 12
        || !detected_language
            .chars()
            .all(|character| character.is_ascii_lowercase() || character == '-')
    {
        return Err(TranscriptionError::InvalidOutput(
            "Whisper 返回了无效的语言标识".to_owned(),
        ));
    }
    if expected_language != "auto" && detected_language != expected_language {
        return Err(TranscriptionError::InvalidOutput(format!(
            "Whisper 返回语言 {}，与已确认语言 {} 不一致",
            detected_language, expected_language
        )));
    }
    let mut generated = Vec::new();
    let mut confidence_sum = 0.0;
    let mut confidence_count = 0_usize;
    for segment in output.transcription {
        let text = segment.text.trim().to_owned();
        if text.is_empty() {
            continue;
        }
        if segment.offsets.from < 0
            || segment.offsets.to <= segment.offsets.from
            || segment.offsets.to > media_duration_ms + 500
        {
            return Err(TranscriptionError::InvalidOutput(
                "字幕段包含无效或越界时间戳".to_owned(),
            ));
        }
        let mut words = Vec::new();
        for token in segment.tokens {
            if is_special_token(&token.text) {
                continue;
            }
            let token_text = token.text.trim();
            if token_text.is_empty() {
                continue;
            }
            let start_ms = token.offsets.from.max(segment.offsets.from);
            let end_ms = token.offsets.to.min(segment.offsets.to);
            if start_ms < 0 || end_ms <= start_ms {
                continue;
            }
            let confidence = token.p.filter(|value| (0.0..=1.0).contains(value));
            if let Some(value) = confidence {
                confidence_sum += value;
                confidence_count += 1;
            }
            words.push(GeneratedSubtitleWord {
                start_ms,
                end_ms,
                text: token_text.to_owned(),
                confidence,
            });
        }
        let segment_confidence = if words.is_empty() {
            None
        } else {
            let values = words
                .iter()
                .filter_map(|word| word.confidence)
                .collect::<Vec<_>>();
            (!values.is_empty()).then(|| values.iter().sum::<f64>() / values.len() as f64)
        };
        generated.push(GeneratedSubtitleCue {
            cue: SubtitleCue {
                ordinal: generated.len() + 1,
                start_ms: segment.offsets.from,
                end_ms: segment.offsets.to,
                text,
                confidence: segment_confidence,
            },
            words,
        });
    }
    let visible_characters = generated
        .iter()
        .flat_map(|generated| generated.cue.text.chars())
        .filter(|character| !character.is_whitespace() && !character.is_ascii_punctuation())
        .count();
    let word_count = generated
        .iter()
        .map(|generated| generated.words.len())
        .sum::<usize>();
    if generated.is_empty()
        || generated
            .iter()
            .all(|generated| is_non_speech_caption(&generated.cue.text))
        || visible_characters < 2
        || word_count == 0
    {
        return Err(TranscriptionError::InvalidOutput(
            "没有检测到可信的语音字幕和词级时间戳".to_owned(),
        ));
    }
    if confidence_count == 0 || confidence_sum / (confidence_count as f64) < 0.05 {
        return Err(TranscriptionError::InvalidOutput(
            "语音 token 置信度不足，结果没有写入项目".to_owned(),
        ));
    }
    Ok(ParsedWhisperOutput {
        language_code: detected_language,
        cues: generated,
    })
}

fn is_special_token(value: &str) -> bool {
    let value = value.trim();
    value.starts_with("[_") && value.ends_with(']')
}

fn is_non_speech_caption(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    let wrapped = (value.starts_with('[') && value.ends_with(']'))
        || (value.starts_with('(') && value.ends_with(')'));
    wrapped
        && [
            "blank", "audio", "silence", "music", "applause", "noise", "静音", "音乐", "掌声",
            "無音", "音楽", "박수", "음악",
        ]
        .iter()
        .any(|marker| value.contains(marker))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::CreateLocalProjectInput;
    use tempfile::TempDir;

    fn store_with_media() -> (TempDir, ProjectStore, String) {
        let temp = tempfile::tempdir().expect("temp directory should work");
        let media = temp.path().join("sample.mp4");
        fs::write(&media, b"media").expect("media fixture should be written");
        let store = ProjectStore::open(temp.path().join("data/projects/siaovplay.db"))
            .expect("store should open");
        let project = store
            .create_local_project(CreateLocalProjectInput {
                media_path: media.to_string_lossy().into_owned(),
                title: None,
            })
            .expect("project should be created");
        (temp, store, project.id)
    }

    #[test]
    fn bundled_runtime_is_discovered_from_executable_ancestors() {
        let temp = tempfile::tempdir().expect("temp directory should work");
        let executable = temp.path().join("app").join("bin").join("SiaoVPlay.exe");
        let bundled_runtime = temp
            .path()
            .join("app")
            .join("resources")
            .join("runtimes")
            .join("whisper");
        fs::create_dir_all(&bundled_runtime).expect("runtime fixture should be created");

        let resolved = resolve_runtime_directory("cpu", None, Some(&executable))
            .expect("bundled runtime should be discovered");

        assert_eq!(resolved, bundled_runtime);
    }

    #[test]
    fn bundled_model_is_discovered_from_executable_ancestors() {
        let temp = tempfile::tempdir().expect("temp directory should work");
        let executable = temp.path().join("app").join("bin").join("SiaoVPlay.exe");
        let bundled_model = temp
            .path()
            .join("app")
            .join("models")
            .join("whisper")
            .join("ggml-small.bin");
        fs::create_dir_all(
            bundled_model
                .parent()
                .expect("model fixture should have a parent"),
        )
        .expect("model directory should be created");
        fs::write(&bundled_model, b"model").expect("model fixture should be written");

        let resolved = resolve_model_path(TranscriptionModelKind::Small, None, Some(&executable))
            .expect("bundled model should be discovered");

        assert_eq!(resolved, bundled_model);
    }

    #[test]
    fn bundled_vad_model_is_discovered_from_cpu_runtime() {
        let temp = tempfile::tempdir().expect("temp directory should work");
        let executable = temp.path().join("app").join("bin").join("SiaoVPlay.exe");
        let cpu_runtime = temp.path().join("app").join("runtimes").join("whisper");
        let vad_model = cpu_runtime.join(VAD_MODEL_FILE_NAME);
        fs::create_dir_all(&cpu_runtime).expect("runtime fixture should be created");
        fs::write(&vad_model, b"vad").expect("VAD fixture should be written");

        let resolved = resolve_vad_model_path(None, Some(&executable), Some(&cpu_runtime))
            .expect("bundled VAD model should be discovered");

        assert_eq!(resolved, vad_model);
    }

    #[test]
    fn configured_roots_take_precedence_over_bundled_candidates() {
        let temp = tempfile::tempdir().expect("temp directory should work");
        let executable = temp.path().join("app").join("SiaoVPlay.exe");
        let runtime_root = temp.path().join("configured-runtimes");
        let runtime = runtime_root.join("whisper-vulkan");
        fs::create_dir_all(&runtime).expect("runtime fixture should be created");
        let model_root = temp.path().join("configured-models");
        let model = model_root.join("whisper").join("ggml-base.bin");
        fs::create_dir_all(model.parent().expect("model fixture should have a parent"))
            .expect("model directory should be created");
        fs::write(&model, b"model").expect("model fixture should be written");

        assert_eq!(
            resolve_runtime_directory("vulkan", Some(&runtime_root), Some(&executable))
                .expect("configured runtime should be discovered"),
            runtime
        );
        assert_eq!(
            resolve_model_path(
                TranscriptionModelKind::Base,
                Some(&model_root),
                Some(&executable)
            )
            .expect("configured model should be discovered"),
            model
        );
    }

    #[test]
    fn parser_keeps_segments_and_word_timestamps() {
        let temp = tempfile::tempdir().expect("temp directory should work");
        let path = temp.path().join("result.json");
        fs::write(
            &path,
            r#"{
                "result":{"language":"ja"},
                "transcription":[{
                    "offsets":{"from":0,"to":1500},
                    "text":" こんにちは ",
                    "tokens":[
                        {"text":"[_BEG_]","offsets":{"from":0,"to":0},"p":0.9},
                        {"text":"こん","offsets":{"from":50,"to":700},"p":0.8},
                        {"text":"にちは","offsets":{"from":700,"to":1400},"p":0.9}
                    ]
                }]
            }"#,
        )
        .expect("fixture should be written");

        let parsed = parse_whisper_output(&path, "ja", 2_000).expect("output should parse");

        assert_eq!(parsed.language_code, "ja");
        assert_eq!(parsed.cues.len(), 1);
        assert_eq!(parsed.cues[0].cue.text, "こんにちは");
        assert_eq!(parsed.cues[0].words.len(), 2);
        assert_eq!(parsed.cues[0].words[0].start_ms, 50);
    }

    #[test]
    fn parser_accepts_detected_language_for_auto_mode() {
        let temp = tempfile::tempdir().expect("temp directory should work");
        let path = temp.path().join("result.json");
        fs::write(
            &path,
            r#"{
                "result":{"language":"zh"},
                "transcription":[{
                    "offsets":{"from":0,"to":900},
                    "text":"这是中文讲解",
                    "tokens":[
                        {"text":"这是","offsets":{"from":50,"to":400},"p":0.8},
                        {"text":"中文讲解","offsets":{"from":400,"to":850},"p":0.9}
                    ]
                }]
            }"#,
        )
        .expect("fixture should be written");

        let parsed = parse_whisper_output(&path, "auto", 1_000)
            .expect("auto mode should retain the detected language");

        assert_eq!(parsed.language_code, "zh");
        assert_eq!(parsed.cues.len(), 1);
    }

    #[test]
    fn parser_rejects_language_mismatch_and_empty_speech() {
        let temp = tempfile::tempdir().expect("temp directory should work");
        let path = temp.path().join("result.json");
        fs::write(&path, r#"{"result":{"language":"en"},"transcription":[]}"#)
            .expect("fixture should be written");
        assert!(matches!(
            parse_whisper_output(&path, "ko", 1_000),
            Err(TranscriptionError::InvalidOutput(_))
        ));

        fs::write(
            &path,
            r#"{
                "result":{"language":"en"},
                "transcription":[{
                    "offsets":{"from":0,"to":900},
                    "text":"[BLANK_AUDIO]",
                    "tokens":[
                        {"text":"[BLANK_AUDIO]","offsets":{"from":50,"to":800},"p":0.9}
                    ]
                }]
            }"#,
        )
        .expect("fixture should be written");
        assert!(matches!(
            parse_whisper_output(&path, "en", 1_000),
            Err(TranscriptionError::InvalidOutput(_))
        ));
    }

    #[test]
    fn recovery_marks_incomplete_jobs_as_interrupted() {
        let (_temp, store, project_id) = store_with_media();
        let timestamp = now_ms().expect("timestamp should work");
        store
            .connect()
            .expect("database should connect")
            .execute(
                "INSERT INTO transcription_jobs (
                    id, project_id, source_media_id, status, stage, progress,
                    language_code, model_kind, model_path, model_sha256,
                    runtime_path, runtime_backend, runtime_version, runtime_sha256,
                    runtime_metadata_sha256, parameters_json,
                    expected_project_revision, expected_media_sha256, media_duration_ms,
                    confirm_replace_original, created_at_ms, updated_at_ms
                 )
                 SELECT
                    ?1, p.id, m.id, 'transcribing', 'transcribing', 0.5,
                    'en', 'small', 'model', ?2,
                    'runtime', 'cpu', '1.9.1-siaocut.1', ?2,
                    ?2, '{}', p.revision, ?2, 1000,
                    0, ?3, ?3
                 FROM projects p
                 JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
                 WHERE p.id = ?4",
                params![
                    Uuid::new_v4().to_string(),
                    "a".repeat(64),
                    timestamp,
                    project_id
                ],
            )
            .expect("job should be inserted");

        assert_eq!(
            recover_transcription_jobs(&store).expect("recovery should work"),
            1
        );
        let jobs = list_transcription_jobs(&store, &project_id).expect("jobs should be listed");
        assert_eq!(jobs[0].status, "interrupted");
        assert_eq!(jobs[0].error_code.as_deref(), Some("app_interrupted"));
    }

    #[test]
    fn queued_job_can_be_cancelled_without_starting_a_worker() {
        let (_temp, store, project_id) = store_with_media();
        let timestamp = now_ms().expect("timestamp should work");
        let job_id = Uuid::new_v4().to_string();
        store
            .connect()
            .expect("database should connect")
            .execute(
                "INSERT INTO transcription_jobs (
                    id, project_id, source_media_id, status, stage, progress,
                    language_code, model_kind, model_path, model_sha256,
                    runtime_path, runtime_backend, runtime_version, runtime_sha256,
                    runtime_metadata_sha256, parameters_json,
                    expected_project_revision, expected_media_sha256, media_duration_ms,
                    confirm_replace_original, created_at_ms, updated_at_ms
                 )
                 SELECT
                    ?1, p.id, m.id, 'queued', 'queued', 0.0,
                    'en', 'small', 'model', ?2,
                    'runtime', 'cpu', '1.9.1-siaocut.1', ?2,
                    ?2, '{}', p.revision, ?2, 1000,
                    0, ?3, ?3
                 FROM projects p
                 JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
                 WHERE p.id = ?4",
                params![job_id, "a".repeat(64), timestamp, project_id],
            )
            .expect("job should be inserted");

        let cancelled = cancel_transcription_job(&store, &job_id).expect("job should cancel");

        assert_eq!(cancelled.status, "cancelled");
        assert_eq!(cancelled.stage, "cancelled");
        assert_eq!(cancelled.error_code.as_deref(), Some("cancelled"));
    }

    #[derive(Deserialize)]
    struct RealFixture {
        language: String,
        audio_path: String,
    }

    #[test]
    #[ignore = "requires the pinned W: Whisper/FFmpeg runtimes, models, and M1 fixture manifest"]
    fn real_four_language_media_transcribes_to_draft_subtitles() {
        let manifest_path = env::var_os("SIAOVPLAY_TRANSCRIPTION_FIXTURE_MANIFEST")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_TRANSCRIPTION_FIXTURE_MANIFEST must be set");
        let fixtures: Vec<RealFixture> =
            serde_json::from_slice(&fs::read(manifest_path).expect("fixture manifest should load"))
                .expect("fixture manifest should parse");
        let temp = tempfile::tempdir().expect("temp directory should work");
        let store = ProjectStore::open(temp.path().join("data/projects/siaovplay.db"))
            .expect("store should open");
        let ffmpeg = media::ffmpeg_path().expect("FFmpeg runtime should resolve");

        for language in ["en", "th", "ja", "ko"] {
            let fixture = fixtures
                .iter()
                .find(|fixture| fixture.language == language)
                .expect("each MVP language needs a fixture");
            let media_path = temp.path().join(format!("{language}.mp4"));
            let status = hidden_command(&ffmpeg)
                .args([
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:s=320x180:r=25",
                    "-i",
                ])
                .arg(&fixture.audio_path)
                .args(["-shortest", "-c:v", "mpeg4", "-q:v", "5", "-c:a", "aac"])
                .arg(&media_path)
                .status()
                .expect("fixture mux should launch");
            assert!(status.success(), "{language} fixture should mux");
            let project = store
                .create_local_project(CreateLocalProjectInput {
                    media_path: media_path.to_string_lossy().into_owned(),
                    title: Some(format!("{language} fixture")),
                })
                .expect("project should be created");
            let job = start_transcription(
                &store,
                StartTranscriptionInput {
                    project_id: project.id.clone(),
                    language_code: language.to_owned(),
                    model_kind: "small".to_owned(),
                    confirm_replace_original: false,
                },
            )
            .expect("job should be created");
            run_job(&store, &job.id, &AtomicBool::new(false))
                .expect("real transcription should complete");

            let completed = get_transcription_job(&store, &job.id).expect("job should be readable");
            assert_eq!(completed.status, "completed", "{language}");
            let versions = subtitles::list_subtitle_versions(&store, &project.id)
                .expect("subtitle should be readable");
            assert_eq!(versions.len(), 1, "{language}");
            assert_eq!(versions[0].status, "draft", "{language}");
            assert_eq!(versions[0].language_code, language, "{language}");
            assert!(!versions[0].segments.is_empty(), "{language}");
            assert!(
                versions[0]
                    .segments
                    .iter()
                    .any(|segment| !segment.words.is_empty()),
                "{language}"
            );
        }
    }

    #[test]
    #[ignore = "requires a caller-provided real media file and the pinned local transcription assets"]
    fn real_regression_media_transcribes_with_verified_vad() {
        let media_path = env::var_os("SIAOVPLAY_TRANSCRIPTION_REGRESSION_MEDIA")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_TRANSCRIPTION_REGRESSION_MEDIA must be set");
        let language_code = env::var("SIAOVPLAY_TRANSCRIPTION_REGRESSION_LANGUAGE")
            .unwrap_or_else(|_| "auto".to_owned());
        let temp = tempfile::tempdir().expect("temp directory should work");
        let store = ProjectStore::open(temp.path().join("data/projects/siaovplay.db"))
            .expect("store should open");
        let project = store
            .create_local_project(CreateLocalProjectInput {
                media_path: media_path.to_string_lossy().into_owned(),
                title: Some("real transcription regression".to_owned()),
            })
            .expect("project should be created");
        let job = start_transcription(
            &store,
            StartTranscriptionInput {
                project_id: project.id.clone(),
                language_code,
                model_kind: "small".to_owned(),
                confirm_replace_original: false,
            },
        )
        .expect("job should be created");
        store
            .connect()
            .expect("database should connect")
            .execute(
                "UPDATE transcription_jobs
                 SET status = 'failed', stage = 'failed', parameters_json = ?2,
                     error_code = 'invalid_output', error_message = 'legacy no-VAD failure'
                 WHERE id = ?1",
                params![
                    job.id,
                    serde_json::json!({
                        "language": job.language_code,
                        "vad": false
                    })
                    .to_string()
                ],
            )
            .expect("legacy failed job should be simulated");
        let resumed =
            resume_transcription_job(&store, &job.id).expect("legacy failed job should resume");
        assert_eq!(resumed.status, "queued");

        run_job(&store, &job.id, &AtomicBool::new(false))
            .expect("real transcription should complete");

        let completed = get_transcription_job(&store, &job.id).expect("job should be readable");
        assert_eq!(completed.status, "completed");
        let versions = subtitles::list_subtitle_versions(&store, &project.id)
            .expect("subtitle should be readable");
        assert_eq!(versions.len(), 1);
        assert!(!versions[0].segments.is_empty());
        assert!(
            versions[0]
                .segments
                .iter()
                .any(|segment| !segment.words.is_empty())
        );
    }

    #[test]
    #[ignore = "requires a persistent W: acceptance store and pinned local transcription assets"]
    fn transcribes_persistent_acceptance_project() {
        let store_path = env::var_os("SIAOVPLAY_TRANSCRIPTION_ACCEPTANCE_STORE")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_TRANSCRIPTION_ACCEPTANCE_STORE must be set");
        let project_id = env::var("SIAOVPLAY_TRANSCRIPTION_ACCEPTANCE_PROJECT_ID")
            .expect("SIAOVPLAY_TRANSCRIPTION_ACCEPTANCE_PROJECT_ID must be set");
        let language_code = env::var("SIAOVPLAY_TRANSCRIPTION_ACCEPTANCE_LANGUAGE")
            .expect("SIAOVPLAY_TRANSCRIPTION_ACCEPTANCE_LANGUAGE must be set");
        let evidence_path = env::var_os("SIAOVPLAY_TRANSCRIPTION_ACCEPTANCE_EVIDENCE")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_TRANSCRIPTION_ACCEPTANCE_EVIDENCE must be set");
        let store = ProjectStore::open(store_path).expect("acceptance store should open");
        recover_transcription_jobs(&store).expect("interrupted acceptance jobs should recover");

        let existing_source = subtitles::list_subtitle_versions(&store, &project_id)
            .expect("subtitle versions should be readable")
            .into_iter()
            .find(|version| version.role == "original" && version.is_current);
        let completed_job = if existing_source.is_some() {
            list_transcription_jobs(&store, &project_id)
                .expect("transcription jobs should be readable")
                .into_iter()
                .find(|job| job.status == "completed")
        } else {
            let resumable = list_transcription_jobs(&store, &project_id)
                .expect("transcription jobs should be readable")
                .into_iter()
                .find(|job| matches!(job.status.as_str(), "failed" | "cancelled" | "interrupted"));
            let job = if let Some(job) = resumable {
                resume_transcription_job(&store, &job.id)
                    .expect("acceptance transcription should resume")
            } else {
                start_transcription(
                    &store,
                    StartTranscriptionInput {
                        project_id: project_id.clone(),
                        language_code,
                        model_kind: "small".to_owned(),
                        confirm_replace_original: false,
                    },
                )
                .expect("acceptance transcription should start")
            };
            run_job(&store, &job.id, &AtomicBool::new(false))
                .expect("acceptance transcription should complete");
            Some(get_transcription_job(&store, &job.id).expect("completed job should be readable"))
        };
        let source = existing_source.unwrap_or_else(|| {
            subtitles::list_subtitle_versions(&store, &project_id)
                .expect("completed source subtitle should be readable")
                .into_iter()
                .find(|version| version.role == "original" && version.is_current)
                .expect("transcription should create a current original subtitle")
        });
        let word_count = source
            .segments
            .iter()
            .map(|segment| segment.words.len())
            .sum::<usize>();
        let evidence = serde_json::json!({
            "projectId": project_id,
            "jobId": completed_job.as_ref().map(|job| &job.id),
            "runtimeBackend": completed_job.as_ref().map(|job| &job.runtime_backend),
            "runtimeVersion": completed_job.as_ref().map(|job| &job.runtime_version),
            "requestedLanguage": completed_job.as_ref().map(|job| &job.language_code),
            "detectedLanguage": source.language_code,
            "sourceVersionId": source.id,
            "segmentCount": source.segments.len(),
            "wordCount": word_count,
            "firstStartMs": source.segments.first().map(|segment| segment.start_ms),
            "lastEndMs": source.segments.last().map(|segment| segment.end_ms),
            "samples": source.segments.iter().take(5).map(|segment| {
                serde_json::json!({
                    "startMs": segment.start_ms,
                    "endMs": segment.end_ms,
                    "text": segment.text
                })
            }).collect::<Vec<_>>()
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
}
