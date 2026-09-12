use super::LibraryService;
use crate::{commands::CommandError, store::ProjectStore};

pub(super) async fn run<T: Send + 'static>(
    store: ProjectStore,
    operation: impl FnOnce(LibraryService) -> Result<T, CommandError> + Send + 'static,
) -> Result<T, CommandError> {
    tauri::async_runtime::spawn_blocking(move || operation(LibraryService::new(store)))
        .await
        .map_err(CommandError::background_task_failed)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_work_runs_on_worker_and_returns_home() {
        let temporary = tempfile::tempdir().unwrap();
        let store = ProjectStore::open(temporary.path().join("siaovplay.db")).unwrap();
        let caller = std::thread::current().id();
        let (worker, home) = tauri::async_runtime::block_on(run(store, |service| {
            Ok((
                std::thread::current().id(),
                service.get_home().map_err(CommandError::from)?,
            ))
        }))
        .unwrap();
        assert_ne!(caller, worker);
        assert!(home.recently_added.is_empty());
    }

    #[test]
    fn domain_failure_survives_worker_boundary() {
        let temporary = tempfile::tempdir().unwrap();
        let store = ProjectStore::open(temporary.path().join("siaovplay.db")).unwrap();
        let error = tauri::async_runtime::block_on(run(store, |service| {
            service
                .get_collection_detail("missing")
                .map_err(CommandError::from)
        }))
        .unwrap_err();
        assert_ne!(error.code, "background_task_failed");
        assert!(!error.message.is_empty());
    }
}
