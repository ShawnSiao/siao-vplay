use std::{fs, path::Path, time::Duration};

use rusqlite::{Connection, OpenFlags, backup::Backup, params};

use super::{StorageArea, StorageError};

const APP_PATH_COLUMNS: &[(&str, &str, bool)] = &[
    ("media_sources", "locator", false),
    ("media_sources", "poster_path", false),
    ("media_artifacts", "path", false),
    ("transcription_jobs", "model_path", false),
    ("transcription_jobs", "runtime_path", false),
    ("explanation_frames", "path", false),
    ("learning_cards", "screenshot_path", false),
    ("subtitle_burn_jobs", "destination_directory", false),
    ("subtitle_burn_jobs", "output_path", false),
    ("subtitle_burn_jobs", "temporary_output_path", false),
    ("subtitle_burn_jobs", "manifest_path", false),
    ("subtitle_burn_jobs", "subtitle_path", false),
    ("subtitle_burn_jobs", "runtime_path", false),
    ("summary_chunks", "frame_manifest_json", true),
];

pub(crate) fn backup_database(source: &Path, destination: &Path) -> Result<(), StorageError> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    remove_database_files(destination)?;
    let source = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut destination_connection = Connection::open(destination)?;
    {
        let backup = Backup::new(&source, &mut destination_connection)?;
        backup.run_to_completion(128, Duration::from_millis(10), None)?;
    }
    destination_connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;")?;
    drop(destination_connection);
    verify_database(destination)
}

pub(crate) fn verify_database(path: &Path) -> Result<(), StorageError> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let quick_check =
        connection.query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))?;
    if quick_check != "ok" {
        return Err(StorageError::MigrationIntegrity(format!(
            "SQLite quick_check 未通过：{quick_check}"
        )));
    }
    let violations =
        connection.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get::<_, i64>(0)
        })?;
    if violations != 0 {
        return Err(StorageError::MigrationIntegrity(format!(
            "SQLite 外键检查发现 {violations} 项异常"
        )));
    }
    Ok(())
}

pub(crate) fn rewrite_managed_paths(
    database: &Path,
    area: StorageArea,
    source: &Path,
    destination: &Path,
) -> Result<(), StorageError> {
    let mut connection = Connection::open(database)?;
    let transaction = connection.transaction()?;
    rewrite_paths_in_transaction(&transaction, area, source, destination)?;
    transaction.commit()?;
    verify_database(database)
}

pub(super) fn rewrite_paths_in_transaction(connection: &Connection, area: StorageArea, source: &Path, destination: &Path) -> Result<(), StorageError> {
    let columns: &[(&str, &str, bool)] = match area {
        StorageArea::AppData => APP_PATH_COLUMNS,
        StorageArea::RemoteMedia => &[("media_sources", "locator", false)],
        StorageArea::MediaCache => &[
            ("media_sources", "poster_path", false),
            ("media_artifacts", "path", false),
        ],
    };
    for (table, column, json) in columns {
        rewrite_column(connection, table, column, *json, source, destination)?;
    }
    Ok(())
}

pub(crate) fn clear_cache_references(database: &Path) -> Result<(), StorageError> {
    let connection = Connection::open(database)?;
    connection.execute_batch(
        "BEGIN IMMEDIATE;
         UPDATE media_sources SET poster_path = NULL;
         DELETE FROM media_artifacts;
         COMMIT;",
    )?;
    verify_database(database)
}

pub(crate) fn ensure_idle(database: &Path) -> Result<(), StorageError> {
    let connection = Connection::open(database)?;
    let checks = [
        ("media_artifacts", "'queued','running'"),
        (
            "transcription_jobs",
            "'queued','extracting','transcribing','validating'",
        ),
        (
            "agent_tasks",
            "'awaiting_external_result','queued','running','validating'",
        ),
        (
            "explanation_tasks",
            "'awaiting_external_result','queued','running','validating'",
        ),
        (
            "learning_tasks",
            "'awaiting_external_result','queued','running','validating'",
        ),
        ("subtitle_burn_jobs", "'queued','running','validating'"),
        (
            "summary_tasks",
            "'awaiting_external_result','queued','running','paused','validating'",
        ),
    ];
    for (table, statuses) in checks {
        if !table_exists(&connection, table)? {
            continue;
        }
        let query =
            format!("SELECT EXISTS(SELECT 1 FROM \"{table}\" WHERE status IN ({statuses}))");
        if connection.query_row(&query, [], |row| row.get::<_, bool>(0))? {
            return Err(StorageError::MigrationBusy);
        }
    }
    Ok(())
}

