use std::{
    collections::HashMap,
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
    delivery::{
        DeliveryError, ExportSubtitlesInput, SubtitleExportFormat, SubtitleExportMode,
        export_subtitles,
    },
    media::{self, MediaError},
    store::{ProjectStore, StoreError},
};

const POLL_INTERVAL: Duration = Duration::from_millis(100);
const BURN_MANIFEST_FORMAT: &str = "siaovplay-subtitle-burn-v1";

static ACTIVE_BURN_JOBS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

#[derive(Debug, Error)]
pub enum SubtitleBurnError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Media(#[from] MediaError),
    #[error(transparent)]
    Delivery(#[from] DeliveryError),
    #[error("字幕烧录文件操作失败：{0}")]
    FileSystem(#[from] std::io::Error),
    #[error("当前项目已有进行中的字幕烧录任务")]
    ActiveJobExists,
    #[error("找不到字幕烧录任务：{0}")]
    JobNotFound(String),
    #[error("字幕烧录任务当前状态不允许此操作：{0}")]
    InvalidJobState(String),
    #[error("项目、媒体或字幕版本已经变化，不能继续烧录")]
    SourceChanged,
    #[error("字幕烧录使用的 FFmpeg 运行时已经变化")]
    RuntimeChanged,
    #[error("字幕烧录失败：{0}")]
    BurnFailed(String),
    #[error("字幕烧录任务已取消")]
    Cancelled,
    #[error("字幕烧录清单生成失败：{0}")]
    Serialization(#[from] serde_json::Error),
}

impl From<rusqlite::Error> for SubtitleBurnError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Store(StoreError::Database(error))
    }
}

impl SubtitleBurnError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Store(StoreError::ProjectNotFound(_)) => "project_not_found",
            Self::Store(StoreError::Validation(_)) => "validation_error",
            Self::Store(StoreError::UnsupportedSchema { .. }) => "unsupported_schema",
            Self::Store(StoreError::FileSystem(_)) | Self::FileSystem(_) => {
                if is_disk_full_error(self) {
                    "disk_full"
                } else {
                    "filesystem_error"
                }
            }
            Self::Store(_) => "database_error",
            Self::Media(MediaError::RuntimeUnavailable(_)) => "media_runtime_unavailable",
            Self::Media(MediaError::SourceChanged) | Self::SourceChanged => "burn_source_changed",
            Self::Media(_) => "media_validation_failed",
            Self::Delivery(error) => error.code(),
            Self::ActiveJobExists => "burn_job_active",
            Self::JobNotFound(_) => "burn_job_not_found",
            Self::InvalidJobState(_) => "burn_job_state_invalid",
            Self::RuntimeChanged => "burn_runtime_changed",
            Self::BurnFailed(message) if is_disk_full_message(message) => "disk_full",
            Self::BurnFailed(_) => "subtitle_burn_failed",
            Self::Cancelled => "subtitle_burn_cancelled",
            Self::Serialization(_) => "subtitle_burn_serialization_failed",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SubtitleBurnMode {
    Translation,
    Bilingual,
}

impl SubtitleBurnMode {
    fn as_database_value(self) -> &'static str {
        match self {
            Self::Translation => "translation",
            Self::Bilingual => "bilingual",
        }
    }

    fn from_database_value(value: &str) -> Result<Self, SubtitleBurnError> {
        match value {
            "translation" => Ok(Self::Translation),
            "bilingual" => Ok(Self::Bilingual),
            _ => Err(SubtitleBurnError::InvalidJobState(format!(
                "未知烧录模式：{value}"
            ))),
        }
    }

    fn export_mode(self) -> SubtitleExportMode {
        match self {
            Self::Translation => SubtitleExportMode::Translation,
            Self::Bilingual => SubtitleExportMode::Bilingual,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSubtitleBurnInput {
    pub project_id: String,
    pub mode: SubtitleBurnMode,
    pub source_version_id: Option<String>,
    pub translation_version_id: String,
    pub destination_directory: String,
    pub confirm_version_selection: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleBurnJobInput {
    pub job_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleBurnJob {
    pub id: String,
    pub project_id: String,
    pub status: String,
    pub stage: String,
    pub progress: f64,
    pub mode: SubtitleBurnMode,
    pub source_version_id: Option<String>,
    pub translation_version_id: String,
    pub output_path: Option<String>,
    pub manifest_path: Option<String>,
    pub output_sha256: Option<String>,
    pub runtime_version: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub started_at_ms: Option<i64>,
    pub completed_at_ms: Option<i64>,
}

#[derive(Clone, Debug)]
struct StoredBurnJob {
    public: SubtitleBurnJob,
    source_media_id: String,
    expected_project_revision: i64,
    expected_media_sha256: String,
    media_duration_ms: i64,
    destination_directory: PathBuf,
    intended_output_path: PathBuf,
    temporary_output_path: PathBuf,
    intended_manifest_path: PathBuf,
    subtitle_path: PathBuf,
    subtitle_sha256: String,
    runtime_path: PathBuf,
    runtime_sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SubtitleBurnManifest<'a> {
    format: &'static str,
    project_id: &'a str,
    project_title: &'a str,
    mode: SubtitleBurnMode,
    source_version_id: Option<&'a str>,
    translation_version_id: &'a str,
    source_media_sha256: &'a str,
    output_file: &'a str,
    output_file_sha256: &'a str,
    runtime_version: &'a str,
    runtime_sha256: &'a str,
    completed_at_ms: i64,
}

pub fn start_subtitle_burn(
    store: &ProjectStore,
    input: StartSubtitleBurnInput,
) -> Result<SubtitleBurnJob, SubtitleBurnError> {
    if !input.confirm_version_selection {
        return Err(SubtitleBurnError::Delivery(DeliveryError::InvalidExport(
            "烧录前必须确认字幕版本".to_owned(),
        )));
    }
    if input.translation_version_id.trim().is_empty() {
        return Err(SubtitleBurnError::Delivery(DeliveryError::InvalidExport(
            "缺少简体中文字幕版本".to_owned(),
        )));
    }
    let inspection = media::inspect_project_media(store, &input.project_id)?;
    let media_duration_ms = inspection
        .probe
        .duration_ms
        .filter(|duration| *duration > 0)
        .ok_or_else(|| SubtitleBurnError::BurnFailed("媒体没有可用的正时长".to_owned()))?;
    let project = store.get_project(&input.project_id)?;
    ensure_no_active_job(store, &project.id, None)?;
    let destination = canonical_destination(&input.destination_directory)?;
    let runtime = media::resolve_runtime()?;
    let runtime_path = runtime.ffmpeg().to_path_buf();
    let runtime_sha256 = hash_file(&runtime_path)?;
    let runtime_version = runtime.version().to_owned();
    let timestamp = now_ms()?;
    let job_id = Uuid::new_v4().to_string();
    let job_directory = reset_job_directory(store, &project.id, &job_id)?;
    let subtitle = match prepare_internal_subtitle(
        store,
        &project.id,
        input.mode,
        input.source_version_id.clone(),
        input.translation_version_id.clone(),
        &job_directory,
    ) {
        Ok(value) => value,
        Err(error) => {
            let _ = remove_job_directory(store, &project.id, &job_id);
            return Err(error);
        }
    };
    if !subtitle
        .media_sha256
        .eq_ignore_ascii_case(&inspection.source_sha256)
    {
        let _ = remove_job_directory(store, &project.id, &job_id);
        return Err(SubtitleBurnError::SourceChanged);
    }
    let suffix = Uuid::new_v4().simple().to_string();
    let output_file_name = format!(
        "SiaoVPlay-{}-{}-{}-{}.mp4",
        safe_file_stem(&project.title),
        input.mode.as_database_value(),
        timestamp,
        &suffix[..8],
    );
    let output_path = destination.join(&output_file_name);
    let temporary_output_path = destination.join(format!(".{output_file_name}.{job_id}.part.mp4"));
    let manifest_path = destination.join(format!("{output_file_name}.siaovplay.json"));

    let inserted = store.connect()?.execute(
        "INSERT INTO subtitle_burn_jobs (
            id, project_id, source_media_id, status, stage, progress, mode,
            source_version_id, translation_version_id,
            expected_project_revision, expected_media_sha256, media_duration_ms,
            destination_directory, output_path, temporary_output_path,
            manifest_path, output_sha256, subtitle_path, subtitle_sha256,
            runtime_path, runtime_version, runtime_sha256,
            cancel_requested_at_ms, error_code, error_message,
            created_at_ms, updated_at_ms, started_at_ms, completed_at_ms
         ) VALUES (
            ?1, ?2, ?3, 'queued', 'queued', 0.0, ?4,
            ?5, ?6,
            ?7, ?8, ?9,
            ?10, ?11, ?12,
            ?13, NULL, ?14, ?15,
            ?16, ?17, ?18,
            NULL, NULL, NULL,
            ?19, ?19, NULL, NULL
         )",
        params![
            job_id,
            project.id,
            inspection.media_source_id,
            input.mode.as_database_value(),
            subtitle.source_version_id,
            subtitle.translation_version_id,
            project.revision,
            inspection.source_sha256,
            media_duration_ms,
            path_to_string(&destination),
            path_to_string(&output_path),
            path_to_string(&temporary_output_path),
            path_to_string(&manifest_path),
            subtitle.file_path,
            subtitle.file_sha256,
            path_to_string(&runtime_path),
            runtime_version,
            runtime_sha256,
            timestamp,
        ],
    );
    if let Err(error) = inserted {
        let _ = remove_job_directory(store, &project.id, &job_id);
        if error
            .to_string()
            .contains("one_active_subtitle_burn_per_project")
        {
            return Err(SubtitleBurnError::ActiveJobExists);
        }
        return Err(error.into());
    }
    get_subtitle_burn_job(store, &job_id)
}

pub fn spawn_subtitle_burn_job(
    store: ProjectStore,
    job_id: String,
) -> Result<(), SubtitleBurnError> {
    let job = load_stored_job(&store, &job_id)?;
    if job.public.status != "queued" {
        return Err(SubtitleBurnError::InvalidJobState(job.public.status));
    }
    let cancellation = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = active_jobs()
            .lock()
            .map_err(|_| SubtitleBurnError::InvalidJobState("任务锁已损坏".to_owned()))?;
        if jobs.contains_key(&job_id) {
            return Err(SubtitleBurnError::ActiveJobExists);
        }
        jobs.insert(job_id.clone(), cancellation.clone());
    }
    let worker_job_id = job_id.clone();
    let failure_store = store.clone();
    let spawn_result = thread::Builder::new()
        .name(format!("subtitle-burn-{job_id}"))
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
            let error = SubtitleBurnError::FileSystem(error);
            let _ = finish_with_error(&failure_store, &job_id, &error);
            Err(error)
        }
    }
}

pub fn get_subtitle_burn_job(
    store: &ProjectStore,
    job_id: &str,
) -> Result<SubtitleBurnJob, SubtitleBurnError> {
    Ok(load_stored_job(store, job_id)?.public)
}

pub fn list_subtitle_burn_jobs(
    store: &ProjectStore,
    project_id: &str,
) -> Result<Vec<SubtitleBurnJob>, SubtitleBurnError> {
    store.get_project(project_id)?;
    let connection = store.connect()?;
    let mut statement = connection.prepare(
        "SELECT
            id, project_id, status, stage, progress, mode,
            source_version_id, translation_version_id,
            CASE WHEN status = 'completed' THEN output_path END,
            CASE WHEN status = 'completed' THEN manifest_path END,
            output_sha256, runtime_version, error_code, error_message,
            created_at_ms, updated_at_ms, started_at_ms, completed_at_ms
         FROM subtitle_burn_jobs
         WHERE project_id = ?1
         ORDER BY created_at_ms DESC, id DESC",
    )?;
    statement
        .query_map(params![project_id], map_public_job)?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(public_row)
        .collect()
}

pub fn cancel_subtitle_burn_job(
    store: &ProjectStore,
    job_id: &str,
) -> Result<SubtitleBurnJob, SubtitleBurnError> {
    let job = load_stored_job(store, job_id)?;
    if matches!(
        job.public.status.as_str(),
        "completed" | "failed" | "cancelled" | "interrupted"
    ) {
        return Err(SubtitleBurnError::InvalidJobState(job.public.status));
    }
    let timestamp = now_ms()?;
    store.connect()?.execute(
        "UPDATE subtitle_burn_jobs
         SET cancel_requested_at_ms = ?2, stage = 'cancelling', updated_at_ms = ?2
         WHERE id = ?1 AND status IN ('queued', 'running', 'validating')",
        params![job_id, timestamp],
    )?;
    if let Ok(jobs) = active_jobs().lock()
        && let Some(flag) = jobs.get(job_id)
    {
        flag.store(true, Ordering::SeqCst);
    }
    if job.public.status == "queued" {
        mark_cancelled(store, &job)?;
    }
    get_subtitle_burn_job(store, job_id)
}

pub fn cancel_project_subtitle_burn_jobs(
    store: &ProjectStore,
    project_id: &str,
) -> Result<usize, SubtitleBurnError> {
    let ids = {
        let connection = store.connect()?;
        let mut statement = connection.prepare(
            "SELECT id FROM subtitle_burn_jobs
             WHERE project_id = ?1
               AND status IN ('queued', 'running', 'validating')",
        )?;
        statement
            .query_map(params![project_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?
    };
    for id in &ids {
        let _ = cancel_subtitle_burn_job(store, id);
    }
    for _ in 0..100 {
        let active = store.connect()?.query_row(
            "SELECT COUNT(*) FROM subtitle_burn_jobs
             WHERE project_id = ?1
               AND status IN ('queued', 'running', 'validating')",
            params![project_id],
            |row| row.get::<_, i64>(0),
        )?;
        if active == 0 {
            return Ok(ids.len());
        }
        thread::sleep(POLL_INTERVAL);
    }
    Err(SubtitleBurnError::InvalidJobState(
        "取消字幕烧录任务超时，项目尚未删除".to_owned(),
    ))
}

pub fn resume_subtitle_burn_job(
    store: &ProjectStore,
    job_id: &str,
) -> Result<SubtitleBurnJob, SubtitleBurnError> {
    let job = load_stored_job(store, job_id)?;
    if !matches!(
        job.public.status.as_str(),
        "failed" | "cancelled" | "interrupted"
    ) {
        return Err(SubtitleBurnError::InvalidJobState(job.public.status));
    }
    validate_baseline(store, &job)?;
    let runtime = media::resolve_runtime()?;
    verify_runtime(&job, &runtime)?;
    ensure_no_active_job(store, &job.public.project_id, Some(job_id))?;
    let project = store.get_project(&job.public.project_id)?;
    let job_directory = reset_job_directory(store, &project.id, job_id)?;
    let subtitle = prepare_internal_subtitle(
        store,
        &project.id,
        job.public.mode,
        job.public.source_version_id.clone(),
        job.public.translation_version_id.clone(),
        &job_directory,
    )?;
    if !subtitle
        .media_sha256
        .eq_ignore_ascii_case(&job.expected_media_sha256)
    {
        return Err(SubtitleBurnError::SourceChanged);
    }
    let suffix = Uuid::new_v4().simple().to_string();
    let output_file_name = format!(
        "SiaoVPlay-{}-{}-{}-{}.mp4",
        safe_file_stem(&project.title),
        job.public.mode.as_database_value(),
        now_ms()?,
        &suffix[..8],
    );
    let output_path = job.destination_directory.join(&output_file_name);
    let temporary_output_path = job
        .destination_directory
        .join(format!(".{output_file_name}.{job_id}.part.mp4"));
    let manifest_path = job
        .destination_directory
        .join(format!("{output_file_name}.siaovplay.json"));
    let timestamp = now_ms()?;
    let changed = store.connect()?.execute(
        "UPDATE subtitle_burn_jobs
         SET status = 'queued', stage = 'queued', progress = 0.0,
             output_path = ?2, temporary_output_path = ?3, manifest_path = ?4,
             output_sha256 = NULL, subtitle_path = ?5, subtitle_sha256 = ?6,
             cancel_requested_at_ms = NULL, error_code = NULL, error_message = NULL,
             updated_at_ms = ?7, started_at_ms = NULL, completed_at_ms = NULL
         WHERE id = ?1 AND status IN ('failed', 'cancelled', 'interrupted')",
        params![
            job_id,
            path_to_string(&output_path),
            path_to_string(&temporary_output_path),
            path_to_string(&manifest_path),
            subtitle.file_path,
            subtitle.file_sha256,
            timestamp,
        ],
    )?;
    if changed != 1 {
        return Err(SubtitleBurnError::InvalidJobState(job.public.status));
    }
    get_subtitle_burn_job(store, job_id)
}

pub fn recover_subtitle_burn_jobs(store: &ProjectStore) -> Result<usize, SubtitleBurnError> {
    let jobs = load_active_jobs(store)?;
    let timestamp = now_ms()?;
    let changed = store.connect()?.execute(
        "UPDATE subtitle_burn_jobs
         SET status = 'interrupted', stage = 'interrupted',
             error_code = 'app_interrupted',
             error_message = '应用退出前烧录尚未完成，可以重新开始',
             updated_at_ms = ?1, completed_at_ms = ?1
         WHERE status IN ('queued', 'running', 'validating')",
        params![timestamp],
    )?;
    for job in jobs {
        remove_incomplete_outputs(&job);
        let _ = remove_job_directory(store, &job.public.project_id, &job.public.id);
    }
    Ok(changed)
}

fn run_job(
    store: &ProjectStore,
    job_id: &str,
    cancellation: &AtomicBool,
) -> Result<(), SubtitleBurnError> {
    transition_job(store, job_id, "queued", "running", "verifying", 0.02)?;
    let job = load_stored_job(store, job_id)?;
    let media_path = validate_baseline(store, &job)?;
    let runtime = media::resolve_runtime()?;
    verify_runtime(&job, &runtime)?;
    verify_subtitle(&job)?;
    check_cancelled(store, job_id, cancellation)?;
    if job.intended_output_path.exists() || job.intended_manifest_path.exists() {
        return Err(SubtitleBurnError::BurnFailed(
            "目标文件已经存在，请重新开始烧录".to_owned(),
        ));
    }
    remove_file_if_present(&job.temporary_output_path)?;
    remove_file_if_present(&temporary_manifest_path(&job))?;
    update_running_progress(store, job_id, "burning", 0.05)?;

    let job_directory = job_directory(store, &job.public.project_id, &job.public.id)?;
    let log_path = job_directory.join("ffmpeg.log");
    let progress_path = job_directory.join("progress.txt");
    remove_file_if_present(&progress_path)?;
    let subtitle_file_name = job
        .subtitle_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| SubtitleBurnError::BurnFailed("临时字幕文件名无效".to_owned()))?;
    let filter = format!(
        "subtitles={subtitle_file_name}:force_style='FontName=Microsoft YaHei,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=32,Alignment=2'"
    );
    let mut command = hidden_command(runtime.ffmpeg());
    command
        .current_dir(&job_directory)
        .args([
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "warning",
            "-n",
            "-i",
        ])
        .arg(&media_path)
        .args(["-map", "0:v:0", "-map", "0:a?", "-vf"])
        .arg(filter)
        .args([
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-max_muxing_queue_size",
            "1024",
            "-progress",
            "progress.txt",
            "-nostats",
        ])
        .arg(&job.temporary_output_path);
    let status = run_ffmpeg(
        store,
        &job,
        cancellation,
        &mut command,
        &log_path,
        &progress_path,
    )?;
    if !status.success() {
        return Err(SubtitleBurnError::BurnFailed(read_log_tail(&log_path)));
    }
    check_cancelled(store, job_id, cancellation)?;
    transition_job(store, job_id, "running", "validating", "validating", 0.96)?;
    media::validate_media_path(&job.temporary_output_path).map_err(|error| {
        SubtitleBurnError::BurnFailed(format!("生成的视频无法通过媒体检查：{error}"))
    })?;
    let output_sha256 = hash_file(&job.temporary_output_path)?;
    let project = store.get_project(&job.public.project_id)?;
    let completed_at_ms = now_ms()?;
    let output_file_name = job
        .intended_output_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| SubtitleBurnError::BurnFailed("输出文件名无效".to_owned()))?;
    let manifest = SubtitleBurnManifest {
        format: BURN_MANIFEST_FORMAT,
        project_id: &project.id,
        project_title: &project.title,
        mode: job.public.mode,
        source_version_id: job.public.source_version_id.as_deref(),
        translation_version_id: &job.public.translation_version_id,
        source_media_sha256: &job.expected_media_sha256,
        output_file: output_file_name,
        output_file_sha256: &output_sha256,
        runtime_version: &job.public.runtime_version,
        runtime_sha256: &job.runtime_sha256,
        completed_at_ms,
    };
    let temporary_manifest_path = temporary_manifest_path(&job);
    fs::write(
        &temporary_manifest_path,
        serde_json::to_vec_pretty(&manifest)?,
    )?;
    check_cancelled(store, job_id, cancellation)?;
    fs::rename(&job.temporary_output_path, &job.intended_output_path)?;
    if let Err(error) = fs::rename(&temporary_manifest_path, &job.intended_manifest_path) {
        let _ = fs::remove_file(&job.intended_output_path);
        return Err(error.into());
    }
    let changed = store.connect()?.execute(
        "UPDATE subtitle_burn_jobs
         SET status = 'completed', stage = 'completed', progress = 1.0,
             output_sha256 = ?2, updated_at_ms = ?3, completed_at_ms = ?3
         WHERE id = ?1 AND status = 'validating' AND cancel_requested_at_ms IS NULL",
        params![job_id, output_sha256, completed_at_ms],
    )?;
    if changed != 1 {
        let _ = fs::remove_file(&job.intended_output_path);
        let _ = fs::remove_file(&job.intended_manifest_path);
        return Err(SubtitleBurnError::InvalidJobState(
            "保存烧录完成状态时任务已经变化".to_owned(),
        ));
    }
    let _ = remove_job_directory(store, &job.public.project_id, job_id);
    Ok(())
}

fn run_ffmpeg(
    store: &ProjectStore,
    job: &StoredBurnJob,
    cancellation: &AtomicBool,
    command: &mut Command,
    log_path: &Path,
    progress_path: &Path,
) -> Result<ExitStatus, SubtitleBurnError> {
    let log = File::create(log_path)?;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone()?))
        .stderr(Stdio::from(log));
    let mut child = command.spawn()?;
    let mut process_group = ProcessGroup::assign(&child)?;
    let mut last_progress = 0.05_f64;
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        if cancellation.load(Ordering::SeqCst) || cancellation_requested(store, &job.public.id)? {
            process_group.terminate();
            let _ = child.wait();
            return Err(SubtitleBurnError::Cancelled);
        }
        if let Some(media_progress) = read_ffmpeg_progress(progress_path, job.media_duration_ms) {
            let progress = 0.05 + media_progress.clamp(0.0, 1.0) * 0.88;
            if progress >= last_progress + 0.01 {
                update_running_progress(store, &job.public.id, "burning", progress)?;
                last_progress = progress;
            }
        }
        thread::sleep(POLL_INTERVAL);
    }
}

