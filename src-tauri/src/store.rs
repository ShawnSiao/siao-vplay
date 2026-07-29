use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use thiserror::Error;
use uuid::Uuid;

use crate::domain::{
    CreateLocalProjectInput, DeleteProjectResult, MediaSource, MediaSourceKind, PlaybackState,
    Project, ProjectStatus, RelinkProjectMediaInput, UpdatePlaybackStateInput,
};

const CURRENT_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("数据库错误：{0}")]
    Database(#[from] rusqlite::Error),
    #[error("文件系统错误：{0}")]
    FileSystem(#[from] std::io::Error),
    #[error("找不到项目：{0}")]
    ProjectNotFound(String),
    #[error("输入无效：{0}")]
    Validation(String),
    #[error("数据库版本 {found} 高于当前支持版本 {supported}")]
    UnsupportedSchema { found: i64, supported: i64 },
    #[error("数据库中的媒体来源类型无效：{0}")]
    InvalidMediaSourceKind(String),
}

#[derive(Clone, Debug)]
pub struct ProjectStore {
    database_path: PathBuf,
}

impl ProjectStore {
    pub fn open(database_path: impl Into<PathBuf>) -> Result<Self, StoreError> {
        let database_path = database_path.into();
        if let Some(parent) = database_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let store = Self { database_path };
        let mut connection = store.connect()?;
        Self::migrate(&mut connection)?;
        Ok(store)
    }

    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    #[cfg(test)]
    fn schema_version(&self) -> Result<i64, StoreError> {
        let connection = self.connect()?;
        let version = connection.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;
        Ok(version)
    }

    pub fn create_local_project(
        &self,
        input: CreateLocalProjectInput,
    ) -> Result<Project, StoreError> {
        let media_path = canonical_media_path(&input.media_path)?;
        let display_name = file_display_name(&media_path)?;
        let title = normalize_project_title(input.title.as_deref(), &media_path)?;
        let timestamp = now_ms()?;
        let project_id = Uuid::new_v4().to_string();
        let media_source_id = Uuid::new_v4().to_string();

        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO projects (
                id, title, revision, created_at_ms, updated_at_ms, last_opened_at_ms
             ) VALUES (?1, ?2, 1, ?3, ?3, ?3)",
            params![project_id, title, timestamp],
        )?;
        transaction.execute(
            "INSERT INTO media_sources (
                id, project_id, kind, locator, display_name, is_primary,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)",
            params![
                media_source_id,
                project_id,
                MediaSourceKind::LocalFile.as_database_value(),
                path_to_string(&media_path),
                display_name,
                timestamp
            ],
        )?;
        transaction.execute(
            "INSERT INTO playback_states (
                project_id, position_ms, duration_ms, volume, playback_rate, updated_at_ms
             ) VALUES (?1, 0, NULL, 1.0, 1.0, ?2)",
            params![project_id, timestamp],
        )?;
        transaction.commit()?;

        self.get_project(&project_id)
    }

    pub fn list_projects(&self) -> Result<Vec<Project>, StoreError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT p.id
             FROM projects p
             ORDER BY p.last_opened_at_ms DESC, p.created_at_ms DESC, p.id ASC",
        )?;
        let project_ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        project_ids
            .iter()
            .map(|project_id| Self::load_project(&connection, project_id))
            .collect()
    }

    pub fn get_project(&self, project_id: &str) -> Result<Project, StoreError> {
        validate_project_id(project_id)?;
        let connection = self.connect()?;
        Self::load_project(&connection, project_id)
    }

    pub fn mark_project_opened(&self, project_id: &str) -> Result<Project, StoreError> {
        validate_project_id(project_id)?;
        let timestamp = now_ms()?;
        let connection = self.connect()?;
        let changed = connection.execute(
            "UPDATE projects
             SET last_opened_at_ms = ?2, updated_at_ms = ?2
             WHERE id = ?1",
            params![project_id, timestamp],
        )?;
        ensure_project_changed(project_id, changed)?;
        Self::load_project(&connection, project_id)
    }

    pub fn update_playback_state(
        &self,
        input: UpdatePlaybackStateInput,
    ) -> Result<Project, StoreError> {
        validate_project_id(&input.project_id)?;
        validate_playback_state(&input)?;
        let timestamp = now_ms()?;
        let position_ms = match input.duration_ms {
            Some(duration_ms) => input.position_ms.min(duration_ms),
            None => input.position_ms,
        };

        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        ensure_project_exists(&transaction, &input.project_id)?;
        transaction.execute(
            "UPDATE playback_states
             SET position_ms = ?2,
                 duration_ms = ?3,
                 volume = ?4,
                 playback_rate = ?5,
                 updated_at_ms = ?6
             WHERE project_id = ?1",
            params![
                input.project_id,
                position_ms,
                input.duration_ms,
                input.volume,
                input.playback_rate,
                timestamp
            ],
        )?;
        transaction.execute(
            "UPDATE projects
             SET updated_at_ms = ?2
             WHERE id = ?1",
            params![input.project_id, timestamp],
        )?;
        transaction.commit()?;

        self.get_project(&input.project_id)
    }

    pub fn relink_project_media(
        &self,
        input: RelinkProjectMediaInput,
    ) -> Result<Project, StoreError> {
        validate_project_id(&input.project_id)?;
        let media_path = canonical_media_path(&input.media_path)?;
        let display_name = file_display_name(&media_path)?;
        let timestamp = now_ms()?;

        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        ensure_project_exists(&transaction, &input.project_id)?;
        let changed = transaction.execute(
            "UPDATE media_sources
             SET kind = ?2,
                 locator = ?3,
                 display_name = ?4,
                 updated_at_ms = ?5
             WHERE project_id = ?1 AND is_primary = 1",
            params![
                input.project_id,
                MediaSourceKind::LocalFile.as_database_value(),
                path_to_string(&media_path),
                display_name,
                timestamp
            ],
        )?;
        if changed == 0 {
            return Err(StoreError::Validation(format!(
                "项目 {} 没有可重新定位的主要媒体来源",
                input.project_id
            )));
        }
        transaction.execute(
            "UPDATE projects
             SET revision = revision + 1,
                 updated_at_ms = ?2
             WHERE id = ?1",
            params![input.project_id, timestamp],
        )?;
        transaction.commit()?;

        self.get_project(&input.project_id)
    }

    pub fn delete_project(&self, project_id: &str) -> Result<DeleteProjectResult, StoreError> {
        validate_project_id(project_id)?;
        let connection = self.connect()?;
        let changed =
            connection.execute("DELETE FROM projects WHERE id = ?1", params![project_id])?;

        Ok(DeleteProjectResult {
            project_id: project_id.to_owned(),
            deleted: changed > 0,
            source_media_deleted: false,
        })
    }

    fn connect(&self) -> Result<Connection, StoreError> {
        let connection = Connection::open(&self.database_path)?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;",
        )?;
        Ok(connection)
    }

    fn migrate(connection: &mut Connection) -> Result<(), StoreError> {
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at_ms INTEGER NOT NULL
             );",
        )?;
        let current_version: i64 = connection.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;
        if current_version > CURRENT_SCHEMA_VERSION {
            return Err(StoreError::UnsupportedSchema {
                found: current_version,
                supported: CURRENT_SCHEMA_VERSION,
            });
        }

        if current_version < 1 {
            let transaction = connection.transaction()?;
            Self::apply_migration_1(&transaction)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (1, ?1)",
                params![now_ms()?],
            )?;
            transaction.commit()?;
        }
        Ok(())
    }

    fn apply_migration_1(transaction: &Transaction<'_>) -> Result<(), StoreError> {
        transaction.execute_batch(
            "CREATE TABLE projects (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                revision INTEGER NOT NULL CHECK (revision >= 1),
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                last_opened_at_ms INTEGER NOT NULL
             );

             CREATE TABLE media_sources (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK (kind IN ('local_file')),
                locator TEXT NOT NULL,
                display_name TEXT NOT NULL,
                is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
             );

             CREATE UNIQUE INDEX one_primary_media_source_per_project
             ON media_sources(project_id)
             WHERE is_primary = 1;

             CREATE INDEX media_sources_project_id
             ON media_sources(project_id);

             CREATE TABLE playback_states (
                project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
                position_ms INTEGER NOT NULL DEFAULT 0 CHECK (position_ms >= 0),
                duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
                volume REAL NOT NULL DEFAULT 1.0 CHECK (volume >= 0.0 AND volume <= 1.0),
                playback_rate REAL NOT NULL DEFAULT 1.0
                    CHECK (playback_rate >= 0.25 AND playback_rate <= 4.0),
                updated_at_ms INTEGER NOT NULL
             );

             CREATE INDEX projects_recently_opened
             ON projects(last_opened_at_ms DESC, created_at_ms DESC);",
        )?;
        Ok(())
    }

    fn load_project(connection: &Connection, project_id: &str) -> Result<Project, StoreError> {
        let row = connection
            .query_row(
                "SELECT
                    p.id,
                    p.title,
                    p.revision,
                    p.created_at_ms,
                    p.updated_at_ms,
                    p.last_opened_at_ms,
                    m.id,
                    m.kind,
                    m.locator,
                    m.display_name,
                    m.created_at_ms,
                    m.updated_at_ms,
                    s.position_ms,
                    s.duration_ms,
                    s.volume,
                    s.playback_rate,
                    s.updated_at_ms
                 FROM projects p
                 JOIN media_sources m
                   ON m.project_id = p.id AND m.is_primary = 1
                 JOIN playback_states s
                   ON s.project_id = p.id
                 WHERE p.id = ?1",
                params![project_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, String>(9)?,
                        row.get::<_, i64>(10)?,
                        row.get::<_, i64>(11)?,
                        row.get::<_, i64>(12)?,
                        row.get::<_, Option<i64>>(13)?,
                        row.get::<_, f64>(14)?,
                        row.get::<_, f64>(15)?,
                        row.get::<_, i64>(16)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| StoreError::ProjectNotFound(project_id.to_owned()))?;

        let source_kind = MediaSourceKind::from_database_value(&row.7)
            .ok_or_else(|| StoreError::InvalidMediaSourceKind(row.7.clone()))?;
        let is_available = match source_kind {
            MediaSourceKind::LocalFile => Path::new(&row.8).is_file(),
        };
        let status = if is_available {
            ProjectStatus::Ready
        } else {
            ProjectStatus::NeedsRelink
        };

        Ok(Project {
            id: row.0,
            title: row.1,
            status,
            revision: row.2,
            created_at_ms: row.3,
            updated_at_ms: row.4,
            last_opened_at_ms: row.5,
            media_source: MediaSource {
                id: row.6,
                kind: source_kind,
                locator: row.8,
                display_name: row.9,
                is_available,
                created_at_ms: row.10,
                updated_at_ms: row.11,
            },
            playback_state: PlaybackState {
                position_ms: row.12,
                duration_ms: row.13,
                volume: row.14,
                playback_rate: row.15,
                updated_at_ms: row.16,
            },
        })
    }
}

