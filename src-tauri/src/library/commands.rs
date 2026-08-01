use std::path::Path;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::{commands::CommandError, store::ProjectStore};

use super::{
    AddProjectToCollectionInput, Collection, CollectionDetail, CreateCollectionInput,
    EpisodeNeighbors, LibraryError, LibraryHome, LibraryPreviewStore, LibraryScanPhase,
    LibraryScanPreview, LibraryScanProgress, LibraryScanService, LibraryService, MediaSummary,
    ScanLibraryFolderInput, SearchResult, UpdateCollectionInput,
};

const LIBRARY_SCAN_PROGRESS_EVENT: &str = "library-scan-progress";

#[tauri::command]
pub(crate) fn get_library_home(
    app: AppHandle,
    store: State<'_, ProjectStore>,
) -> Result<LibraryHome, CommandError> {
    let home = LibraryService::new(store.inner().clone())
        .get_home()
        .map_err(CommandError::from)?;
    allow_home_posters(&app, &home)?;
    Ok(home)
}

#[tauri::command]
pub(crate) fn search_library(
    store: State<'_, ProjectStore>,
    query: String,
) -> Result<Vec<SearchResult>, CommandError> {
    LibraryService::new(store.inner().clone())
        .search(&query)
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) fn create_collection(
    store: State<'_, ProjectStore>,
    input: CreateCollectionInput,
) -> Result<Collection, CommandError> {
    LibraryService::new(store.inner().clone())
        .create_collection(input)
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) fn update_collection(
    store: State<'_, ProjectStore>,
    input: UpdateCollectionInput,
) -> Result<Collection, CommandError> {
    LibraryService::new(store.inner().clone())
        .update_collection(input)
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) fn delete_collection(
    store: State<'_, ProjectStore>,
    collection_id: String,
) -> Result<(), CommandError> {
    LibraryService::new(store.inner().clone())
        .delete_collection(&collection_id)
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) fn get_collection_detail(
    store: State<'_, ProjectStore>,
    collection_id: String,
) -> Result<CollectionDetail, CommandError> {
    LibraryService::new(store.inner().clone())
        .get_collection_detail(&collection_id)
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) fn list_collection_episodes(
    app: AppHandle,
    store: State<'_, ProjectStore>,
    collection_id: String,
    season_number: Option<i64>,
) -> Result<Vec<MediaSummary>, CommandError> {
    let episodes = LibraryService::new(store.inner().clone())
        .list_collection_episodes(&collection_id, season_number)
        .map_err(CommandError::from)?;
    allow_media_posters(&app, &episodes)?;
    Ok(episodes)
}

#[tauri::command]
pub(crate) fn add_project_to_collection(
    store: State<'_, ProjectStore>,
    input: AddProjectToCollectionInput,
) -> Result<CollectionDetail, CommandError> {
    LibraryService::new(store.inner().clone())
        .add_project_to_collection(input)
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) fn remove_project_from_collection(
    store: State<'_, ProjectStore>,
    collection_id: String,
    project_id: String,
) -> Result<CollectionDetail, CommandError> {
    LibraryService::new(store.inner().clone())
        .remove_project_from_collection(&collection_id, &project_id)
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) fn get_episode_neighbors(
    store: State<'_, ProjectStore>,
    collection_id: String,
    project_id: String,
) -> Result<EpisodeNeighbors, CommandError> {
    LibraryService::new(store.inner().clone())
        .get_episode_neighbors(&collection_id, &project_id)
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) fn set_watch_later(
    store: State<'_, ProjectStore>,
    project_id: String,
    enabled: bool,
) -> Result<Option<CollectionDetail>, CommandError> {
    LibraryService::new(store.inner().clone())
        .set_watch_later(&project_id, enabled)
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) async fn scan_library_folder(
    app: AppHandle,
    preview_store: State<'_, LibraryPreviewStore>,
    input: ScanLibraryFolderInput,
) -> Result<LibraryScanPreview, CommandError> {
    let scan_id = input.scan_id.clone();
    let service = LibraryScanService::new(preview_store.inner().clone());
    let cancelled = service.begin_scan(&scan_id).map_err(CommandError::from)?;
    let task_service = service.clone();
    let progress_app = app.clone();
    let task_result = tauri::async_runtime::spawn_blocking(move || {
        task_service.scan_started(input, cancelled, |progress| {
            if let Err(error) = progress_app.emit(LIBRARY_SCAN_PROGRESS_EVENT, progress) {
                eprintln!("SiaoVPlay: failed to emit library scan progress: {error}");
            }
        })
    })
    .await;
    let result = match task_result {
        Ok(result) => result,
        Err(error) => {
            service.abort(&scan_id);
            let error = LibraryError::Conflict(format!("媒体库扫描任务无法完成：{error}"));
            emit_scan_outcome(&app, scan_id, LibraryScanPhase::Failed, error.to_string());
            return Err(CommandError::from(error));
        }
    };

    match result {
        Ok(preview) => Ok(preview),
        Err(error) => {
            let phase = if matches!(error, LibraryError::ScanCancelled(_)) {
                LibraryScanPhase::Cancelled
            } else {
                LibraryScanPhase::Failed
            };
            emit_scan_outcome(&app, scan_id, phase, error.to_string());
            Err(CommandError::from(error))
        }
    }
}

#[tauri::command]
pub(crate) fn cancel_library_scan(
    preview_store: State<'_, LibraryPreviewStore>,
    scan_id: String,
) -> Result<(), CommandError> {
    LibraryScanService::new(preview_store.inner().clone())
        .cancel(&scan_id)
        .map_err(CommandError::from)
}

fn emit_scan_outcome(app: &AppHandle, scan_id: String, phase: LibraryScanPhase, message: String) {
    if let Err(error) = app.emit(
        LIBRARY_SCAN_PROGRESS_EVENT,
        LibraryScanProgress {
            scan_id,
            phase,
            scanned_directories: 0,
            scanned_files: 0,
            candidate_files: 0,
            ignored_entries: 0,
            current_relative_path: None,
            message: Some(message),
        },
    ) {
        eprintln!("SiaoVPlay: failed to emit library scan outcome: {error}");
    }
}

fn allow_home_posters(app: &AppHandle, home: &LibraryHome) -> Result<(), CommandError> {
    for poster_path in home
        .collections
        .iter()
        .filter_map(|summary| summary.collection.poster_path.as_deref())
    {
        allow_poster(app, poster_path)?;
    }
    allow_media_posters(app, &home.continue_watching)?;
    allow_media_posters(app, &home.unclassified)
}

fn allow_media_posters(app: &AppHandle, media: &[MediaSummary]) -> Result<(), CommandError> {
    for poster_path in media.iter().filter_map(|item| item.poster_path.as_deref()) {
        allow_poster(app, poster_path)?;
    }
    Ok(())
}

fn allow_poster(app: &AppHandle, poster_path: &str) -> Result<(), CommandError> {
    if !Path::new(poster_path).is_file() {
        return Ok(());
    }
    app.asset_protocol_scope()
        .allow_file(poster_path)
        .map_err(|error| {
            CommandError::asset_scope_failed(format!("无法授权媒体库读取视频封面：{error}"))
        })
}
