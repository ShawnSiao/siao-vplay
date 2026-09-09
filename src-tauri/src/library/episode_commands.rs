use tauri::{AppHandle, State};
use crate::{commands::CommandError, store::ProjectStore};
use super::{LibraryService, MediaSummary, commands::allow_media_posters};

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
pub(crate) async fn list_collection_episode_page(
    app: AppHandle,
    store: State<'_, ProjectStore>,
    input: super::ListCollectionEpisodePageInput,
) -> Result<super::CollectionEpisodePage, CommandError> {
    let store = store.inner().clone();
    let page = tauri::async_runtime::spawn_blocking(move || {
        LibraryService::new(store).list_collection_episode_page(input).map_err(CommandError::from)
    }).await.map_err(CommandError::background_task_failed)??;
    allow_media_posters(&app, &page.items)?;
    Ok(page)
}