fn ensure_project_exists(
    transaction: &Transaction<'_>,
    project_id: &str,
) -> Result<(), StoreError> {
    let exists = transaction
        .query_row(
            "SELECT 1 FROM projects WHERE id = ?1",
            params![project_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err(StoreError::ProjectNotFound(project_id.to_owned()))
    }
}

fn ensure_project_changed(project_id: &str, changed: usize) -> Result<(), StoreError> {
    if changed == 0 {
        Err(StoreError::ProjectNotFound(project_id.to_owned()))
    } else {
        Ok(())
    }
}

fn canonical_media_path(value: &str) -> Result<PathBuf, StoreError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(StoreError::Validation("媒体路径不能为空".to_owned()));
    }

    let path = Path::new(trimmed);
    if !path.is_file() {
        return Err(StoreError::Validation(format!(
            "媒体文件不存在或不是文件：{trimmed}"
        )));
    }
    Ok(dunce::canonicalize(path)?)
}

fn file_display_name(path: &Path) -> Result<String, StoreError> {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| StoreError::Validation("媒体文件名无效".to_owned()))
}

fn normalize_project_title(value: Option<&str>, media_path: &Path) -> Result<String, StoreError> {
    if let Some(title) = value.map(str::trim).filter(|title| !title.is_empty()) {
        if title.chars().count() > 200 {
            return Err(StoreError::Validation(
                "项目名称不能超过 200 个字符".to_owned(),
            ));
        }
        return Ok(title.to_owned());
    }

    media_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| StoreError::Validation("无法从媒体文件生成项目名称".to_owned()))
}

