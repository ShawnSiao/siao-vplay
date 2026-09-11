use tauri::{AppHandle, State};

use crate::commands::CommandError;
use crate::store::ProjectStore;

use super::{
    ClearPlaybackCacheInput, ClearPlaybackCacheResult, PrepareStorageMigrationInput,
    SaveStorageSettingsInput, StartStorageMigrationInput, StorageLocationInput, StorageManager,
    StorageMigrationTask, StorageMigrationTaskInput, StorageSettingsView, maintenance,
};

#[tauri::command]
pub async fn get_storage_settings(
    storage: State<'_, StorageManager>,
) -> Result<StorageSettingsView, CommandError> {
    let storage = storage.inner().clone();
    run(move || storage.get_settings().map_err(Into::into)).await
}

#[tauri::command]
pub async fn save_storage_settings(
    storage: State<'_, StorageManager>,
    input: SaveStorageSettingsInput,
) -> Result<StorageSettingsView, CommandError> {
    let storage = storage.inner().clone();
    run(move || storage.save_settings(input).map_err(Into::into)).await
}

#[tauri::command]
pub async fn prepare_storage_migration(
    storage: State<'_, StorageManager>,
    input: PrepareStorageMigrationInput,
) -> Result<StorageMigrationTask, CommandError> {
    let storage = storage.inner().clone();
    run(move || storage.prepare_migration(input).map_err(Into::into)).await
}

#[tauri::command]
pub async fn start_storage_migration(
    storage: State<'_, StorageManager>,
    store: State<'_, ProjectStore>,
    input: StartStorageMigrationInput,
) -> Result<StorageMigrationTask, CommandError> {
    let storage = storage.inner().clone();
    let database = store.database_path().to_path_buf();
    run(move || storage.start_migration(database, input).map_err(Into::into)).await
}

#[tauri::command]
pub async fn resume_storage_migration(
    storage: State<'_, StorageManager>,
    store: State<'_, ProjectStore>,
    input: StartStorageMigrationInput,
) -> Result<StorageMigrationTask, CommandError> {
    let storage = storage.inner().clone();
    let database = store.database_path().to_path_buf();
    run(move || storage.start_migration(database, input).map_err(Into::into)).await
}

#[tauri::command]
pub async fn get_storage_migration(
    storage: State<'_, StorageManager>,
    input: StorageMigrationTaskInput,
) -> Result<StorageMigrationTask, CommandError> {
    let storage = storage.inner().clone();
    run(move || storage.get_migration(&input.task_id).map_err(Into::into)).await
}

#[tauri::command]
pub async fn get_current_storage_migration(
    storage: State<'_, StorageManager>,
) -> Result<Option<StorageMigrationTask>, CommandError> {
    let storage = storage.inner().clone();
    run(move || storage.current_migration().map_err(Into::into)).await
}

#[tauri::command]
pub async fn cancel_storage_migration(
    storage: State<'_, StorageManager>,
    input: StorageMigrationTaskInput,
) -> Result<StorageMigrationTask, CommandError> {
    let storage = storage.inner().clone();
    run(move || storage.cancel_migration(&input.task_id).map_err(Into::into)).await
}

#[tauri::command]
pub async fn open_storage_location(
    storage: State<'_, StorageManager>,
    input: StorageLocationInput,
) -> Result<(), CommandError> {
    let storage = storage.inner().clone();
    run(move || maintenance::open_location(&storage, input.kind).map_err(Into::into)).await
}

#[tauri::command]
pub async fn clear_playback_cache(
    storage: State<'_, StorageManager>,
    store: State<'_, ProjectStore>,
    input: ClearPlaybackCacheInput,
) -> Result<ClearPlaybackCacheResult, CommandError> {
    let storage = storage.inner().clone();
    let database = store.database_path().to_path_buf();
    run(move || {
        maintenance::clear_playback_cache(&storage, &database, input.confirmed).map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub fn restart_after_storage_migration(app: AppHandle) {
    app.restart()
}

async fn run<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, CommandError> + Send + 'static,
) -> Result<T, CommandError> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(CommandError::background_task_failed)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_work_runs_on_a_different_thread() {
        let caller = std::thread::current().id();
        let worker =
            tauri::async_runtime::block_on(run(|| Ok(std::thread::current().id()))).unwrap();
        assert_ne!(caller, worker);
    }

    #[test]
    fn storage_worker_preserves_domain_errors() {
        let error = tauri::async_runtime::block_on(run::<()>(|| {
            Err(super::super::StorageError::ConfirmationRequired.into())
        }))
        .unwrap_err();
        let expected: CommandError = super::super::StorageError::ConfirmationRequired.into();
        assert_eq!(error.code, expected.code);
        assert_eq!(error.message, expected.message);
    }

    #[test]
    fn storage_worker_panic_becomes_a_command_error() {
        let error = tauri::async_runtime::block_on(run::<()>(|| panic!("isolated worker failure")))
            .unwrap_err();
        assert_eq!(error.code, "background_task_failed");
        assert!(!error.message.is_empty());
    }
}
