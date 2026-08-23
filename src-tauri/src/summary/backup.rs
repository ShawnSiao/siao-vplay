use std::{
    ffi::OsString,
    fs,
    fs::OpenOptions,
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{Connection, OpenFlags, backup::Backup};

use crate::store::StoreError;

const BACKUP_SUFFIX: &str = ".v17.backup";
const PARTIAL_SUFFIX: &str = ".part";

pub(crate) fn v17_backup_path(database_path: &Path) -> PathBuf {
    let mut path = OsString::from(database_path.as_os_str());
    path.push(BACKUP_SUFFIX);
    PathBuf::from(path)
}

pub(crate) fn create_v17_backup(
    source: &Connection,
    database_path: &Path,
) -> Result<PathBuf, StoreError> {
    let backup_path = v17_backup_path(database_path);
    if backup_path.exists() {
        ensure_file(&backup_path, "Schema 17 备份目标")?;
        validate_v17_backup(&backup_path)?;
        return Ok(backup_path);
    }
    let mut partial_path = OsString::from(backup_path.as_os_str());
    partial_path.push(PARTIAL_SUFFIX);
    let partial_path = PathBuf::from(partial_path);
    if partial_path.exists() {
        ensure_file(&partial_path, "Schema 17 临时备份目标")?;
        fs::remove_file(&partial_path)?;
    }

    let result = (|| -> Result<(), StoreError> {
        let mut destination = Connection::open(&partial_path)?;
        {
            let backup = Backup::new(source, &mut destination)?;
            backup.run_to_completion(128, Duration::from_millis(10), None)?;
        }
        drop(destination);
        validate_v17_backup(&partial_path)?;
        OpenOptions::new()
            .write(true)
            .open(&partial_path)?
            .sync_all()?;
        fs::rename(&partial_path, &backup_path)?;
        Ok(())
    })();
    if result.is_err() && partial_path.is_file() {
        let _ = fs::remove_file(&partial_path);
    }
    result?;
    Ok(backup_path)
}

fn ensure_file(path: &Path, label: &str) -> Result<(), StoreError> {
    if path.is_file() {
        return Ok(());
    }
    Err(StoreError::Validation(format!(
        "{label}不是文件：{}",
        path.display()
    )))
}

fn validate_v17_backup(path: &Path) -> Result<(), StoreError> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let version = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if version != 17 {
        return Err(StoreError::Validation(format!(
            "{} 的 Schema 版本为 {version}，预期为 17",
            path.display()
        )));
    }
    let quick_check =
        connection.query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))?;
    if quick_check != "ok" {
        return Err(StoreError::Validation(format!(
            "{} 未通过 SQLite quick_check：{quick_check}",
            path.display()
        )));
    }
    Ok(())
}
