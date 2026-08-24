use tauri::State;

use crate::commands::CommandError;

use super::{SaveStorageSettingsInput, StorageManager, StorageSettingsView};

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
