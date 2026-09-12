use std::{fs, io, path::Path};
use rusqlite::{params, Connection, Transaction};
use super::StoreError;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct PendingProjectCleanup {
    pub project_id: String,
    #[cfg_attr(test, schemars(range(min = 1, max = 9007199254740991_u64)))]
    pub pending_directories: u64,
}

impl super::ProjectStore {
    pub fn next_pending_project_cleanup(&self) -> Result<Option<PendingProjectCleanup>, StoreError> {
        use rusqlite::OptionalExtension;
        Ok(self.connect()?.query_row(
            "SELECT project_id, COUNT(*) FROM project_cleanup_receipts GROUP BY project_id ORDER BY project_id LIMIT 1",
            [], |row| Ok(PendingProjectCleanup { project_id: row.get(0)?, pending_directories: row.get::<_, i64>(1)?.try_into().map_err(|_| rusqlite::Error::InvalidQuery)? }),
        ).optional()?)
    }
}

pub(super) fn migrate(connection: &mut Connection, timestamp: i64) -> Result<(), StoreError> {
    let transaction = connection.transaction()?;
    transaction.execute_batch("CREATE TABLE project_cleanup_receipts (
        project_id TEXT NOT NULL, kind TEXT NOT NULL, target_id TEXT NOT NULL,
        PRIMARY KEY(project_id, kind, target_id)
    );")?;
    transaction.execute("INSERT INTO schema_migrations(version, applied_at_ms) VALUES (21, ?1)", [timestamp])?;
    transaction.commit()?;
    Ok(())
}

pub(super) fn record(transaction: &Transaction<'_>, project: &str, kind: &str, id: &str) -> Result<(), StoreError> {
    transaction.execute("INSERT OR IGNORE INTO project_cleanup_receipts(project_id, kind, target_id) VALUES (?1, ?2, ?3)", params![project, kind, id])?;
    Ok(())
}

pub(super) fn record_remote(transaction: &Transaction<'_>, project: &str, root: &Path, locator: &str) -> Result<(), StoreError> {
    let invalid = || StoreError::Validation("远程副本不在受控目录中，项目尚未删除".into());
    let parent = Path::new(locator).parent().ok_or_else(invalid)?;
    let id = parent.file_name().and_then(|value| value.to_str()).ok_or_else(invalid)?;
    if uuid::Uuid::parse_str(id).is_err() { return Err(invalid()); }
    let expected = dunce::canonicalize(root).unwrap_or_else(|_| root.to_path_buf()).join(id);
    let actual = dunce::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
    if expected != actual { return Err(invalid()); }
    record(transaction, project, "remote-media", id)
}

// Only typed, application-owned UUID directories are executable receipts.
fn remove(root: &Path, kind: &str, id: &str) -> io::Result<()> {
    if !matches!(kind, "agent-tasks" | "summary-tasks" | "learning-cards" | "subtitle-burn-jobs" | "remote-media")
        || uuid::Uuid::parse_str(id).is_err() {
        return Err(io::Error::other("无效的清理记录"));
    }
    let root = dunce::canonicalize(root)?;
    let mut target = root.clone();
    let parts = if kind == "remote-media" { vec![id] } else { vec![kind, id] };
    for part in parts {
        target.push(part);
        match fs::symlink_metadata(&target) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
            Ok(_) => {}
        }
        if dunce::canonicalize(&target)? != target {
            return Err(io::Error::other("清理目录已重定向"));
        }
    }
    fs::remove_dir_all(target)
}