fn read_ffmpeg_progress(path: &Path, duration_ms: i64) -> Option<f64> {
    let value = fs::read_to_string(path).ok()?;
    let out_time_us = value
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix("out_time_us="))
        .and_then(|value| value.parse::<i64>().ok())?;
    Some((out_time_us as f64 / 1_000.0) / duration_ms as f64)
}

fn validate_baseline(
    store: &ProjectStore,
    job: &StoredBurnJob,
) -> Result<PathBuf, SubtitleBurnError> {
    let project = store.get_project(&job.public.project_id)?;
    if project.revision != job.expected_project_revision
        || project.media_source.id != job.source_media_id
        || !project.media_source.is_available
        || project
            .media_source
            .source_sha256
            .as_deref()
            .is_some_and(|value| !value.eq_ignore_ascii_case(&job.expected_media_sha256))
    {
        return Err(SubtitleBurnError::SourceChanged);
    }
    let media_path = PathBuf::from(&project.media_source.locator);
    if !hash_file(&media_path)?.eq_ignore_ascii_case(&job.expected_media_sha256) {
        return Err(SubtitleBurnError::SourceChanged);
    }
    Ok(media_path)
}

fn verify_runtime(
    job: &StoredBurnJob,
    runtime: &media::MediaRuntime,
) -> Result<(), SubtitleBurnError> {
    let current_path = runtime.ffmpeg();
    let current_version = runtime.version();
    if current_path != job.runtime_path
        || current_version != job.public.runtime_version
        || !hash_file(current_path)?.eq_ignore_ascii_case(&job.runtime_sha256)
    {
        return Err(SubtitleBurnError::RuntimeChanged);
    }
    Ok(())
}

