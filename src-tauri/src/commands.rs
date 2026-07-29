use serde::Serialize;
use tauri::State;

use crate::{
    domain::{
        CreateLocalProjectInput, DeleteProjectResult, Project, RelinkProjectMediaInput,
        UpdatePlaybackStateInput,
    },
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
            StoreError::Database(_) | StoreError::InvalidMediaSourceKind(_) => "database_error",
        };
        Self {
            code,
            message: error.to_string(),
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
