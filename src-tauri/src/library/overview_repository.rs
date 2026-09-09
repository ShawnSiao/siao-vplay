use std::path::Path;
use rusqlite::params;
use super::{CollectionSummary, LibraryError, LibraryRootSummary, LibraryRootStatus,
    repository::{LibraryRepository, map_collection_summary}};

impl LibraryRepository<'_> {
    #[cfg(test)]
    pub(crate) fn list_collection_summary_window(&self, limit: i64, offset: i64, root_linked: Option<bool>) -> Result<Vec<CollectionSummary>, LibraryError> {
        self.search_collection_summary_window(limit, offset, root_linked, "")
    }
    pub(crate) fn search_collection_summary_window(&self, limit: i64, offset: i64, root_linked: Option<bool>, query: &str) -> Result<Vec<CollectionSummary>, LibraryError> {
        self.collection_summary_window(limit, offset, root_linked, query, true)
    }
    pub(crate) fn list_home_collections(&self) -> Result<Vec<CollectionSummary>, LibraryError> {
        self.collection_summary_window(4, 0, None, "", false)
    }
    fn collection_summary_window(&self, limit: i64, offset: i64, root_linked: Option<bool>, query: &str, include_system: bool) -> Result<Vec<CollectionSummary>, LibraryError> {
        validate_window(limit, offset)?;
        let mut statement = self.connection.prepare(include_str!("collection_summary_window.sql"))?;
        statement.query_and_then(params![limit, offset, root_linked, query, include_system], map_collection_summary)?.collect()
    }
    pub(crate) fn home_overview_counts(&self) -> Result<(i64, i64, i64), LibraryError> {
        self.connection.query_row("SELECT
            (SELECT COUNT(*) FROM collections WHERE system_key IS NULL),
            (SELECT COUNT(*) FROM library_roots),
            (SELECT COUNT(*) FROM collection_items ci JOIN collections c ON c.id = ci.collection_id WHERE c.system_key = 'watch_later')",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).map_err(Into::into)
    }
    pub(crate) fn list_root_window(&self, limit: i64, offset: i64) -> Result<Vec<LibraryRootSummary>, LibraryError> {
        validate_window(limit, offset)?;
        let mut statement = self.connection.prepare(include_str!("root_summary_window.sql"))?;
        statement.query_map(params![limit, offset], |row| {
            let path: String = row.get(1)?;
            Ok(LibraryRootSummary {
                id: row.get(0)?, display_name: row.get(2)?,
                availability: if Path::new(&path).is_dir() { "available".to_owned() } else { "offline".to_owned() },
                path, last_scanned_at_ms: row.get(4)?, item_count: row.get(5)?,
                status: LibraryRootStatus::from_collection_count(row.get(6)?),
            })
        })?.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }
}

fn validate_window(limit: i64, offset: i64) -> Result<(), LibraryError> {
    // -1 is reserved for test-only full-read comparison wrappers.
    if limit < -1 || offset < 0 { return Err(LibraryError::Validation("概览分页范围无效".to_owned())); }
    Ok(())
}