fn verify_subtitle(job: &StoredBurnJob) -> Result<(), SubtitleBurnError> {
    if !job.subtitle_path.is_file()
        || !hash_file(&job.subtitle_path)?.eq_ignore_ascii_case(&job.subtitle_sha256)
    {
        return Err(SubtitleBurnError::SourceChanged);
    }
    Ok(())
}

fn ensure_no_active_job(
    store: &ProjectStore,
    project_id: &str,
    except_job_id: Option<&str>,
) -> Result<(), SubtitleBurnError> {
    let active = store
        .connect()?
        .query_row(
            "SELECT 1 FROM subtitle_burn_jobs
             WHERE project_id = ?1
               AND (?2 IS NULL OR id <> ?2)
               AND status IN ('queued', 'running', 'validating')
             LIMIT 1",
            params![project_id, except_job_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if active {
        Err(SubtitleBurnError::ActiveJobExists)
    } else {
        Ok(())
    }
}

fn prepare_internal_subtitle(
    store: &ProjectStore,
    project_id: &str,
    mode: SubtitleBurnMode,
    source_version_id: Option<String>,
    translation_version_id: String,
    job_directory: &Path,
) -> Result<crate::delivery::SubtitleExport, SubtitleBurnError> {
    let exported = export_subtitles(
        store,
        ExportSubtitlesInput {
            project_id: project_id.to_owned(),
            mode: mode.export_mode(),
            format: SubtitleExportFormat::Srt,
            source_version_id,
            translation_version_id: Some(translation_version_id),
            destination_directory: path_to_string(job_directory),
            confirm_version_selection: true,
        },
    )?;
    let subtitle_path = job_directory.join("burn.srt");
    let manifest_path = job_directory.join("burn.srt.siaovplay.json");
    fs::rename(&exported.file_path, &subtitle_path)?;
    fs::rename(&exported.manifest_path, &manifest_path)?;
    Ok(crate::delivery::SubtitleExport {
        file_path: path_to_string(&subtitle_path),
        manifest_path: path_to_string(&manifest_path),
        ..exported
    })
}

fn load_active_jobs(store: &ProjectStore) -> Result<Vec<StoredBurnJob>, SubtitleBurnError> {
    let ids = {
        let connection = store.connect()?;
        let mut statement = connection.prepare(
            "SELECT id FROM subtitle_burn_jobs
             WHERE status IN ('queued', 'running', 'validating')",
        )?;
        statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?
    };
    ids.into_iter()
        .map(|id| load_stored_job(store, &id))
        .collect()
}

fn load_stored_job(store: &ProjectStore, job_id: &str) -> Result<StoredBurnJob, SubtitleBurnError> {
    let connection = store.connect()?;
    let row = connection
        .query_row(
            "SELECT
                id, project_id, status, stage, progress, mode,
                source_version_id, translation_version_id,
                CASE WHEN status = 'completed' THEN output_path END,
                CASE WHEN status = 'completed' THEN manifest_path END,
                output_sha256, runtime_version, error_code, error_message,
                created_at_ms, updated_at_ms, started_at_ms, completed_at_ms,
                source_media_id, expected_project_revision, expected_media_sha256,
                media_duration_ms, destination_directory, output_path,
                temporary_output_path, manifest_path, subtitle_path, subtitle_sha256,
                runtime_path, runtime_sha256
             FROM subtitle_burn_jobs
             WHERE id = ?1",
            params![job_id],
            map_stored_row,
        )
        .optional()?
        .ok_or_else(|| SubtitleBurnError::JobNotFound(job_id.to_owned()))?;
    stored_row(row)
}

type PublicJobRow = (
    String,
    String,
    String,
    String,
    f64,
    String,
    Option<String>,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    String,
    Option<String>,
    Option<String>,
    i64,
    i64,
    Option<i64>,
    Option<i64>,
);

type StoredJobRow = (
    PublicJobRow,
    String,
    i64,
    String,
    i64,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
);

fn map_public_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<PublicJobRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get(10)?,
        row.get(11)?,
        row.get(12)?,
        row.get(13)?,
        row.get(14)?,
        row.get(15)?,
        row.get(16)?,
        row.get(17)?,
    ))
}

