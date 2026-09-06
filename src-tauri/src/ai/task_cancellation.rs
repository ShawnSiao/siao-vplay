use super::{AiError, providers::CancellationCheck};
use crate::store::ProjectStore;
use rusqlite::OptionalExtension;
use std::sync::Arc;

pub(crate) fn for_task(store: &ProjectStore, id: &str) -> CancellationCheck {
    let store = store.clone();
    let id = id.to_owned();
    Arc::new(move || {
        let connection = store.connect().map_err(|_| AiError::ConfigurationRead)?;
        let cancelled = connection.query_row(
            "SELECT cancel_requested_at_ms IS NOT NULL OR status NOT IN ('running', 'validating') FROM explanation_tasks WHERE id = ?1
             UNION ALL SELECT cancel_requested_at_ms IS NOT NULL OR status NOT IN ('running', 'validating') FROM learning_tasks WHERE id = ?1
             UNION ALL SELECT cancel_requested_at_ms IS NOT NULL OR status NOT IN ('running', 'validating') FROM summary_tasks WHERE id = ?1",
            [&id], |row| row.get::<_, bool>(0),
        ).optional().map_err(|_| AiError::ConfigurationRead)?;
        Ok(cancelled.unwrap_or(true))
    })
}
