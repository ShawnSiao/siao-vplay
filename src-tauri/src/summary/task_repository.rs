use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{OptionalExtension, params};
use uuid::Uuid;

use super::model::{
    AnalysisMode, AnalysisScope, PromptSnapshot, SummaryChunk, SummaryExecutionKind, SummaryTask,
    VideoSummary,
};
use crate::store::{ProjectStore, StoreError};

pub(crate) struct NewSummaryTask<'a> {
    pub project_id: &'a str,
    pub scope: AnalysisScope,
    pub playback_cutoff_ms: Option<i64>,
    pub analysis_mode: AnalysisMode,
    pub execution_kind: SummaryExecutionKind,
    pub prompt_snapshot: &'a PromptSnapshot,
    pub subtitle_version_id: &'a str,
    pub material_manifest_sha256: &'a str,
    pub visual_material_authorized: bool,
    pub spoiler_confirmed: bool,
    pub service_config_id: Option<&'a str>,
    pub service_revision: Option<u64>,
    pub provider_id: Option<&'a str>,
    pub model_id: Option<&'a str>,
}

pub(crate) struct NewSummaryChunk<'a> {
    pub ordinal: usize,
    pub start_ms: i64,
    pub end_ms: i64,
    pub segment_ids: &'a [String],
    pub context_segment_ids: &'a [String],
    pub material_sha256: &'a str,
}

pub(crate) struct SummaryTaskRepository<'a> {
    store: &'a ProjectStore,
}

impl<'a> SummaryTaskRepository<'a> {
    pub(crate) fn new(store: &'a ProjectStore) -> Self {
        Self { store }
    }

