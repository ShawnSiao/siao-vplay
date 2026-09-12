use rusqlite::params;
use super::{LibraryError, MediaSummary, repository::{LibraryRepository, map_media_summary}};

impl LibraryRepository<'_> {
    pub(crate) fn list_collection_episodes(&self, collection_id: &str, season_number: Option<i64>) -> Result<Vec<MediaSummary>, LibraryError> {
        self.list_collection_episode_window(collection_id, season_number, -1, 0)
    }
    pub(crate) fn list_collection_episode_window(
        &self,
        collection_id: &str,
        season_number: Option<i64>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<MediaSummary>, LibraryError> {
        self.get_collection(collection_id)?;
        let mut statement = self.connection.prepare(
            include_str!("episode_window.sql"),
        )?;
        statement
            .query_and_then(params![collection_id, season_number, limit, offset], map_media_summary)?
            .collect()
    }

}