fn public_row(row: PublicJobRow) -> Result<SubtitleBurnJob, SubtitleBurnError> {
    Ok(SubtitleBurnJob {
        id: row.0,
        project_id: row.1,
        status: row.2,
        stage: row.3,
        progress: row.4,
        mode: SubtitleBurnMode::from_database_value(&row.5)?,
        source_version_id: row.6,
        translation_version_id: row.7,
        output_path: row.8,
        manifest_path: row.9,
        output_sha256: row.10,
        runtime_version: row.11,
        error_code: row.12,
        error_message: row.13,
        created_at_ms: row.14,
        updated_at_ms: row.15,
        started_at_ms: row.16,
        completed_at_ms: row.17,
    })
}

fn map_stored_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredJobRow> {
    Ok((
        map_public_job(row)?,
        row.get(18)?,
        row.get(19)?,
        row.get(20)?,
        row.get(21)?,
        row.get(22)?,
        row.get(23)?,
        row.get(24)?,
        row.get(25)?,
        row.get(26)?,
        row.get(27)?,
        row.get(28)?,
        row.get(29)?,
    ))
}

fn stored_row(row: StoredJobRow) -> Result<StoredBurnJob, SubtitleBurnError> {
    Ok(StoredBurnJob {
        public: public_row(row.0)?,
        source_media_id: row.1,
        expected_project_revision: row.2,
        expected_media_sha256: row.3,
        media_duration_ms: row.4,
        destination_directory: PathBuf::from(row.5),
        intended_output_path: PathBuf::from(row.6),
        temporary_output_path: PathBuf::from(row.7),
        intended_manifest_path: PathBuf::from(row.8),
        subtitle_path: PathBuf::from(row.9),
        subtitle_sha256: row.10,
        runtime_path: PathBuf::from(row.11),
        runtime_sha256: row.12,
    })
}

