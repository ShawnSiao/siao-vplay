use rusqlite::{Row, params};
use super::{EpisodeNeighbors, EpisodeReference, LibraryError, repository::LibraryRepository};

fn reference(row: &Row<'_>) -> Result<EpisodeReference, rusqlite::Error> {
    Ok(EpisodeReference { project_id: row.get(0)?, display_title: row.get(1)?,
        season_number: row.get(2)?, episode_number: row.get(3)?, absolute_order: row.get(4)? })
}

impl LibraryRepository<'_> {
    pub(crate) fn get_episode_neighbors(&self, collection_id: &str, project_id: &str) -> Result<EpisodeNeighbors, LibraryError> {
        let mut statement = self.connection.prepare(
            "SELECT
                ci.project_id, ci.display_title, ci.season_number,
                ci.episode_number, ci.absolute_order
             FROM collection_items ci
             JOIN collections c ON c.id = ci.collection_id
             WHERE ci.collection_id = ?1
             ORDER BY
                CASE WHEN c.sort_mode = 'manual' THEN ci.absolute_order END,
                CASE WHEN c.sort_mode != 'manual' THEN ci.season_number END,
                CASE WHEN c.sort_mode != 'manual' THEN ci.episode_number END,
                ci.absolute_order,
                ci.display_title COLLATE NOCASE,
                ci.project_id",
        )?;
        let mut rows = statement.query(params![collection_id])?;
        let mut previous_id: Option<String> = None;
        while let Some(row) = rows.next()? {
            let candidate_id: String = row.get(0)?;
            if candidate_id == project_id {
                // Ordering still belongs to SQLite. Decode only the actual neighbors,
                // not the titles and metadata of every preceding episode.
                let previous = previous_id.map(|id| self.connection.query_row(
                    "SELECT project_id, display_title, season_number, episode_number, absolute_order
                     FROM collection_items WHERE collection_id = ?1 AND project_id = ?2",
                    params![collection_id, id], reference,
                )).transpose()?;
                let next = rows.next()?.map(reference).transpose()?;
                return Ok(EpisodeNeighbors { previous, next });
            }
            previous_id = Some(candidate_id);
        }
        Err(LibraryError::MembershipNotFound { collection_id: collection_id.to_owned(), project_id: project_id.to_owned() })
    }
}
