use rusqlite::{Connection, params};
use serde::Serialize;
use sha2::{Digest, Sha256};
use super::LibraryError;

fn hash_value(hash: &mut Sha256, value: impl Serialize) -> Result<(), LibraryError> {
    let bytes = serde_json::to_vec(&value).map_err(|error| LibraryError::InvalidData(error.to_string()))?;
    hash.update((bytes.len() as u64).to_le_bytes());
    hash.update(bytes);
    Ok(())
}

// Bind membership and ordering, not changing playback progress. Stream rows instead
// of materializing the full collection; the caller owns the read transaction.
pub(super) fn token(connection: &Connection, collection_id: &str, season: Option<i64>, sort_mode: &str) -> Result<String, LibraryError> {
    let mut hash = Sha256::new();
    hash_value(&mut hash, ("episode-order-v1", collection_id, season, sort_mode))?;
    let mut statement = connection.prepare(
        "SELECT ci.project_id, ci.season_number, ci.episode_number, ci.absolute_order, ci.display_title
         FROM collection_items ci
         JOIN projects p ON p.id = ci.project_id
         JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
         JOIN playback_states ps ON ps.project_id = p.id
         WHERE ci.collection_id = ?1 AND (?2 IS NULL OR ci.season_number = ?2)
         ORDER BY ci.project_id")?;
    let mut rows = statement.query(params![collection_id, season])?;
    while let Some(row) = rows.next()? {
        hash_value(&mut hash, (row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?,
            row.get::<_, Option<i64>>(2)?, row.get::<_, i64>(3)?, row.get::<_, String>(4)?))?;
    }
    Ok(format!("{:x}", hash.finalize()))
}
