use super::import_service::path_key;
use rusqlite::{Connection, params};
use std::path::Path;

// The storage owner supplies the transaction; root identity and normalization
// remain owned by the library. A uniqueness conflict must roll back the move.
pub(crate) fn relocate_roots_in_transaction(
    connection: &Connection,
    source: &Path,
    destination: &Path,
) -> rusqlite::Result<()> {
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='library_roots')",
        [],
        |row| row.get(0),
    )?;
    if !exists {
        return Ok(());
    }
    let roots = connection
        .prepare("SELECT id,path FROM library_roots")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (id, old_path) in roots {
        let Ok(relative) = Path::new(&old_path).strip_prefix(source) else {
            continue;
        };
        // Joining an empty path adds a trailing separator and changes path_key.
        let next = if relative.as_os_str().is_empty() {
            destination.to_path_buf()
        } else {
            destination.join(relative)
        };
        connection.execute(
            "UPDATE library_roots SET path=?1,path_key=?2 WHERE id=?3",
            params![next.to_string_lossy(), path_key(&next), id],
        )?;
    }
    Ok(())
}
