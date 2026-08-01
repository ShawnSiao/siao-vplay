use tauri::State;

use crate::{commands::CommandError, store::ProjectStore};

use super::{
    AddProjectToCollectionInput, Collection, CollectionDetail, CreateCollectionInput,
    EpisodeNeighbors, LibraryHome, LibraryService, MediaSummary, SearchResult,
    UpdateCollectionInput,
};

#[tauri::command]
pub(crate) fn get_library_home(
    store: State<'_, ProjectStore>,
) -> Result<LibraryHome, CommandError> {
    LibraryService::new(store.inner().clone())
        .get_home()
        .map_err(Into::into)
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
    store: State<'_, ProjectStore>,
    collection_id: String,
    season_number: Option<i64>,
) -> Result<Vec<MediaSummary>, CommandError> {
    LibraryService::new(store.inner().clone())
        .list_collection_episodes(&collection_id, season_number)
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) fn add_project_to_collection(
    store: State<'_, ProjectStore>,
    input: AddProjectToCollectionInput,
) -> Result<(), CommandError> {
    LibraryService::new(store.inner().clone())
        .add_project_to_collection(input)
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) fn remove_project_from_collection(
    store: State<'_, ProjectStore>,
    collection_id: String,
    project_id: String,
) -> Result<(), CommandError> {
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
) -> Result<(), CommandError> {
    LibraryService::new(store.inner().clone())
        .set_watch_later(&project_id, enabled)
        .map_err(Into::into)
}
