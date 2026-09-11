use super::command_worker::run;
use super::{LibraryService, MediaSummary, command_assets::allow_media_posters};
use crate::{commands::CommandError, store::ProjectStore};
use tauri::{AppHandle, State};

#[tauri::command]
pub(crate) async fn list_collection_episodes(
    app: AppHandle,
    store: State<'_, ProjectStore>,
    collection_id: String,
    season_number: Option<i64>,
) -> Result<Vec<MediaSummary>, CommandError> {
    run(store.inner().clone(), move |service| {
        let episodes = service
            .list_collection_episodes(&collection_id, season_number)
            .map_err(CommandError::from)?;
        allow_media_posters(&app, &episodes)?;
        Ok(episodes)
    })
    .await
}

#[tauri::command]
pub(crate) async fn list_collection_episode_page(
    app: AppHandle,
    store: State<'_, ProjectStore>,
    input: super::ListCollectionEpisodePageInput,
) -> Result<super::CollectionEpisodePage, CommandError> {
    let store = store.inner().clone();
    let page = tauri::async_runtime::spawn_blocking(move || {
        LibraryService::new(store)
            .list_collection_episode_page(input)
            .map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)??;
    allow_media_posters(&app, &page.items)?;
    Ok(page)
}
