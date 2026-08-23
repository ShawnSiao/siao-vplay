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
             UNION ALL SELECT cancel_requested_at_ms IS NOT NULL FROM learning_tasks WHERE id = ?1",
            params![task_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(requested.unwrap_or(false))
}
