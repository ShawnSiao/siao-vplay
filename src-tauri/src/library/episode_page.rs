use serde::{Deserialize, Serialize};
use super::{LibraryError, LibraryService, MediaSummary, repository::LibraryRepository,
    service::{validate_id, validate_optional_number}};

const PAGE_LIMIT: i64 = 24;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListCollectionEpisodePageInput {
    pub collection_id: String,
    pub season_number: Option<i64>,
    pub offset: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) struct CollectionEpisodePage {
    pub collection_id: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    pub season_number: Option<i64>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    pub offset: i64,
    #[cfg_attr(test, schemars(length(max = 24)))]
    pub items: Vec<MediaSummary>,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    pub total_count: i64,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    pub next_offset: Option<i64>,
}

impl LibraryService {
    pub(crate) fn list_collection_episode_page(&self, input: ListCollectionEpisodePageInput) -> Result<CollectionEpisodePage, LibraryError> {
        self.collection_episode_page_with_checkpoint(input, || {})
    }

    pub(super) fn collection_episode_page_with_checkpoint(&self, input: ListCollectionEpisodePageInput, after_count: impl FnOnce()) -> Result<CollectionEpisodePage, LibraryError> {
        validate_id("合集", &input.collection_id)?;
        validate_optional_number("季号", input.season_number)?;
        if !(0..=9007199254740991).contains(&input.offset) {
            return Err(LibraryError::Validation("剧集分页位置无效".into()));
        }
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction()?;
        let repository = LibraryRepository::new(&transaction);
        repository.get_collection(&input.collection_id)?;
        let total_count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM collection_items ci
             JOIN projects p ON p.id = ci.project_id
             JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
             JOIN playback_states ps ON ps.project_id = p.id
             WHERE ci.collection_id = ?1 AND (?2 IS NULL OR ci.season_number = ?2)",
            rusqlite::params![input.collection_id, input.season_number], |row| row.get(0))?;
        after_count();
        let items = repository.list_collection_episode_window(&input.collection_id, input.season_number, PAGE_LIMIT, input.offset)?;
        let loaded = input.offset + items.len() as i64;
        transaction.commit()?;
        Ok(CollectionEpisodePage { collection_id: input.collection_id, season_number: input.season_number,
            offset: input.offset, items, total_count, next_offset: (loaded < total_count).then_some(loaded) })
    }
}
