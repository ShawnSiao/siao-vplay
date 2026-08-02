use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use thiserror::Error;
use uuid::Uuid;

use crate::domain::{
    CreateLocalProjectInput, DeleteProjectResult, MediaArtifact, MediaArtifactStatus, MediaSource,
    MediaSourceKind, PlaybackState, Project, ProjectStatus, RelinkProjectMediaInput,
    SubtitleDisplayMode, UpdatePlaybackStateInput,
};
use crate::library::migration::{self as library_migration, MigrationError};

const CURRENT_SCHEMA_VERSION: i64 = 16;

#[derive(Clone, Debug)]
pub(crate) struct RemoteImportProvenance {
    pub importer: String,
    pub importer_version: String,
    pub importer_sha256: String,
}

#[derive(Clone, Debug)]
pub(crate) struct CachedMediaProbe {
    pub source_sha256: String,
    pub probe_json: String,
    pub source_size_bytes: u64,
    pub source_modified_at_ms: Option<i64>,
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("数据库错误：{0}")]
    Database(#[from] rusqlite::Error),
    #[error("文件系统错误：{0}")]
    FileSystem(#[from] std::io::Error),
    #[error(transparent)]
    LibraryMigration(#[from] MigrationError),
    #[error("找不到项目：{0}")]
    ProjectNotFound(String),
    #[error("输入无效：{0}")]
    Validation(String),
    #[error("数据库版本 {found} 高于当前支持版本 {supported}")]
    UnsupportedSchema { found: i64, supported: i64 },
    #[error("数据库中的媒体来源类型无效：{0}")]
    InvalidMediaSourceKind(String),
    #[error("数据库中的媒体产物状态无效：{0}")]
    InvalidMediaArtifactStatus(String),
    #[error("数据库中的字幕显示模式无效：{0}")]
    InvalidSubtitleDisplayMode(String),
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
        Self::migrate(&mut connection, &store.database_path)?;
        Ok(store)
    }

    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    pub fn data_directory(&self) -> &Path {
        self.database_path
            .parent()
            .and_then(Path::parent)
            .unwrap_or_else(|| Path::new("."))
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
                project_id, position_ms, duration_ms, volume, playback_rate,
                subtitle_mode, updated_at_ms
             ) VALUES (?1, 0, NULL, 1.0, 1.0, 'translation', ?2)",
            params![project_id, timestamp],
        )?;
        transaction.commit()?;

        self.get_project(&project_id)
    }

    pub fn create_remote_project(
        &self,
        media_path: &Path,
        origin_url: &str,
        display_name: &str,
        title: Option<&str>,
    ) -> Result<Project, StoreError> {
        self.create_remote_project_internal(media_path, origin_url, display_name, title, None)
    }

    pub(crate) fn create_remote_project_with_provenance(
        &self,
        media_path: &Path,
        origin_url: &str,
        display_name: &str,
        title: Option<&str>,
        provenance: &RemoteImportProvenance,
    ) -> Result<Project, StoreError> {
        self.create_remote_project_internal(
            media_path,
            origin_url,
            display_name,
            title,
            Some(provenance),
        )
    }

    fn create_remote_project_internal(
        &self,
        media_path: &Path,
        origin_url: &str,
        display_name: &str,
        title: Option<&str>,
        provenance: Option<&RemoteImportProvenance>,
    ) -> Result<Project, StoreError> {
        let media_path = canonical_media_path(
            media_path
                .to_str()
                .ok_or_else(|| StoreError::Validation("媒体路径不是有效文本".to_owned()))?,
        )?;
        let origin_url = origin_url.trim();
        if origin_url.is_empty() {
            return Err(StoreError::Validation("媒体来源 URL 不能为空".to_owned()));
        }
        let display_name = display_name.trim();
        if display_name.is_empty() {
            return Err(StoreError::Validation("媒体显示名称不能为空".to_owned()));
        }
        let title = title
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| {
                Path::new(display_name)
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or("URL 视频")
                    .to_owned()
            });
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
                id, project_id, kind, locator, origin_url, display_name, is_primary,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)",
            params![
                media_source_id,
                project_id,
                MediaSourceKind::LocalFile.as_database_value(),
                path_to_string(&media_path),
                origin_url,
                display_name,
                timestamp
            ],
        )?;
        if let Some(provenance) = provenance {
            validate_sha256(&provenance.importer_sha256)?;
            transaction.execute(
                "INSERT INTO media_source_imports (
                    media_source_id, importer, importer_version, importer_sha256, imported_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    media_source_id,
                    provenance.importer,
                    provenance.importer_version,
                    provenance.importer_sha256,
                    timestamp
                ],
            )?;
        }
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
                 completed_at_ms = CASE
                     WHEN completed_at_ms IS NOT NULL THEN completed_at_ms
                     WHEN ?3 IS NOT NULL AND ?3 > 0 AND ?2 * 10 >= ?3 * 9 THEN ?7
                     ELSE NULL
                 END,
                 volume = ?4,
                 playback_rate = ?5,
                 subtitle_mode = ?6,
                 updated_at_ms = ?7
             WHERE project_id = ?1",
            params![
                input.project_id,
                position_ms,
                input.duration_ms,
                input.volume,
                input.playback_rate,
                input.subtitle_mode.as_database_value(),
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
                 origin_url = NULL,
                 display_name = ?4,
                 source_sha256 = NULL,
                 probe_json = NULL,
                 probed_at_ms = NULL,
                 source_size_bytes = NULL,
                 source_modified_at_ms = NULL,
                 poster_path = NULL,
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

    pub fn record_media_probe(
        &self,
        project_id: &str,
        media_source_id: &str,
        source_sha256: &str,
        probe_json: &str,
        source_size_bytes: u64,
        source_modified_at_ms: Option<i64>,
    ) -> Result<Project, StoreError> {
        validate_project_id(project_id)?;
        validate_uuid(media_source_id, "媒体来源 ID")?;
        validate_sha256(source_sha256)?;
        let source_size_bytes = i64::try_from(source_size_bytes)
            .map_err(|_| StoreError::Validation("媒体文件大小超出支持范围".to_owned()))?;
        let timestamp = now_ms()?;
        let connection = self.connect()?;
        let changed = connection.execute(
            "UPDATE media_sources
             SET source_sha256 = ?3,
                 probe_json = ?4,
                 source_size_bytes = ?5,
                 source_modified_at_ms = ?6,
                 probed_at_ms = ?7,
                 updated_at_ms = ?7
             WHERE id = ?2 AND project_id = ?1 AND is_primary = 1",
            params![
                project_id,
                media_source_id,
                source_sha256,
                probe_json,
                source_size_bytes,
                source_modified_at_ms,
                timestamp
            ],
        )?;
        if changed == 0 {
            return Err(StoreError::Validation(
                "项目的主要媒体来源已经发生变化，请重新探测".to_owned(),
            ));
        }
        Self::load_project(&connection, project_id)
    }

    pub(crate) fn cached_media_probe(
        &self,
        project_id: &str,
        media_source_id: &str,
    ) -> Result<Option<CachedMediaProbe>, StoreError> {
        validate_project_id(project_id)?;
        validate_uuid(media_source_id, "媒体来源 ID")?;
        let connection = self.connect()?;
        connection
            .query_row(
                "SELECT source_sha256, probe_json, source_size_bytes, source_modified_at_ms
                 FROM media_sources
                 WHERE id = ?2 AND project_id = ?1 AND is_primary = 1
                   AND source_sha256 IS NOT NULL
                   AND probe_json IS NOT NULL
                   AND source_size_bytes IS NOT NULL",
                params![project_id, media_source_id],
                |row| {
                    let size = row.get::<_, i64>(2)?;
                    let source_size_bytes = u64::try_from(size).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            2,
                            rusqlite::types::Type::Integer,
                            Box::new(error),
                        )
                    })?;
                    Ok(CachedMediaProbe {
                        source_sha256: row.get(0)?,
                        probe_json: row.get(1)?,
                        source_size_bytes,
                        source_modified_at_ms: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn record_media_poster(
        &self,
        project_id: &str,
        media_source_id: &str,
        source_sha256: &str,
        poster_path: &Path,
    ) -> Result<Project, StoreError> {
        validate_project_id(project_id)?;
        validate_uuid(media_source_id, "媒体来源 ID")?;
        validate_sha256(source_sha256)?;
        let timestamp = now_ms()?;
        let connection = self.connect()?;
        let changed = connection.execute(
            "UPDATE media_sources
             SET poster_path = ?4,
                 updated_at_ms = ?5
             WHERE id = ?2 AND project_id = ?1 AND is_primary = 1
               AND source_sha256 = ?3",
            params![
                project_id,
                media_source_id,
                source_sha256,
                path_to_string(poster_path),
                timestamp
            ],
        )?;
        if changed == 0 {
            return Err(StoreError::Validation(
                "媒体来源已变化，未保存旧媒体的封面".to_owned(),
            ));
        }
        Self::load_project(&connection, project_id)
    }

    pub fn find_completed_playback_proxy(
        &self,
        project_id: &str,
        source_sha256: &str,
        profile: &str,
    ) -> Result<Option<MediaArtifact>, StoreError> {
        validate_project_id(project_id)?;
        validate_sha256(source_sha256)?;
        let connection = self.connect()?;
        connection
            .query_row(
                "SELECT
                    id, project_id, source_media_id, status, path, source_sha256,
                    profile, error_code, error_message, created_at_ms, updated_at_ms
                 FROM media_artifacts
                 WHERE project_id = ?1
                   AND kind = 'playback_proxy'
                   AND source_sha256 = ?2
                   AND profile = ?3
                   AND status = 'completed'",
                params![project_id, source_sha256, profile],
                map_media_artifact,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn begin_playback_proxy(
        &self,
        project_id: &str,
        source_media_id: &str,
        source_sha256: &str,
        profile: &str,
        artifact_path: &Path,
    ) -> Result<MediaArtifact, StoreError> {
        validate_project_id(project_id)?;
        validate_uuid(source_media_id, "媒体来源 ID")?;
        validate_sha256(source_sha256)?;
        if profile.trim().is_empty() {
            return Err(StoreError::Validation("代理配置不能为空".to_owned()));
        }
        let artifact_path = path_to_string(artifact_path);
        let artifact_id = Uuid::new_v4().to_string();
        let timestamp = now_ms()?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        ensure_project_exists(&transaction, project_id)?;
        let source_exists = transaction
            .query_row(
                "SELECT 1
                 FROM media_sources
                 WHERE id = ?1 AND project_id = ?2 AND is_primary = 1",
                params![source_media_id, project_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !source_exists {
            return Err(StoreError::Validation(
                "项目的主要媒体来源已经发生变化，请重新准备".to_owned(),
            ));
        }
        transaction.execute(
            "INSERT INTO media_artifacts (
                id, project_id, source_media_id, kind, status, path,
                source_sha256, profile, error_code, error_message,
                created_at_ms, updated_at_ms
             ) VALUES (
                ?1, ?2, ?3, 'playback_proxy', 'queued', ?4,
                ?5, ?6, NULL, NULL, ?7, ?7
             )
             ON CONFLICT(project_id, kind, source_sha256, profile)
             DO UPDATE SET
                source_media_id = excluded.source_media_id,
                status = 'queued',
                path = excluded.path,
                error_code = NULL,
                error_message = NULL,
                updated_at_ms = excluded.updated_at_ms",
            params![
                artifact_id,
                project_id,
                source_media_id,
                artifact_path,
                source_sha256,
                profile,
                timestamp
            ],
        )?;
        let persisted_id: String = transaction.query_row(
            "SELECT id
             FROM media_artifacts
             WHERE project_id = ?1
               AND kind = 'playback_proxy'
               AND source_sha256 = ?2
               AND profile = ?3",
            params![project_id, source_sha256, profile],
            |row| row.get(0),
        )?;
        transaction.commit()?;
        self.get_media_artifact(&persisted_id)
    }

    pub fn update_media_artifact_status(
        &self,
        artifact_id: &str,
        status: MediaArtifactStatus,
        error_code: Option<&str>,
        error_message: Option<&str>,
    ) -> Result<MediaArtifact, StoreError> {
        validate_uuid(artifact_id, "媒体产物 ID")?;
        let timestamp = now_ms()?;
        let connection = self.connect()?;
        let changed = connection.execute(
            "UPDATE media_artifacts
             SET status = ?2,
                 error_code = ?3,
                 error_message = ?4,
                 updated_at_ms = ?5
             WHERE id = ?1",
            params![
                artifact_id,
                status.as_database_value(),
                error_code,
                error_message,
                timestamp
            ],
        )?;
        if changed == 0 {
            return Err(StoreError::Validation(format!(
                "找不到媒体产物：{artifact_id}"
            )));
        }
        Self::load_media_artifact(&connection, artifact_id)
    }

    pub fn recover_running_media_artifacts(&self) -> Result<usize, StoreError> {
        let timestamp = now_ms()?;
        let connection = self.connect()?;
        let changed = connection.execute(
            "UPDATE media_artifacts
             SET status = 'interrupted',
                 error_code = 'app_restarted',
                 error_message = '应用退出前代理任务尚未完成，可以重新开始',
                 updated_at_ms = ?1
             WHERE status = 'running'",
            params![timestamp],
        )?;
        Ok(changed)
    }

    pub fn delete_project(&self, project_id: &str) -> Result<DeleteProjectResult, StoreError> {
        validate_project_id(project_id)?;
        let project = match self.get_project(project_id) {
            Ok(project) => Some(project),
            Err(StoreError::ProjectNotFound(_)) => None,
            Err(error) => return Err(error),
        };
        let connection = self.connect()?;
        let agent_task_ids = connection
            .prepare(
                "SELECT id FROM agent_tasks WHERE project_id = ?1
                 UNION
                 SELECT id FROM explanation_tasks WHERE project_id = ?1
                 UNION
                 SELECT id FROM learning_tasks WHERE project_id = ?1",
            )?
            .query_map(params![project_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let changed =
            connection.execute("DELETE FROM projects WHERE id = ?1", params![project_id])?;
        let cached_media_deleted = if changed > 0 {
            project
                .as_ref()
                .filter(|project| project.media_source.origin_url.is_some())
                .is_some_and(|project| {
                    self.remove_remote_media_cache(&project.media_source.locator)
                })
        } else {
            false
        };
        if changed > 0 {
            self.remove_agent_task_materials(&agent_task_ids);
            self.remove_learning_card_materials(project_id);
            self.remove_subtitle_burn_materials(project_id);
        }

        Ok(DeleteProjectResult {
            project_id: project_id.to_owned(),
            deleted: changed > 0,
            source_media_deleted: false,
            cached_media_deleted,
        })
    }

    fn remove_remote_media_cache(&self, locator: &str) -> bool {
        let cache_root = self.data_directory().join("remote-media");
        let Ok(cache_root) = dunce::canonicalize(cache_root) else {
            return false;
        };
        let Some(parent) = Path::new(locator).parent() else {
            return false;
        };
        let Ok(parent) = dunce::canonicalize(parent) else {
            return false;
        };
        if parent == cache_root || !parent.starts_with(&cache_root) {
            return false;
        }
        fs::remove_dir_all(parent).is_ok()
    }

    fn remove_agent_task_materials(&self, task_ids: &[String]) {
        let task_root = self.data_directory().join("agent-tasks");
        for task_id in task_ids {
            if Uuid::parse_str(task_id).is_ok() {
                let _ = fs::remove_dir_all(task_root.join(task_id));
            }
        }
    }

    fn remove_learning_card_materials(&self, project_id: &str) {
        if Uuid::parse_str(project_id).is_ok() {
            let _ = fs::remove_dir_all(
                self.data_directory()
                    .join("learning-cards")
                    .join(project_id),
            );
        }
    }

    fn remove_subtitle_burn_materials(&self, project_id: &str) {
        if Uuid::parse_str(project_id).is_ok() {
            let _ = fs::remove_dir_all(
                self.data_directory()
                    .join("subtitle-burn-jobs")
                    .join(project_id),
            );
        }
    }

    fn get_media_artifact(&self, artifact_id: &str) -> Result<MediaArtifact, StoreError> {
        let connection = self.connect()?;
        Self::load_media_artifact(&connection, artifact_id)
    }

    pub(crate) fn connect(&self) -> Result<Connection, StoreError> {
        let connection = Connection::open(&self.database_path)?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;",
        )?;
        Ok(connection)
    }

    fn migrate(connection: &mut Connection, database_path: &Path) -> Result<(), StoreError> {
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at_ms INTEGER NOT NULL
             );",
        )?;
        let mut current_version: i64 = connection.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;
        let existing_database = current_version > 0;
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
            current_version = 1;
        }
        if current_version < 2 {
            let transaction = connection.transaction()?;
            Self::apply_migration_2(&transaction)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (2, ?1)",
                params![now_ms()?],
            )?;
            transaction.commit()?;
            current_version = 2;
        }
        if current_version < 3 {
            let transaction = connection.transaction()?;
            Self::apply_migration_3(&transaction)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (3, ?1)",
                params![now_ms()?],
            )?;
            transaction.commit()?;
            current_version = 3;
        }
        if current_version < 4 {
            let transaction = connection.transaction()?;
            Self::apply_migration_4(&transaction)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (4, ?1)",
                params![now_ms()?],
            )?;
            transaction.commit()?;
            current_version = 4;
        }
        if current_version < 5 {
            let transaction = connection.transaction()?;
            Self::apply_migration_5(&transaction)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (5, ?1)",
                params![now_ms()?],
            )?;
            transaction.commit()?;
            current_version = 5;
        }
        if current_version < 6 {
            let transaction = connection.transaction()?;
            Self::apply_migration_6(&transaction)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (6, ?1)",
                params![now_ms()?],
            )?;
            transaction.commit()?;
            current_version = 6;
        }
        if current_version < 7 {
            let transaction = connection.transaction()?;
            Self::apply_migration_7(&transaction)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (7, ?1)",
                params![now_ms()?],
            )?;
            transaction.commit()?;
            current_version = 7;
        }
        if current_version < 8 {
            let transaction = connection.transaction()?;
            Self::apply_migration_8(&transaction)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (8, ?1)",
                params![now_ms()?],
            )?;
            transaction.commit()?;
            current_version = 8;
        }
        if current_version < 9 {
            let transaction = connection.transaction()?;
            Self::apply_migration_9(&transaction)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (9, ?1)",
                params![now_ms()?],
            )?;
            transaction.commit()?;
            current_version = 9;
        }
        if current_version < 10 {
            let transaction = connection.transaction()?;
            Self::apply_migration_10(&transaction)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (10, ?1)",
                params![now_ms()?],
            )?;
            transaction.commit()?;
            current_version = 10;
        }
        if current_version < 11 {
            let transaction = connection.transaction()?;
            Self::apply_migration_11(&transaction)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (11, ?1)",
                params![now_ms()?],
            )?;
            transaction.commit()?;
            current_version = 11;
        }
        if current_version < 12 {
            let transaction = connection.transaction()?;
            Self::apply_migration_12(&transaction)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (12, ?1)",
                params![now_ms()?],
            )?;
            transaction.commit()?;
            current_version = 12;
        }
        if current_version < 13 {
            let transaction = connection.transaction()?;
            Self::apply_migration_13(&transaction)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (13, ?1)",
                params![now_ms()?],
            )?;
            transaction.commit()?;
            current_version = 13;
        }
        if current_version < 14 {
            let transaction = connection.transaction()?;
            Self::apply_migration_14(&transaction)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (14, ?1)",
                params![now_ms()?],
            )?;
            transaction.commit()?;
            current_version = 14;
        }
        if current_version < 15 {
            if existing_database {
                library_migration::create_v14_backup(connection, database_path)?;
            }
            let transaction = connection.transaction()?;
            library_migration::apply_schema_15(&transaction)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (15, ?1)",
                params![now_ms()?],
            )?;
            library_migration::ensure_foreign_keys(&transaction)?;
            transaction.commit()?;
        }
        if current_version < 16 {
            let transaction = connection.transaction()?;
            library_migration::apply_schema_16(&transaction)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (16, ?1)",
                params![now_ms()?],
            )?;
            library_migration::ensure_foreign_keys(&transaction)?;
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

    fn apply_migration_2(transaction: &Transaction<'_>) -> Result<(), StoreError> {
        transaction.execute_batch(
            "ALTER TABLE media_sources ADD COLUMN source_sha256 TEXT;
             ALTER TABLE media_sources ADD COLUMN probe_json TEXT;
             ALTER TABLE media_sources ADD COLUMN probed_at_ms INTEGER;

             CREATE TABLE media_artifacts (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                source_media_id TEXT NOT NULL REFERENCES media_sources(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK (kind IN ('playback_proxy')),
                status TEXT NOT NULL
                    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'interrupted')),
                path TEXT NOT NULL,
                source_sha256 TEXT NOT NULL,
                profile TEXT NOT NULL,
                error_code TEXT,
                error_message TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                UNIQUE(project_id, kind, source_sha256, profile)
             );

             CREATE INDEX media_artifacts_project_id
             ON media_artifacts(project_id, status);",
        )?;
        Ok(())
    }

    fn apply_migration_3(transaction: &Transaction<'_>) -> Result<(), StoreError> {
        transaction.execute_batch(
            "ALTER TABLE media_sources ADD COLUMN source_size_bytes INTEGER;
             ALTER TABLE media_sources ADD COLUMN source_modified_at_ms INTEGER;
             ALTER TABLE media_sources ADD COLUMN poster_path TEXT;",
        )?;
        Ok(())
    }

    fn apply_migration_4(transaction: &Transaction<'_>) -> Result<(), StoreError> {
        transaction.execute_batch(
            "CREATE TABLE subtitle_tracks (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('original', 'translation')),
                language_code TEXT NOT NULL,
                current_version_id TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
             );

             CREATE UNIQUE INDEX one_original_subtitle_track_per_project
             ON subtitle_tracks(project_id)
             WHERE role = 'original';

             CREATE UNIQUE INDEX one_translation_subtitle_track_per_language
             ON subtitle_tracks(project_id, language_code)
             WHERE role = 'translation';

             CREATE TABLE subtitle_versions (
                id TEXT PRIMARY KEY,
                track_id TEXT NOT NULL REFERENCES subtitle_tracks(id) ON DELETE CASCADE,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                version_number INTEGER NOT NULL CHECK (version_number >= 1),
                status TEXT NOT NULL CHECK (status IN ('draft', 'ready', 'rejected')),
                source_kind TEXT NOT NULL
                    CHECK (source_kind IN ('imported_file', 'embedded', 'transcription', 'agent_translation')),
                source_label TEXT NOT NULL,
                source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
                media_sha256 TEXT NOT NULL CHECK (length(media_sha256) = 64),
                language_code TEXT NOT NULL CHECK (length(language_code) BETWEEN 2 AND 35),
                project_revision INTEGER NOT NULL CHECK (project_revision >= 1),
                preflight_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                UNIQUE(track_id, version_number)
             );

             CREATE INDEX subtitle_versions_project_id
             ON subtitle_versions(project_id, created_at_ms DESC);

             CREATE TABLE subtitle_segments (
                id TEXT PRIMARY KEY,
                version_id TEXT NOT NULL REFERENCES subtitle_versions(id) ON DELETE CASCADE,
                ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
                start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
                end_ms INTEGER NOT NULL CHECK (end_ms > start_ms),
                text TEXT NOT NULL CHECK (length(trim(text)) > 0),
                confidence REAL CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
                UNIQUE(version_id, ordinal)
             );

             CREATE INDEX subtitle_segments_version_timeline
             ON subtitle_segments(version_id, start_ms, end_ms, ordinal);

             CREATE TRIGGER subtitle_track_current_version_guard
             BEFORE UPDATE OF current_version_id ON subtitle_tracks
             WHEN NEW.current_version_id IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1 FROM subtitle_versions
                   WHERE id = NEW.current_version_id AND track_id = NEW.id
               )
             BEGIN
                 SELECT RAISE(ABORT, 'subtitle current version must belong to track');
             END;",
        )?;
        Ok(())
    }

    fn apply_migration_5(transaction: &Transaction<'_>) -> Result<(), StoreError> {
        transaction.execute_batch(
            "ALTER TABLE media_sources ADD COLUMN origin_url TEXT;

             CREATE INDEX media_sources_origin_url
             ON media_sources(origin_url)
             WHERE origin_url IS NOT NULL;",
        )?;
        Ok(())
    }

    fn apply_migration_6(transaction: &Transaction<'_>) -> Result<(), StoreError> {
        transaction.execute_batch(
            "CREATE TABLE media_source_imports (
                media_source_id TEXT PRIMARY KEY
                    REFERENCES media_sources(id) ON DELETE CASCADE,
                importer TEXT NOT NULL CHECK (length(trim(importer)) > 0),
                importer_version TEXT NOT NULL CHECK (length(trim(importer_version)) > 0),
                importer_sha256 TEXT NOT NULL CHECK (length(importer_sha256) = 64),
                imported_at_ms INTEGER NOT NULL
             );",
        )?;
        Ok(())
    }

    fn apply_migration_7(transaction: &Transaction<'_>) -> Result<(), StoreError> {
        transaction.execute_batch(
            "CREATE TABLE subtitle_words (
                id TEXT PRIMARY KEY,
                segment_id TEXT NOT NULL
                    REFERENCES subtitle_segments(id) ON DELETE CASCADE,
                ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
                start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
                end_ms INTEGER NOT NULL CHECK (end_ms > start_ms),
                text TEXT NOT NULL CHECK (length(trim(text)) > 0),
                confidence REAL
                    CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
                UNIQUE(segment_id, ordinal)
             );

             CREATE INDEX subtitle_words_segment_timeline
             ON subtitle_words(segment_id, start_ms, end_ms, ordinal);

             CREATE TABLE transcription_jobs (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                source_media_id TEXT NOT NULL REFERENCES media_sources(id) ON DELETE CASCADE,
                status TEXT NOT NULL CHECK (
                    status IN (
                        'queued', 'extracting', 'transcribing', 'validating',
                        'completed', 'failed', 'cancelled', 'interrupted'
                    )
                ),
                stage TEXT NOT NULL,
                progress REAL NOT NULL CHECK (progress >= 0.0 AND progress <= 1.0),
                language_code TEXT NOT NULL CHECK (language_code IN ('en', 'th', 'ja', 'ko')),
                model_kind TEXT NOT NULL CHECK (model_kind IN ('small', 'base')),
                model_path TEXT NOT NULL,
                model_sha256 TEXT NOT NULL CHECK (length(model_sha256) = 64),
                runtime_path TEXT NOT NULL,
                runtime_backend TEXT NOT NULL CHECK (runtime_backend IN ('vulkan', 'cpu')),
                runtime_version TEXT NOT NULL,
                runtime_sha256 TEXT NOT NULL CHECK (length(runtime_sha256) = 64),
                runtime_metadata_sha256 TEXT NOT NULL CHECK (length(runtime_metadata_sha256) = 64),
                parameters_json TEXT NOT NULL,
                expected_project_revision INTEGER NOT NULL CHECK (expected_project_revision >= 1),
                expected_media_sha256 TEXT NOT NULL CHECK (length(expected_media_sha256) = 64),
                media_duration_ms INTEGER NOT NULL CHECK (media_duration_ms > 0),
                confirm_replace_original INTEGER NOT NULL
                    CHECK (confirm_replace_original IN (0, 1)),
                subtitle_version_id TEXT
                    REFERENCES subtitle_versions(id) ON DELETE SET NULL,
                cancel_requested_at_ms INTEGER,
                error_code TEXT,
                error_message TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                started_at_ms INTEGER,
                completed_at_ms INTEGER
             );

             CREATE INDEX transcription_jobs_project_created
             ON transcription_jobs(project_id, created_at_ms DESC);

             CREATE UNIQUE INDEX one_active_transcription_per_project
             ON transcription_jobs(project_id)
             WHERE status IN ('queued', 'extracting', 'transcribing', 'validating');",
        )?;
        Ok(())
    }

    fn apply_migration_8(transaction: &Transaction<'_>) -> Result<(), StoreError> {
        transaction.execute_batch(
            "CREATE TABLE agent_tasks (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                task_type TEXT NOT NULL CHECK (task_type IN ('subtitle_translation')),
                handoff_kind TEXT NOT NULL CHECK (handoff_kind IN ('manual', 'codex')),
                protocol_version TEXT NOT NULL,
                status TEXT NOT NULL CHECK (
                    status IN (
                        'awaiting_external_result', 'queued', 'running', 'validating',
                        'completed', 'failed', 'cancelled', 'interrupted'
                    )
                ),
                stage TEXT NOT NULL,
                progress REAL NOT NULL CHECK (progress >= 0.0 AND progress <= 1.0),
                receiver_label TEXT NOT NULL,
                material_scope_json TEXT NOT NULL,
                source_version_id TEXT NOT NULL
                    REFERENCES subtitle_versions(id) ON DELETE CASCADE,
                source_language_code TEXT NOT NULL
                    CHECK (length(source_language_code) BETWEEN 2 AND 35),
                target_language_code TEXT NOT NULL
                    CHECK (target_language_code = 'zh-cn'),
                authorized_segment_ids_json TEXT NOT NULL,
                segment_count INTEGER NOT NULL CHECK (segment_count > 0),
                expected_project_revision INTEGER NOT NULL
                    CHECK (expected_project_revision >= 1),
                expected_media_sha256 TEXT NOT NULL
                    CHECK (length(expected_media_sha256) = 64),
                material_manifest_sha256 TEXT NOT NULL
                    CHECK (length(material_manifest_sha256) = 64),
                result_sha256 TEXT
                    CHECK (result_sha256 IS NULL OR length(result_sha256) = 64),
                result_validation_json TEXT,
                output_version_id TEXT
                    REFERENCES subtitle_versions(id) ON DELETE SET NULL,
                runner_version TEXT,
                runner_auth_mode TEXT,
                runner_thread_id TEXT,
                cancel_requested_at_ms INTEGER,
                error_code TEXT,
                error_message TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                started_at_ms INTEGER,
                completed_at_ms INTEGER
             );

             CREATE INDEX agent_tasks_project_created
             ON agent_tasks(project_id, created_at_ms DESC);

             CREATE UNIQUE INDEX one_active_translation_task_per_project
             ON agent_tasks(project_id)
             WHERE status IN (
                'awaiting_external_result', 'queued', 'running', 'validating'
             );

             CREATE TABLE agent_task_batches (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
                ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
                status TEXT NOT NULL CHECK (
                    status IN (
                        'prepared', 'queued', 'running', 'completed',
                        'failed', 'cancelled'
                    )
                ),
                segment_ids_json TEXT NOT NULL,
                result_json TEXT,
                error_code TEXT,
                error_message TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                started_at_ms INTEGER,
                completed_at_ms INTEGER,
                UNIQUE(task_id, ordinal)
             );

             CREATE INDEX agent_task_batches_task
             ON agent_task_batches(task_id, ordinal);

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

             ALTER TABLE subtitle_versions
             ADD COLUMN parent_version_id TEXT
                 REFERENCES subtitle_versions(id) ON DELETE SET NULL;

             ALTER TABLE subtitle_versions
             ADD COLUMN source_task_id TEXT
                 REFERENCES agent_tasks(id) ON DELETE SET NULL;

             ALTER TABLE subtitle_segments
             ADD COLUMN source_segment_id TEXT
                 REFERENCES subtitle_segments(id) ON DELETE SET NULL;

             CREATE INDEX subtitle_segments_source
             ON subtitle_segments(source_segment_id)
             WHERE source_segment_id IS NOT NULL;",
        )?;
        Ok(())
    }

    fn apply_migration_9(transaction: &Transaction<'_>) -> Result<(), StoreError> {
        transaction.execute_batch(
            "ALTER TABLE subtitle_segments
             ADD COLUMN lineage_id TEXT;

             UPDATE subtitle_segments
             SET lineage_id = id
             WHERE lineage_id IS NULL;

             CREATE INDEX subtitle_segments_lineage
             ON subtitle_segments(lineage_id);

             ALTER TABLE subtitle_segments
             ADD COLUMN issue_kind TEXT
                 CHECK (
                    issue_kind IS NULL
                    OR issue_kind IN ('missing', 'duplicate', 'incorrect')
                 );

             ALTER TABLE agent_tasks
             ADD COLUMN base_translation_version_id TEXT
                 REFERENCES subtitle_versions(id) ON DELETE SET NULL;

             UPDATE agent_tasks
             SET base_translation_version_id = (
                SELECT current_version_id
                FROM subtitle_tracks
                WHERE subtitle_tracks.project_id = agent_tasks.project_id
                  AND subtitle_tracks.role = 'translation'
                  AND subtitle_tracks.language_code = 'zh-cn'
             )
             WHERE status IN (
                'awaiting_external_result', 'queued', 'running', 'validating'
             );",
        )?;
        Ok(())
    }

    fn apply_migration_10(transaction: &Transaction<'_>) -> Result<(), StoreError> {
        transaction.execute_batch(
            "ALTER TABLE playback_states
             ADD COLUMN subtitle_mode TEXT NOT NULL DEFAULT 'translation'
                 CHECK (subtitle_mode IN ('original', 'translation', 'bilingual'));",
        )?;
        Ok(())
    }

    fn apply_migration_11(transaction: &Transaction<'_>) -> Result<(), StoreError> {
        transaction.execute_batch(
            "CREATE TABLE explanation_tasks (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                handoff_kind TEXT NOT NULL CHECK (handoff_kind IN ('manual', 'codex')),
                protocol_version TEXT NOT NULL,
                status TEXT NOT NULL CHECK (
                    status IN (
                        'awaiting_external_result', 'queued', 'running', 'validating',
                        'completed', 'failed', 'cancelled', 'interrupted'
                    )
                ),
                stage TEXT NOT NULL,
                progress REAL NOT NULL CHECK (progress >= 0.0 AND progress <= 1.0),
                receiver_label TEXT NOT NULL,
                material_scope_json TEXT NOT NULL,
                source_version_id TEXT NOT NULL
                    REFERENCES subtitle_versions(id) ON DELETE CASCADE,
                translation_version_id TEXT
                    REFERENCES subtitle_versions(id) ON DELETE SET NULL,
                authorized_segment_ids_json TEXT NOT NULL,
                playback_cutoff_ms INTEGER NOT NULL CHECK (playback_cutoff_ms > 0),
                scene_start_ms INTEGER NOT NULL
                    CHECK (scene_start_ms >= 0 AND scene_start_ms <= playback_cutoff_ms),
                expected_project_revision INTEGER NOT NULL
                    CHECK (expected_project_revision >= 1),
                expected_media_sha256 TEXT NOT NULL
                    CHECK (length(expected_media_sha256) = 64),
                material_manifest_sha256 TEXT NOT NULL
                    CHECK (length(material_manifest_sha256) = 64),
                result_sha256 TEXT
                    CHECK (result_sha256 IS NULL OR length(result_sha256) = 64),
                result_validation_json TEXT,
                runner_version TEXT,
                runner_auth_mode TEXT,
                runner_thread_id TEXT,
                cancel_requested_at_ms INTEGER,
                error_code TEXT,
                error_message TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                started_at_ms INTEGER,
                completed_at_ms INTEGER
             );

             CREATE INDEX explanation_tasks_project_created
             ON explanation_tasks(project_id, created_at_ms DESC);

             CREATE UNIQUE INDEX one_active_explanation_task_per_project
             ON explanation_tasks(project_id)
             WHERE status IN (
                'awaiting_external_result', 'queued', 'running', 'validating'
             );

             CREATE TABLE explanation_frames (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL
                    REFERENCES explanation_tasks(id) ON DELETE CASCADE,
                ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
                timestamp_ms INTEGER NOT NULL CHECK (timestamp_ms >= 0),
                path TEXT NOT NULL,
                sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
                created_at_ms INTEGER NOT NULL,
                UNIQUE(task_id, ordinal),
                UNIQUE(task_id, timestamp_ms)
             );

             CREATE INDEX explanation_frames_task_timeline
             ON explanation_frames(task_id, timestamp_ms);

             CREATE TABLE explanations (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                task_id TEXT NOT NULL UNIQUE
                    REFERENCES explanation_tasks(id) ON DELETE CASCADE,
                source_version_id TEXT NOT NULL
                    REFERENCES subtitle_versions(id) ON DELETE CASCADE,
                translation_version_id TEXT
                    REFERENCES subtitle_versions(id) ON DELETE SET NULL,
                playback_cutoff_ms INTEGER NOT NULL CHECK (playback_cutoff_ms > 0),
                scene_start_ms INTEGER NOT NULL
                    CHECK (scene_start_ms >= 0 AND scene_start_ms <= playback_cutoff_ms),
                confirmed_facts_json TEXT NOT NULL,
                possible_interpretations_json TEXT NOT NULL,
                withheld_reason TEXT,
                created_at_ms INTEGER NOT NULL
             );

             CREATE INDEX explanations_project_cutoff
             ON explanations(project_id, playback_cutoff_ms DESC, created_at_ms DESC);

             ALTER TABLE explanation_tasks
             ADD COLUMN output_explanation_id TEXT
                 REFERENCES explanations(id) ON DELETE SET NULL;",
        )?;
        Ok(())
    }

    fn apply_migration_12(transaction: &Transaction<'_>) -> Result<(), StoreError> {
        transaction.execute_batch(
            "CREATE TABLE learning_tasks (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                handoff_kind TEXT NOT NULL CHECK (handoff_kind IN ('manual', 'codex')),
                protocol_version TEXT NOT NULL,
                status TEXT NOT NULL CHECK (
                    status IN (
                        'awaiting_external_result', 'queued', 'running', 'validating',
                        'completed', 'failed', 'cancelled', 'interrupted'
                    )
                ),
                stage TEXT NOT NULL,
                progress REAL NOT NULL CHECK (progress >= 0.0 AND progress <= 1.0),
                receiver_label TEXT NOT NULL,
                material_scope_json TEXT NOT NULL,
                source_version_id TEXT NOT NULL
                    REFERENCES subtitle_versions(id) ON DELETE CASCADE,
                translation_version_id TEXT
                    REFERENCES subtitle_versions(id) ON DELETE SET NULL,
                source_segment_id TEXT NOT NULL
                    REFERENCES subtitle_segments(id) ON DELETE CASCADE,
                selected_text TEXT NOT NULL,
                selection_kind TEXT NOT NULL
                    CHECK (selection_kind IN ('word', 'phrase', 'sentence')),
                playback_position_ms INTEGER NOT NULL CHECK (playback_position_ms >= 0),
                expected_project_revision INTEGER NOT NULL
                    CHECK (expected_project_revision >= 1),
                expected_media_sha256 TEXT NOT NULL
                    CHECK (length(expected_media_sha256) = 64),
                material_manifest_sha256 TEXT NOT NULL
                    CHECK (length(material_manifest_sha256) = 64),
                result_sha256 TEXT
                    CHECK (result_sha256 IS NULL OR length(result_sha256) = 64),
                result_validation_json TEXT,
                runner_version TEXT,
                runner_auth_mode TEXT,
                runner_thread_id TEXT,
                cancel_requested_at_ms INTEGER,
                error_code TEXT,
                error_message TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                started_at_ms INTEGER,
                completed_at_ms INTEGER
             );

             CREATE INDEX learning_tasks_project_created
             ON learning_tasks(project_id, created_at_ms DESC);

             CREATE UNIQUE INDEX one_active_learning_task_per_project
             ON learning_tasks(project_id)
             WHERE status IN (
                'awaiting_external_result', 'queued', 'running', 'validating'
             );

             CREATE TABLE dictionary_entries (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                task_id TEXT NOT NULL UNIQUE
                    REFERENCES learning_tasks(id) ON DELETE CASCADE,
                source_version_id TEXT NOT NULL
                    REFERENCES subtitle_versions(id) ON DELETE CASCADE,
                translation_version_id TEXT
                    REFERENCES subtitle_versions(id) ON DELETE SET NULL,
                source_segment_id TEXT NOT NULL
                    REFERENCES subtitle_segments(id) ON DELETE CASCADE,
                selected_text TEXT NOT NULL,
                selection_kind TEXT NOT NULL
                    CHECK (selection_kind IN ('word', 'phrase', 'sentence')),
                pronunciation TEXT NOT NULL,
                part_of_speech TEXT NOT NULL,
                contextual_meaning TEXT NOT NULL,
                usage_note TEXT,
                source_sentence TEXT NOT NULL,
                translated_sentence TEXT,
                language_code TEXT NOT NULL,
                playback_position_ms INTEGER NOT NULL CHECK (playback_position_ms >= 0),
                created_at_ms INTEGER NOT NULL
             );

             CREATE INDEX dictionary_entries_project_created
             ON dictionary_entries(project_id, created_at_ms DESC);

             ALTER TABLE learning_tasks
             ADD COLUMN output_dictionary_entry_id TEXT
                 REFERENCES dictionary_entries(id) ON DELETE SET NULL;

             CREATE TABLE learning_cards (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                dictionary_entry_id TEXT UNIQUE
                    REFERENCES dictionary_entries(id) ON DELETE SET NULL,
                source_version_id TEXT NOT NULL
                    REFERENCES subtitle_versions(id) ON DELETE CASCADE,
                translation_version_id TEXT
                    REFERENCES subtitle_versions(id) ON DELETE SET NULL,
                source_segment_id TEXT NOT NULL
                    REFERENCES subtitle_segments(id) ON DELETE CASCADE,
                selected_text TEXT NOT NULL,
                selection_kind TEXT NOT NULL
                    CHECK (selection_kind IN ('word', 'phrase', 'sentence')),
                pronunciation TEXT NOT NULL,
                part_of_speech TEXT NOT NULL,
                contextual_meaning TEXT NOT NULL,
                usage_note TEXT,
                source_sentence TEXT NOT NULL,
                translated_sentence TEXT,
                language_code TEXT NOT NULL,
                playback_position_ms INTEGER NOT NULL CHECK (playback_position_ms >= 0),
                screenshot_path TEXT NOT NULL,
                screenshot_sha256 TEXT NOT NULL CHECK (length(screenshot_sha256) = 64),
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
             );

             CREATE INDEX learning_cards_project_position
             ON learning_cards(project_id, playback_position_ms ASC, created_at_ms DESC);",
        )?;
        Ok(())
    }

    fn apply_migration_13(transaction: &Transaction<'_>) -> Result<(), StoreError> {
        transaction.execute_batch(
            "CREATE TABLE subtitle_burn_jobs (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                source_media_id TEXT NOT NULL REFERENCES media_sources(id) ON DELETE CASCADE,
                status TEXT NOT NULL CHECK (
                    status IN (
                        'queued', 'running', 'validating', 'completed',
                        'failed', 'cancelled', 'interrupted'
                    )
                ),
                stage TEXT NOT NULL,
                progress REAL NOT NULL CHECK (progress >= 0.0 AND progress <= 1.0),
                mode TEXT NOT NULL CHECK (mode IN ('translation', 'bilingual')),
                source_version_id TEXT REFERENCES subtitle_versions(id),
                translation_version_id TEXT NOT NULL REFERENCES subtitle_versions(id),
                expected_project_revision INTEGER NOT NULL
                    CHECK (expected_project_revision >= 1),
                expected_media_sha256 TEXT NOT NULL
                    CHECK (length(expected_media_sha256) = 64),
                media_duration_ms INTEGER NOT NULL CHECK (media_duration_ms > 0),
                destination_directory TEXT NOT NULL,
                output_path TEXT NOT NULL,
                temporary_output_path TEXT NOT NULL,
                manifest_path TEXT,
                output_sha256 TEXT
                    CHECK (output_sha256 IS NULL OR length(output_sha256) = 64),
                subtitle_path TEXT NOT NULL,
                subtitle_sha256 TEXT NOT NULL CHECK (length(subtitle_sha256) = 64),
                runtime_path TEXT NOT NULL,
                runtime_version TEXT NOT NULL,
                runtime_sha256 TEXT NOT NULL CHECK (length(runtime_sha256) = 64),
                cancel_requested_at_ms INTEGER,
                error_code TEXT,
                error_message TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                started_at_ms INTEGER,
                completed_at_ms INTEGER
             );

             CREATE INDEX subtitle_burn_jobs_project_created
             ON subtitle_burn_jobs(project_id, created_at_ms DESC);

             CREATE UNIQUE INDEX one_active_subtitle_burn_per_project
             ON subtitle_burn_jobs(project_id)
             WHERE status IN ('queued', 'running', 'validating');",
        )?;
        Ok(())
    }

    fn apply_migration_14(transaction: &Transaction<'_>) -> Result<(), StoreError> {
        transaction.execute_batch(
            "ALTER TABLE transcription_jobs RENAME TO transcription_jobs_v13;

             CREATE TABLE transcription_jobs (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                source_media_id TEXT NOT NULL REFERENCES media_sources(id) ON DELETE CASCADE,
                status TEXT NOT NULL CHECK (
                    status IN (
                        'queued', 'extracting', 'transcribing', 'validating',
                        'completed', 'failed', 'cancelled', 'interrupted'
                    )
                ),
                stage TEXT NOT NULL,
                progress REAL NOT NULL CHECK (progress >= 0.0 AND progress <= 1.0),
                language_code TEXT NOT NULL
                    CHECK (language_code IN ('auto', 'en', 'th', 'ja', 'ko')),
                model_kind TEXT NOT NULL CHECK (model_kind IN ('small', 'base')),
                model_path TEXT NOT NULL,
                model_sha256 TEXT NOT NULL CHECK (length(model_sha256) = 64),
                runtime_path TEXT NOT NULL,
                runtime_backend TEXT NOT NULL CHECK (runtime_backend IN ('vulkan', 'cpu')),
                runtime_version TEXT NOT NULL,
                runtime_sha256 TEXT NOT NULL CHECK (length(runtime_sha256) = 64),
                runtime_metadata_sha256 TEXT NOT NULL CHECK (length(runtime_metadata_sha256) = 64),
                parameters_json TEXT NOT NULL,
                expected_project_revision INTEGER NOT NULL CHECK (expected_project_revision >= 1),
                expected_media_sha256 TEXT NOT NULL CHECK (length(expected_media_sha256) = 64),
                media_duration_ms INTEGER NOT NULL CHECK (media_duration_ms > 0),
                confirm_replace_original INTEGER NOT NULL
                    CHECK (confirm_replace_original IN (0, 1)),
                subtitle_version_id TEXT
                    REFERENCES subtitle_versions(id) ON DELETE SET NULL,
                cancel_requested_at_ms INTEGER,
                error_code TEXT,
                error_message TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                started_at_ms INTEGER,
                completed_at_ms INTEGER
             );

             INSERT INTO transcription_jobs (
                id, project_id, source_media_id, status, stage, progress,
                language_code, model_kind, model_path, model_sha256,
                runtime_path, runtime_backend, runtime_version, runtime_sha256,
                runtime_metadata_sha256, parameters_json, expected_project_revision,
                expected_media_sha256, media_duration_ms, confirm_replace_original,
                subtitle_version_id, cancel_requested_at_ms, error_code, error_message,
                created_at_ms, updated_at_ms, started_at_ms, completed_at_ms
             )
             SELECT
                id, project_id, source_media_id, status, stage, progress,
                language_code, model_kind, model_path, model_sha256,
                runtime_path, runtime_backend, runtime_version, runtime_sha256,
                runtime_metadata_sha256, parameters_json, expected_project_revision,
                expected_media_sha256, media_duration_ms, confirm_replace_original,
                subtitle_version_id, cancel_requested_at_ms, error_code, error_message,
                created_at_ms, updated_at_ms, started_at_ms, completed_at_ms
             FROM transcription_jobs_v13;

             DROP TABLE transcription_jobs_v13;

             CREATE INDEX transcription_jobs_project_created
             ON transcription_jobs(project_id, created_at_ms DESC);

             CREATE UNIQUE INDEX one_active_transcription_per_project
             ON transcription_jobs(project_id)
             WHERE status IN ('queued', 'extracting', 'transcribing', 'validating');",
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
                    m.origin_url,
                    m.display_name,
                    m.source_sha256,
                    m.probed_at_ms,
                    m.poster_path,
                    m.created_at_ms,
                    m.updated_at_ms,
                    s.position_ms,
                    s.duration_ms,
                    s.completed_at_ms,
                    s.volume,
                    s.playback_rate,
                    s.subtitle_mode,
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
                        row.get::<_, Option<String>>(9)?,
                        row.get::<_, String>(10)?,
                        row.get::<_, Option<String>>(11)?,
                        row.get::<_, Option<i64>>(12)?,
                        row.get::<_, Option<String>>(13)?,
                        row.get::<_, i64>(14)?,
                        row.get::<_, i64>(15)?,
                        row.get::<_, i64>(16)?,
                        row.get::<_, Option<i64>>(17)?,
                        row.get::<_, Option<i64>>(18)?,
                        row.get::<_, f64>(19)?,
                        row.get::<_, f64>(20)?,
                        row.get::<_, String>(21)?,
                        row.get::<_, i64>(22)?,
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
        let subtitle_mode = SubtitleDisplayMode::from_database_value(&row.21)
            .ok_or_else(|| StoreError::InvalidSubtitleDisplayMode(row.21.clone()))?;

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
                origin_url: row.9,
                display_name: row.10,
                is_available,
                source_sha256: row.11,
                probed_at_ms: row.12,
                poster_path: row.13,
                created_at_ms: row.14,
                updated_at_ms: row.15,
            },
            playback_state: PlaybackState {
                position_ms: row.16,
                duration_ms: row.17,
                completed_at_ms: row.18,
                volume: row.19,
                playback_rate: row.20,
                subtitle_mode,
                updated_at_ms: row.22,
            },
        })
    }

    fn load_media_artifact(
        connection: &Connection,
        artifact_id: &str,
    ) -> Result<MediaArtifact, StoreError> {
        connection
            .query_row(
                "SELECT
                    id, project_id, source_media_id, status, path, source_sha256,
                    profile, error_code, error_message, created_at_ms, updated_at_ms
                 FROM media_artifacts
                 WHERE id = ?1",
                params![artifact_id],
                map_media_artifact,
            )
            .optional()?
            .ok_or_else(|| StoreError::Validation(format!("找不到媒体产物：{artifact_id}")))
    }
}

