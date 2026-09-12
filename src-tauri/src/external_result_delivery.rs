//! Completed manual results and their delivery receipts share the domain transaction.
//! Migration deliberately starts empty: historical completions are not new notifications.
use crate::{
    external_handoff::ExternalAgentResultUpdate,
    store::{ProjectStore, StoreError},
};
use rusqlite::{Connection, Transaction, params};
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub(crate) struct DeliveryQueue(Arc<Mutex<Option<DeliveryCursor>>>);

#[derive(Clone)]
struct DeliveryCursor {
    created_at_ms: i64,
    task_kind: String,
    task_id: String,
}

impl DeliveryQueue {
    pub(crate) fn next_pending(
        &self,
        store: &ProjectStore,
    ) -> Result<Vec<ExternalAgentResultUpdate>, StoreError> {
        let mut cursor = self
            .0
            .lock()
            .map_err(|_| StoreError::Validation("外部结果读取状态不可用，请重启应用".into()))?;
        let mut page = pending_after(store, cursor.as_ref())?;
        if page.is_empty() && cursor.is_some() {
            page = pending_after(store, None)?;
        }
        *cursor = page.last().map(|(created_at_ms, update)| DeliveryCursor {
            created_at_ms: *created_at_ms,
            task_kind: update.task_kind.clone(),
            task_id: update.task_id.clone(),
        });
        Ok(page.into_iter().map(|(_, update)| update).collect())
    }
}

pub(crate) fn migrate(connection: &mut Connection, timestamp: i64) -> rusqlite::Result<()> {
    let transaction = connection.transaction()?;
    transaction.execute_batch(
        "CREATE TABLE external_result_deliveries (
        task_kind TEXT NOT NULL CHECK(task_kind IN ('translation','explanation','learning')),
        task_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        output_id TEXT NOT NULL CHECK(length(output_id)>0),
        created_at_ms INTEGER NOT NULL,
        PRIMARY KEY(task_kind, task_id)
    ); CREATE INDEX external_result_deliveries_created
       ON external_result_deliveries(created_at_ms, task_kind, task_id);",
    )?;
    transaction.execute(
        "INSERT INTO schema_migrations(version, applied_at_ms) VALUES (20, ?1)",
        [timestamp],
    )?;
    transaction.commit()
}

pub(crate) fn record_completion(
    transaction: &Transaction<'_>,
    kind: &str,
    task_id: &str,
) -> rusqlite::Result<()> {
    let (table, output) = match kind {
        "translation" => ("agent_tasks", "output_version_id"),
        "explanation" => ("explanation_tasks", "output_explanation_id"),
        "learning" => ("learning_tasks", "output_dictionary_entry_id"),
        _ => return Err(rusqlite::Error::InvalidParameterName(kind.into())),
    };
    // Identifiers come exclusively from the fixed domain mapping above.
    transaction.execute(
        &format!(
            "INSERT INTO external_result_deliveries
        (task_kind,task_id,project_id,output_id,created_at_ms)
        SELECT ?1,id,project_id,{output},completed_at_ms FROM {table}
        WHERE id=?2 AND execution_kind='manual' AND status='completed'"
        ),
        params![kind, task_id],
    )?;
    Ok(())
}

#[cfg(test)]
pub(crate) fn pending(store: &ProjectStore) -> Result<Vec<ExternalAgentResultUpdate>, StoreError> {
    DeliveryQueue::default().next_pending(store)
}

fn pending_after(
    store: &ProjectStore,
    after: Option<&DeliveryCursor>,
) -> Result<Vec<(i64, ExternalAgentResultUpdate)>, StoreError> {
    let connection = store.connect()?;
    let mut statement = connection.prepare(
        "SELECT created_at_ms,task_kind,task_id,project_id,output_id
         FROM external_result_deliveries WHERE (created_at_ms,task_kind,task_id) > (?1,?2,?3)
         ORDER BY created_at_ms,task_kind,task_id LIMIT 100",
    )?;
    let rows = statement.query_map(
        params![
            after.map_or(i64::MIN, |cursor| cursor.created_at_ms),
            after.map_or("", |cursor| cursor.task_kind.as_str()),
            after.map_or("", |cursor| cursor.task_id.as_str()),
        ],
        |row| {
            let kind: String = row.get(1)?;
            let label = match kind.as_str() {
                "translation" => "字幕翻译",
                "explanation" => "场景解释",
                _ => "词义结果",
            };
            Ok((
                row.get(0)?,
                ExternalAgentResultUpdate {
                    task_kind: kind,
                    task_id: row.get(2)?,
                    project_id: row.get(3)?,
                    status: "completed".into(),
                    output_id: Some(row.get(4)?),
                    message: format!("已导入外部 Agent 返回的{label}"),
                },
            ))
        },
    )?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub(crate) fn acknowledge(
    store: &ProjectStore,
    updates: &[ExternalAgentResultUpdate],
) -> Result<(), StoreError> {
    let mut connection = store.connect()?;
    let transaction = connection.transaction()?;
    for update in updates {
        if update.status != "completed" || update.output_id.as_deref().is_none_or(str::is_empty) {
            return Err(StoreError::Validation("只能确认已完成的外部结果".into()));
        }
        transaction.execute(
            "DELETE FROM external_result_deliveries
            WHERE task_kind=?1 AND task_id=?2 AND project_id=?3 AND output_id=?4",
            params![
                update.task_kind,
                update.task_id,
                update.project_id,
                update.output_id
            ],
        )?;
    }
    transaction.commit()?;
    Ok(())
}