fn transition_job(
    store: &ProjectStore,
    job_id: &str,
    expected_status: &str,
    status: &str,
    stage: &str,
    progress: f64,
) -> Result<(), SubtitleBurnError> {
    let timestamp = now_ms()?;
    let changed = store.connect()?.execute(
        "UPDATE subtitle_burn_jobs
         SET status = ?3, stage = ?4, progress = ?5, updated_at_ms = ?6,
             started_at_ms = COALESCE(started_at_ms, ?6)
         WHERE id = ?1 AND status = ?2 AND cancel_requested_at_ms IS NULL",
        params![job_id, expected_status, status, stage, progress, timestamp],
    )?;
    if changed == 1 {
        Ok(())
    } else if cancellation_requested(store, job_id)? {
        Err(SubtitleBurnError::Cancelled)
    } else {
        Err(SubtitleBurnError::InvalidJobState(
            get_subtitle_burn_job(store, job_id)?.status,
        ))
    }
}

fn update_running_progress(
    store: &ProjectStore,
    job_id: &str,
    stage: &str,
    progress: f64,
) -> Result<(), SubtitleBurnError> {
    let timestamp = now_ms()?;
    let changed = store.connect()?.execute(
        "UPDATE subtitle_burn_jobs
         SET stage = ?2, progress = ?3, updated_at_ms = ?4
         WHERE id = ?1 AND status = 'running' AND cancel_requested_at_ms IS NULL",
        params![job_id, stage, progress.clamp(0.0, 0.95), timestamp],
    )?;
    if changed == 1 {
        Ok(())
    } else if cancellation_requested(store, job_id)? {
        Err(SubtitleBurnError::Cancelled)
    } else {
        Err(SubtitleBurnError::InvalidJobState(
            get_subtitle_burn_job(store, job_id)?.status,
        ))
    }
}

fn cancellation_requested(store: &ProjectStore, job_id: &str) -> Result<bool, SubtitleBurnError> {
    store
        .connect()?
        .query_row(
            "SELECT cancel_requested_at_ms IS NOT NULL
             FROM subtitle_burn_jobs WHERE id = ?1",
            params![job_id],
            |row| row.get::<_, bool>(0),
        )
        .optional()?
        .ok_or_else(|| SubtitleBurnError::JobNotFound(job_id.to_owned()))
}

fn check_cancelled(
    store: &ProjectStore,
    job_id: &str,
    cancellation: &AtomicBool,
) -> Result<(), SubtitleBurnError> {
    if cancellation.load(Ordering::SeqCst) || cancellation_requested(store, job_id)? {
        Err(SubtitleBurnError::Cancelled)
    } else {
        Ok(())
    }
}

fn mark_cancelled(store: &ProjectStore, job: &StoredBurnJob) -> Result<(), SubtitleBurnError> {
    let timestamp = now_ms()?;
    store.connect()?.execute(
        "UPDATE subtitle_burn_jobs
         SET status = 'cancelled', stage = 'cancelled',
             error_code = 'subtitle_burn_cancelled',
             error_message = '字幕烧录任务已取消',
             updated_at_ms = ?2, completed_at_ms = ?2
         WHERE id = ?1 AND status = 'queued'",
        params![job.public.id, timestamp],
    )?;
    remove_incomplete_outputs(job);
    let _ = remove_job_directory(store, &job.public.project_id, &job.public.id);
    Ok(())
}

fn finish_with_error(
    store: &ProjectStore,
    job_id: &str,
    error: &SubtitleBurnError,
) -> Result<(), SubtitleBurnError> {
    let Ok(job) = load_stored_job(store, job_id) else {
        return Ok(());
    };
    if job.public.status == "completed" {
        return Ok(());
    }
    let timestamp = now_ms()?;
    let status = if matches!(error, SubtitleBurnError::Cancelled) {
        "cancelled"
    } else {
        "failed"
    };
    store.connect()?.execute(
        "UPDATE subtitle_burn_jobs
         SET status = ?2, stage = ?2, error_code = ?3, error_message = ?4,
             updated_at_ms = ?5, completed_at_ms = ?5
         WHERE id = ?1 AND status IN ('queued', 'running', 'validating')",
        params![job_id, status, error.code(), error.to_string(), timestamp],
    )?;
    remove_incomplete_outputs(&job);
    if status == "cancelled" {
        let _ = remove_job_directory(store, &job.public.project_id, job_id);
    }
    Ok(())
}

fn remove_incomplete_outputs(job: &StoredBurnJob) {
    let _ = remove_file_if_present(&job.temporary_output_path);
    let _ = remove_file_if_present(&temporary_manifest_path(job));
    let _ = remove_file_if_present(&job.intended_output_path);
    let _ = remove_file_if_present(&job.intended_manifest_path);
}

fn temporary_manifest_path(job: &StoredBurnJob) -> PathBuf {
    let file_name = job
        .intended_manifest_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("burn.siaovplay.json");
    job.intended_manifest_path
        .with_file_name(format!(".{file_name}.{}.part", job.public.id))
}

fn active_jobs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    ACTIVE_BURN_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn canonical_destination(value: &str) -> Result<PathBuf, SubtitleBurnError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(SubtitleBurnError::Delivery(DeliveryError::InvalidExport(
            "烧录视频保存位置不能为空".to_owned(),
        )));
    }
    let destination = dunce::canonicalize(value).map_err(|error| {
        SubtitleBurnError::Delivery(DeliveryError::InvalidExport(format!(
            "无法读取烧录视频保存位置：{error}"
        )))
    })?;
    if !destination.is_dir() {
        return Err(SubtitleBurnError::Delivery(DeliveryError::InvalidExport(
            "烧录视频保存位置不存在或不是文件夹".to_owned(),
        )));
    }
    Ok(destination)
}

fn safe_file_stem(value: &str) -> String {
    let value = value
        .chars()
        .map(|character| {
            if character.is_control() || r#"<>:"/\|?*"#.contains(character) {
                '-'
            } else {
                character
            }
        })
        .collect::<String>();
    let value = value.trim().trim_matches(['.', ' ']);
    let value = value.chars().take(60).collect::<String>();
    if value.is_empty() {
        "video".to_owned()
    } else {
        value
    }
}

fn job_directory(
    store: &ProjectStore,
    project_id: &str,
    job_id: &str,
) -> Result<PathBuf, SubtitleBurnError> {
    Uuid::parse_str(project_id)
        .map_err(|_| SubtitleBurnError::JobNotFound(project_id.to_owned()))?;
    Uuid::parse_str(job_id).map_err(|_| SubtitleBurnError::JobNotFound(job_id.to_owned()))?;
    Ok(store
        .data_directory()
        .join("subtitle-burn-jobs")
        .join(project_id)
        .join(job_id))
}

fn reset_job_directory(
    store: &ProjectStore,
    project_id: &str,
    job_id: &str,
) -> Result<PathBuf, SubtitleBurnError> {
    remove_job_directory(store, project_id, job_id)?;
    let directory = job_directory(store, project_id, job_id)?;
    fs::create_dir_all(&directory)?;
    Ok(directory)
}