fn map_media_artifact(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaArtifact> {
    let status_value = row.get::<_, String>(3)?;
    let status = MediaArtifactStatus::from_database_value(&status_value).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            Box::new(StoreError::InvalidMediaArtifactStatus(status_value)),
        )
    })?;
    Ok(MediaArtifact {
        id: row.get(0)?,
        project_id: row.get(1)?,
        source_media_id: row.get(2)?,
        status,
        path: row.get(4)?,
        source_sha256: row.get(5)?,
        profile: row.get(6)?,
        error_code: row.get(7)?,
        error_message: row.get(8)?,
        created_at_ms: row.get(9)?,
        updated_at_ms: row.get(10)?,
    })
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
    validate_uuid(project_id, "项目 ID")
}

fn validate_uuid(value: &str, label: &str) -> Result<(), StoreError> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| StoreError::Validation(format!("{label} 格式无效")))
}

fn validate_sha256(value: &str) -> Result<(), StoreError> {
    let valid = value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit());
    if valid {
        Ok(())
    } else {
        Err(StoreError::Validation("媒体 SHA-256 格式无效".to_owned()))
    }
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

    fn apply_schema_through_14(transaction: &Transaction<'_>) {
        ProjectStore::apply_migration_1(transaction).expect("v1 should apply");
        ProjectStore::apply_migration_2(transaction).expect("v2 should apply");
        ProjectStore::apply_migration_3(transaction).expect("v3 should apply");
        ProjectStore::apply_migration_4(transaction).expect("v4 should apply");
        ProjectStore::apply_migration_5(transaction).expect("v5 should apply");
        ProjectStore::apply_migration_6(transaction).expect("v6 should apply");
        ProjectStore::apply_migration_7(transaction).expect("v7 should apply");
        ProjectStore::apply_migration_8(transaction).expect("v8 should apply");
        ProjectStore::apply_migration_9(transaction).expect("v9 should apply");
        ProjectStore::apply_migration_10(transaction).expect("v10 should apply");
        ProjectStore::apply_migration_11(transaction).expect("v11 should apply");
        ProjectStore::apply_migration_12(transaction).expect("v12 should apply");
        ProjectStore::apply_migration_13(transaction).expect("v13 should apply");
        ProjectStore::apply_migration_14(transaction).expect("v14 should apply");
        for version in 1..=14 {
            transaction
                .execute(
                    "INSERT INTO schema_migrations (version, applied_at_ms)
                     VALUES (?1, 0)",
                    params![version],
                )
                .expect("migration should be recorded");
        }
    }

    fn create_v14_database(database_path: &Path) -> String {
        let project_id = Uuid::new_v4().to_string();
        let media_id = Uuid::new_v4().to_string();
        let mut connection = Connection::open(database_path).expect("v14 database should open");
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at_ms INTEGER NOT NULL
                 );",
            )
            .expect("migration table should be created");
        let transaction = connection.transaction().expect("transaction should open");
        apply_schema_through_14(&transaction);
        transaction
            .execute(
                "INSERT INTO projects (
                    id, title, revision, created_at_ms, updated_at_ms, last_opened_at_ms
                 ) VALUES (?1, 'v14 project', 1, 1, 1, 1)",
                params![project_id],
            )
            .expect("v14 project should be inserted");
        transaction
            .execute(
                "INSERT INTO media_sources (
                    id, project_id, kind, locator, display_name, is_primary,
                    created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, 'local_file', 'episode.mp4', 'episode.mp4', 1, 1, 1)",
                params![media_id, project_id],
            )
            .expect("v14 media should be inserted");
        transaction
            .execute(
                "INSERT INTO playback_states (
                    project_id, position_ms, duration_ms, volume, playback_rate,
                    subtitle_mode, updated_at_ms
                 ) VALUES (?1, 500, 1000, 0.8, 1.0, 'bilingual', 1)",
                params![project_id],
            )
            .expect("v14 playback should be inserted");
        transaction.commit().expect("v14 fixture should commit");
        project_id
    }

    struct V14BusinessFixture {
        project_id: String,
        original_version_id: String,
        translation_version_id: String,
        explanation_id: String,
        dictionary_entry_id: String,
        learning_card_id: String,
    }

    fn create_v14_business_database(database_path: &Path) -> V14BusinessFixture {
        let project_id = create_v14_database(database_path);
        let original_track_id = Uuid::new_v4().to_string();
        let translation_track_id = Uuid::new_v4().to_string();
        let original_version_id = Uuid::new_v4().to_string();
        let translation_version_id = Uuid::new_v4().to_string();
        let original_segment_id = Uuid::new_v4().to_string();
        let translation_segment_id = Uuid::new_v4().to_string();
        let explanation_task_id = Uuid::new_v4().to_string();
        let explanation_id = Uuid::new_v4().to_string();
        let learning_task_id = Uuid::new_v4().to_string();
        let dictionary_entry_id = Uuid::new_v4().to_string();
        let learning_card_id = Uuid::new_v4().to_string();
        let media_sha256 = "a".repeat(64);
        let material_sha256 = "b".repeat(64);
        let source_sha256 = "c".repeat(64);
        let screenshot_sha256 = "d".repeat(64);
        let preflight_json = r#"{"status":"ready","segmentCount":1,"errorCount":0,"warningCount":0,"firstStartMs":40000,"lastEndMs":45000,"mediaDurationMs":180000,"coverageRatio":0.0278,"issues":[]}"#;
        let mut connection = Connection::open(database_path).expect("v14 database should reopen");
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign keys should enable");
        let transaction = connection
            .transaction()
            .expect("business transaction should open");
        transaction
            .execute(
                "UPDATE media_sources SET source_sha256 = ?2 WHERE project_id = ?1",
                params![project_id, media_sha256],
            )
            .expect("media hash should be recorded");
        transaction
            .execute(
                "UPDATE playback_states
                 SET position_ms = 42000, duration_ms = 180000, subtitle_mode = 'bilingual'
                 WHERE project_id = ?1",
                params![project_id],
            )
            .expect("playback state should be recorded");

        for (track_id, role, language_code) in [
            (&original_track_id, "original", "ja"),
            (&translation_track_id, "translation", "zh-cn"),
        ] {
            transaction
                .execute(
                    "INSERT INTO subtitle_tracks (
                        id, project_id, role, language_code, created_at_ms, updated_at_ms
                     ) VALUES (?1, ?2, ?3, ?4, 10, 10)",
                    params![track_id, project_id, role, language_code],
                )
                .expect("subtitle track should insert");
        }
        for (version_id, track_id, source_kind, source_label, language_code) in [
            (
                &original_version_id,
                &original_track_id,
                "imported_file",
                "v14 original.srt",
                "ja",
            ),
            (
                &translation_version_id,
                &translation_track_id,
                "agent_translation",
                "v14 translation",
                "zh-cn",
            ),
        ] {
            transaction
                .execute(
                    "INSERT INTO subtitle_versions (
                        id, track_id, project_id, version_number, status, source_kind,
                        source_label, source_sha256, media_sha256, language_code,
                        project_revision, preflight_json, created_at_ms
                     ) VALUES (?1, ?2, ?3, 1, 'ready', ?4, ?5, ?6, ?7, ?8, 1, ?9, 10)",
                    params![
                        version_id,
                        track_id,
                        project_id,
                        source_kind,
                        source_label,
                        source_sha256,
                        media_sha256,
                        language_code,
                        preflight_json,
                    ],
                )
                .expect("subtitle version should insert");
        }
        transaction
            .execute(
                "INSERT INTO subtitle_segments (
                    id, version_id, ordinal, start_ms, end_ms, text
                 ) VALUES (?1, ?2, 0, 40000, 45000, '待っていたの？')",
                params![original_segment_id, original_version_id],
            )
            .expect("original segment should insert");
        transaction
            .execute(
                "INSERT INTO subtitle_segments (
                    id, version_id, ordinal, start_ms, end_ms, text
                 ) VALUES (?1, ?2, 0, 40000, 45000, '你一直在等吗？')",
                params![translation_segment_id, translation_version_id],
            )
            .expect("translation segment should insert");
        transaction
            .execute(
                "UPDATE subtitle_tracks SET current_version_id = ?2 WHERE id = ?1",
                params![original_track_id, original_version_id],
            )
            .expect("original current version should update");
        transaction
            .execute(
                "UPDATE subtitle_tracks SET current_version_id = ?2 WHERE id = ?1",
                params![translation_track_id, translation_version_id],
            )
            .expect("translation current version should update");

        transaction
            .execute(
                "INSERT INTO explanation_tasks (
                    id, project_id, handoff_kind, protocol_version, status, stage, progress,
                    receiver_label, material_scope_json, source_version_id,
                    translation_version_id, authorized_segment_ids_json, playback_cutoff_ms,
                    scene_start_ms, expected_project_revision, expected_media_sha256,
                    material_manifest_sha256, created_at_ms, updated_at_ms, completed_at_ms
                 ) VALUES (
                    ?1, ?2, 'manual', 'siaovplay-understanding-v1', 'completed', 'completed', 1.0,
                    'v14 external agent', '{}', ?3, ?4, ?5, 45000, 40000, 1, ?6, ?7, 20, 20, 20
                 )",
                params![
                    explanation_task_id,
                    project_id,
                    original_version_id,
                    translation_version_id,
                    format!("[\"{original_segment_id}\"]"),
                    media_sha256,
                    material_sha256,
                ],
            )
            .expect("explanation task should insert");
        transaction
            .execute(
                "INSERT INTO explanations (
                    id, project_id, task_id, source_version_id, translation_version_id,
                    playback_cutoff_ms, scene_start_ms, confirmed_facts_json,
                    possible_interpretations_json, created_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 45000, 40000,
                    '[\"人物正在车站等待\"]', '[\"语气带有惊讶\"]', 20)",
                params![
                    explanation_id,
                    project_id,
                    explanation_task_id,
                    original_version_id,
                    translation_version_id,
                ],
            )
            .expect("explanation should insert");

        transaction
            .execute(
                "INSERT INTO learning_tasks (
                    id, project_id, handoff_kind, protocol_version, status, stage, progress,
                    receiver_label, material_scope_json, source_version_id,
                    translation_version_id, source_segment_id, selected_text, selection_kind,
                    playback_position_ms, expected_project_revision, expected_media_sha256,
                    material_manifest_sha256, created_at_ms, updated_at_ms, completed_at_ms
                 ) VALUES (
                    ?1, ?2, 'manual', 'siaovplay-learning-v1', 'completed', 'completed', 1.0,
                    'v14 external agent', '{}', ?3, ?4, ?5, '待っていた', 'phrase',
                    42000, 1, ?6, ?7, 30, 30, 30
                 )",
                params![
                    learning_task_id,
                    project_id,
                    original_version_id,
                    translation_version_id,
                    original_segment_id,
                    media_sha256,
                    material_sha256,
                ],
            )
            .expect("learning task should insert");
        transaction
            .execute(
                "INSERT INTO dictionary_entries (
                    id, project_id, task_id, source_version_id, translation_version_id,
                    source_segment_id, selected_text, selection_kind, pronunciation,
                    part_of_speech, contextual_meaning, usage_note, source_sentence,
                    translated_sentence, language_code, playback_position_ms, created_at_ms
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, '待っていた', 'phrase', 'まっていた',
                    '动词短语', '一直在等', '过去进行状态', '待っていたの？',
                    '你一直在等吗？', 'ja', 42000, 30
                 )",
                params![
                    dictionary_entry_id,
                    project_id,
                    learning_task_id,
                    original_version_id,
                    translation_version_id,
                    original_segment_id,
                ],
            )
            .expect("dictionary entry should insert");
        transaction
            .execute(
                "INSERT INTO learning_cards (
                    id, project_id, dictionary_entry_id, source_version_id,
                    translation_version_id, source_segment_id, selected_text, selection_kind,
                    pronunciation, part_of_speech, contextual_meaning, usage_note,
                    source_sentence, translated_sentence, language_code, playback_position_ms,
                    screenshot_path, screenshot_sha256, created_at_ms, updated_at_ms
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, '待っていた', 'phrase', 'まっていた',
                    '动词短语', '一直在等', '过去进行状态', '待っていたの？',
                    '你一直在等吗？', 'ja', 42000, 'v14-scene.png', ?7, 30, 30
                 )",
                params![
                    learning_card_id,
                    project_id,
                    dictionary_entry_id,
                    original_version_id,
                    translation_version_id,
                    original_segment_id,
                    screenshot_sha256,
                ],
            )
            .expect("learning card should insert");
        transaction
            .commit()
            .expect("business fixture should commit");

        V14BusinessFixture {
            project_id,
            original_version_id,
            translation_version_id,
            explanation_id,
            dictionary_entry_id,
            learning_card_id,
        }
    }

    fn table_exists(connection: &Connection, table: &str) -> bool {
        connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1
                 )",
                params![table],
                |row| row.get::<_, bool>(0),
            )
            .expect("table existence should be readable")
    }

    fn column_exists(connection: &Connection, table: &str, column: &str) -> bool {
        connection
            .prepare(&format!("PRAGMA table_info({table})"))
            .expect("table info should prepare")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("table info should query")
            .collect::<Result<Vec<_>, _>>()
            .expect("table columns should load")
            .iter()
            .any(|name| name == column)
    }

    #[test]
    fn migrates_new_database_and_persists_playback_after_reopen() {
        let fixture = Fixture::new();
        assert_eq!(
            fixture.store.schema_version().expect("schema version"),
            CURRENT_SCHEMA_VERSION
        );
        assert!(
            !library_migration::v14_backup_path(fixture.store.database_path()).exists(),
            "a new empty database should not create a legacy backup"
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
                subtitle_mode: SubtitleDisplayMode::Bilingual,
            })
            .expect("playback should update");

        let reopened =
            ProjectStore::open(fixture.store.database_path()).expect("store should reopen");
        let restored = reopened
            .get_project(&project.id)
            .expect("project should be restored");
        assert_eq!(restored.playback_state.position_ms, 75_000);
        assert_eq!(restored.playback_state.duration_ms, Some(120_000));
        assert_eq!(restored.playback_state.completed_at_ms, None);
        assert_eq!(restored.playback_state.volume, 0.7);
        assert_eq!(restored.playback_state.playback_rate, 1.25);
        assert_eq!(
            restored.playback_state.subtitle_mode,
            SubtitleDisplayMode::Bilingual
        );
    }

    #[test]
    fn records_completion_at_ninety_percent_and_never_clears_it_implicitly() {
        let fixture = Fixture::new();
        let project = fixture.create_project(&fixture.media_file("completion.mp4"));

        let before_threshold = fixture
            .store
            .update_playback_state(UpdatePlaybackStateInput {
                project_id: project.id.clone(),
                position_ms: 89_999,
                duration_ms: Some(100_000),
                volume: 1.0,
                playback_rate: 1.0,
                subtitle_mode: SubtitleDisplayMode::Original,
            })
            .expect("playback below threshold should save");
        assert_eq!(before_threshold.playback_state.completed_at_ms, None);

        let completed = fixture
            .store
            .update_playback_state(UpdatePlaybackStateInput {
                project_id: project.id.clone(),
                position_ms: 90_000,
                duration_ms: Some(100_000),
                volume: 1.0,
                playback_rate: 1.0,
                subtitle_mode: SubtitleDisplayMode::Original,
            })
            .expect("playback at threshold should save");
        let completed_at_ms = completed
            .playback_state
            .completed_at_ms
            .expect("completion should be recorded");

        let replayed = fixture
            .store
            .update_playback_state(UpdatePlaybackStateInput {
                project_id: project.id,
                position_ms: 0,
                duration_ms: Some(100_000),
                volume: 1.0,
                playback_rate: 1.0,
                subtitle_mode: SubtitleDisplayMode::Original,
            })
            .expect("replay position should save");
        assert_eq!(
            replayed.playback_state.completed_at_ms,
            Some(completed_at_ms)
        );
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
    fn relinking_media_invalidates_probe_and_poster_cache() {
        let fixture = Fixture::new();
        let original_path = fixture.media_file("original.mp4");
        let project = fixture.create_project(&original_path);
        let source_sha256 = "a".repeat(64);
        fixture
            .store
            .record_media_probe(
                &project.id,
                &project.media_source.id,
                &source_sha256,
                "{}",
                10,
                Some(123),
            )
            .expect("probe should be recorded");
        let poster_path = fixture.temp_dir.path().join("poster.jpg");
        fs::write(&poster_path, b"poster").expect("poster fixture should be written");
        let with_poster = fixture
            .store
            .record_media_poster(
                &project.id,
                &project.media_source.id,
                &source_sha256,
                &poster_path,
            )
            .expect("poster should be recorded");
        assert!(with_poster.media_source.poster_path.is_some());

        let replacement_path = fixture.media_file("replacement.mp4");
        let relinked = fixture
            .store
            .relink_project_media(RelinkProjectMediaInput {
                project_id: project.id,
                media_path: path_to_string(&replacement_path),
            })
            .expect("project should relink");

        assert_eq!(relinked.media_source.source_sha256, None);
        assert_eq!(relinked.media_source.probed_at_ms, None);
        assert_eq!(relinked.media_source.poster_path, None);
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
    fn remote_project_persists_origin_and_only_deletes_controlled_cache() {
        let temporary = tempfile::tempdir().expect("temp directory should be created");
        let store = ProjectStore::open(temporary.path().join("projects").join("siaovplay.sqlite3"))
            .expect("store should open");
        let cache_directory = temporary
            .path()
            .join("remote-media")
            .join("authorized-import");
        fs::create_dir_all(&cache_directory).expect("cache directory should be created");
        let cached_media = cache_directory.join("source.mp4");
        fs::write(&cached_media, b"remote-media-copy").expect("cached media should be written");

        let project = store
            .create_remote_project(
                &cached_media,
                "https://media.example.com/episode.mp4",
                "episode.mp4",
                None,
            )
            .expect("remote project should be created");

        assert_eq!(
            project.media_source.origin_url.as_deref(),
            Some("https://media.example.com/episode.mp4")
        );
        let result = store
            .delete_project(&project.id)
            .expect("remote project should delete");
        assert!(result.deleted);
        assert!(result.cached_media_deleted);
        assert!(!cache_directory.exists());
    }

    #[test]
    fn remote_project_can_persist_importer_provenance() {
        let temporary = tempfile::tempdir().expect("temp directory should be created");
        let store = ProjectStore::open(temporary.path().join("projects").join("siaovplay.sqlite3"))
            .expect("store should open");
        let cache_directory = temporary.path().join("remote-media").join("youtube-import");
        fs::create_dir_all(&cache_directory).expect("cache directory should be created");
        let cached_media = cache_directory.join("source.mp4");
        fs::write(&cached_media, b"remote-media-copy").expect("cached media should be written");
        let sha256 = "3".repeat(64);

        let project = store
            .create_remote_project_with_provenance(
                &cached_media,
                "https://www.youtube.com/watch?v=jNQXAC9IVRw",
                "Me at the zoo.mp4",
                Some("Me at the zoo"),
                &RemoteImportProvenance {
                    importer: "yt-dlp".to_owned(),
                    importer_version: "2026.06.09".to_owned(),
                    importer_sha256: sha256.clone(),
                },
            )
            .expect("remote project should be created");
        let connection = store.connect().expect("database should open");
        let provenance = connection
            .query_row(
                "SELECT importer, importer_version, importer_sha256, imported_at_ms
                 FROM media_source_imports WHERE media_source_id=?1",
                [&project.media_source.id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .expect("provenance should be stored");

        assert_eq!(provenance.0, "yt-dlp");
        assert_eq!(provenance.1, "2026.06.09");
        assert_eq!(provenance.2, sha256);
        assert!(provenance.3 > 0);
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
                subtitle_mode: SubtitleDisplayMode::Translation,
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

    #[test]
    fn migrates_v14_with_a_verified_backup_and_preserves_existing_projects() {
        let temp_dir = tempfile::tempdir().expect("temporary directory should be created");
        let database_path = temp_dir.path().join("v14.sqlite3");
        let project_id = create_v14_database(&database_path);

        let store = ProjectStore::open(&database_path).expect("v14 store should upgrade");
        assert_eq!(store.schema_version().expect("schema version"), 15);
        let project = store
            .get_project(&project_id)
            .expect("v14 project should remain readable");
        assert_eq!(project.title, "v14 project");
        assert_eq!(project.playback_state.position_ms, 500);
        assert_eq!(project.playback_state.completed_at_ms, None);

        let connection = store.connect().expect("upgraded database should reopen");
        for table in ["library_roots", "collections", "collection_items"] {
            assert!(table_exists(&connection, table), "{table} should exist");
        }
        assert!(column_exists(
            &connection,
            "playback_states",
            "completed_at_ms"
        ));

        let backup_path = library_migration::v14_backup_path(&database_path);
        assert!(backup_path.is_file());
        let backup = Connection::open(&backup_path).expect("backup should open");
        let backup_version = backup
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("backup schema version should load");
        assert_eq!(backup_version, 14);
        assert!(!table_exists(&backup, "library_roots"));
        assert!(!column_exists(
            &backup,
            "playback_states",
            "completed_at_ms"
        ));
    }

    #[test]
    fn v14_business_data_remains_readable_and_unclassified_after_schema_15() {
        let temporary = tempfile::tempdir().expect("temporary directory should be created");
        let database_path = temporary.path().join("v14-business.sqlite3");
        let fixture = create_v14_business_database(&database_path);

        let store = ProjectStore::open(&database_path).expect("v14 business store should upgrade");
        let project = store
            .get_project(&fixture.project_id)
            .expect("project should remain readable");
        assert_eq!(project.playback_state.position_ms, 42_000);
        assert_eq!(project.playback_state.duration_ms, Some(180_000));
        assert_eq!(
            project.playback_state.subtitle_mode,
            SubtitleDisplayMode::Bilingual
        );
        assert_eq!(project.playback_state.completed_at_ms, None);

        let versions = crate::subtitles::list_subtitle_versions(&store, &fixture.project_id)
            .expect("subtitle versions should remain readable");
        assert_eq!(versions.len(), 2);
        let original = versions
            .iter()
            .find(|version| version.id == fixture.original_version_id)
            .expect("original version should remain");
        assert!(original.is_current);
        assert_eq!(original.segments[0].text, "待っていたの？");
        let translation = versions
            .iter()
            .find(|version| version.id == fixture.translation_version_id)
            .expect("translation version should remain");
        assert!(translation.is_current);
        assert_eq!(translation.segments[0].text, "你一直在等吗？");

        let explanations = crate::understanding::list_explanations(&store, &fixture.project_id)
            .expect("explanations should remain readable");
        assert_eq!(explanations.len(), 1);
        assert_eq!(explanations[0].id, fixture.explanation_id);
        assert_eq!(explanations[0].confirmed_facts, ["人物正在车站等待"]);
        assert_eq!(explanations[0].possible_interpretations, ["语气带有惊讶"]);

        let entries = crate::learning::list_dictionary_entries(&store, &fixture.project_id)
            .expect("dictionary entries should remain readable");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, fixture.dictionary_entry_id);
        assert_eq!(entries[0].contextual_meaning, "一直在等");
        assert_eq!(
            entries[0].translated_sentence.as_deref(),
            Some("你一直在等吗？")
        );

        let cards = crate::learning::list_learning_cards(&store, &fixture.project_id)
            .expect("learning cards should remain readable");
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].id, fixture.learning_card_id);
        assert_eq!(cards[0].selected_text, "待っていた");
        assert!(!cards[0].screenshot_available);

        let home = crate::library::LibraryService::new(store.clone())
            .get_home()
            .expect("library home should load");
        assert_eq!(home.total_project_count, 1);
        assert_eq!(home.unclassified_count, 1);
        assert_eq!(home.unclassified[0].project_id, fixture.project_id);
        assert!(home.collections.is_empty());

        let backup_path = library_migration::v14_backup_path(&database_path);
        let backup = Connection::open(backup_path).expect("v14 backup should open");
        for table in [
            "subtitle_versions",
            "subtitle_segments",
            "explanations",
            "dictionary_entries",
            "learning_cards",
        ] {
            let count = backup
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("backup business data should be readable");
            assert!(count > 0, "{table} should be present in the v14 backup");
        }
    }

    #[test]
    fn aborts_schema_15_when_the_v14_backup_cannot_be_created() {
        let temp_dir = tempfile::tempdir().expect("temporary directory should be created");
        let database_path = temp_dir.path().join("backup-failure.sqlite3");
        create_v14_database(&database_path);
        let backup_path = library_migration::v14_backup_path(&database_path);
        fs::create_dir(&backup_path).expect("blocking backup directory should be created");

        let result = ProjectStore::open(&database_path);
        assert!(matches!(
            result,
            Err(StoreError::LibraryMigration(MigrationError::InvalidBackup(
                _
            )))
        ));

        let connection = Connection::open(&database_path).expect("v14 database should reopen");
        let version = connection
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("schema version should remain readable");
        assert_eq!(version, 14);
        assert!(!table_exists(&connection, "library_roots"));
        assert!(!column_exists(
            &connection,
            "playback_states",
            "completed_at_ms"
        ));
    }

    #[test]
    fn rolls_back_schema_15_when_foreign_key_check_fails() {
        let temp_dir = tempfile::tempdir().expect("temporary directory should be created");
        let database_path = temp_dir.path().join("foreign-key-failure.sqlite3");
        create_v14_database(&database_path);
        let connection = Connection::open(&database_path).expect("v14 database should reopen");
        connection
            .execute_batch("PRAGMA foreign_keys = OFF;")
            .expect("foreign keys should disable for corrupted fixture");
        connection
            .execute(
                "INSERT INTO media_sources (
                    id, project_id, kind, locator, display_name, is_primary,
                    created_at_ms, updated_at_ms
                 ) VALUES (?1, 'missing-project', 'local_file', 'missing.mp4',
                    'missing.mp4', 0, 1, 1)",
                params![Uuid::new_v4().to_string()],
            )
            .expect("corrupted foreign key fixture should be inserted");
        drop(connection);

        let result = ProjectStore::open(&database_path);
        assert!(matches!(
            result,
            Err(StoreError::LibraryMigration(
                MigrationError::ForeignKeyViolation(_)
            ))
        ));

        let connection = Connection::open(&database_path).expect("database should reopen");
        let version = connection
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("schema version should remain readable");
        assert_eq!(version, 14);
        assert!(!table_exists(&connection, "library_roots"));
        assert!(!column_exists(
            &connection,
            "playback_states",
            "completed_at_ms"
        ));
    }

    #[test]
    fn collection_relationships_use_the_intended_cascade_boundaries() {
        let fixture = Fixture::new();
        let project = fixture.create_project(&fixture.media_file("cascade.mp4"));
        let connection = fixture.store.connect().expect("database should connect");
        let root_id = Uuid::new_v4().to_string();
        let collection_id = Uuid::new_v4().to_string();
        connection
            .execute(
                "INSERT INTO library_roots (
                    id, path, path_key, display_name, created_at_ms, updated_at_ms
                 ) VALUES (?1, 'W:\\Series', 'w:\\series', 'Series', 1, 1)",
                params![root_id],
            )
            .expect("library root should insert");

        let insert_collection = |id: &str| {
            connection
                .execute(
                    "INSERT INTO collections (
                        id, kind, title, root_id, created_at_ms, updated_at_ms
                     ) VALUES (?1, 'series', 'Series', ?2, 1, 1)",
                    params![id, root_id],
                )
                .expect("collection should insert");
            connection
                .execute(
                    "INSERT INTO collection_items (
                        collection_id, project_id, season_number, episode_number,
                        absolute_order, display_title, relative_path, relative_path_key,
                        created_at_ms, updated_at_ms
                     ) VALUES (?1, ?2, 1, 1, 1, 'Episode 1', 'S01E01.mp4',
                        's01e01.mp4', 1, 1)",
                    params![id, project.id],
                )
                .expect("collection item should insert");
        };

        insert_collection(&collection_id);
        let auto_play_next = connection
            .query_row(
                "SELECT auto_play_next FROM collections WHERE id = ?1",
                params![collection_id],
                |row| row.get::<_, i64>(0),
            )
            .expect("auto play default should load");
        assert_eq!(auto_play_next, 0);

        connection
            .execute(
                "DELETE FROM collections WHERE id = ?1",
                params![collection_id],
            )
            .expect("collection should delete");
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM projects WHERE id = ?1",
                    params![project.id],
                    |row| row.get::<_, i64>(0),
                )
                .expect("project count should load"),
            1
        );

        let second_collection_id = Uuid::new_v4().to_string();
        insert_collection(&second_collection_id);
        connection
            .execute(
                "DELETE FROM collection_items
                 WHERE collection_id = ?1 AND project_id = ?2",
                params![second_collection_id, project.id],
            )
            .expect("membership should delete");
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM projects WHERE id = ?1",
                    params![project.id],
                    |row| row.get::<_, i64>(0),
                )
                .expect("project count should load"),
            1
        );

        connection
            .execute(
                "INSERT INTO collection_items (
                    collection_id, project_id, absolute_order, display_title,
                    created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, 1, 'Episode 1', 1, 1)",
                params![second_collection_id, project.id],
            )
            .expect("membership should reinsert");
        connection
            .execute("DELETE FROM projects WHERE id = ?1", params![project.id])
            .expect("project should delete");
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM collection_items WHERE collection_id = ?1",
                    params![second_collection_id],
                    |row| row.get::<_, i64>(0),
                )
                .expect("membership count should load"),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM collections WHERE id = ?1",
                    params![second_collection_id],
                    |row| row.get::<_, i64>(0),
                )
                .expect("collection count should load"),
            1
        );
    }

    #[test]
    fn migrates_a_v1_database_to_current_schema() {
        let temp_dir = tempfile::tempdir().expect("temp directory should be created");
        let database_path = temp_dir.path().join("v1.sqlite3");
        let mut connection = Connection::open(&database_path).expect("database should open");
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at_ms INTEGER NOT NULL
                 );",
            )
            .expect("migration table should be created");
        let transaction = connection.transaction().expect("transaction should open");
        ProjectStore::apply_migration_1(&transaction).expect("v1 schema should apply");
        transaction
            .execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (1, 0)",
                [],
            )
            .expect("v1 migration should be recorded");
        transaction.commit().expect("transaction should commit");
        drop(connection);

        let store = ProjectStore::open(database_path).expect("v1 store should upgrade");
        assert_eq!(
            store.schema_version().expect("schema version"),
            CURRENT_SCHEMA_VERSION
        );
        let connection = store.connect().expect("database should reopen");
        let artifact_table_exists = connection
            .query_row(
                "SELECT 1 FROM sqlite_master
                 WHERE type = 'table' AND name = 'media_artifacts'",
                [],
                |_| Ok(()),
            )
            .optional()
            .expect("schema query should run")
            .is_some();
        assert!(artifact_table_exists);
        let subtitle_tables = connection
            .prepare(
                "SELECT name FROM sqlite_master
                 WHERE type = 'table' AND name IN (
                    'subtitle_tracks', 'subtitle_versions', 'subtitle_segments'
                 )
                 ORDER BY name",
            )
            .expect("schema query should prepare")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("schema query should run")
            .collect::<Result<Vec<_>, _>>()
            .expect("schema rows should load");
        assert_eq!(subtitle_tables.len(), 3);
    }

    #[test]
    fn migrates_v13_transcription_jobs_and_allows_automatic_language_detection() {
        let temp_dir = tempfile::tempdir().expect("temporary directory should be created");
        let database_path = temp_dir.path().join("v13.sqlite3");
        let project_id = Uuid::new_v4().to_string();
        let media_id = Uuid::new_v4().to_string();
        let legacy_job_id = Uuid::new_v4().to_string();
        let mut connection = Connection::open(&database_path).expect("database should open");
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at_ms INTEGER NOT NULL
                 );",
            )
            .expect("migration table should be created");
        let transaction = connection.transaction().expect("transaction should open");
        ProjectStore::apply_migration_1(&transaction).expect("v1 should apply");
        ProjectStore::apply_migration_2(&transaction).expect("v2 should apply");
        ProjectStore::apply_migration_3(&transaction).expect("v3 should apply");
        ProjectStore::apply_migration_4(&transaction).expect("v4 should apply");
        ProjectStore::apply_migration_5(&transaction).expect("v5 should apply");
        ProjectStore::apply_migration_6(&transaction).expect("v6 should apply");
        ProjectStore::apply_migration_7(&transaction).expect("v7 should apply");
        ProjectStore::apply_migration_8(&transaction).expect("v8 should apply");
        ProjectStore::apply_migration_9(&transaction).expect("v9 should apply");
        ProjectStore::apply_migration_10(&transaction).expect("v10 should apply");
        ProjectStore::apply_migration_11(&transaction).expect("v11 should apply");
        ProjectStore::apply_migration_12(&transaction).expect("v12 should apply");
        ProjectStore::apply_migration_13(&transaction).expect("v13 should apply");
        for version in 1..=13 {
            transaction
                .execute(
                    "INSERT INTO schema_migrations (version, applied_at_ms)
                     VALUES (?1, 0)",
                    params![version],
                )
                .expect("migration should be recorded");
        }
        transaction
            .execute(
                "INSERT INTO projects (
                    id, title, revision, created_at_ms, updated_at_ms, last_opened_at_ms
                 ) VALUES (?1, 'legacy project', 1, 1, 1, 1)",
                params![project_id],
            )
            .expect("legacy project should be inserted");
        transaction
            .execute(
                "INSERT INTO media_sources (
                    id, project_id, kind, locator, display_name, is_primary,
                    created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, 'local_file', 'legacy.mp4', 'legacy.mp4', 1, 1, 1)",
                params![media_id, project_id],
            )
            .expect("legacy media should be inserted");
        transaction
            .execute(
                "INSERT INTO transcription_jobs (
                    id, project_id, source_media_id, status, stage, progress,
                    language_code, model_kind, model_path, model_sha256,
                    runtime_path, runtime_backend, runtime_version, runtime_sha256,
                    runtime_metadata_sha256, parameters_json, expected_project_revision,
                    expected_media_sha256, media_duration_ms, confirm_replace_original,
                    subtitle_version_id, cancel_requested_at_ms, error_code, error_message,
                    created_at_ms, updated_at_ms, started_at_ms, completed_at_ms
                 ) VALUES (
                    ?1, ?2, ?3, 'completed', 'completed', 1.0,
                    'en', 'small', 'model.bin', ?4,
                    'runtime.exe', 'cpu', 'test', ?5,
                    ?6, '{}', 1,
                    ?7, 1000, 0,
                    NULL, NULL, NULL, NULL,
                    1, 1, 1, 1
                 )",
                params![
                    legacy_job_id,
                    project_id,
                    media_id,
                    "a".repeat(64),
                    "b".repeat(64),
                    "c".repeat(64),
                    "d".repeat(64),
                ],
            )
            .expect("legacy transcription job should be inserted");
        transaction.commit().expect("v13 fixture should commit");
        drop(connection);

        let store = ProjectStore::open(&database_path).expect("v13 store should upgrade");
        assert_eq!(
            store.schema_version().expect("schema version"),
            CURRENT_SCHEMA_VERSION
        );
        let connection = store.connect().expect("database should reopen");
        let migrated_language = connection
            .query_row(
                "SELECT language_code FROM transcription_jobs WHERE id = ?1",
                params![legacy_job_id],
                |row| row.get::<_, String>(0),
            )
            .expect("legacy job should remain readable");
        assert_eq!(migrated_language, "en");

        connection
            .execute(
                "INSERT INTO transcription_jobs (
                    id, project_id, source_media_id, status, stage, progress,
                    language_code, model_kind, model_path, model_sha256,
                    runtime_path, runtime_backend, runtime_version, runtime_sha256,
                    runtime_metadata_sha256, parameters_json, expected_project_revision,
                    expected_media_sha256, media_duration_ms, confirm_replace_original,
                    subtitle_version_id, cancel_requested_at_ms, error_code, error_message,
                    created_at_ms, updated_at_ms, started_at_ms, completed_at_ms
                 ) VALUES (
                    ?1, ?2, ?3, 'completed', 'completed', 1.0,
                    'auto', 'small', 'model.bin', ?4,
                    'runtime.exe', 'cpu', 'test', ?5,
                    ?6, '{}', 1,
                    ?7, 1000, 0,
                    NULL, NULL, NULL, NULL,
                    2, 2, 2, 2
                 )",
                params![
                    Uuid::new_v4().to_string(),
                    project_id,
                    media_id,
                    "a".repeat(64),
                    "b".repeat(64),
                    "c".repeat(64),
                    "d".repeat(64),
                ],
            )
            .expect("automatic language job should be accepted");
    }

    #[test]
    fn migrates_a_v9_project_with_the_chinese_subtitle_default() {
        let temp_dir = tempfile::tempdir().expect("temporary directory should be created");
        let database_path = temp_dir.path().join("v9.sqlite3");
        let media_path = temp_dir.path().join("legacy.mp4");
        fs::write(&media_path, b"legacy-media").expect("legacy media should be written");
        let project_id = Uuid::new_v4().to_string();
        let media_id = Uuid::new_v4().to_string();
        let mut connection = Connection::open(&database_path).expect("database should open");
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at_ms INTEGER NOT NULL
                 );",
            )
            .expect("migration table should be created");
        let transaction = connection.transaction().expect("transaction should open");
        ProjectStore::apply_migration_1(&transaction).expect("v1 should apply");
        ProjectStore::apply_migration_2(&transaction).expect("v2 should apply");
        ProjectStore::apply_migration_3(&transaction).expect("v3 should apply");
        ProjectStore::apply_migration_4(&transaction).expect("v4 should apply");
        ProjectStore::apply_migration_5(&transaction).expect("v5 should apply");
        ProjectStore::apply_migration_6(&transaction).expect("v6 should apply");
        ProjectStore::apply_migration_7(&transaction).expect("v7 should apply");
        ProjectStore::apply_migration_8(&transaction).expect("v8 should apply");
        ProjectStore::apply_migration_9(&transaction).expect("v9 should apply");
        for version in 1..=9 {
            transaction
                .execute(
                    "INSERT INTO schema_migrations (version, applied_at_ms)
                     VALUES (?1, 0)",
                    params![version],
                )
                .expect("migration should be recorded");
        }
        transaction
            .execute(
                "INSERT INTO projects (
                    id, title, revision, created_at_ms, updated_at_ms, last_opened_at_ms
                 ) VALUES (?1, 'legacy project', 1, 1, 1, 1)",
                params![project_id],
            )
            .expect("legacy project should be inserted");
        transaction
            .execute(
                "INSERT INTO media_sources (
                    id, project_id, kind, locator, display_name, is_primary,
                    created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, 'local_file', ?3, 'legacy.mp4', 1, 1, 1)",
                params![media_id, project_id, path_to_string(&media_path)],
            )
            .expect("legacy media should be inserted");
        transaction
            .execute(
                "INSERT INTO playback_states (
                    project_id, position_ms, duration_ms, volume, playback_rate, updated_at_ms
                 ) VALUES (?1, 500, 1000, 0.8, 1.0, 1)",
                params![project_id],
            )
            .expect("legacy playback state should be inserted");
        transaction.commit().expect("legacy fixture should commit");
        drop(connection);

        let store = ProjectStore::open(database_path).expect("v9 store should upgrade");
        let project = store
            .get_project(&project_id)
            .expect("legacy project should remain readable");
        assert_eq!(project.playback_state.position_ms, 500);
        assert_eq!(
            project.playback_state.subtitle_mode,
            SubtitleDisplayMode::Translation
        );
        assert_eq!(
            store.schema_version().expect("schema version"),
            CURRENT_SCHEMA_VERSION
        );
    }

    #[test]
    fn recovers_running_proxy_as_interrupted() {
        let fixture = Fixture::new();
        let media_path = fixture.media_file("proxy-source.mp4");
        let project = fixture.create_project(&media_path);
        let artifact = fixture
            .store
            .begin_playback_proxy(
                &project.id,
                &project.media_source.id,
                &"a".repeat(64),
                "h264-yuv420p-aac-v1",
                &fixture.temp_dir.path().join("proxy.mp4"),
            )
            .expect("artifact should begin");
        fixture
            .store
            .update_media_artifact_status(&artifact.id, MediaArtifactStatus::Running, None, None)
            .expect("artifact should run");

        assert_eq!(
            fixture
                .store
                .recover_running_media_artifacts()
                .expect("recovery should run"),
            1
        );
        let recovered = fixture
            .store
            .get_media_artifact(&artifact.id)
            .expect("artifact should load");
        assert_eq!(recovered.status, MediaArtifactStatus::Interrupted);
        assert_eq!(recovered.error_code.as_deref(), Some("app_restarted"));
    }
}
