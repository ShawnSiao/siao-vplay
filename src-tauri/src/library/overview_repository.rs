use std::path::Path;
use rusqlite::params;
use super::{CollectionSummary, LibraryError, LibraryRootSummary, LibraryRootStatus,
    repository::{LibraryRepository, map_collection_summary}};

impl LibraryRepository<'_> {
    pub(crate) fn list_collection_summary_window(&self, limit: i64, offset: i64, root_linked: Option<bool>) -> Result<Vec<CollectionSummary>, LibraryError> {
        validate_window(limit, offset)?;
        let mut statement = self.connection.prepare(include_str!("collection_summary_window.sql"))?;
        statement.query_and_then(params![limit, offset, root_linked], map_collection_summary)?.collect()
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
    // -1 is reserved for the existing full-read wrappers during migration.
    if limit < -1 || offset < 0 { return Err(LibraryError::Validation("概览分页范围无效".to_owned())); }
    Ok(())
}
