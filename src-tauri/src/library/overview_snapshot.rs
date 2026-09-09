use rusqlite::{Connection, params};
use serde::Serialize;
use sha2::{Digest, Sha256};
use super::LibraryError;

fn append(hash: &mut Sha256, value: impl Serialize) -> Result<(), LibraryError> {
    let bytes = serde_json::to_vec(&value).map_err(|error| LibraryError::InvalidData(error.to_string()))?;
    hash.update((bytes.len() as u64).to_le_bytes()); hash.update(bytes);
    Ok(())
}

// The caller owns the read transaction. Bind list identity, labels and ordering;
// aggregate progress and filesystem availability remain current read-time values.
pub(super) fn collections(connection: &Connection, root_linked: bool, query: &str) -> Result<(String, i64), LibraryError> {
    let mut hash = Sha256::new();
    append(&mut hash, ("collection-overview-v2", root_linked, query))?;
    let mut statement = connection.prepare("SELECT id, title, root_id, last_opened_at_ms, updated_at_ms
        FROM collections WHERE system_key IS NULL AND (root_id IS NOT NULL) = ?1
        AND instr(lower(title), lower(?2)) > 0
        ORDER BY COALESCE(last_opened_at_ms, 0) DESC, updated_at_ms DESC, title COLLATE NOCASE, id")?;
    let mut rows = statement.query(params![root_linked, query])?;
    let mut count = 0;
    while let Some(row) = rows.next()? {
        append(&mut hash, (row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<i64>>(3)?, row.get::<_, i64>(4)?))?;
        count += 1;
    }
    Ok((format!("{:x}", hash.finalize()), count))
}

pub(super) fn roots(connection: &Connection) -> Result<(String, i64), LibraryError> {
    let mut hash = Sha256::new(); append(&mut hash, "root-overview-v1")?;
    let mut statement = connection.prepare("SELECT id, display_name, path, updated_at_ms FROM library_roots ORDER BY display_name COLLATE NOCASE, id")?;
    let mut rows = statement.query([])?;
    let mut count = 0;
    while let Some(row) = rows.next()? {
        append(&mut hash, (row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, i64>(3)?))?;
        count += 1;
    }
    Ok((format!("{:x}", hash.finalize()), count))
}
