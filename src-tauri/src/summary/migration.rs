use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, Transaction, params};

use super::{backup, prompts, schema};
use crate::store::StoreError;

pub(crate) fn migrate(
    connection: &mut Connection,
    database_path: &Path,
    existing_database: bool,
) -> Result<(), StoreError> {
    let applied_at_ms = now_ms()?;
    let current_version = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    crate::ai_migration::migrate_if_needed(connection, current_version, applied_at_ms)?;
    let current_version = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    migrate_schema_18(
        connection,
        current_version,
        existing_database,
        database_path,
        applied_at_ms,
    )
}

fn migrate_schema_18(
    connection: &mut Connection,
    current_version: i64,
    existing_database: bool,
    database_path: &Path,
    applied_at_ms: i64,
) -> Result<(), StoreError> {
    if current_version >= 18 {
        return Ok(());
    }
    if current_version != 17 {
        return Err(StoreError::Validation(format!(
            "Schema 18 迁移需要 Schema 17，当前为 {current_version}"
        )));
    }
    if existing_database {
        backup::create_v17_backup(connection, database_path)?;
    }
    let transaction = connection.transaction()?;
    apply_schema_and_seed(&transaction, applied_at_ms)?;
    transaction.execute(
        "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (18, ?1)",
        params![applied_at_ms],
    )?;
    ensure_foreign_keys(&transaction)?;
    transaction.commit()?;
    Ok(())
}

fn now_ms() -> Result<i64, StoreError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| StoreError::Validation("系统时间早于 Unix epoch".to_owned()))?;
    i64::try_from(duration.as_millis())
        .map_err(|_| StoreError::Validation("系统时间超出支持范围".to_owned()))
}

fn apply_schema_and_seed(
    transaction: &Transaction<'_>,
    applied_at_ms: i64,
) -> Result<(), StoreError> {
    schema::apply_schema_18(transaction)?;
    prompts::seed_built_ins(transaction, applied_at_ms)
}

fn ensure_foreign_keys(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    let violation = {
        let mut statement = transaction.prepare("PRAGMA foreign_key_check")?;
        let mut rows = statement.query([])?;
        rows.next()?
            .map(|row| {
                Ok::<String, rusqlite::Error>(format!(
                    "table={} rowid={:?} parent={} fkid={}",
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?
                ))
            })
            .transpose()?
    };
    if let Some(violation) = violation {
        return Err(StoreError::Validation(format!(
            "Schema 18 外键完整性检查失败：{violation}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::OpenFlags;
    use std::path::PathBuf;

    fn create_v17_fixture(path: &Path, corrupt: bool) {
        let connection = Connection::open(path).unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys = OFF;
                 CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at_ms INTEGER NOT NULL
                 );
                 INSERT INTO schema_migrations VALUES (17, 1);
                 CREATE TABLE projects (id TEXT PRIMARY KEY);
                 INSERT INTO projects VALUES ('project');
                 CREATE TABLE subtitle_versions (
                    id TEXT PRIMARY KEY,
                    project_id TEXT REFERENCES projects(id)
                 );
                 INSERT INTO subtitle_versions VALUES ('subtitle', 'project');
                 CREATE TABLE legacy_links (
                    id TEXT PRIMARY KEY,
                    project_id TEXT REFERENCES projects(id)
                 );",
            )
            .unwrap();
        if corrupt {
            connection
                .execute("INSERT INTO legacy_links VALUES ('bad', 'missing')", [])
                .unwrap();
        }
    }

    #[test]
    fn upgrades_atomically_and_creates_a_verified_v17_backup() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("projects.sqlite3");
        create_v17_fixture(&path, false);
        let mut connection = Connection::open(&path).unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();
        migrate_schema_18(&mut connection, 17, true, &path, 2).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
            18
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM analysis_prompt_templates",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            7
        );
        let backup_path = backup::v17_backup_path(&path);
        assert!(!PathBuf::from(format!("{}-wal", backup_path.display())).exists());
        assert!(!PathBuf::from(format!("{}-shm", backup_path.display())).exists());
        assert!(!PathBuf::from(format!("{}.part-wal", backup_path.display())).exists());
        assert!(!PathBuf::from(format!("{}.part-shm", backup_path.display())).exists());
        let backup =
            Connection::open_with_flags(backup_path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        assert_eq!(
            backup
                .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
            17
        );
    }

    #[test]
    fn rolls_back_schema_when_foreign_key_check_fails() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("corrupt.sqlite3");
        create_v17_fixture(&path, true);
        let mut connection = Connection::open(&path).unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();
        let result = migrate_schema_18(&mut connection, 17, true, &path, 2);
        assert!(matches!(result, Err(StoreError::Validation(_))));
        assert_eq!(
            connection
                .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
            17
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master
                     WHERE type = 'table' AND name = 'summary_tasks'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
    }
}
