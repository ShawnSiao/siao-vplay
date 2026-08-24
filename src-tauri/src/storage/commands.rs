use tauri::{AppHandle, State};

use crate::commands::CommandError;
use crate::store::ProjectStore;

use super::{
    ClearPlaybackCacheInput, ClearPlaybackCacheResult, PrepareStorageMigrationInput,
    SaveStorageSettingsInput, StartStorageMigrationInput, StorageLocationInput, StorageManager,
    StorageMigrationTask, StorageMigrationTaskInput, StorageSettingsView, maintenance,
};

#[tauri::command]
pub fn get_storage_settings(
    storage: State<'_, StorageManager>,
) -> Result<StorageSettingsView, CommandError> {
    storage.get_settings().map_err(Into::into)
}

#[tauri::command]
pub fn save_storage_settings(
    storage: State<'_, StorageManager>,
    input: SaveStorageSettingsInput,
) -> Result<StorageSettingsView, CommandError> {
    storage.save_settings(input).map_err(Into::into)
}

#[tauri::command]
pub fn prepare_storage_migration(
    storage: State<'_, StorageManager>,
    input: PrepareStorageMigrationInput,
) -> Result<StorageMigrationTask, CommandError> {
    storage.prepare_migration(input).map_err(Into::into)
}

#[tauri::command]
pub fn start_storage_migration(
    storage: State<'_, StorageManager>,
    store: State<'_, ProjectStore>,
    input: StartStorageMigrationInput,
) -> Result<StorageMigrationTask, CommandError> {
    storage
        .start_migration(store.database_path().to_path_buf(), input)
        .map_err(Into::into)
}

#[tauri::command]
pub fn resume_storage_migration(
    storage: State<'_, StorageManager>,
    store: State<'_, ProjectStore>,
    input: StartStorageMigrationInput,
) -> Result<StorageMigrationTask, CommandError> {
    storage
        .start_migration(store.database_path().to_path_buf(), input)
        .map_err(Into::into)
}

#[tauri::command]
pub fn get_storage_migration(
    storage: State<'_, StorageManager>,
    input: StorageMigrationTaskInput,
) -> Result<StorageMigrationTask, CommandError> {
    storage.get_migration(&input.task_id).map_err(Into::into)
}

#[tauri::command]
pub fn get_current_storage_migration(
    storage: State<'_, StorageManager>,
) -> Result<Option<StorageMigrationTask>, CommandError> {
    storage.current_migration().map_err(Into::into)
}

#[tauri::command]
pub fn cancel_storage_migration(
    storage: State<'_, StorageManager>,
    input: StorageMigrationTaskInput,
) -> Result<StorageMigrationTask, CommandError> {
    storage.cancel_migration(&input.task_id).map_err(Into::into)
}

#[tauri::command]
pub fn open_storage_location(
    storage: State<'_, StorageManager>,
    input: StorageLocationInput,
) -> Result<(), CommandError> {
    maintenance::open_location(&storage, input.kind).map_err(Into::into)
}

#[tauri::command]
pub fn clear_playback_cache(
    storage: State<'_, StorageManager>,
    store: State<'_, ProjectStore>,
    input: ClearPlaybackCacheInput,
) -> Result<ClearPlaybackCacheResult, CommandError> {
    maintenance::clear_playback_cache(&storage, store.database_path(), input.confirmed)
        .map_err(Into::into)
}

#[tauri::command]
pub fn restart_after_storage_migration(app: AppHandle) {
    app.restart()
}
