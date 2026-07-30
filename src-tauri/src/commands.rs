use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::{
    codex_runner::{self, CodexRunnerError, CodexRuntimeStatus, StartCodexTranslationInput},
    delivery::{self, DeliveryError, ExportSubtitlesInput, SubtitleExport},
    domain::{
        CreateLocalProjectInput, DeleteProjectResult, PrepareProjectMediaInput, Project,
        RelinkProjectMediaInput, UpdatePlaybackStateInput,
    },
    learning::{
        self, CreateLearningCardInput, DictionaryEntry, ExportLearningCardsInput,
        ImportLearningResultInput, LearningApplication, LearningCard, LearningCardsExport,
        LearningError, LearningTask, PrepareLearningTaskInput,
    },
    media::{self, MediaError, MediaInspection, MediaPreparation, MediaRuntimeStatus},
    remote_media::{
        self, CancelRemoteMediaImportInput, ImportRemoteMediaUrlInput, InspectRemoteMediaUrlInput,
        RemoteMediaError, RemoteMediaPreview,
    },
    store::{ProjectStore, StoreError},
    subtitles::{
        self, EmbeddedSubtitlePreview, ImportEmbeddedSubtitleInput, ImportSubtitleFileInput,
        InspectEmbeddedSubtitleInput, InspectSubtitleFileInput, RestoreSubtitleVersionInput,
        ReviseSubtitleVersionInput, SubtitleError, SubtitleImportPreview, SubtitleVersion,
    },
    transcription::{
        self, StartTranscriptionInput, TranscriptionError, TranscriptionJob, TranscriptionJobInput,
        TranscriptionRuntimeStatus,
    },
    translation::{
        self, ImportTranslationResultInput, PrepareTranslationTaskInput, TranslationApplication,
        TranslationError, TranslationTask, TranslationTaskInput,
    },
    understanding::{
        self, Explanation, ExplanationApplication, ExplanationTask, ImportExplanationResultInput,
        PrepareExplanationTaskInput, UnderstandingError,
    },
    youtube_media::{
        self, CancelYouTubeImportInput, ImportYouTubeUrlInput, InspectYouTubeUrlInput,
        YouTubeMediaError, YouTubeMediaPreview,
    },
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    code: &'static str,
    message: String,
}

