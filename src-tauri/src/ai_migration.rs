use rusqlite::{Connection, Transaction, params};

use crate::store::StoreError;

pub fn migrate_if_needed(
    connection: &mut Connection,
    current_version: i64,
    applied_at_ms: i64,
) -> Result<(), StoreError> {
    if current_version >= 17 {
        return Ok(());
    }
    let transaction = connection.transaction()?;
    apply_schema_17(&transaction)?;
    transaction.execute(
        "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (17, ?1)",
        params![applied_at_ms],
    )?;
    let foreign_key_violations =
        transaction.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get::<_, i64>(0)
        })?;
    if foreign_key_violations != 0 {
        return Err(StoreError::Validation(
            "Schema 17 外键完整性检查失败".to_owned(),
        ));
    }
    transaction.commit()?;
    Ok(())
}

pub fn apply_schema_17(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    for table in ["agent_tasks", "explanation_tasks", "learning_tasks"] {
        add_execution_columns(transaction, table)?;
    }
    rebuild_agent_results(transaction)?;
    Ok(())
}

fn add_execution_columns(transaction: &Transaction<'_>, table: &str) -> Result<(), StoreError> {
    transaction.execute_batch(&format!(
        "ALTER TABLE {table}
         ADD COLUMN execution_kind TEXT NOT NULL DEFAULT 'manual'
             CHECK (execution_kind IN ('manual', 'codex', 'api'));
         ALTER TABLE {table} ADD COLUMN service_config_id TEXT;
         ALTER TABLE {table} ADD COLUMN service_revision INTEGER;
         ALTER TABLE {table} ADD COLUMN provider_id TEXT;
         ALTER TABLE {table} ADD COLUMN model_id TEXT;
         ALTER TABLE {table} ADD COLUMN provider_request_id TEXT;
         ALTER TABLE {table} ADD COLUMN usage_json TEXT;
         UPDATE {table} SET execution_kind = handoff_kind;"
    ))?;
    Ok(())
}

fn rebuild_agent_results(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    transaction.execute_batch(
        "DROP INDEX IF EXISTS agent_results_task_created;
         ALTER TABLE agent_results RENAME TO agent_results_v16;
         CREATE TABLE agent_results (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
            delivery_kind TEXT NOT NULL CHECK (delivery_kind IN ('manual', 'codex', 'api')),
            result_sha256 TEXT NOT NULL CHECK (length(result_sha256) = 64),
            raw_json TEXT NOT NULL,
            validation_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
            created_at_ms INTEGER NOT NULL
         );
         INSERT INTO agent_results (
            id, task_id, delivery_kind, result_sha256, raw_json,
            validation_json, status, created_at_ms
         )
         SELECT
            id, task_id, delivery_kind, result_sha256, raw_json,
            validation_json, status, created_at_ms
         FROM agent_results_v16;
         DROP TABLE agent_results_v16;
         CREATE INDEX agent_results_task_created
         ON agent_results(task_id, created_at_ms DESC);",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::{Connection, params};

    use super::*;

    #[test]
    fn schema_17_backfills_execution_and_preserves_legacy_results() {
        let mut connection = Connection::open_in_memory().expect("database");
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE agent_tasks (
                    id TEXT PRIMARY KEY,
                    handoff_kind TEXT NOT NULL CHECK (handoff_kind IN ('manual', 'codex'))
                 );
                 CREATE TABLE explanation_tasks (
                    id TEXT PRIMARY KEY,
                    handoff_kind TEXT NOT NULL CHECK (handoff_kind IN ('manual', 'codex'))
                 );
                 CREATE TABLE learning_tasks (
                    id TEXT PRIMARY KEY,
                    handoff_kind TEXT NOT NULL CHECK (handoff_kind IN ('manual', 'codex'))
                 );
                 CREATE TABLE agent_results (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
                    delivery_kind TEXT NOT NULL CHECK (delivery_kind IN ('manual', 'codex')),
                    result_sha256 TEXT NOT NULL CHECK (length(result_sha256) = 64),
                    raw_json TEXT NOT NULL,
                    validation_json TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
                    created_at_ms INTEGER NOT NULL
                 );
                 CREATE INDEX agent_results_task_created
                 ON agent_results(task_id, created_at_ms DESC);
                 INSERT INTO agent_tasks VALUES ('task', 'codex');
                 INSERT INTO explanation_tasks VALUES ('explanation', 'manual');
                 INSERT INTO learning_tasks VALUES ('learning', 'codex');
                 INSERT INTO agent_results VALUES (
                    'result', 'task', 'codex',
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    '{}', '{}', 'accepted', 1
                 );",
            )
            .expect("v16 fixture");
        let transaction = connection.transaction().expect("transaction");
        apply_schema_17(&transaction).expect("migration");
        transaction.commit().expect("commit");
        assert_eq!(
            connection
                .query_row(
                    "SELECT execution_kind FROM agent_tasks WHERE id = ?1",
                    params!["task"],
                    |row| row.get::<_, String>(0)
                )
                .expect("execution"),
            "codex"
        );
        connection
            .execute(
                "UPDATE explanation_tasks SET execution_kind = 'api' WHERE id = 'explanation'",
                [],
            )
            .expect("api execution");
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM agent_results", [], |row| row
                    .get::<_, i64>(0))
                .expect("results"),
            1
        );
    }
}
