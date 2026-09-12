use super::SubtitleError;
use rusqlite::Connection;
use sha2::{Digest, Sha256};

// Versions and their segments are immutable. Bind membership, ordering, status
// and current pointers without loading historical subtitle bodies or cue counts.
pub(super) fn catalog(connection: &Connection, project_id: &str) -> Result<(String, i64), SubtitleError> {
    let mut hash = Sha256::new();
    hash.update(serde_json::to_vec(&("subtitle-catalog-v1", project_id))?);
    let mut statement = connection.prepare(
        "SELECT v.id, v.track_id, v.version_number, v.created_at_ms, v.status, t.current_version_id
         FROM subtitle_versions v JOIN subtitle_tracks t ON t.id = v.track_id
         WHERE v.project_id = ?1 ORDER BY v.id")?;
    let mut rows = statement.query([project_id])?;
    let mut count = 0;
    while let Some(row) = rows.next()? {
        let bytes = serde_json::to_vec(&(row.get::<_, String>(0)?, row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?, row.get::<_, i64>(3)?, row.get::<_, String>(4)?, row.get::<_, Option<String>>(5)?))?;
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
        count += 1;
    }
    Ok((format!("{:x}", hash.finalize()), count))
}