impl From<StoreError> for CommandError {
    fn from(error: StoreError) -> Self {
        let code = match &error {
            StoreError::ProjectNotFound(_) => "project_not_found",
            StoreError::Validation(_) => "validation_error",
            StoreError::UnsupportedSchema { .. } => "unsupported_schema",
            StoreError::FileSystem(_) => "filesystem_error",
            StoreError::Database(_)
            | StoreError::InvalidMediaSourceKind(_)
            | StoreError::InvalidMediaArtifactStatus(_)
            | StoreError::InvalidSubtitleDisplayMode(_) => "database_error",
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

impl From<MediaError> for CommandError {
    fn from(error: MediaError) -> Self {
        let code = match &error {
            MediaError::Store(StoreError::ProjectNotFound(_)) => "project_not_found",
            MediaError::Store(StoreError::Validation(_)) => "validation_error",
            MediaError::Store(StoreError::UnsupportedSchema { .. }) => "unsupported_schema",
            MediaError::Store(StoreError::FileSystem(_)) | MediaError::FileSystem(_) => {
                "filesystem_error"
            }
            MediaError::Store(_) => "database_error",
            MediaError::RuntimeUnavailable(_) => "media_runtime_unavailable",
            MediaError::ProbeFailed(_) => "media_probe_failed",
            MediaError::SourceChanged => "media_source_changed",
            MediaError::MissingVideo => "missing_video_stream",
            MediaError::ProxyFailed(_) => "playback_proxy_failed",
            MediaError::PosterFailed(_) => "media_poster_failed",
            MediaError::SubtitleStreamNotFound(_) => "embedded_subtitle_not_found",
            MediaError::UnsupportedSubtitleCodec(_) => "embedded_subtitle_unsupported",
            MediaError::SubtitleExtractionFailed(_) => "embedded_subtitle_extraction_failed",
            MediaError::Serialization(_) => "media_probe_serialization_failed",
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

impl From<SubtitleError> for CommandError {
    fn from(error: SubtitleError) -> Self {
        let code = match &error {
            SubtitleError::Store(StoreError::ProjectNotFound(_)) => "project_not_found",
            SubtitleError::Store(StoreError::Validation(_)) => "validation_error",
            SubtitleError::Store(StoreError::UnsupportedSchema { .. }) => "unsupported_schema",
            SubtitleError::Store(StoreError::FileSystem(_)) | SubtitleError::FileSystem(_) => {
                "filesystem_error"
            }
            SubtitleError::Store(
                StoreError::Database(_)
                | StoreError::InvalidMediaSourceKind(_)
                | StoreError::InvalidMediaArtifactStatus(_)
                | StoreError::InvalidSubtitleDisplayMode(_),
            ) => "database_error",
            SubtitleError::Media(MediaError::SubtitleStreamNotFound(_)) => {
                "embedded_subtitle_not_found"
            }
            SubtitleError::Media(MediaError::UnsupportedSubtitleCodec(_)) => {
                "embedded_subtitle_unsupported"
            }
            SubtitleError::Media(MediaError::SubtitleExtractionFailed(_)) => {
                "embedded_subtitle_extraction_failed"
            }
            SubtitleError::Media(_) => "media_inspection_failed",
            SubtitleError::UnsupportedFormat => "subtitle_format_unsupported",
            SubtitleError::UnsupportedEncoding => "subtitle_encoding_unsupported",
            SubtitleError::Parse(_) => "subtitle_parse_failed",
            SubtitleError::InvalidLanguage(_) => "subtitle_language_invalid",
            SubtitleError::PreflightBlocked(_) => "subtitle_preflight_blocked",
            SubtitleError::SubtitleSourceChanged => "subtitle_source_changed",
            SubtitleError::ProjectChanged => "project_changed",
            SubtitleError::MediaChanged => "media_changed",
            SubtitleError::VersionNotFound(_) => "subtitle_version_not_found",
            SubtitleError::VersionChanged => "subtitle_version_changed",
            SubtitleError::InvalidRevision(_) => "subtitle_revision_invalid",
            SubtitleError::ActiveTranslationTask => "translation_task_active",
            SubtitleError::Serialization(_) => "subtitle_serialization_failed",
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

impl From<DeliveryError> for CommandError {
    fn from(error: DeliveryError) -> Self {
        Self {
            code: error.code(),
            message: error.to_string(),
        }
    }
}

impl From<RemoteMediaError> for CommandError {
    fn from(error: RemoteMediaError) -> Self {
        let code = match &error {
            RemoteMediaError::InvalidUrl => "remote_url_invalid",
            RemoteMediaError::HttpsRequired => "remote_https_required",
            RemoteMediaError::CredentialsNotAllowed => "remote_credentials_not_allowed",
            RemoteMediaError::PrivateNetwork => "remote_private_network",
            RemoteMediaError::Dns(_) => "remote_dns_failed",
            RemoteMediaError::InvalidRedirect(_) | RemoteMediaError::RedirectLimit => {
                "remote_redirect_invalid"
            }
            RemoteMediaError::Request(_) => "remote_request_failed",
            RemoteMediaError::UnsupportedContent(_) => "remote_content_unsupported",
            RemoteMediaError::SizeLimit => "remote_size_limit",
            RemoteMediaError::PreviewChanged => "remote_preview_changed",
            RemoteMediaError::Cancelled => "remote_import_cancelled",
            RemoteMediaError::Hls(_) => "remote_hls_failed",
            RemoteMediaError::FileSystem(_) => "filesystem_error",
            RemoteMediaError::Media(MediaError::RuntimeUnavailable(_)) => {
                "media_runtime_unavailable"
            }
            RemoteMediaError::Media(MediaError::MissingVideo) => "missing_video_stream",
            RemoteMediaError::Media(_) => "media_inspection_failed",
            RemoteMediaError::Store(StoreError::ProjectNotFound(_)) => "project_not_found",
            RemoteMediaError::Store(StoreError::Validation(_)) => "validation_error",
            RemoteMediaError::Store(StoreError::UnsupportedSchema { .. }) => "unsupported_schema",
            RemoteMediaError::Store(StoreError::FileSystem(_)) => "filesystem_error",
            RemoteMediaError::Store(_) => "database_error",
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

impl From<YouTubeMediaError> for CommandError {
    fn from(error: YouTubeMediaError) -> Self {
        let code = match &error {
            YouTubeMediaError::Network(RemoteMediaError::PrivateNetwork) => {
                "remote_private_network"
            }
            YouTubeMediaError::Network(_) => "youtube_preflight_failed",
            YouTubeMediaError::UnsupportedUrl => "youtube_url_unsupported",
            YouTubeMediaError::PlaylistNotAllowed => "youtube_playlist_not_allowed",
            YouTubeMediaError::LiveNotAllowed => "youtube_live_not_allowed",
            YouTubeMediaError::Restricted => "youtube_restricted",
            YouTubeMediaError::UncertainMedia => "youtube_media_uncertain",
            YouTubeMediaError::ToolUnavailable(_) => "youtube_runtime_unavailable",
            YouTubeMediaError::ToolIntegrity | YouTubeMediaError::ToolVersion => {
                "youtube_runtime_invalid"
            }
            YouTubeMediaError::InspectionTimeout => "youtube_inspection_timeout",
            YouTubeMediaError::InspectionFailed(_) => "youtube_inspection_failed",
            YouTubeMediaError::MetadataInvalid(_) => "youtube_metadata_invalid",
            YouTubeMediaError::SelectedMediaUnsafe => "youtube_selected_media_unsafe",
            YouTubeMediaError::PreviewChanged => "youtube_preview_changed",
            YouTubeMediaError::SizeLimit => "remote_size_limit",
            YouTubeMediaError::DownloadTimeout => "youtube_download_timeout",
            YouTubeMediaError::DownloadFailed(_) => "youtube_download_failed",
            YouTubeMediaError::Cancelled => "remote_import_cancelled",
            YouTubeMediaError::FileSystem(_) => "filesystem_error",
            YouTubeMediaError::Media(MediaError::RuntimeUnavailable(_)) => {
                "media_runtime_unavailable"
            }
            YouTubeMediaError::Media(MediaError::MissingVideo) => "missing_video_stream",
            YouTubeMediaError::Media(_) => "media_inspection_failed",
            YouTubeMediaError::Store(StoreError::ProjectNotFound(_)) => "project_not_found",
            YouTubeMediaError::Store(StoreError::Validation(_)) => "validation_error",
            YouTubeMediaError::Store(StoreError::UnsupportedSchema { .. }) => "unsupported_schema",
            YouTubeMediaError::Store(StoreError::FileSystem(_)) => "filesystem_error",
            YouTubeMediaError::Store(_) => "database_error",
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

impl From<TranscriptionError> for CommandError {
    fn from(error: TranscriptionError) -> Self {
        let code = match &error {
            TranscriptionError::Store(StoreError::ProjectNotFound(_)) => "project_not_found",
            TranscriptionError::Store(StoreError::Validation(_)) => "validation_error",
            TranscriptionError::Store(StoreError::UnsupportedSchema { .. }) => "unsupported_schema",
            TranscriptionError::Store(StoreError::FileSystem(_))
            | TranscriptionError::FileSystem(_) => "filesystem_error",
            TranscriptionError::Store(_) => "database_error",
            TranscriptionError::Media(MediaError::RuntimeUnavailable(_)) => {
                "media_runtime_unavailable"
            }
            TranscriptionError::Media(_) => "media_inspection_failed",
            TranscriptionError::Subtitle(_) => "subtitle_persistence_failed",
            TranscriptionError::RuntimeUnavailable(_) => "transcription_runtime_unavailable",
            TranscriptionError::RuntimeIntegrity(_) => "transcription_runtime_invalid",
            TranscriptionError::ModelUnavailable(_) => "transcription_model_unavailable",
            TranscriptionError::ModelIntegrity(_) => "transcription_model_invalid",
            TranscriptionError::InvalidLanguage(_) => "transcription_language_invalid",
            TranscriptionError::InvalidModel(_) => "transcription_model_invalid",
            TranscriptionError::MissingAudio => "missing_audio_stream",
            TranscriptionError::ReplaceConfirmationRequired => {
                "subtitle_replace_confirmation_required"
            }
            TranscriptionError::ActiveJobExists => "transcription_already_running",
            TranscriptionError::JobNotFound(_) => "transcription_job_not_found",
            TranscriptionError::InvalidJobState(_) => "transcription_job_state_invalid",
            TranscriptionError::SourceChanged => "project_changed",
            TranscriptionError::AudioExtractionFailed(_) => "audio_extraction_failed",
            TranscriptionError::TranscriptionFailed(_) => "transcription_failed",
            TranscriptionError::InvalidOutput(_) => "transcription_output_invalid",
            TranscriptionError::Cancelled => "transcription_cancelled",
            TranscriptionError::Serialization(_) => "transcription_serialization_failed",
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

impl From<TranslationError> for CommandError {
    fn from(error: TranslationError) -> Self {
        Self {
            code: error.code(),
            message: error.to_string(),
        }
    }
}

impl From<CodexRunnerError> for CommandError {
    fn from(error: CodexRunnerError) -> Self {
        Self {
            code: error.code(),
            message: error.to_string(),
        }
    }
}

impl From<UnderstandingError> for CommandError {
    fn from(error: UnderstandingError) -> Self {
        Self {
            code: error.code(),
            message: error.to_string(),
        }
    }
}

impl From<LearningError> for CommandError {
    fn from(error: LearningError) -> Self {
        Self {
            code: error.code(),
            message: error.to_string(),
        }
    }
}

impl CommandError {
    fn background_task_failed(message: impl ToString) -> Self {
        Self {
            code: "background_task_failed",
            message: message.to_string(),
        }
    }
}

#[tauri::command]
pub fn create_local_project(
    store: State<'_, ProjectStore>,
    input: CreateLocalProjectInput,
) -> Result<Project, CommandError> {
    store.create_local_project(input).map_err(Into::into)
}

#[tauri::command]
pub async fn inspect_remote_media_url(
    input: InspectRemoteMediaUrlInput,
) -> Result<RemoteMediaPreview, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        remote_media::inspect_remote_media_url(input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub async fn import_remote_media_url(
    store: State<'_, ProjectStore>,
    input: ImportRemoteMediaUrlInput,
) -> Result<Project, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        remote_media::import_remote_media_url(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub fn cancel_remote_media_import(
    input: CancelRemoteMediaImportInput,
) -> Result<bool, CommandError> {
    remote_media::cancel_remote_media_import(input).map_err(Into::into)
}

#[tauri::command]
pub async fn inspect_youtube_url(
    input: InspectYouTubeUrlInput,
) -> Result<YouTubeMediaPreview, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        youtube_media::inspect_youtube_url(input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub async fn import_youtube_url(
    store: State<'_, ProjectStore>,
    input: ImportYouTubeUrlInput,
) -> Result<Project, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        youtube_media::import_youtube_url(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub fn cancel_youtube_import(input: CancelYouTubeImportInput) -> Result<bool, CommandError> {
    youtube_media::cancel_youtube_import(input).map_err(Into::into)
}

#[tauri::command]
pub fn list_projects(
    app: AppHandle,
    store: State<'_, ProjectStore>,
) -> Result<Vec<Project>, CommandError> {
    let projects = store.list_projects().map_err(CommandError::from)?;
    for project in &projects {
        allow_project_poster(&app, project)?;
    }
    Ok(projects)
}

#[tauri::command]
pub fn get_project(
    store: State<'_, ProjectStore>,
    project_id: String,
) -> Result<Project, CommandError> {
    store.get_project(&project_id).map_err(Into::into)
}

#[tauri::command]
pub fn mark_project_opened(
    store: State<'_, ProjectStore>,
    project_id: String,
) -> Result<Project, CommandError> {
    store.mark_project_opened(&project_id).map_err(Into::into)
}

#[tauri::command]
pub fn update_playback_state(
    store: State<'_, ProjectStore>,
    input: UpdatePlaybackStateInput,
) -> Result<Project, CommandError> {
    store.update_playback_state(input).map_err(Into::into)
}

#[tauri::command]
pub fn relink_project_media(
    store: State<'_, ProjectStore>,
    input: RelinkProjectMediaInput,
) -> Result<Project, CommandError> {
    store.relink_project_media(input).map_err(Into::into)
}

#[tauri::command]
pub fn delete_project(
    store: State<'_, ProjectStore>,
    project_id: String,
) -> Result<DeleteProjectResult, CommandError> {
    transcription::cancel_project_transcriptions(store.inner(), &project_id)?;
    codex_runner::cancel_project_translation_tasks(store.inner(), &project_id)?;
    codex_runner::cancel_project_explanation_tasks(store.inner(), &project_id)?;
    codex_runner::cancel_project_learning_tasks(store.inner(), &project_id)?;
    store.delete_project(&project_id).map_err(Into::into)
}

#[tauri::command]
pub fn get_media_runtime_status() -> MediaRuntimeStatus {
    media::media_runtime_status()
}

#[tauri::command]
pub async fn inspect_project_media(
    store: State<'_, ProjectStore>,
    project_id: String,
) -> Result<MediaInspection, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        media::inspect_project_media(&store, &project_id).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub async fn prepare_project_media(
    app: AppHandle,
    store: State<'_, ProjectStore>,
    input: PrepareProjectMediaInput,
) -> Result<MediaPreparation, CommandError> {
    let store = store.inner().clone();
    let preparation = tauri::async_runtime::spawn_blocking(move || {
        media::prepare_project_media(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)??;
    app.asset_protocol_scope()
        .allow_file(&preparation.playback_path)
        .map_err(|error| CommandError {
            code: "asset_scope_error",
            message: format!("无法授权播放器读取已准备的媒体：{error}"),
        })?;
    Ok(preparation)
}

#[tauri::command]
pub async fn ensure_project_poster(
    app: AppHandle,
    store: State<'_, ProjectStore>,
    project_id: String,
) -> Result<Project, CommandError> {
    let store = store.inner().clone();
    let project = tauri::async_runtime::spawn_blocking(move || {
        media::ensure_project_poster(&store, &project_id).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)??;
    allow_project_poster(&app, &project)?;
    Ok(project)
}

#[tauri::command]
pub async fn inspect_subtitle_file(
    store: State<'_, ProjectStore>,
    input: InspectSubtitleFileInput,
) -> Result<SubtitleImportPreview, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        subtitles::inspect_subtitle_file(&store, &input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub async fn import_subtitle_file(
    store: State<'_, ProjectStore>,
    input: ImportSubtitleFileInput,
) -> Result<SubtitleVersion, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        subtitles::import_subtitle_file(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub fn list_subtitle_versions(
    store: State<'_, ProjectStore>,
    project_id: String,
) -> Result<Vec<SubtitleVersion>, CommandError> {
    subtitles::list_subtitle_versions(store.inner(), &project_id).map_err(Into::into)
}

#[tauri::command]
pub async fn revise_subtitle_version(
    store: State<'_, ProjectStore>,
    input: ReviseSubtitleVersionInput,
) -> Result<SubtitleVersion, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        subtitles::revise_subtitle_version(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub async fn restore_subtitle_version(
    store: State<'_, ProjectStore>,
    input: RestoreSubtitleVersionInput,
) -> Result<SubtitleVersion, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        subtitles::restore_subtitle_version(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub async fn inspect_embedded_subtitle(
    store: State<'_, ProjectStore>,
    input: InspectEmbeddedSubtitleInput,
) -> Result<EmbeddedSubtitlePreview, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        subtitles::inspect_embedded_subtitle(&store, &input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub async fn import_embedded_subtitle(
    store: State<'_, ProjectStore>,
    input: ImportEmbeddedSubtitleInput,
) -> Result<SubtitleVersion, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        subtitles::import_embedded_subtitle(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub async fn get_transcription_runtime_status() -> Result<TranscriptionRuntimeStatus, CommandError>
{
    tauri::async_runtime::spawn_blocking(transcription::transcription_runtime_status)
        .await
        .map_err(CommandError::background_task_failed)
}

#[tauri::command]
pub async fn start_transcription(
    store: State<'_, ProjectStore>,
    input: StartTranscriptionInput,
) -> Result<TranscriptionJob, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let job = transcription::start_transcription(&store, input)?;
        transcription::spawn_transcription_job(store, job.id.clone())?;
        Ok(job)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub fn get_transcription_job(
    store: State<'_, ProjectStore>,
    input: TranscriptionJobInput,
) -> Result<TranscriptionJob, CommandError> {
    transcription::get_transcription_job(store.inner(), &input.job_id).map_err(Into::into)
}

#[tauri::command]
pub fn list_transcription_jobs(
    store: State<'_, ProjectStore>,
    project_id: String,
) -> Result<Vec<TranscriptionJob>, CommandError> {
    transcription::list_transcription_jobs(store.inner(), &project_id).map_err(Into::into)
}

#[tauri::command]
pub fn cancel_transcription_job(
    store: State<'_, ProjectStore>,
    input: TranscriptionJobInput,
) -> Result<TranscriptionJob, CommandError> {
    transcription::cancel_transcription_job(store.inner(), &input.job_id).map_err(Into::into)
}

#[tauri::command]
pub async fn resume_transcription_job(
    store: State<'_, ProjectStore>,
    input: TranscriptionJobInput,
) -> Result<TranscriptionJob, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let job = transcription::resume_transcription_job(&store, &input.job_id)?;
        transcription::spawn_transcription_job(store, job.id.clone())?;
        Ok(job)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub async fn prepare_translation_task(
    store: State<'_, ProjectStore>,
    input: PrepareTranslationTaskInput,
) -> Result<TranslationTask, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        translation::prepare_translation_task(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub fn get_translation_task(
    store: State<'_, ProjectStore>,
    input: TranslationTaskInput,
) -> Result<TranslationTask, CommandError> {
    translation::get_translation_task(store.inner(), &input.task_id).map_err(Into::into)
}

#[tauri::command]
pub fn list_translation_tasks(
    store: State<'_, ProjectStore>,
    project_id: String,
) -> Result<Vec<TranslationTask>, CommandError> {
    translation::list_translation_tasks(store.inner(), &project_id).map_err(Into::into)
}

#[tauri::command]
pub fn read_translation_prompt(
    store: State<'_, ProjectStore>,
    input: TranslationTaskInput,
) -> Result<String, CommandError> {
    translation::read_translation_prompt(store.inner(), &input.task_id).map_err(Into::into)
}

#[tauri::command]
pub async fn import_translation_result(
    store: State<'_, ProjectStore>,
    input: ImportTranslationResultInput,
) -> Result<TranslationApplication, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        translation::import_translation_result(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub async fn get_codex_runtime_status() -> Result<CodexRuntimeStatus, CommandError> {
    tauri::async_runtime::spawn_blocking(codex_runner::get_codex_runtime_status)
        .await
        .map_err(CommandError::background_task_failed)
}

#[tauri::command]
pub async fn start_codex_translation_task(
    store: State<'_, ProjectStore>,
    input: StartCodexTranslationInput,
) -> Result<TranslationTask, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        codex_runner::start_codex_translation_task(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub fn cancel_translation_task(
    store: State<'_, ProjectStore>,
    input: TranslationTaskInput,
) -> Result<TranslationTask, CommandError> {
    codex_runner::cancel_translation_task(store.inner(), &input.task_id).map_err(Into::into)
}

#[tauri::command]
pub async fn resume_codex_translation_task(
    store: State<'_, ProjectStore>,
    input: StartCodexTranslationInput,
) -> Result<TranslationTask, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        codex_runner::resume_codex_translation_task(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub async fn prepare_explanation_task(
    store: State<'_, ProjectStore>,
    input: PrepareExplanationTaskInput,
) -> Result<ExplanationTask, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        understanding::prepare_explanation_task(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub fn get_explanation_task(
    store: State<'_, ProjectStore>,
    task_id: String,
) -> Result<ExplanationTask, CommandError> {
    understanding::get_explanation_task(store.inner(), &task_id).map_err(Into::into)
}

#[tauri::command]
pub fn list_explanation_tasks(
    store: State<'_, ProjectStore>,
    project_id: String,
) -> Result<Vec<ExplanationTask>, CommandError> {
    understanding::list_explanation_tasks(store.inner(), &project_id).map_err(Into::into)
}

#[tauri::command]
pub fn read_explanation_prompt(
    store: State<'_, ProjectStore>,
    task_id: String,
) -> Result<String, CommandError> {
    understanding::read_explanation_prompt(store.inner(), &task_id).map_err(Into::into)
}

#[tauri::command]
pub fn open_explanation_materials(
    store: State<'_, ProjectStore>,
    task_id: String,
) -> Result<bool, CommandError> {
    understanding::open_explanation_materials(store.inner(), &task_id).map_err(Into::into)
}

#[tauri::command]
pub fn get_explanation(
    store: State<'_, ProjectStore>,
    explanation_id: String,
) -> Result<Explanation, CommandError> {
    understanding::get_explanation(store.inner(), &explanation_id).map_err(Into::into)
}

#[tauri::command]
pub fn list_explanations(
    store: State<'_, ProjectStore>,
    project_id: String,
) -> Result<Vec<Explanation>, CommandError> {
    understanding::list_explanations(store.inner(), &project_id).map_err(Into::into)
}

#[tauri::command]
pub async fn import_explanation_result(
    store: State<'_, ProjectStore>,
    input: ImportExplanationResultInput,
) -> Result<ExplanationApplication, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        understanding::import_explanation_result(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub async fn start_codex_explanation_task(
    store: State<'_, ProjectStore>,
    input: StartCodexTranslationInput,
) -> Result<ExplanationTask, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        codex_runner::start_codex_explanation_task(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub fn cancel_explanation_task(
    store: State<'_, ProjectStore>,
    task_id: String,
) -> Result<ExplanationTask, CommandError> {
    codex_runner::cancel_explanation_task(store.inner(), &task_id).map_err(Into::into)
}

#[tauri::command]
pub async fn resume_codex_explanation_task(
    store: State<'_, ProjectStore>,
    input: StartCodexTranslationInput,
) -> Result<ExplanationTask, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        codex_runner::resume_codex_explanation_task(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub async fn prepare_learning_task(
    store: State<'_, ProjectStore>,
    input: PrepareLearningTaskInput,
) -> Result<LearningTask, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        learning::prepare_learning_task(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub fn get_learning_task(
    store: State<'_, ProjectStore>,
    task_id: String,
) -> Result<LearningTask, CommandError> {
    learning::get_learning_task(store.inner(), &task_id).map_err(Into::into)
}

#[tauri::command]
pub fn list_learning_tasks(
    store: State<'_, ProjectStore>,
    project_id: String,
) -> Result<Vec<LearningTask>, CommandError> {
    learning::list_learning_tasks(store.inner(), &project_id).map_err(Into::into)
}

#[tauri::command]
pub fn read_learning_prompt(
    store: State<'_, ProjectStore>,
    task_id: String,
) -> Result<String, CommandError> {
    learning::read_learning_prompt(store.inner(), &task_id).map_err(Into::into)
}

#[tauri::command]
pub fn get_dictionary_entry(
    store: State<'_, ProjectStore>,
    entry_id: String,
) -> Result<DictionaryEntry, CommandError> {
    learning::get_dictionary_entry(store.inner(), &entry_id).map_err(Into::into)
}

#[tauri::command]
pub fn list_dictionary_entries(
    store: State<'_, ProjectStore>,
    project_id: String,
) -> Result<Vec<DictionaryEntry>, CommandError> {
    learning::list_dictionary_entries(store.inner(), &project_id).map_err(Into::into)
}

#[tauri::command]
pub async fn import_learning_result(
    store: State<'_, ProjectStore>,
    input: ImportLearningResultInput,
) -> Result<LearningApplication, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        learning::import_learning_result(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub async fn start_codex_learning_task(
    store: State<'_, ProjectStore>,
    input: StartCodexTranslationInput,
) -> Result<LearningTask, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        codex_runner::start_codex_learning_task(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub fn cancel_learning_task(
    store: State<'_, ProjectStore>,
    task_id: String,
) -> Result<LearningTask, CommandError> {
    codex_runner::cancel_learning_task(store.inner(), &task_id).map_err(Into::into)
}

#[tauri::command]
pub async fn resume_codex_learning_task(
    store: State<'_, ProjectStore>,
    input: StartCodexTranslationInput,
) -> Result<LearningTask, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        codex_runner::resume_codex_learning_task(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub async fn create_learning_card(
    app: AppHandle,
    store: State<'_, ProjectStore>,
    input: CreateLearningCardInput,
) -> Result<LearningCard, CommandError> {
    let store = store.inner().clone();
    let card = tauri::async_runtime::spawn_blocking(move || {
        learning::create_learning_card(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)??;
    allow_learning_screenshot(&app, &card)?;
    Ok(card)
}

#[tauri::command]
pub fn get_learning_card(
    app: AppHandle,
    store: State<'_, ProjectStore>,
    card_id: String,
) -> Result<LearningCard, CommandError> {
    let card = learning::get_learning_card(store.inner(), &card_id)?;
    allow_learning_screenshot(&app, &card)?;
    Ok(card)
}

#[tauri::command]
pub fn list_learning_cards(
    app: AppHandle,
    store: State<'_, ProjectStore>,
    project_id: String,
) -> Result<Vec<LearningCard>, CommandError> {
    let cards = learning::list_learning_cards(store.inner(), &project_id)?;
    for card in &cards {
        allow_learning_screenshot(&app, card)?;
    }
    Ok(cards)
}

#[tauri::command]
pub fn delete_learning_card(
    store: State<'_, ProjectStore>,
    project_id: String,
    card_id: String,
) -> Result<bool, CommandError> {
    learning::delete_learning_card(store.inner(), &project_id, &card_id).map_err(Into::into)
}

#[tauri::command]
pub async fn export_learning_cards(
    store: State<'_, ProjectStore>,
    input: ExportLearningCardsInput,
) -> Result<LearningCardsExport, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        learning::export_learning_cards(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

#[tauri::command]
pub async fn export_subtitles(
    store: State<'_, ProjectStore>,
    input: ExportSubtitlesInput,
) -> Result<SubtitleExport, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        delivery::export_subtitles(&store, input).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}

fn allow_project_poster(app: &AppHandle, project: &Project) -> Result<(), CommandError> {
    let Some(poster_path) = project.media_source.poster_path.as_deref() else {
        return Ok(());
    };
    if !std::path::Path::new(poster_path).is_file() {
        return Ok(());
    }
    app.asset_protocol_scope()
        .allow_file(poster_path)
        .map_err(|error| CommandError {
            code: "asset_scope_error",
            message: format!("无法授权项目库读取视频封面：{error}"),
        })
}

fn allow_learning_screenshot(app: &AppHandle, card: &LearningCard) -> Result<(), CommandError> {
    if !card.screenshot_available {
        return Ok(());
    }
    app.asset_protocol_scope()
        .allow_file(&card.screenshot_path)
        .map_err(|error| CommandError {
            code: "learning_screenshot_scope_failed",
            message: format!("场景截图未能加入本地显示范围：{error}"),
        })
}
