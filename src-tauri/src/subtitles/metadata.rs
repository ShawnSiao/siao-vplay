use super::SubtitleError;
use crate::{commands::CommandError, store::ProjectStore};
use rusqlite::params;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleVersionMetadata {
    pub id: String,
    pub track_id: String,
    pub project_id: String,
    pub role: String,
    pub version_number: i64,
    pub status: String,
    pub source_label: String,
    pub language_code: String,
    pub created_at_ms: i64,
    pub is_current: bool,
    pub segment_count: i64,
}

pub fn list_metadata(
    store: &ProjectStore,
    project_id: &str,
) -> Result<Vec<SubtitleVersionMetadata>, SubtitleError> {
    store.get_project(project_id)?;
    let connection = store.connect()?;
    let mut statement = connection.prepare(
        "SELECT v.id, v.track_id, v.project_id, t.role, v.version_number, v.status,
          v.source_label, v.language_code, v.created_at_ms, CASE WHEN t.current_version_id = v.id THEN 1 ELSE 0 END,
          (SELECT COUNT(*) FROM subtitle_segments s WHERE s.version_id = v.id)
         FROM subtitle_versions v JOIN subtitle_tracks t ON t.id = v.track_id
         WHERE v.project_id = ?1 ORDER BY v.created_at_ms DESC, v.version_number DESC, v.id DESC",
    )?;
    let rows = statement
        .query_map(params![project_id], |row| {
            Ok(SubtitleVersionMetadata {
                id: row.get(0)?,
                track_id: row.get(1)?,
                project_id: row.get(2)?,
                role: row.get(3)?,
                version_number: row.get(4)?,
                status: row.get(5)?,
                source_label: row.get(6)?,
                language_code: row.get(7)?,
                created_at_ms: row.get(8)?,
                is_current: row.get(9)?,
                segment_count: row.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub async fn list_subtitle_version_metadata(
    store: State<'_, ProjectStore>,
    project_id: String,
) -> Result<Vec<SubtitleVersionMetadata>, CommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        list_metadata(&store, &project_id).map_err(CommandError::from)
    })
    .await
    .map_err(CommandError::background_task_failed)?
}
