use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::{
    domain::{
        CreateLocalProjectInput, DeleteProjectResult, PrepareProjectMediaInput, Project,
        RelinkProjectMediaInput, UpdatePlaybackStateInput,
    },
    media::{self, MediaError, MediaInspection, MediaPreparation, MediaRuntimeStatus},
    store::{ProjectStore, StoreError},
    subtitles::{
        self, EmbeddedSubtitlePreview, ImportEmbeddedSubtitleInput, ImportSubtitleFileInput,
        InspectEmbeddedSubtitleInput, InspectSubtitleFileInput, SubtitleError,
        SubtitleImportPreview, SubtitleVersion,
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
            | StoreError::InvalidMediaArtifactStatus(_) => "database_error",
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
                | StoreError::InvalidMediaArtifactStatus(_),
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
            SubtitleError::Serialization(_) => "subtitle_serialization_failed",
        };
        Self {
            code,
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