fn remove_job_directory(
    store: &ProjectStore,
    project_id: &str,
    job_id: &str,
) -> Result<(), SubtitleBurnError> {
    let directory = job_directory(store, project_id, job_id)?;
    if directory.exists() {
        fs::remove_dir_all(directory)?;
    }
    Ok(())
}

fn remove_file_if_present(path: &Path) -> Result<(), std::io::Error> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn hash_file(path: &Path) -> Result<String, SubtitleBurnError> {
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

fn now_ms() -> Result<i64, SubtitleBurnError> {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| std::io::Error::other(error.to_string()))?
            .as_millis(),
    )
    .map_err(|_| SubtitleBurnError::FileSystem(std::io::Error::other("系统时间超出支持范围")))
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

fn read_log_tail(path: &Path) -> String {
    let Ok(value) = fs::read_to_string(path) else {
        return "没有可用的 FFmpeg 运行日志".to_owned();
    };
    let tail = value.chars().rev().take(3_000).collect::<String>();
    let tail = tail.chars().rev().collect::<String>().trim().to_owned();
    if tail.is_empty() {
        "FFmpeg 没有提供错误详情".to_owned()
    } else {
        tail
    }
}

fn is_disk_full_error(error: &SubtitleBurnError) -> bool {
    matches!(
        error,
        SubtitleBurnError::FileSystem(source) if source.raw_os_error() == Some(112)
    )
}

fn is_disk_full_message(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("no space left")
        || message.contains("not enough space")
        || message.contains("disk full")
        || message.contains("磁盘空间不足")
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(windows)]
struct ProcessGroup {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
impl ProcessGroup {
    fn assign(child: &Child) -> Result<Self, SubtitleBurnError> {
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
            return Err(std::io::Error::last_os_error().into());
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
            return Err(std::io::Error::last_os_error().into());
        }
        let assigned = unsafe { AssignProcessToJobObject(handle, child.as_raw_handle() as _) };
        if assigned == 0 {
            unsafe { CloseHandle(handle) };
            return Err(std::io::Error::last_os_error().into());
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
    fn assign(_child: &Child) -> Result<Self, SubtitleBurnError> {
        Ok(Self)
    }

    fn terminate(&mut self) {}
}

#[cfg(test)]
mod tests {
    use rusqlite::params;

    use super::*;
    use crate::domain::CreateLocalProjectInput;

    struct Fixture {
        _temporary: tempfile::TempDir,
        store: ProjectStore,
        project_id: String,
        source_media_id: String,
        media_sha256: String,
        source_version_id: String,
        translation_version_id: String,
        destination: PathBuf,
        runtime_path: PathBuf,
    }

    #[test]
    fn recovers_active_jobs_as_interrupted_and_removes_partial_outputs() {
        let fixture = fixture();
        let job_id = insert_job(&fixture, "running");
        let stored = load_stored_job(&fixture.store, &job_id).expect("job should load");
        fs::write(&stored.temporary_output_path, b"partial video")
            .expect("partial video should write");
        fs::write(temporary_manifest_path(&stored), b"partial manifest")
            .expect("partial manifest should write");
        fs::write(&stored.intended_output_path, b"uncommitted video")
            .expect("uncommitted output should write");
        fs::write(&stored.intended_manifest_path, b"uncommitted manifest")
            .expect("uncommitted output manifest should write");

        assert_eq!(
            recover_subtitle_burn_jobs(&fixture.store).expect("recovery should run"),
            1
        );
        let recovered = get_subtitle_burn_job(&fixture.store, &job_id).expect("job should recover");
        assert_eq!(recovered.status, "interrupted");
        assert_eq!(recovered.stage, "interrupted");
        assert_eq!(recovered.error_code.as_deref(), Some("app_interrupted"));
        assert!(!stored.temporary_output_path.exists());
        assert!(!temporary_manifest_path(&stored).exists());
        assert!(!stored.intended_output_path.exists());
        assert!(!stored.intended_manifest_path.exists());
        assert!(
            !job_directory(&fixture.store, &fixture.project_id, &job_id)
                .expect("job directory should resolve")
                .exists()
        );
    }

    #[test]
    fn cancels_a_queued_job_without_leaving_a_completed_looking_file() {
        let fixture = fixture();
        let job_id = insert_job(&fixture, "queued");
        let stored = load_stored_job(&fixture.store, &job_id).expect("job should load");
        fs::write(&stored.temporary_output_path, b"partial video")
            .expect("partial video should write");

        let cancelled =
            cancel_subtitle_burn_job(&fixture.store, &job_id).expect("job should cancel");
        assert_eq!(cancelled.status, "cancelled");
        assert_eq!(
            cancelled.error_code.as_deref(),
            Some("subtitle_burn_cancelled")
        );
        assert!(cancelled.output_path.is_none());
        assert!(!stored.temporary_output_path.exists());
        assert!(!stored.intended_output_path.exists());
        assert!(
            !job_directory(&fixture.store, &fixture.project_id, &job_id)
                .expect("job directory should resolve")
                .exists()
        );
    }

    #[test]
    fn classifies_disk_full_errors_for_actionable_ui_messages() {
        let error = SubtitleBurnError::FileSystem(std::io::Error::from_raw_os_error(112));
        assert_eq!(error.code(), "disk_full");
        let ffmpeg_error = SubtitleBurnError::BurnFailed("No space left on device".to_owned());
        assert_eq!(ffmpeg_error.code(), "disk_full");
    }

    #[test]
    #[ignore = "requires the real FFmpeg runtime and SIAOVPLAY_MEDIA_FIXTURE_DIR"]
    fn real_ffmpeg_burns_bilingual_subtitles_without_changing_the_source() {
        let fixture_directory = std::env::var_os("SIAOVPLAY_MEDIA_FIXTURE_DIR")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_MEDIA_FIXTURE_DIR must be set");
        let media_path = fixture_directory.join("h264-aac.mp4");
        let source_sha256_before = hash_file(&media_path).expect("source should hash");
        let temporary = tempfile::tempdir().expect("temporary directory should work");
        let store = ProjectStore::open(
            temporary
                .path()
                .join("data")
                .join("projects")
                .join("siaovplay.db"),
        )
        .expect("store should open");
        let project = store
            .create_local_project(CreateLocalProjectInput {
                media_path: path_to_string(&media_path),
                title: Some("Phase 5B real burn".to_owned()),
            })
            .expect("project should create");
        let inspection =
            media::inspect_project_media(&store, &project.id).expect("media should inspect");
        let duration_ms = inspection
            .probe
            .duration_ms
            .expect("fixture should have duration");
        let (source_version_id, translation_version_id) =
            insert_subtitle_fixture(&store, &project.id, &inspection.source_sha256, duration_ms);
        let destination = temporary.path().join("exports");
        fs::create_dir_all(&destination).expect("destination should create");
        let queued = start_subtitle_burn(
            &store,
            StartSubtitleBurnInput {
                project_id: project.id.clone(),
                mode: SubtitleBurnMode::Bilingual,
                source_version_id: Some(source_version_id),
                translation_version_id,
                destination_directory: path_to_string(&destination),
                confirm_version_selection: true,
            },
        )
        .expect("burn job should prepare");
        spawn_subtitle_burn_job(store.clone(), queued.id.clone())
            .expect("burn worker should start");

        let completed = wait_for_burn(&store, &queued.id);
        assert_eq!(
            completed.status, "completed",
            "burn failed: {:?}",
            completed.error_message
        );
        let output_path = PathBuf::from(
            completed
                .output_path
                .expect("output path should be returned"),
        );
        let manifest_path = PathBuf::from(
            completed
                .manifest_path
                .expect("manifest path should be returned"),
        );
        assert!(output_path.is_file());
        assert!(manifest_path.is_file());
        media::validate_media_path(&output_path).expect("output should be a playable video");
        assert_eq!(
            hash_file(&output_path).expect("output should hash"),
            completed.output_sha256.expect("output hash should persist")
        );
        let manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(manifest_path).expect("manifest should read"))
                .expect("manifest should parse");
        assert_eq!(manifest["format"], BURN_MANIFEST_FORMAT);
        assert_eq!(manifest["mode"], "bilingual");
        assert_eq!(
            hash_file(&media_path).expect("source should still hash"),
            source_sha256_before
        );
    }

