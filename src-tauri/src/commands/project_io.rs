use super::{CommandError, ProjectStore};

pub(super) async fn run<T: Send + 'static>(
    store: ProjectStore,
    operation: impl FnOnce(ProjectStore) -> Result<T, CommandError> + Send + 'static,
) -> Result<T, CommandError> {
    tauri::async_runtime::spawn_blocking(move || operation(store))
        .await
        .map_err(CommandError::background_task_failed)?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_query_uses_worker_and_preserves_store_error() {
        let temporary = tempfile::tempdir().unwrap();
        let store = ProjectStore::open(temporary.path().join("siaovplay.db")).unwrap();
        let caller = std::thread::current().id();
        let error = tauri::async_runtime::block_on(run(store, move |store| {
            assert_ne!(caller, std::thread::current().id());
            store
                .get_project("00000000-0000-4000-8000-000000000001")
                .map_err(CommandError::from)
        }))
        .unwrap_err();
        assert_eq!(error.code, "project_not_found");
    }
}
