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