    #[test]
    #[ignore = "requires the real FFmpeg runtime and SIAOVPLAY_MEDIA_FIXTURE_DIR"]
    fn real_media_delivers_all_subtitle_formats_and_burn_modes_after_restart() {
        let fixture_directory = std::env::var_os("SIAOVPLAY_MEDIA_FIXTURE_DIR")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_MEDIA_FIXTURE_DIR must be set");
        let media_path = fixture_directory.join("h264-aac.mp4");
        let source_sha256_before = hash_file(&media_path).expect("source should hash");
        let temporary = tempfile::tempdir().expect("temporary directory should work");
        let persistent_validation_directory =
            std::env::var_os("SIAOVPLAY_PERSIST_VALIDATION_DIR").map(PathBuf::from);
        let data_directory = persistent_validation_directory
            .clone()
            .unwrap_or_else(|| temporary.path().join("data"));
        let database_path = data_directory.join("projects").join("siaovplay.db");
        let store = ProjectStore::open(&database_path).expect("store should open");
        let project = store
            .create_local_project(CreateLocalProjectInput {
                media_path: path_to_string(&media_path),
                title: Some("Phase 5D 真实字幕交付".to_owned()),
            })
            .expect("project should create");
        let inspection =
            media::inspect_project_media(&store, &project.id).expect("media should inspect");
        let duration_ms = inspection
            .probe
            .duration_ms
            .expect("fixture should have duration");
        let (source_version_id, translation_version_id) =
            insert_subtitle_fixture(&store, &project.id, &inspection.source_sha256, duration_ms);
        let destination = data_directory.join("exports");
        fs::create_dir_all(&destination).expect("destination should create");

        for mode in [
            SubtitleExportMode::Original,
            SubtitleExportMode::Translation,
            SubtitleExportMode::Bilingual,
        ] {
            for format in [SubtitleExportFormat::Srt, SubtitleExportFormat::Vtt] {
                let exported = export_subtitles(
                    &store,
                    ExportSubtitlesInput {
                        project_id: project.id.clone(),
                        mode,
                        format,
                        source_version_id: if mode == SubtitleExportMode::Translation {
                            None
                        } else {
                            Some(source_version_id.clone())
                        },
                        translation_version_id: if mode == SubtitleExportMode::Original {
                            None
                        } else {
                            Some(translation_version_id.clone())
                        },
                        destination_directory: path_to_string(&destination),
                        confirm_version_selection: true,
                    },
                )
                .expect("subtitle should export");
                assert_eq!(exported.cue_count, 1);
                let file_path = PathBuf::from(&exported.file_path);
                let manifest_path = PathBuf::from(&exported.manifest_path);
                assert!(file_path.is_file());
                assert!(manifest_path.is_file());
                assert_eq!(
                    hash_file(&file_path).expect("subtitle should hash"),
                    exported.file_sha256
                );
                let text = fs::read_to_string(file_path).expect("subtitle should read");
                if format == SubtitleExportFormat::Vtt {
                    assert!(text.starts_with("WEBVTT\n\n"));
                }
                if mode != SubtitleExportMode::Translation {
                    assert!(text.contains("Meet me at the station."));
                }
                if mode != SubtitleExportMode::Original {
                    assert!(text.contains("在车站等我。"));
                }
            }
        }

        let mut completed_jobs = Vec::new();
        for mode in [SubtitleBurnMode::Translation, SubtitleBurnMode::Bilingual] {
            let queued = start_subtitle_burn(
                &store,
                StartSubtitleBurnInput {
                    project_id: project.id.clone(),
                    mode,
                    source_version_id: if mode == SubtitleBurnMode::Bilingual {
                        Some(source_version_id.clone())
                    } else {
                        None
                    },
                    translation_version_id: translation_version_id.clone(),
                    destination_directory: path_to_string(&destination),
                    confirm_version_selection: true,
                },
            )
            .expect("burn job should prepare");
            spawn_subtitle_burn_job(store.clone(), queued.id.clone())
                .expect("burn worker should start");
            let completed = wait_for_burn(&store, &queued.id);
            assert_eq!(
                completed.status, "completed",
                "burn failed: {:?}",
                completed.error_message
            );
            assert_real_burn_output(&completed, mode);
            completed_jobs.push(completed);
        }
        assert_ne!(
            completed_jobs[0].output_path, completed_jobs[1].output_path,
            "translation and bilingual burns must be separate files"
        );
        assert_eq!(
            hash_file(&media_path).expect("source should still hash"),
            source_sha256_before
        );

        drop(store);
        let reopened = ProjectStore::open(&database_path).expect("store should reopen");
        assert_eq!(
            recover_subtitle_burn_jobs(&reopened).expect("recovery should run"),
            0
        );
        let restored_jobs =
            list_subtitle_burn_jobs(&reopened, &project.id).expect("jobs should survive restart");
        assert_eq!(restored_jobs.len(), 2);
        assert!(restored_jobs.iter().all(|job| job.status == "completed"));
        assert!(restored_jobs.iter().all(|job| {
            job.output_path
                .as_ref()
                .is_some_and(|path| Path::new(path).is_file())
        }));
        let restored_project = reopened
            .get_project(&project.id)
            .expect("project should survive restart");
        assert_eq!(
            restored_project.media_source.locator,
            path_to_string(&media_path)
        );
        if persistent_validation_directory.is_some() {
            println!("persisted_project_id={}", project.id);
            println!(
                "persisted_data_directory={}",
                path_to_string(&data_directory)
            );
            println!(
                "persisted_export_directory={}",
                path_to_string(&destination)
            );
        }
    }

    fn wait_for_burn(store: &ProjectStore, job_id: &str) -> SubtitleBurnJob {
        for _ in 0..600 {
            let current = get_subtitle_burn_job(store, job_id).expect("job should remain readable");
            if matches!(
                current.status.as_str(),
                "completed" | "failed" | "cancelled" | "interrupted"
            ) {
                return current;
            }
            thread::sleep(POLL_INTERVAL);
        }
        panic!("burn should finish before timeout");
    }

    fn assert_real_burn_output(completed: &SubtitleBurnJob, mode: SubtitleBurnMode) {
        let output_path = PathBuf::from(
            completed
                .output_path
                .as_deref()
                .expect("output path should be returned"),
        );
        let manifest_path = PathBuf::from(
            completed
                .manifest_path
                .as_deref()
                .expect("manifest path should be returned"),
        );
        assert!(output_path.is_file());
        assert!(manifest_path.is_file());
        media::validate_media_path(&output_path).expect("output should be a playable video");
        assert_eq!(
            hash_file(&output_path).expect("output should hash"),
            completed
                .output_sha256
                .as_deref()
                .expect("output hash should persist")
        );
        let manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(manifest_path).expect("manifest should read"))
                .expect("manifest should parse");
        assert_eq!(manifest["format"], BURN_MANIFEST_FORMAT);
        assert_eq!(
            manifest["mode"],
            match mode {
                SubtitleBurnMode::Translation => "translation",
                SubtitleBurnMode::Bilingual => "bilingual",
            }
        );
    }

