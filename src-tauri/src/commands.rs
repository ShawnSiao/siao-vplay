use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::{
    domain::{
        CreateLocalProjectInput, DeleteProjectResult, PrepareProjectMediaInput, Project,
        RelinkProjectMediaInput, UpdatePlaybackStateInput,
    },
    media::{self, MediaError, MediaInspection, MediaPreparation, MediaRuntimeStatus},
    store::{ProjectStore, StoreError},
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
            MediaError::Serialization(_) => "media_probe_serialization_failed",
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
pub fn list_projects(store: State<'_, ProjectStore>) -> Result<Vec<Project>, CommandError> {
    store.list_projects().map_err(Into::into)
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