    pub(crate) fn create(
        &self,
        task: NewSummaryTask<'_>,
        chunks: &[NewSummaryChunk<'_>],
    ) -> Result<SummaryTask, StoreError> {
        let id = Uuid::new_v4().to_string();
        let timestamp = now_ms()?;
        let prompt_json = serde_json::to_string(task.prompt_snapshot)
            .map_err(|error| StoreError::Validation(error.to_string()))?;
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO summary_tasks (
                id, project_id, scope, playback_cutoff_ms, analysis_mode, execution_kind,
                prompt_snapshot_json, prompt_snapshot_sha256, subtitle_version_id,
                material_manifest_sha256, visual_material_authorized, spoiler_confirmed,
                status, stage, progress, service_config_id, service_revision, provider_id,
                model_id, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                       'prepared', 'prepared', 0, ?13, ?14, ?15, ?16, ?17, ?17)",
            params![
                id,
                task.project_id,
                task.scope.as_database_value(),
                task.playback_cutoff_ms,
                task.analysis_mode.as_database_value(),
                task.execution_kind.as_database_value(),
                prompt_json,
                task.prompt_snapshot.sha256,
                task.subtitle_version_id,
                task.material_manifest_sha256,
                task.visual_material_authorized,
                task.spoiler_confirmed,
                task.service_config_id,
                task.service_revision
                    .and_then(|value| i64::try_from(value).ok()),
                task.provider_id,
                task.model_id,
                timestamp
            ],
        )?;
        for chunk in chunks {
            transaction.execute(
                "INSERT INTO summary_chunks (
                    id, task_id, ordinal, start_ms, end_ms, segment_ids_json,
                    context_segment_ids_json, frame_manifest_json, material_sha256,
                    status, created_at_ms, updated_at_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '[]', ?8, 'prepared', ?9, ?9)",
                params![
                    Uuid::new_v4().to_string(),
                    id,
                    i64::try_from(chunk.ordinal).unwrap_or(i64::MAX),
                    chunk.start_ms,
                    chunk.end_ms,
                    serde_json::to_string(chunk.segment_ids).unwrap_or_else(|_| "[]".to_owned()),
                    serde_json::to_string(chunk.context_segment_ids)
                        .unwrap_or_else(|_| "[]".to_owned()),
                    chunk.material_sha256,
                    timestamp
                ],
            )?;
        }
        transaction.commit()?;
        self.get(&id)
    }

    pub(crate) fn get(&self, task_id: &str) -> Result<SummaryTask, StoreError> {
        let connection = self.store.connect()?;
        let row = connection
            .query_row(
                "SELECT id, project_id, scope, playback_cutoff_ms, analysis_mode,
                        execution_kind, prompt_snapshot_json, subtitle_version_id,
                        material_manifest_sha256, visual_material_authorized, spoiler_confirmed,
                        status, stage, progress, service_config_id, service_revision, provider_id,
                        model_id, output_summary_id, cancel_requested_at_ms, error_code,
                        error_message, created_at_ms, updated_at_ms
                 FROM summary_tasks WHERE id = ?1",
                params![task_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, bool>(9)?,
                        row.get::<_, bool>(10)?,
                        row.get::<_, String>(11)?,
                        row.get::<_, String>(12)?,
                        row.get::<_, f64>(13)?,
                        row.get::<_, Option<String>>(14)?,
                        row.get::<_, Option<i64>>(15)?,
                        row.get::<_, Option<String>>(16)?,
                        row.get::<_, Option<String>>(17)?,
                        row.get::<_, Option<String>>(18)?,
                        row.get::<_, Option<i64>>(19)?,
                        row.get::<_, Option<String>>(20)?,
                        row.get::<_, Option<String>>(21)?,
                        row.get::<_, i64>(22)?,
                        row.get::<_, i64>(23)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| StoreError::Validation("总结任务不存在".to_owned()))?;
        Ok(SummaryTask {
            id: row.0.clone(),
            project_id: row.1,
            scope: AnalysisScope::from_database(&row.2)?,
            playback_cutoff_ms: row.3,
            analysis_mode: AnalysisMode::from_database(&row.4)?,
            execution_kind: SummaryExecutionKind::from_database(&row.5)?,
            prompt_snapshot: serde_json::from_str(&row.6)
                .map_err(|error| StoreError::Validation(error.to_string()))?,
            subtitle_version_id: row.7,
            material_manifest_sha256: row.8,
            visual_material_authorized: row.9,
            spoiler_confirmed: row.10,
            status: row.11,
            stage: row.12,
            progress: row.13,
            service_config_id: row.14,
            service_revision: row.15.and_then(|value| u64::try_from(value).ok()),
            provider_id: row.16,
            model_id: row.17,
            output_summary_id: row.18,
            cancel_requested: row.19.is_some(),
            error_code: row.20,
            error_message: row.21,
            created_at_ms: row.22,
            updated_at_ms: row.23,
            chunks: read_chunks(&connection, &row.0)?,
            materials_directory: self
                .materials_directory(&row.0)
                .to_string_lossy()
                .into_owned(),
        })
    }

    pub(crate) fn list(&self, project_id: &str) -> Result<Vec<SummaryTask>, StoreError> {
        let connection = self.store.connect()?;
        let mut statement = connection.prepare(
            "SELECT id FROM summary_tasks WHERE project_id = ?1 ORDER BY created_at_ms DESC",
        )?;
        let ids = statement
            .query_map(params![project_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids.iter().map(|id| self.get(id)).collect()
    }

    pub(crate) fn set_task_state(
        &self,
        task_id: &str,
        status: &str,
        stage: &str,
        progress: f64,
    ) -> Result<(), StoreError> {
        let changed = self.store.connect()?.execute(
            "UPDATE summary_tasks SET status = ?2, stage = ?3, progress = ?4,
                    updated_at_ms = ?5, started_at_ms = COALESCE(started_at_ms, ?5),
                    completed_at_ms = NULL, error_code = NULL, error_message = NULL
             WHERE id = ?1 AND status NOT IN ('completed', 'cancelled') AND cancel_requested_at_ms IS NULL",
            params![task_id, status, stage, progress, now_ms()?],
        )?;
        if changed != 1 {
            return Err(StoreError::Validation("任务已结束或正在取消".to_owned()));
        }
        Ok(())
    }

    pub(crate) fn claim_for_execution(&self, task_id: &str) -> Result<(), StoreError> {
        let changed = self.store.connect()?.execute(
            "UPDATE summary_tasks SET status = 'queued', stage = 'queued', updated_at_ms = ?2,
                    error_code = NULL, error_message = NULL, completed_at_ms = NULL
             WHERE id = ?1 AND status IN ('prepared', 'awaiting_external_result', 'interrupted', 'failed', 'paused')
               AND cancel_requested_at_ms IS NULL",
            params![task_id, now_ms()?],
        )?;
        if changed != 1 {
            return Err(StoreError::Validation(
                "任务已启动、结束或正在取消".to_owned(),
            ));
        }
        Ok(())
    }

    pub(crate) fn request_cancel(&self, task_id: &str) -> Result<(), StoreError> {
        self.store.connect()?.execute(
            "UPDATE summary_tasks SET cancel_requested_at_ms = ?2, updated_at_ms = ?2
             WHERE id = ?1 AND status NOT IN ('completed', 'failed', 'cancelled')",
            params![task_id, now_ms()?],
        )?;
        Ok(())
    }

    pub(crate) fn finish_cancelled(&self, task_id: &str) -> Result<(), StoreError> {
        let timestamp = now_ms()?;
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE summary_tasks SET status = 'cancelled', stage = 'cancelled',
                    completed_at_ms = ?2, updated_at_ms = ?2 WHERE id = ?1",
            params![task_id, timestamp],
        )?;
        transaction.execute(
            "UPDATE summary_chunks SET status = 'cancelled', completed_at_ms = ?2,
                    updated_at_ms = ?2 WHERE task_id = ?1 AND status != 'completed'",
            params![task_id, timestamp],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub(crate) fn fail(&self, task_id: &str, code: &str, message: &str) -> Result<(), StoreError> {
        self.store.connect()?.execute(
            "UPDATE summary_tasks SET status = 'failed', stage = 'failed', error_code = ?2,
                    error_message = ?3, completed_at_ms = ?4, updated_at_ms = ?4 WHERE id = ?1",
            params![task_id, code, message, now_ms()?],
        )?;
        Ok(())
    }

    pub(crate) fn translation_is_active(&self) -> Result<bool, StoreError> {
        Ok(self.store.connect()?.query_row(
            "SELECT EXISTS(SELECT 1 FROM agent_tasks
             WHERE status IN ('awaiting_external_result', 'queued', 'running', 'validating'))",
            [],
            |row| row.get(0),
        )?)
    }

    pub(crate) fn recover_interrupted(&self) -> Result<usize, StoreError> {
        let timestamp = now_ms()?;
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction()?;
        let cancelled = transaction.execute(
            "UPDATE summary_tasks SET status = 'cancelled', stage = 'cancelled', completed_at_ms = ?1,
                    updated_at_ms = ?1 WHERE cancel_requested_at_ms IS NOT NULL
                    AND status IN ('queued', 'running', 'validating', 'interrupted', 'paused')",
            params![timestamp],
        )?;
        transaction.execute(
            "UPDATE summary_chunks SET status = 'cancelled', completed_at_ms = ?1, updated_at_ms = ?1
             WHERE status != 'completed' AND task_id IN (SELECT id FROM summary_tasks WHERE status = 'cancelled')",
            params![timestamp],
        )?;
        let count = transaction.execute(
            "UPDATE summary_tasks SET status = 'interrupted', stage = 'interrupted',
                    updated_at_ms = ?1 WHERE status IN ('queued', 'running', 'validating')",
            params![timestamp],
        )?;
        transaction.execute(
            "UPDATE summary_chunks SET status = 'prepared', updated_at_ms = ?1
             WHERE status IN ('queued', 'running')",
            params![timestamp],
        )?;
        transaction.commit()?;
        Ok(count + cancelled)
    }

    pub(crate) fn materials_directory(&self, task_id: &str) -> std::path::PathBuf {
        self.store
            .data_directory()
            .join("summary-tasks")
            .join(task_id)
    }
}

fn read_chunks(
    connection: &rusqlite::Connection,
    task_id: &str,
) -> Result<Vec<SummaryChunk>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT id, ordinal, start_ms, end_ms, segment_ids_json,
                context_segment_ids_json, status, retry_count
         FROM summary_chunks WHERE task_id = ?1 ORDER BY ordinal",
    )?;
    let rows = statement
        .query_map(params![task_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, i64>(7)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|row| {
            Ok(SummaryChunk {
                id: row.0,
                ordinal: usize::try_from(row.1).unwrap_or_default(),
                start_ms: row.2,
                end_ms: row.3,
                segment_ids: serde_json::from_str(&row.4)
                    .map_err(|error| StoreError::Validation(error.to_string()))?,
                context_segment_ids: serde_json::from_str(&row.5)
                    .map_err(|error| StoreError::Validation(error.to_string()))?,
                status: row.6,
                retry_count: u8::try_from(row.7).unwrap_or(2),
            })
        })
        .collect()
}

pub(crate) fn now_ms() -> Result<i64, StoreError> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| StoreError::Validation("系统时间无效".to_owned()))?
        .as_millis();
    i64::try_from(millis).map_err(|_| StoreError::Validation("系统时间超出范围".to_owned()))
}

#[allow(dead_code)]
fn _assert_video_summary_is_domain_type(_: VideoSummary) {}

#[cfg(test)]
#[path = "task_lifecycle_tests.rs"]
mod lifecycle_tests;
