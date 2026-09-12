use rusqlite::Connection;
use sha2::{Digest, Sha256};
use super::{LibraryError, LibraryMediaSection};

// Hash only ordered membership. Changing display/progress fields does not
// invalidate pages unless it changes eligibility or the section's actual order.
// Stream IDs inside the caller's read transaction; never hydrate the full list.
pub(super) fn read(connection: &Connection, section: LibraryMediaSection) -> Result<(String, i64), LibraryError> {
    let (identity, query) = match section {
        LibraryMediaSection::ContinueWatching => ("continue_watching", "
            SELECT p.id FROM projects p
            JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
            JOIN playback_states ps ON ps.project_id = p.id
            WHERE ps.position_ms > 0 AND ps.completed_at_ms IS NULL
            ORDER BY p.last_opened_at_ms DESC, p.updated_at_ms DESC, p.id"),
        LibraryMediaSection::Unclassified => ("unclassified", "
            SELECT p.id FROM projects p
            JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
            JOIN playback_states ps ON ps.project_id = p.id
            WHERE NOT EXISTS (SELECT 1 FROM collection_items ci WHERE ci.project_id = p.id)
            ORDER BY p.created_at_ms DESC, p.id"),
        LibraryMediaSection::WatchLater => ("watch_later", "
            SELECT p.id FROM collection_items ci
            JOIN collections c ON c.id = ci.collection_id
            JOIN projects p ON p.id = ci.project_id
            JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
            JOIN playback_states ps ON ps.project_id = p.id
            WHERE c.system_key = 'watch_later'
            ORDER BY ci.created_at_ms DESC, ci.project_id"),
    };
    let mut hash = Sha256::new();
    hash.update(b"library-section-order-v1:");
    hash.update(identity.as_bytes());
    let mut statement = connection.prepare(query)?;
    let mut rows = statement.query([])?;
    let mut count = 0;
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        hash.update((id.len() as u64).to_le_bytes());
        hash.update(id.as_bytes());
        count += 1;
    }
    Ok((format!("{:x}", hash.finalize()), count))
}
