use tauri::{AppHandle, State};
use crate::{commands::CommandError, store::ProjectStore};
use super::{LibraryService, commands::allow_poster,
    overview_model::{CollectionOverviewInput, CollectionOverviewPage, OverviewPageInput, RootOverviewPage}};

#[tauri::command]
pub(crate) async fn list_collection_overview(app: AppHandle, store: State<'_, ProjectStore>, input: CollectionOverviewInput) -> Result<CollectionOverviewPage, CommandError> {
    let store = store.inner().clone();
    let page = tauri::async_runtime::spawn_blocking(move || LibraryService::new(store).collection_overview_page(input).map_err(CommandError::from))
        .await.map_err(CommandError::background_task_failed)??;
    for path in page.page.items.iter().filter_map(|item| item.collection.poster_path.as_deref()) { allow_poster(&app, path)?; }
    Ok(page)
}

#[tauri::command]
pub(crate) async fn list_root_overview(store: State<'_, ProjectStore>, input: OverviewPageInput) -> Result<RootOverviewPage, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || LibraryService::new(store).root_overview_page(input).map_err(CommandError::from))
        .await.map_err(CommandError::background_task_failed)?
}
