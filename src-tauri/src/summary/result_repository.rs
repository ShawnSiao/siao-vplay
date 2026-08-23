use rusqlite::{OptionalExtension, params};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{
    model::{AnalysisMode, AnalysisScope, SummaryResult, VideoSummary},
    task_repository::now_ms,
};
use crate::store::{ProjectStore, StoreError};

pub(crate) struct SummaryResultRepository<'a> {
    store: &'a ProjectStore,
}

impl<'a> SummaryResultRepository<'a> {
    pub(crate) fn new(store: &'a ProjectStore) -> Self {
        Self { store }
    }

    pub(crate) fn begin_chunk(&self, chunk_id: &str) -> Result<(), StoreError> {
        self.store.connect()?.execute(
            "UPDATE summary_chunks SET status = 'running', started_at_ms = COALESCE(started_at_ms, ?2),
                    updated_at_ms = ?2, error_code = NULL, error_message = NULL WHERE id = ?1",
            params![chunk_id, now_ms()?],
        )?;
        Ok(())
    }

    pub(crate) fn save_chunk(
        &self,
        chunk_id: &str,
        result: &SummaryResult,
    ) -> Result<(), StoreError> {
        let bytes = serde_json::to_vec(result)
            .map_err(|error| StoreError::Validation(error.to_string()))?;
        self.store.connect()?.execute(
            "UPDATE summary_chunks SET status = 'completed', result_json = ?2,
                    result_sha256 = ?3, completed_at_ms = ?4,
                    updated_at_ms = ?4, error_code = NULL, error_message = NULL WHERE id = ?1",
            params![
                chunk_id,
                String::from_utf8_lossy(&bytes),
                format!("{:x}", Sha256::digest(&bytes)),
                now_ms()?
            ],
        )?;
        Ok(())
    }

    pub(crate) fn update_retry(
        &self,
        chunk_id: &str,
        retry_count: u8,
        code: &str,
        message: &str,
    ) -> Result<(), StoreError> {
        self.store.connect()?.execute(
            "UPDATE summary_chunks SET retry_count = ?2, error_code = ?3,
                    error_message = ?4, updated_at_ms = ?5 WHERE id = ?1",
            params![chunk_id, retry_count, code, message, now_ms()?],
        )?;
        Ok(())
    }

    pub(crate) fn completed_chunk_results(
        &self,
        task_id: &str,
    ) -> Result<Vec<SummaryResult>, StoreError> {
        let connection = self.store.connect()?;
        let mut statement = connection.prepare(
            "SELECT result_json FROM summary_chunks
             WHERE task_id = ?1 AND status = 'completed' ORDER BY ordinal",
        )?;
        let rows = statement
            .query_map(params![task_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|json| {
                serde_json::from_str(&json)
                    .map_err(|error| StoreError::Validation(error.to_string()))
            })
            .collect()
    }

    pub(crate) fn save_summary(
        &self,
        task_id: &str,
        result: &SummaryResult,
        visual_material_used: bool,
    ) -> Result<VideoSummary, StoreError> {
        let task = super::task_repository::SummaryTaskRepository::new(self.store).get(task_id)?;
        let summary_id = Uuid::new_v4().to_string();
        let timestamp = now_ms()?;
        let result_json = serde_json::to_string(result)
            .map_err(|error| StoreError::Validation(error.to_string()))?;
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO video_summaries (
                id, task_id, project_id, protocol_version, scope, playback_cutoff_ms,
                analysis_mode, subtitle_version_id, material_manifest_sha256,
                structured_result_json, visual_material_used, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, 'siaovplay-summary-v1', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![
                summary_id,
                task.id,
                task.project_id,
                task.scope.as_database_value(),
                task.playback_cutoff_ms,
                task.analysis_mode.as_database_value(),
                task.subtitle_version_id,
                task.material_manifest_sha256,
                result_json,
                visual_material_used,
                timestamp
            ],
        )?;
        transaction.execute(
            "UPDATE summary_tasks SET status = 'completed', stage = 'completed', progress = 1,
                    output_summary_id = ?2, completed_at_ms = ?3, updated_at_ms = ?3,
                    error_code = NULL, error_message = NULL WHERE id = ?1",
            params![task_id, summary_id, timestamp],
        )?;
        transaction.commit()?;
        self.get_summary(&summary_id)
    }

    pub(crate) fn get_summary(&self, summary_id: &str) -> Result<VideoSummary, StoreError> {
        let connection = self.store.connect()?;
        let row = connection
            .query_row(
                "SELECT id, task_id, project_id, protocol_version, scope, playback_cutoff_ms,
                        analysis_mode, subtitle_version_id, material_manifest_sha256,
                        structured_result_json, visual_material_used, created_at_ms, updated_at_ms
                 FROM video_summaries WHERE id = ?1",
                params![summary_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, Option<i64>>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, String>(9)?,
                        row.get::<_, bool>(10)?,
                        row.get::<_, i64>(11)?,
                        row.get::<_, i64>(12)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| StoreError::Validation("视频总结不存在".to_owned()))?;
        Ok(VideoSummary {
            id: row.0,
            task_id: row.1,
            project_id: row.2,
            protocol_version: row.3,
            scope: AnalysisScope::from_database(&row.4)?,
            playback_cutoff_ms: row.5,
            analysis_mode: AnalysisMode::from_database(&row.6)?,
            subtitle_version_id: row.7,
            material_manifest_sha256: row.8,
            result: serde_json::from_str(&row.9)
                .map_err(|error| StoreError::Validation(error.to_string()))?,
            visual_material_used: row.10,
            created_at_ms: row.11,
            updated_at_ms: row.12,
        })
    }

    pub(crate) fn list_summaries(&self, project_id: &str) -> Result<Vec<VideoSummary>, StoreError> {
        let connection = self.store.connect()?;
        let mut statement = connection.prepare(
            "SELECT id FROM video_summaries WHERE project_id = ?1 ORDER BY created_at_ms DESC",
        )?;
        let ids = statement
            .query_map(params![project_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids.iter().map(|id| self.get_summary(id)).collect()
    }
}