fn rewrite_column(
    connection: &Connection,
    table: &str,
    column: &str,
    json: bool,
    source: &Path,
    destination: &Path,
) -> Result<(), StorageError> {
    if !table_exists(connection, table)? || !column_exists(connection, table, column)? {
        return Ok(());
    }
    let query =
        format!("SELECT rowid, \"{column}\" FROM \"{table}\" WHERE \"{column}\" IS NOT NULL");
    let mut statement = connection.prepare(&query)?;
    let values = statement
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let update = format!("UPDATE \"{table}\" SET \"{column}\" = ?1 WHERE rowid = ?2");
    for (rowid, value) in values {
        let replacement = if json {
            rewrite_json_paths(&value, source, destination)?
        } else {
            rewrite_path(&value, source, destination)
        };
        if let Some(replacement) = replacement {
            connection.execute(&update, params![replacement, rowid])?;
        }
    }
    Ok(())
}

fn rewrite_json_paths(
    value: &str,
    source: &Path,
    destination: &Path,
) -> Result<Option<String>, StorageError> {
    let mut json: serde_json::Value = serde_json::from_str(value)?;
    let changed = rewrite_json_value(&mut json, source, destination);
    changed
        .then(|| serde_json::to_string(&json))
        .transpose()
        .map_err(Into::into)
}

fn rewrite_json_value(value: &mut serde_json::Value, source: &Path, destination: &Path) -> bool {
    match value {
        serde_json::Value::String(text) => {
            rewrite_path(text, source, destination).is_some_and(|replacement| {
                *text = replacement;
                true
            })
        }
        serde_json::Value::Array(values) => {
            let mut changed = false;
            for value in values {
                changed |= rewrite_json_value(value, source, destination);
            }
            changed
        }
        serde_json::Value::Object(values) => {
            let mut changed = false;
            for value in values.values_mut() {
                changed |= rewrite_json_value(value, source, destination);
            }
            changed
        }
        _ => false,
    }
}

fn rewrite_path(value: &str, source: &Path, destination: &Path) -> Option<String> {
    let path = Path::new(value);
    let relative = path.strip_prefix(source).ok()?;
    Some(destination.join(relative).to_string_lossy().into_owned())
}

fn table_exists(connection: &Connection, table: &str) -> Result<bool, StorageError> {
    Ok(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        params![table],
        |row| row.get(0),
    )?)
}

fn column_exists(connection: &Connection, table: &str, column: &str) -> Result<bool, StorageError> {
    let query = format!("PRAGMA table_info(\"{table}\")");
    let mut statement = connection.prepare(&query)?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(names.iter().any(|name| name == column))
}

fn remove_database_files(database: &Path) -> Result<(), StorageError> {
    for path in [
        database.to_path_buf(),
        Path::new(&format!("{}-wal", database.display())).to_path_buf(),
        Path::new(&format!("{}-shm", database.display())).to_path_buf(),
    ] {
        if path.is_file() {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_only_paths_below_the_selected_root() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("database.sqlite3");
        let connection = Connection::open(&database).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE media_sources (locator TEXT, poster_path TEXT);
             CREATE TABLE media_artifacts (path TEXT);
             INSERT INTO media_sources VALUES ('C:\\old\\remote\\a.mp4', 'D:\\outside.jpg');",
            )
            .unwrap();
        drop(connection);
        rewrite_managed_paths(
            &database,
            StorageArea::RemoteMedia,
            Path::new("C:\\old\\remote"),
            Path::new("W:\\media"),
        )
        .unwrap();
        let connection = Connection::open(database).unwrap();
        let locator: String = connection
            .query_row("SELECT locator FROM media_sources", [], |row| row.get(0))
            .unwrap();
        assert_eq!(locator, "W:\\media\\a.mp4");
    }
}
