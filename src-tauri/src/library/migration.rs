use std::{
    ffi::OsString,
    fs,
    fs::OpenOptions,
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{Connection, OpenFlags, Transaction, backup::Backup};
use thiserror::Error;

const V14_BACKUP_SUFFIX: &str = ".v14.backup";
const PARTIAL_SUFFIX: &str = ".part";

#[derive(Debug, Error)]
pub(crate) enum MigrationError {
    #[error("集合数据库迁移失败：{0}")]
    Database(#[from] rusqlite::Error),
    #[error("集合数据库备份失败：{0}")]
    FileSystem(#[from] std::io::Error),
    #[error("v14 备份文件无效：{0}")]
    InvalidBackup(String),
    #[error("数据库外键检查失败：{0}")]
    ForeignKeyViolation(String),
}

pub(crate) fn v14_backup_path(database_path: &Path) -> PathBuf {
    let mut path = OsString::from(database_path.as_os_str());
    path.push(V14_BACKUP_SUFFIX);
    PathBuf::from(path)
}

pub(crate) fn create_v14_backup(
    source: &Connection,
    database_path: &Path,
) -> Result<PathBuf, MigrationError> {
    let backup_path = v14_backup_path(database_path);
    if backup_path.exists() {
        if !backup_path.is_file() {
            return Err(MigrationError::InvalidBackup(format!(
                "备份目标不是文件：{}",
                backup_path.display()
            )));
        }
        validate_v14_backup(&backup_path)?;
        return Ok(backup_path);
    }

    let mut partial_path = OsString::from(backup_path.as_os_str());
    partial_path.push(PARTIAL_SUFFIX);
    let partial_path = PathBuf::from(partial_path);
    if partial_path.exists() {
        if !partial_path.is_file() {
            return Err(MigrationError::InvalidBackup(format!(
                "临时备份目标不是文件：{}",
                partial_path.display()
            )));
        }
        fs::remove_file(&partial_path)?;
    }

    let result = (|| -> Result<(), MigrationError> {
        let mut destination = Connection::open(&partial_path)?;
        {
            let backup = Backup::new(source, &mut destination)?;
            backup.run_to_completion(128, Duration::from_millis(10), None)?;
        }
        drop(destination);

        validate_v14_backup(&partial_path)?;
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

fn validate_v14_backup(path: &Path) -> Result<(), MigrationError> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let version = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if version != 14 {
        return Err(MigrationError::InvalidBackup(format!(
            "{} 的 Schema 版本为 {version}，预期为 14",
            path.display()
        )));
    }
    let quick_check =
        connection.query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))?;
    if quick_check != "ok" {
        return Err(MigrationError::InvalidBackup(format!(
            "{} 未通过 SQLite quick_check：{quick_check}",
            path.display()
        )));
    }
    Ok(())
}

pub(crate) fn apply_schema_15(transaction: &Transaction<'_>) -> Result<(), MigrationError> {
    transaction.execute_batch(
        "CREATE TABLE library_roots (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL CHECK (length(trim(path)) > 0),
            path_key TEXT NOT NULL UNIQUE CHECK (length(trim(path_key)) > 0),
            display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
            scan_policy TEXT NOT NULL DEFAULT 'manual'
                CHECK (scan_policy IN ('manual')),
            availability TEXT NOT NULL DEFAULT 'available'
                CHECK (availability IN ('available', 'offline')),
            last_scanned_at_ms INTEGER
                CHECK (last_scanned_at_ms IS NULL OR last_scanned_at_ms >= 0),
            created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
            updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
         );

         CREATE INDEX library_roots_availability
         ON library_roots(availability, updated_at_ms DESC);

         CREATE TABLE collections (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL CHECK (kind IN ('series', 'folder', 'manual')),
            title TEXT NOT NULL CHECK (length(trim(title)) > 0),
            root_id TEXT REFERENCES library_roots(id) ON DELETE SET NULL,
            system_key TEXT UNIQUE
                CHECK (system_key IS NULL OR system_key IN ('watch_later')),
            poster_path TEXT,
            sort_mode TEXT NOT NULL DEFAULT 'episode'
                CHECK (sort_mode IN ('episode', 'natural', 'manual', 'added_at')),
            auto_play_next INTEGER NOT NULL DEFAULT 0
                CHECK (auto_play_next IN (0, 1)),
            last_opened_at_ms INTEGER
                CHECK (last_opened_at_ms IS NULL OR last_opened_at_ms >= 0),
            created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
            updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
         );

         CREATE INDEX collections_root_kind
         ON collections(root_id, kind, title);

         CREATE INDEX collections_last_opened
         ON collections(last_opened_at_ms DESC, updated_at_ms DESC);

         CREATE TABLE collection_items (
            collection_id TEXT NOT NULL
                REFERENCES collections(id) ON DELETE CASCADE,
            project_id TEXT NOT NULL
                REFERENCES projects(id) ON DELETE CASCADE,
            season_number INTEGER
                CHECK (season_number IS NULL OR season_number >= 0),
            episode_number INTEGER
                CHECK (episode_number IS NULL OR episode_number >= 0),
            absolute_order INTEGER NOT NULL CHECK (absolute_order >= 0),
            display_title TEXT NOT NULL CHECK (length(trim(display_title)) > 0),
            relative_path TEXT,
            relative_path_key TEXT,
            availability TEXT NOT NULL DEFAULT 'available'
                CHECK (availability IN ('available', 'missing', 'root_offline', 'changed')),
            source_size_bytes INTEGER
                CHECK (source_size_bytes IS NULL OR source_size_bytes >= 0),
            source_modified_at_ms INTEGER
                CHECK (source_modified_at_ms IS NULL OR source_modified_at_ms >= 0),
            quick_fingerprint TEXT
                CHECK (quick_fingerprint IS NULL OR length(quick_fingerprint) = 64),
            created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
            updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
            PRIMARY KEY (collection_id, project_id),
            CHECK (
                (relative_path IS NULL AND relative_path_key IS NULL)
                OR (relative_path IS NOT NULL AND relative_path_key IS NOT NULL)
            )
         );

         CREATE UNIQUE INDEX collection_items_relative_path
         ON collection_items(collection_id, relative_path_key)
         WHERE relative_path_key IS NOT NULL;

         CREATE INDEX collection_items_project
         ON collection_items(project_id, collection_id);

         CREATE INDEX collection_items_stable_order
         ON collection_items(
            collection_id, season_number, episode_number, absolute_order, project_id
         );

         ALTER TABLE playback_states
         ADD COLUMN completed_at_ms INTEGER
            CHECK (completed_at_ms IS NULL OR completed_at_ms >= 0);",
    )?;
    Ok(())
}

pub(crate) fn apply_schema_16(transaction: &Transaction<'_>) -> Result<(), MigrationError> {
    transaction.execute_batch(
        "CREATE TABLE library_root_items (
            root_id TEXT NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            season_number INTEGER
                CHECK (season_number IS NULL OR season_number >= 0),
            episode_number INTEGER
                CHECK (episode_number IS NULL OR episode_number >= 0),
            absolute_order INTEGER NOT NULL CHECK (absolute_order >= 0),
            display_title TEXT NOT NULL CHECK (length(trim(display_title)) > 0),
            relative_path TEXT,
            relative_path_key TEXT,
            availability TEXT NOT NULL DEFAULT 'available'
                CHECK (availability IN ('available', 'missing', 'root_offline', 'changed')),
            source_size_bytes INTEGER
                CHECK (source_size_bytes IS NULL OR source_size_bytes >= 0),
            source_modified_at_ms INTEGER
                CHECK (source_modified_at_ms IS NULL OR source_modified_at_ms >= 0),
            quick_fingerprint TEXT
                CHECK (quick_fingerprint IS NULL OR length(quick_fingerprint) = 64),
            created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
            updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
            PRIMARY KEY (root_id, project_id),
            CHECK (
                (relative_path IS NULL AND relative_path_key IS NULL)
                OR (relative_path IS NOT NULL AND relative_path_key IS NOT NULL)
            )
         );

         CREATE UNIQUE INDEX library_root_items_relative_path
         ON library_root_items(root_id, relative_path_key)
         WHERE relative_path_key IS NOT NULL;

         CREATE INDEX library_root_items_project
         ON library_root_items(project_id, root_id);

         INSERT OR IGNORE INTO library_root_items (
             root_id, project_id, season_number, episode_number, absolute_order,
             display_title, relative_path, relative_path_key, availability,
             source_size_bytes, source_modified_at_ms, quick_fingerprint,
             created_at_ms, updated_at_ms
         )
         SELECT
             c.root_id, ci.project_id, ci.season_number, ci.episode_number,
             ci.absolute_order, ci.display_title, ci.relative_path,
             ci.relative_path_key, ci.availability, ci.source_size_bytes,
             ci.source_modified_at_ms, ci.quick_fingerprint,
             ci.created_at_ms, ci.updated_at_ms
         FROM collections c
         JOIN collection_items ci ON ci.collection_id = c.id
         WHERE c.root_id IS NOT NULL;",
    )?;
    Ok(())
}

pub(crate) fn ensure_foreign_keys(transaction: &Transaction<'_>) -> Result<(), MigrationError> {
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
        return Err(MigrationError::ForeignKeyViolation(violation));
    }
    Ok(())
}
