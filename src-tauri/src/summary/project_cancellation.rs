use crate::store::{ProjectStore, StoreError};

pub(crate) fn cancel_project_tasks(store: &ProjectStore, project_id: &str) -> Result<(), StoreError> {
    let ids = {
        let connection = store.connect()?;
        let mut statement = connection.prepare("SELECT id FROM summary_tasks WHERE project_id = ?1 AND status NOT IN ('completed','failed','cancelled')")?;
        statement.query_map([project_id], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?
    };
    let repository = super::task_repository::SummaryTaskRepository::new(store);
    for id in ids {
        let task = repository.get(&id)?;
        if matches!(task.status.as_str(), "prepared" | "awaiting_external_result" | "paused" | "interrupted") {
            repository.finish_cancelled(&id)?;
        } else {
            repository.request_cancel(&id)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::summary::{test_support, task_repository::SummaryTaskRepository};
    #[cfg(windows)]
    #[test]
    fn project_cleanup_can_retry_locked_materials_after_reopen() {
        use std::os::windows::fs::OpenOptionsExt;
        let (_directory, store, task) = test_support::prepared_summary();
        let materials = SummaryTaskRepository::new(&store).materials_directory(&task.id);
        std::fs::create_dir_all(&materials).unwrap();
        let sentinel = materials.join("locked.txt");
        std::fs::write(&sentinel, b"pending cleanup").unwrap();
        let lock = std::fs::OpenOptions::new().read(true).share_mode(1).open(&sentinel).unwrap();
        let first = store.delete_project(&task.project_id);
        assert!(sentinel.exists(), "fixture must reproduce deletion denial");
        drop(lock);
        let database = store.database_path().to_owned();
        drop(store);
        let reopened = ProjectStore::open(database).unwrap();
        let retry = reopened.delete_project(&task.project_id);
        assert!(!materials.exists(), "cleanup identity was lost: first={first:?}, retry={retry:?}");
    }
    #[test]
    fn project_deletion_removes_only_its_summary_materials() {
        let (_directory, store, task) = test_support::prepared_summary();
        let repository = SummaryTaskRepository::new(&store);
        let materials = repository.materials_directory(&task.id);
        std::fs::create_dir_all(&materials).unwrap();
        std::fs::write(materials.join("sentinel.txt"), b"task").unwrap();
        let unrelated = repository.materials_directory(&uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&unrelated).unwrap();
        std::fs::write(unrelated.join("sentinel.txt"), b"retain").unwrap();
        assert!(store.delete_project(&task.project_id).unwrap().deleted);
        assert!(!materials.exists(), "deleted project left summary materials behind");
        assert_eq!(std::fs::read(unrelated.join("sentinel.txt")).unwrap(), b"retain");
    }
    #[test]
    fn project_cancellation_marks_summary_without_faking_worker_exit() {
        for status in ["prepared", "awaiting_external_result", "running", "validating"] {
            let (_directory, store, task) = test_support::prepared_summary();
            store.connect().unwrap().execute("UPDATE summary_tasks SET status = ?1 WHERE id = ?2", [status, &task.id]).unwrap();
            cancel_project_tasks(&store, "unrelated-project").unwrap();
            assert_eq!(SummaryTaskRepository::new(&store).get(&task.id).unwrap().status, status);
            cancel_project_tasks(&store, &task.project_id).unwrap();
            let result = SummaryTaskRepository::new(&store).get(&task.id).unwrap();
            if matches!(status, "running" | "validating") {
                assert_eq!(result.status, status);
                assert!(result.cancel_requested);
            } else {
                assert_eq!(result.status, "cancelled");
            }
        }
    }
}
