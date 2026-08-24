use tauri::State;

use crate::commands::CommandError;
use crate::store::ProjectStore;

use super::{
    PrepareStorageMigrationInput, SaveStorageSettingsInput, StartStorageMigrationInput,
    StorageManager, StorageMigrationTask, StorageMigrationTaskInput, StorageSettingsView,
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
pub fn cancel_storage_migration(
    storage: State<'_, StorageManager>,
    input: StorageMigrationTaskInput,
) -> Result<StorageMigrationTask, CommandError> {
    storage.cancel_migration(&input.task_id).map_err(Into::into)
}
