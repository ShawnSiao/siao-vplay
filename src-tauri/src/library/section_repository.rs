use rusqlite::params;

use super::{
    LibraryError, MediaSummary,
    repository::{LibraryRepository, map_media_summary},
};

impl LibraryRepository<'_> {
    pub(crate) fn list_continue_watching_page(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<MediaSummary>, LibraryError> {
        let mut statement = self.connection.prepare(
            include_str!("continue_watching_window.sql"),
        )?;
        statement
            .query_and_then(params![limit, offset], map_media_summary)?
            .collect()
    }

    pub(crate) fn list_unclassified_page(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<MediaSummary>, LibraryError> {
        let mut statement = self.connection.prepare(
            "SELECT
                p.id, p.title, m.display_name, m.locator, m.poster_path,
                ps.position_ms, ps.duration_ms, ps.completed_at_ms,
                p.last_opened_at_ms, p.created_at_ms,
                EXISTS(
                    SELECT 1 FROM subtitle_tracks st
                    WHERE st.project_id = p.id AND st.role = 'original'
                      AND st.current_version_id IS NOT NULL
                ),
                EXISTS(
                    SELECT 1 FROM subtitle_tracks st
                    WHERE st.project_id = p.id AND st.role = 'translation'
                      AND st.language_code = 'zh-cn' AND st.current_version_id IS NOT NULL
                ),
                NULL, NULL, NULL, NULL, NULL, NULL, NULL
             FROM projects p
             JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
             JOIN playback_states ps ON ps.project_id = p.id
             WHERE NOT EXISTS (
                SELECT 1 FROM collection_items ci WHERE ci.project_id = p.id
             )
             ORDER BY p.created_at_ms DESC, p.id
             LIMIT ?1 OFFSET ?2",
        )?;
        statement
            .query_and_then(params![limit, offset], map_media_summary)?
            .collect()
    }

    pub(crate) fn list_watch_later_page(
        &self,
        collection_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<MediaSummary>, LibraryError> {
        let mut statement = self.connection.prepare(
            "SELECT
                p.id, p.title, m.display_name, m.locator, m.poster_path,
                ps.position_ms, ps.duration_ms, ps.completed_at_ms,
                p.last_opened_at_ms, p.created_at_ms,
                EXISTS(
                    SELECT 1 FROM subtitle_tracks st
                    WHERE st.project_id = p.id AND st.role = 'original'
                      AND st.current_version_id IS NOT NULL
                ),
                EXISTS(
                    SELECT 1 FROM subtitle_tracks st
                    WHERE st.project_id = p.id AND st.role = 'translation'
                      AND st.language_code = 'zh-cn' AND st.current_version_id IS NOT NULL
                ),
                c.id, c.title, ci.season_number, ci.episode_number,
                ci.absolute_order, ci.display_title, ci.availability
             FROM collection_items ci
             JOIN collections c ON c.id = ci.collection_id
             JOIN projects p ON p.id = ci.project_id
             JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
             JOIN playback_states ps ON ps.project_id = p.id
             WHERE ci.collection_id = ?1
             ORDER BY ci.created_at_ms DESC, ci.project_id
             LIMIT ?2 OFFSET ?3",
        )?;
        statement
            .query_and_then(params![collection_id, limit, offset], map_media_summary)?
            .collect()
    }

    pub(crate) fn continue_watching_count(&self) -> Result<i64, LibraryError> {
        self.connection
            .query_row(
                "SELECT COUNT(*)
                 FROM projects p
                 JOIN playback_states ps ON ps.project_id = p.id
                 WHERE ps.position_ms > 0 AND ps.completed_at_ms IS NULL",
                [],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }
}
