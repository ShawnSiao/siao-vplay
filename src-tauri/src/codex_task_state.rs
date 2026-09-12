use rusqlite::{OptionalExtension, params};

use crate::{codex_runner::CodexRunnerError, store::ProjectStore};

pub(crate) fn cancellation_requested(
    store: &ProjectStore,
    task_id: &str,
) -> Result<bool, CodexRunnerError> {
    let requested = store
        .connect()?
        .query_row(
            "SELECT cancel_requested_at_ms IS NOT NULL FROM agent_tasks WHERE id = ?1
             UNION ALL SELECT cancel_requested_at_ms IS NOT NULL FROM explanation_tasks WHERE id = ?1
             UNION ALL SELECT cancel_requested_at_ms IS NOT NULL FROM learning_tasks WHERE id = ?1
             UNION ALL SELECT cancel_requested_at_ms IS NOT NULL FROM summary_tasks WHERE id = ?1",
            params![task_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(requested.unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observes_summary_cancellation_in_the_owned_codex_process() {
        let (_directory, store, task) = crate::summary::test_support::prepared_summary();
        assert!(!cancellation_requested(&store, &task.id).unwrap());
        store
            .connect()
            .unwrap()
            .execute(
                "UPDATE summary_tasks SET cancel_requested_at_ms = 1 WHERE id = ?1",
                [&task.id],
            )
            .unwrap();
        assert!(cancellation_requested(&store, &task.id).unwrap());
    }
}
