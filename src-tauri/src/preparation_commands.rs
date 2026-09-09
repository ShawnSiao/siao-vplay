use crate::{
    commands::CommandError,
    domain::PrepareProjectMediaInput,
    media::{self, MediaPreparation},
    preparation::{Snapshot, Status},
    storage::StorageManager,
    store::ProjectStore,
};
use tauri::{AppHandle, Manager, State};
fn command_error(error: std::io::Error) -> CommandError {
    CommandError {
        code: "preparation_unavailable",
        message: error.to_string(),
    }
}
#[tauri::command]
pub fn get_media_preparation(request_id: String) -> Option<Snapshot> {
    crate::preparation::get(&request_id)
}
#[tauri::command]
pub fn cancel_media_preparation(request_id: String) -> bool {
    crate::preparation::cancel(&request_id)
}

#[tauri::command]
pub async fn prepare_project_media(
    app: AppHandle,
    store: State<'_, ProjectStore>,
    storage: State<'_, StorageManager>,
    input: PrepareProjectMediaInput,
    request_id: Option<String>,
) -> Result<MediaPreparation, CommandError> {
    let usage = storage.acquire_usage()?;
    let store = store.inner().clone();
    let media_cache_root = storage.media_cache_root_for_write()?;
    let request_id = request_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let control =
        crate::preparation::begin(&request_id, &input.project_id).map_err(command_error)?;
    let resources = match crate::resource_leases::configured(&["ffmpeg-cpu"]) {
        Ok(resources) => resources,
        Err(error) => {
            control.finish(Status::Failed);
            return Err(command_error(error));
        }
    };
    let worker_control = control.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _usage = usage;
        let _resources = resources;
        media::prepare_project_media_controlled(
            &store,
            &media_cache_root,
            input,
            Some(worker_control),
        )
        .map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)
    .and_then(|result| result);
    let result = result.and_then(|preparation| {
        app.asset_protocol_scope()
            .allow_file(&preparation.playback_path)
            .map_err(|error| CommandError {
                code: "asset_scope_error",
                message: format!("无法授权播放器读取已准备的媒体：{error}"),
            })?;
        Ok(preparation)
    });
    let status = if result.is_ok() {
        Status::Completed
    } else if control.cancel.check().is_err() {
        Status::Cancelled
    } else {
        Status::Failed
    };
    control.finish(status);
    result
}
