use crate::store::StoreError;
use rusqlite::{
    Connection, OpenFlags,
    backup::{Backup, StepResult},
};
use std::{
    fs,
    path::Path,
    time::{Duration, Instant},
};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupPolicy {
    backup_timeout_seconds: u64,
    pages_per_step: i32,
    busy_retry_delay_ms: u64,
}

pub(crate) fn check_version(connection: &Connection, supported: i64) -> Result<i64, StoreError> {
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations')",
        [], |row| row.get(0),
    )?;
    let version = if exists {
        connection.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get::<_, i64>(0),
        )?
    } else {
        0
    };
    if version > supported {
        return Err(StoreError::UnsupportedSchema {
            found: version,
            supported,
        });
    }
    if version < 0 {
        return Err(StoreError::Validation("数据库版本无效".into()));
    }
    Ok(version)
}

pub(crate) fn backup_before_upgrade(
    source: &Connection,
    path: &Path,
    supported: i64,
) -> Result<(), StoreError> {
    let version = check_version(source, supported)?;
    if version == 0 || version == supported {
        return Ok(());
    }
    let policy: BackupPolicy =
        serde_json::from_str(include_str!("database-upgrade-policy.json"))
            .map_err(|error| StoreError::Validation(format!("升级备份配置无效：{error}")))?;
    if !(1..=3600).contains(&policy.backup_timeout_seconds)
        || !(1..=4096).contains(&policy.pages_per_step)
        || !(1..=1000).contains(&policy.busy_retry_delay_ms)
    {
        return Err(StoreError::Validation("升级备份配置超出有效范围".into()));
    }
    let directory = path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("upgrade-backups");
    fs::create_dir_all(&directory)?;
    let target = directory.join(format!(
        "v{version}-to-v{supported}-{}.sqlite3",
        uuid::Uuid::new_v4()
    ));
    let partial = target.with_extension("part");
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)?;
    let result = (|| -> Result<(), StoreError> {
        let mut destination = Connection::open(&partial)?;
        {
            let backup = Backup::new(source, &mut destination)?;
            let started = Instant::now();
            loop {
                if started.elapsed() >= Duration::from_secs(policy.backup_timeout_seconds) {
                    return Err(StoreError::Validation(
                        "升级备份超时，尚未开始修改数据库。请关闭其他占用后重试。".into(),
                    ));
                }
                match backup.step(policy.pages_per_step)? {
                    StepResult::Done => break,
                    StepResult::More => {}
                    StepResult::Busy | StepResult::Locked => {
                        std::thread::sleep(Duration::from_millis(policy.busy_retry_delay_ms))
                    }
                    _ => return Err(StoreError::Validation("升级备份返回未知状态".into())),
                }
            }
        }
        destination
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;")?;
        drop(destination);
        let verified = Connection::open_with_flags(&partial, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let integrity: String = verified.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
        let has_foreign_key_error = verified.prepare("PRAGMA foreign_key_check")?.exists([])?;
        if check_version(&verified, supported)? != version
            || integrity != "ok"
            || has_foreign_key_error
        {
            return Err(StoreError::Validation(
                "升级备份未通过完整性检查，尚未开始修改数据库".into(),
            ));
        }
        drop(verified);
        fs::OpenOptions::new()
            .write(true)
            .open(&partial)?
            .sync_all()?;
        fs::rename(&partial, &target)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}

#[cfg(test)]
mod tests {
    use crate::store::{ProjectStore, StoreError};
    use rusqlite::Connection;
    #[test]
    fn a_future_database_is_rejected_before_changing_its_journal_or_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("future.db");
        let database = Connection::open(&path).unwrap();
        database.execute_batch("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at_ms INTEGER NOT NULL); INSERT INTO schema_migrations VALUES (999, 1); CREATE TABLE future_assets(value TEXT); INSERT INTO future_assets VALUES ('preserve'); PRAGMA journal_mode=DELETE;").unwrap();
        drop(database);
        let before = std::fs::read(&path).unwrap();
        assert!(matches!(
            ProjectStore::open(&path),
            Err(StoreError::UnsupportedSchema { .. })
        ));
        assert_eq!(
            crate::agent_task_files::hash_bytes(&std::fs::read(&path).unwrap()),
            crate::agent_task_files::hash_bytes(&before)
        );
        let database = Connection::open(&path).unwrap();
        let mode: String = database
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        assert_eq!(mode, "delete");
    }
    fn pending_upgrade() -> crate::understanding::test_fixture::Fixture {
        let fixture = crate::understanding::test_fixture::Fixture::new();
        fixture.store.connect().unwrap().execute_batch("DROP TABLE external_result_deliveries; DELETE FROM schema_migrations WHERE version >= 19; ALTER TABLE subtitle_burn_jobs DROP COLUMN burn_style_json; UPDATE playback_states SET position_ms = 4200;").unwrap();
        fixture
    }
    #[test]
    fn an_upgrade_keeps_a_readable_backup_of_the_original_assets() {
        let fixture = pending_upgrade();
        let path = fixture.store.database_path();
        let reopened = ProjectStore::open(path).unwrap();
        assert_eq!(
            reopened
                .get_project(&fixture.project_id)
                .unwrap()
                .playback_state
                .position_ms,
            4200
        );
        let directory = path.parent().unwrap().join("upgrade-backups");
        let backups: Vec<_> = std::fs::read_dir(directory)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        assert_eq!(backups.len(), 1);
        let backup =
            Connection::open_with_flags(&backups[0], rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .unwrap();
        assert_eq!(
            backup
                .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
            18
        );
        assert_eq!(
            backup
                .query_row("SELECT COUNT(*) FROM subtitle_segments", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            4
        );
        assert_eq!(
            backup
                .query_row("SELECT position_ms FROM playback_states", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            4200
        );
    }
    #[test]
    fn backup_failure_stops_before_schema_changes() {
        let fixture = pending_upgrade();
        let path = fixture.store.database_path();
        std::fs::write(
            path.parent().unwrap().join("upgrade-backups"),
            b"not a directory",
        )
        .unwrap();
        assert!(ProjectStore::open(path).is_err());
        let connection = Connection::open(path).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
            18
        );
    }

    #[test]
    fn current_database_does_not_create_upgrade_backups() {
        let fixture = crate::understanding::test_fixture::Fixture::new();
        ProjectStore::open(fixture.store.database_path()).unwrap();
        assert!(
            !fixture
                .store
                .database_path()
                .parent()
                .unwrap()
                .join("upgrade-backups")
                .exists()
        );
    }

    #[test]
    fn a_failed_migration_keeps_each_original_backup() {
        let fixture = pending_upgrade();
        let path = fixture.store.database_path();
        // Force the real v19 migration to fail after the generic backup succeeds.
        fixture
            .store
            .connect()
            .unwrap()
            .execute_batch("CREATE TABLE agent_tasks_v19(blocker TEXT);")
            .unwrap();
        assert!(ProjectStore::open(path).is_err());
        assert!(ProjectStore::open(path).is_err());
        let backups: Vec<_> = std::fs::read_dir(path.parent().unwrap().join("upgrade-backups"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        assert_eq!(backups.len(), 2);
        for backup in backups {
            let connection =
                Connection::open_with_flags(backup, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                    .unwrap();
            assert_eq!(super::check_version(&connection, 19).unwrap(), 18);
            assert_eq!(
                connection
                    .query_row("SELECT position_ms FROM playback_states", [], |row| row
                        .get::<_, i64>(0))
                    .unwrap(),
                4200
            );
        }
    }
}
