use super::SubtitleError;
use crate::{commands::CommandError, store::ProjectStore};
use rusqlite::params;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tauri::State;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub enum SubtitleTrackRole { Original, Translation }

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub enum SubtitleRevisionStatus { Draft, Ready, Rejected }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct SubtitleVersionMetadata {
    pub id: String,
    pub track_id: String,
    pub project_id: String,
    pub role: SubtitleTrackRole,
    #[cfg_attr(test, schemars(range(min = 1, max = 9007199254740991_i64)))]
    pub version_number: i64,
    pub status: SubtitleRevisionStatus,
    pub source_label: String,
    pub language_code: String,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub created_at_ms: i64,
    pub is_current: bool,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    pub segment_count: i64,
}

fn read_enum<T: DeserializeOwned>(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<T> {
    let value: String = row.get(index)?;
    serde_json::from_value(serde_json::Value::String(value)).map_err(|error|
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(error)))
}

pub fn list_metadata(
    store: &ProjectStore,
    project_id: &str,
) -> Result<Vec<SubtitleVersionMetadata>, SubtitleError> {
    list_metadata_window(store, project_id, None)
}

pub(super) fn list_metadata_window(
    store: &ProjectStore,
    project_id: &str,
    window: Option<(usize, usize)>,
) -> Result<Vec<SubtitleVersionMetadata>, SubtitleError> {
    store.get_project(project_id)?;
    let connection = store.connect()?;
    read_metadata_window(&connection, project_id, window)
}

pub(super) fn read_metadata_window(
    connection: &rusqlite::Connection,
    project_id: &str,
    window: Option<(usize, usize)>,
) -> Result<Vec<SubtitleVersionMetadata>, SubtitleError> {
    read_metadata_selection(connection, project_id, window, false)
}

pub(super) fn read_metadata_selection(
    connection: &rusqlite::Connection,
    project_id: &str,
    window: Option<(usize, usize)>,
    current_only: bool,
) -> Result<Vec<SubtitleVersionMetadata>, SubtitleError> {
    let (offset, limit) = match window {
        Some((offset, limit)) => (
            i64::try_from(offset).map_err(|_| SubtitleError::InvalidRevision("字幕历史分页位置无效".into()))?,
            i64::try_from(limit).map_err(|_| SubtitleError::InvalidRevision("字幕历史分页数量无效".into()))?,
        ),
        None => (0, -1),
    };
    let mut statement = connection.prepare(metadata_query(current_only))?;
    let rows = statement
        .query_map(params![project_id, limit, offset, current_only], |row| {
            Ok(SubtitleVersionMetadata {
                id: row.get(0)?,
                track_id: row.get(1)?,
                project_id: row.get(2)?,
                role: read_enum(row, 3)?,
                version_number: row.get(4)?,
                status: read_enum(row, 5)?,
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

pub(super) fn metadata_query(current_only: bool) -> &'static str {
    if current_only { include_str!("metadata_current.sql") }
    else { include_str!("metadata_window.sql") }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_and_status_are_checked_at_database_boundary() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        for value in ["original", "translation"] {
            let role = connection.query_row("SELECT ?1", [value], |row| read_enum::<SubtitleTrackRole>(row, 0)).unwrap();
            assert_eq!(serde_json::to_value(role).unwrap(), value);
        }
        for value in ["draft", "ready", "rejected"] {
            let status = connection.query_row("SELECT ?1", [value], |row| read_enum::<SubtitleRevisionStatus>(row, 0)).unwrap();
            assert_eq!(serde_json::to_value(status).unwrap(), value);
        }
        assert!(connection.query_row("SELECT 'unknown'", [], |row| read_enum::<SubtitleTrackRole>(row, 0)).is_err());
        assert!(connection.query_row("SELECT 'unknown'", [], |row| read_enum::<SubtitleRevisionStatus>(row, 0)).is_err());
    }
}
