use super::{SubtitleError, SubtitleVersion, load_segments};
use crate::store::ProjectStore;

pub fn list_subtitle_versions(
    store: &ProjectStore,
    project_id: &str,
) -> Result<Vec<SubtitleVersion>, SubtitleError> {
    read_versions(store, project_id, Selection::All)
}

pub fn get_subtitle_version(
    store: &ProjectStore,
    project_id: &str,
    version_id: &str,
) -> Result<SubtitleVersion, SubtitleError> {
    read_versions(store, project_id, Selection::Version(version_id))?
        .into_iter()
        .next()
        .ok_or_else(|| SubtitleError::VersionNotFound(version_id.to_owned()))
}

pub fn list_current_subtitle_versions(
    store: &ProjectStore,
    project_id: &str,
) -> Result<Vec<SubtitleVersion>, SubtitleError> {
    read_versions(store, project_id, Selection::Current)
}

enum Selection<'a> {
    All,
    Current,
    Version(&'a str),
}

fn read_versions(
    store: &ProjectStore,
    project_id: &str,
    selection: Selection<'_>,
) -> Result<Vec<SubtitleVersion>, SubtitleError> {
    let project = store.get_project(project_id)?;
    let connection = store.connect()?;
    let query = format!(
        "SELECT
            v.id, v.track_id, v.project_id, t.role, v.version_number, v.status,
            v.source_kind, v.source_label, v.source_sha256, v.media_sha256,
            v.language_code, v.project_revision, v.preflight_json,
            v.parent_version_id, v.source_task_id, v.created_at_ms,
            CASE WHEN t.current_version_id = v.id THEN 1 ELSE 0 END
         FROM subtitle_versions v
         JOIN subtitle_tracks t ON t.id = v.track_id
         WHERE v.project_id = ?1 {}
         ORDER BY v.created_at_ms DESC, v.version_number DESC, v.id DESC",
        match selection {
            Selection::All => "",
            Selection::Current => "AND t.current_version_id = v.id",
            Selection::Version(_) => "AND v.id = ?2",
        },
    );
    let mut statement = connection.prepare(&query)?;
    let mut arguments = vec![project.id.as_str()];
    if let Selection::Version(id) = selection {
        arguments.push(id);
    }
    let rows = statement
        .query_map(rusqlite::params_from_iter(arguments), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, i64>(11)?,
                row.get::<_, String>(12)?,
                row.get::<_, Option<String>>(13)?,
                row.get::<_, Option<String>>(14)?,
                row.get::<_, i64>(15)?,
                row.get::<_, bool>(16)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    rows.into_iter()
        .map(|row| {
            let preflight = serde_json::from_str(&row.12)?;
            let segments = load_segments(&connection, &row.0)?;
            Ok(SubtitleVersion {
                id: row.0,
                track_id: row.1,
                project_id: row.2,
                role: row.3,
                version_number: row.4,
                status: row.5,
                source_kind: row.6,
                source_label: row.7,
                source_sha256: row.8,
                media_sha256: row.9,
                language_code: row.10,
                project_revision: row.11,
                parent_version_id: row.13,
                source_task_id: row.14,
                preflight,
                created_at_ms: row.15,
                is_current: row.16,
                segments,
            })
        })
        .collect()
}