fn validate_project_id(project_id: &str) -> Result<(), StoreError> {
    Uuid::parse_str(project_id)
        .map(|_| ())
        .map_err(|_| StoreError::Validation("项目 ID 格式无效".to_owned()))
}

fn validate_playback_state(input: &UpdatePlaybackStateInput) -> Result<(), StoreError> {
    if input.position_ms < 0 {
        return Err(StoreError::Validation("播放位置不能小于 0".to_owned()));
    }
    if input.duration_ms.is_some_and(|duration| duration < 0) {
        return Err(StoreError::Validation("媒体时长不能小于 0".to_owned()));
    }
    if !(0.0..=1.0).contains(&input.volume) || !input.volume.is_finite() {
        return Err(StoreError::Validation(
            "音量必须位于 0 到 1 之间".to_owned(),
        ));
    }
    if !(0.25..=4.0).contains(&input.playback_rate) || !input.playback_rate.is_finite() {
        return Err(StoreError::Validation(
            "播放速度必须位于 0.25 到 4 之间".to_owned(),
        ));
    }
    Ok(())
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn now_ms() -> Result<i64, StoreError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| StoreError::Validation(format!("系统时间无效：{error}")))?;
    i64::try_from(duration.as_millis())
        .map_err(|_| StoreError::Validation("系统时间超出支持范围".to_owned()))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    struct Fixture {
        temp_dir: TempDir,
        store: ProjectStore,
    }

    impl Fixture {
        fn new() -> Self {
            let temp_dir = tempfile::tempdir().expect("temp directory should be created");
            let store = ProjectStore::open(temp_dir.path().join("projects.sqlite3"))
                .expect("store should open");
            Self { temp_dir, store }
        }

        fn media_file(&self, name: &str) -> PathBuf {
            let path = self.temp_dir.path().join(name);
            fs::write(&path, b"test-media").expect("media fixture should be written");
            path
        }

        fn create_project(&self, media_path: &Path) -> Project {
            self.store
                .create_local_project(CreateLocalProjectInput {
                    media_path: path_to_string(media_path),
                    title: None,
                })
                .expect("project should be created")
        }
    }

    #[test]
    fn migrates_new_database_and_persists_playback_after_reopen() {
        let fixture = Fixture::new();
        assert_eq!(
            fixture.store.schema_version().expect("schema version"),
            CURRENT_SCHEMA_VERSION
        );
        let media_path = fixture.media_file("episode-01.mp4");
        let project = fixture.create_project(&media_path);

        fixture
            .store
            .update_playback_state(UpdatePlaybackStateInput {
                project_id: project.id.clone(),
                position_ms: 75_000,
                duration_ms: Some(120_000),
                volume: 0.7,
                playback_rate: 1.25,
            })
            .expect("playback should update");

        let reopened =
            ProjectStore::open(fixture.store.database_path()).expect("store should reopen");
        let restored = reopened
            .get_project(&project.id)
            .expect("project should be restored");
        assert_eq!(restored.playback_state.position_ms, 75_000);
        assert_eq!(restored.playback_state.duration_ms, Some(120_000));
        assert_eq!(restored.playback_state.volume, 0.7);
        assert_eq!(restored.playback_state.playback_rate, 1.25);
    }

    #[test]
    fn missing_media_preserves_project_until_relinked() {
        let fixture = Fixture::new();
        let original_path = fixture.media_file("original.mp4");
        let project = fixture.create_project(&original_path);
        fs::remove_file(&original_path).expect("fixture media should be removed");

        let missing = fixture
            .store
            .get_project(&project.id)
            .expect("project should remain");
        assert_eq!(missing.status, ProjectStatus::NeedsRelink);
        assert!(!missing.media_source.is_available);

        let replacement_path = fixture.media_file("replacement.mp4");
        let relinked = fixture
            .store
            .relink_project_media(RelinkProjectMediaInput {
                project_id: project.id,
                media_path: path_to_string(&replacement_path),
            })
            .expect("project should relink");
        assert_eq!(relinked.status, ProjectStatus::Ready);
        assert_eq!(relinked.revision, 2);
        assert!(relinked.media_source.is_available);
    }

    #[test]
    fn deleting_project_never_deletes_source_media() {
        let fixture = Fixture::new();
        let media_path = fixture.media_file("keep-source.mp4");
        let project = fixture.create_project(&media_path);

        let result = fixture
            .store
            .delete_project(&project.id)
            .expect("project should delete");

        assert!(result.deleted);
        assert!(!result.source_media_deleted);
        assert!(media_path.is_file());
        assert!(matches!(
            fixture.store.get_project(&project.id),
            Err(StoreError::ProjectNotFound(_))
        ));
    }

    #[test]
    fn invalid_playback_state_is_rejected() {
        let fixture = Fixture::new();
        let media_path = fixture.media_file("episode.mp4");
        let project = fixture.create_project(&media_path);

        let result = fixture
            .store
            .update_playback_state(UpdatePlaybackStateInput {
                project_id: project.id,
                position_ms: -1,
                duration_ms: None,
                volume: 1.0,
                playback_rate: 1.0,
            });

        assert!(matches!(result, Err(StoreError::Validation(_))));
    }

    #[test]
    fn lists_projects_and_records_the_latest_open() {
        let fixture = Fixture::new();
        let first = fixture.create_project(&fixture.media_file("first.mp4"));
        let second = fixture.create_project(&fixture.media_file("second.mp4"));

        let projects = fixture.store.list_projects().expect("projects should list");
        assert_eq!(projects.len(), 2);
        assert!(projects.iter().any(|project| project.id == first.id));
        assert!(projects.iter().any(|project| project.id == second.id));

        let opened = fixture
            .store
            .mark_project_opened(&first.id)
            .expect("project should be marked opened");
        assert!(opened.last_opened_at_ms >= first.last_opened_at_ms);
    }

    #[test]
    fn rejects_a_database_from_a_newer_schema() {
        let temp_dir = tempfile::tempdir().expect("temp directory should be created");
        let database_path = temp_dir.path().join("future.sqlite3");
        let connection = Connection::open(&database_path).expect("database should open");
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at_ms INTEGER NOT NULL
                 );
                 INSERT INTO schema_migrations (version, applied_at_ms) VALUES (99, 0);",
            )
            .expect("future schema fixture should be created");
        drop(connection);

        let result = ProjectStore::open(database_path);
        assert!(matches!(
            result,
            Err(StoreError::UnsupportedSchema {
                found: 99,
                supported: CURRENT_SCHEMA_VERSION
            })
        ));
    }
}