    fn fixture() -> Fixture {
        let temporary = tempfile::tempdir().expect("temporary directory should work");
        let media_path = temporary.path().join("fixture.mp4");
        fs::write(&media_path, b"burn-media-fixture").expect("media should write");
        let media_sha256 = hash_file(&media_path).expect("media should hash");
        let store = ProjectStore::open(
            temporary
                .path()
                .join("data")
                .join("projects")
                .join("siaovplay.db"),
        )
        .expect("store should open");
        let project = store
            .create_local_project(CreateLocalProjectInput {
                media_path: path_to_string(&media_path),
                title: Some("Burn recovery".to_owned()),
            })
            .expect("project should create");
        store
            .record_media_probe(
                &project.id,
                &project.media_source.id,
                &media_sha256,
                "{}",
                18,
                None,
            )
            .expect("media identity should persist");
        let (source_version_id, translation_version_id) =
            insert_subtitle_fixture(&store, &project.id, &media_sha256, 1_000);
        let destination = temporary.path().join("exports");
        fs::create_dir_all(&destination).expect("destination should create");
        let runtime_path = temporary.path().join("ffmpeg.exe");
        fs::write(&runtime_path, b"fake ffmpeg").expect("runtime should write");
        Fixture {
            _temporary: temporary,
            store,
            project_id: project.id,
            source_media_id: project.media_source.id,
            media_sha256,
            source_version_id,
            translation_version_id,
            destination,
            runtime_path,
        }
    }

    fn insert_subtitle_fixture(
        store: &ProjectStore,
        project_id: &str,
        media_sha256: &str,
        duration_ms: i64,
    ) -> (String, String) {
        let source_track_id = Uuid::new_v4().to_string();
        let source_version_id = Uuid::new_v4().to_string();
        let translation_track_id = Uuid::new_v4().to_string();
        let translation_version_id = Uuid::new_v4().to_string();
        let source_segment_id = Uuid::new_v4().to_string();
        let cue_end_ms = duration_ms.min(2_500);
        let preflight = serde_json::json!({
            "status": "ready",
            "segmentCount": 1,
            "errorCount": 0,
            "warningCount": 0,
            "firstStartMs": 0,
            "lastEndMs": cue_end_ms,
            "mediaDurationMs": duration_ms,
            "coverageRatio": cue_end_ms as f64 / duration_ms as f64,
            "issues": []
        })
        .to_string();
        let mut connection = store.connect().expect("connection should open");
        let transaction = connection.transaction().expect("transaction should start");
        transaction
            .execute(
                "INSERT INTO subtitle_tracks (
                    id, project_id, role, language_code, current_version_id,
                    created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, 'original', 'en', ?3, 1, 1)",
                params![source_track_id, project_id, source_version_id],
            )
            .expect("source track should insert");
        insert_version(
            &transaction,
            &source_version_id,
            &source_track_id,
            project_id,
            "ready",
            "imported_file",
            "en",
            media_sha256,
            &preflight,
        );
        transaction
            .execute(
                "INSERT INTO subtitle_tracks (
                    id, project_id, role, language_code, current_version_id,
                    created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, 'translation', 'zh-cn', ?3, 1, 1)",
                params![translation_track_id, project_id, translation_version_id],
            )
            .expect("translation track should insert");
        insert_version(
            &transaction,
            &translation_version_id,
            &translation_track_id,
            project_id,
            "draft",
            "agent_translation",
            "zh-cn",
            media_sha256,
            &preflight,
        );
        transaction
            .execute(
                "INSERT INTO subtitle_segments (
                    id, version_id, lineage_id, ordinal,
                    start_ms, end_ms, text, confidence, issue_kind
                 ) VALUES (?1, ?2, ?1, 0, 0, ?3, 'Meet me at the station.', NULL, NULL)",
                params![source_segment_id, source_version_id, cue_end_ms],
            )
            .expect("source segment should insert");
        transaction
            .execute(
                "INSERT INTO subtitle_segments (
                    id, version_id, lineage_id, source_segment_id, ordinal,
                    start_ms, end_ms, text, confidence, issue_kind
                 ) VALUES (?1, ?2, ?1, ?3, 0, 0, ?4, '在车站等我。', NULL, NULL)",
                params![
                    Uuid::new_v4().to_string(),
                    translation_version_id,
                    source_segment_id,
                    cue_end_ms
                ],
            )
            .expect("translation segment should insert");
        transaction.commit().expect("subtitles should commit");
        (source_version_id, translation_version_id)
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_version(
        transaction: &rusqlite::Transaction<'_>,
        version_id: &str,
        track_id: &str,
        project_id: &str,
        status: &str,
        source_kind: &str,
        language_code: &str,
        media_sha256: &str,
        preflight: &str,
    ) {
        transaction
            .execute(
                "INSERT INTO subtitle_versions (
                    id, track_id, project_id, version_number, status,
                    source_kind, source_label, source_sha256, media_sha256,
                    language_code, project_revision, preflight_json, created_at_ms
                 ) VALUES (?1, ?2, ?3, 1, ?4, ?5, 'fixture', ?6, ?7, ?8, 1, ?9, 1)",
                params![
                    version_id,
                    track_id,
                    project_id,
                    status,
                    source_kind,
                    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    media_sha256,
                    language_code,
                    preflight
                ],
            )
            .expect("version should insert");
    }

    fn insert_job(fixture: &Fixture, status: &str) -> String {
        let job_id = Uuid::new_v4().to_string();
        let directory = reset_job_directory(&fixture.store, &fixture.project_id, &job_id)
            .expect("job directory should create");
        let subtitle_path = directory.join("burn.srt");
        fs::write(&subtitle_path, b"1\n00:00:00,000 --> 00:00:01,000\nHello\n")
            .expect("subtitle should write");
        let subtitle_sha256 = hash_file(&subtitle_path).expect("subtitle should hash");
        let runtime_sha256 = hash_file(&fixture.runtime_path).expect("runtime should hash");
        let output_path = fixture.destination.join("output.mp4");
        let temporary_output_path = fixture.destination.join(".output.part.mp4");
        let manifest_path = fixture.destination.join("output.mp4.siaovplay.json");
        fixture
            .store
            .connect()
            .expect("connection should open")
            .execute(
                "INSERT INTO subtitle_burn_jobs (
                    id, project_id, source_media_id, status, stage, progress, mode,
                    source_version_id, translation_version_id,
                    expected_project_revision, expected_media_sha256, media_duration_ms,
                    destination_directory, output_path, temporary_output_path,
                    manifest_path, output_sha256, subtitle_path, subtitle_sha256,
                    runtime_path, runtime_version, runtime_sha256,
                    cancel_requested_at_ms, error_code, error_message,
                    created_at_ms, updated_at_ms, started_at_ms, completed_at_ms
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?4, 0.25, 'bilingual',
                    ?5, ?6, 1, ?7, 1000,
                    ?8, ?9, ?10, ?11, NULL, ?12, ?13,
                    ?14, 'test-runtime', ?15,
                    NULL, NULL, NULL, 1, 1, 1, NULL
                 )",
                params![
                    job_id,
                    fixture.project_id,
                    fixture.source_media_id,
                    status,
                    fixture.source_version_id,
                    fixture.translation_version_id,
                    fixture.media_sha256,
                    path_to_string(&fixture.destination),
                    path_to_string(&output_path),
                    path_to_string(&temporary_output_path),
                    path_to_string(&manifest_path),
                    path_to_string(&subtitle_path),
                    subtitle_sha256,
                    path_to_string(&fixture.runtime_path),
                    runtime_sha256,
                ],
            )
            .expect("burn job should insert");
        job_id
    }
}