pub(super) fn retry_remote(connection: &Connection, root: &Path, remote: &Path, project: &str) -> Result<(u64, bool), StoreError> {
    let entries = connection.prepare("SELECT kind, target_id FROM project_cleanup_receipts WHERE project_id = ?1")?
        .query_map([project], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut pending = 0;
    let mut remote_removed = false;
    for (kind, id) in entries {
        let directory = if kind == "remote-media" { remote } else { root };
        if remove(directory, &kind, &id).is_ok() {
            remote_removed |= kind == "remote-media";
            connection.execute("DELETE FROM project_cleanup_receipts WHERE project_id = ?1 AND kind = ?2 AND target_id = ?3", params![project, kind, id])?;
        } else {
            pending += 1;
        }
    }
    Ok((pending, remote_removed))
}

#[cfg(test)]
fn retry(connection: &Connection, root: &Path, project: &str) -> Result<u64, StoreError> {
    retry_remote(connection, root, &root.join("remote-media"), project).map(|result| result.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[test]
    fn locked_remote_copy_can_be_cleaned_after_reopen() {
        use std::os::windows::fs::OpenOptionsExt;
        let directory = tempfile::tempdir().unwrap();
        let store = super::super::ProjectStore::open(directory.path().join("projects/app.db")).unwrap();
        let root = directory.path().join("remote-media");
        let target = root.join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&target).unwrap();
        let media = target.join("source.mp4");
        fs::write(&media, b"remote copy").unwrap();
        let project = store.create_remote_project(&media, "https://example.com/video.mp4", "video.mp4", None).unwrap();
        let locked = fs::OpenOptions::new().read(true).share_mode(1).open(&media).unwrap();
        let first = store.delete_project(&project.id).unwrap();
        assert!(media.exists());
        drop(locked);
        let database = store.database_path().to_owned();
        drop(store);
        let store = super::super::ProjectStore::open(database).unwrap();
        let pending = store.next_pending_project_cleanup().unwrap().unwrap();
        assert_eq!(pending.project_id, project.id);
        assert_eq!(pending.pending_directories, 1);
        let second = store.delete_project(&project.id).unwrap();
        assert!(!target.exists(), "remote cleanup lost: {first:?}; {second:?}");
        assert_eq!(first.cleanup_pending, 1);
        assert_eq!(second.cleanup_pending, 0);
        assert!(store.next_pending_project_cleanup().unwrap().is_none());
    }
    #[test]
    fn pending_discovery_advances_across_deleted_projects_after_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("projects/app.db");
        let store = super::super::ProjectStore::open(&database).unwrap();
        let mut ids = [uuid::Uuid::new_v4().to_string(), uuid::Uuid::new_v4().to_string()];
        ids.sort();
        let mut connection = store.connect().unwrap();
        let transaction = connection.transaction().unwrap();
        for id in &ids { record(&transaction, id, "learning-cards", id).unwrap(); }
        transaction.commit().unwrap();
        drop(connection);
        drop(store);
        let store = super::super::ProjectStore::open(&database).unwrap();
        for id in ids {
            let pending = store.next_pending_project_cleanup().unwrap().unwrap();
            assert_eq!(pending.project_id, id);
            assert_eq!(pending.pending_directories, 1);
            assert_eq!(store.delete_project(&id).unwrap().cleanup_pending, 0);
        }
        assert!(store.next_pending_project_cleanup().unwrap().is_none());
    }
    #[cfg(windows)]
    #[test]
    fn pending_remote_cleanup_uses_migrated_root() {
        use std::{os::windows::fs::OpenOptionsExt, thread, time::{Duration, Instant}};
        use crate::storage::{StorageManager, StorageArea, StorageMigrationMode, StorageMigrationStatus, PrepareStorageMigrationInput, StartStorageMigrationInput};
        let directory = tempfile::tempdir().unwrap();
        let app = directory.path().join("app");
        let manager = StorageManager::initialize(&app, app.clone(), None).unwrap();
        let store = super::super::ProjectStore::open(app.join("projects/siaovplay.db")).unwrap();
        let remote = manager.remote_media_root().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let source = remote.join(&id);
        fs::create_dir_all(&source).unwrap();
        let media = source.join("source.mp4");
        fs::write(&media, b"retained source copy").unwrap();
        let project = store.create_remote_project(&media, "https://example.com/video.mp4", "video.mp4", None).unwrap();
        let lock = fs::OpenOptions::new().read(true).share_mode(1).open(&media).unwrap();
        assert_eq!(store.delete_project_with_remote_media_root(&project.id, &remote).unwrap().cleanup_pending, 1);
        drop(lock);
        let destination = directory.path().join("destination");
        fs::create_dir_all(&destination).unwrap();
        let task = manager.prepare_migration(PrepareStorageMigrationInput { area: StorageArea::RemoteMedia, mode: StorageMigrationMode::Copy, destination_directory: destination.to_string_lossy().into_owned() }).unwrap();
        manager.start_migration(store.database_path().to_path_buf(), StartStorageMigrationInput { task_id: task.id.clone(), confirmed: true }).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while manager.get_migration(&task.id).unwrap().status == StorageMigrationStatus::Running && Instant::now() < deadline { thread::sleep(Duration::from_millis(10)); }
        assert_eq!(manager.get_migration(&task.id).unwrap().status, StorageMigrationStatus::Completed);
        let current = manager.remote_media_root().unwrap();
        assert!(current.join(&id).join("source.mp4").is_file());
        assert_eq!(store.delete_project_with_remote_media_root(&project.id, &current).unwrap().cleanup_pending, 0);
        assert!(!current.join(&id).exists());
        assert_eq!(fs::read(media).unwrap(), b"retained source copy");
    }
    #[cfg(windows)]
    #[test]
    fn redirected_task_directory_preserves_external_files_and_receipt() {
        let (directory, mut connection) = setup();
        let root = directory.path().join("app");
        let external = directory.path().join("external");
        fs::create_dir_all(root.join("summary-tasks")).unwrap();
        fs::create_dir_all(&external).unwrap();
        fs::write(external.join("sentinel"), b"retain").unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let link = root.join("summary-tasks").join(&id);
        let output = std::process::Command::new("cmd.exe").args(["/D", "/C", "mklink", "/J"])
            .arg(&link).arg(&external).output().unwrap();
        assert!(output.status.success(), "cannot create isolated junction fixture");
        let transaction = connection.transaction().unwrap();
        record(&transaction, "project", "summary-tasks", &id).unwrap();
        transaction.commit().unwrap();
        assert_eq!(retry(&connection, &root, "project").unwrap(), 1);
        assert_eq!(fs::read(external.join("sentinel")).unwrap(), b"retain");
        fs::remove_dir(&link).unwrap();
        assert_eq!(retry(&connection, &root, "project").unwrap(), 0);
        assert_eq!(fs::read(external.join("sentinel")).unwrap(), b"retain");
    }
    fn setup() -> (tempfile::TempDir, Connection) {
        let directory = tempfile::tempdir().unwrap();
        let mut connection = Connection::open(directory.path().join("receipts.db")).unwrap();
        connection.execute_batch("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at_ms INTEGER);").unwrap();
        migrate(&mut connection, 1).unwrap();
        (directory, connection)
    }
    #[test]
    fn invalid_targets_remain_pending_without_touching_unrelated_files() {
        let (directory, mut connection) = setup();
        let sentinel = directory.path().join("sentinel");
        fs::write(&sentinel, b"retain").unwrap();
        let transaction = connection.transaction().unwrap();
        for (kind, id) in [("summary-tasks", "../sentinel"), ("..", "sentinel"), ("unknown", "550e8400-e29b-41d4-a716-446655440000")] {
            record(&transaction, "project", kind, id).unwrap();
        }
        transaction.commit().unwrap();
        assert_eq!(retry(&connection, directory.path(), "project").unwrap(), 3);
        assert_eq!(retry(&connection, directory.path(), "project").unwrap(), 3);
        assert_eq!(fs::read(sentinel).unwrap(), b"retain");
    }
    #[test]
    fn receipts_rollback_and_retry_an_already_removed_target() {
        let (directory, mut connection) = setup();
        let id = uuid::Uuid::new_v4().to_string();
        {
            let transaction = connection.transaction().unwrap();
            record(&transaction, "project", "summary-tasks", &id).unwrap();
            // Simulate failure before the project deletion transaction commits.
        }
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM project_cleanup_receipts", [], |row| row.get::<_, i64>(0)).unwrap(), 0);
        let transaction = connection.transaction().unwrap();
        record(&transaction, "project", "summary-tasks", &id).unwrap();
        transaction.commit().unwrap();
        // A crash after filesystem removal but before receipt deletion is idempotent.
        assert_eq!(retry(&connection, directory.path(), "project").unwrap(), 0);
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM project_cleanup_receipts", [], |row| row.get::<_, i64>(0)).unwrap(), 0);
    }
}
