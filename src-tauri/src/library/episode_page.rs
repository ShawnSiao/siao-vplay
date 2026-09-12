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
    #[serde(default)]
    pub expected_snapshot_token: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub(crate) struct CollectionEpisodePage {
    #[cfg_attr(test, schemars(length(min = 64, max = 64)))]
    pub snapshot_token: String,
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
        if input.offset > 0 && input.expected_snapshot_token.is_none() {
            return Err(LibraryError::Validation("请重新加载合集后继续读取剧集".into()));
        }
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction()?;
        let repository = LibraryRepository::new(&transaction);
        let collection = repository.get_collection(&input.collection_id)?;
        let total_count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM collection_items ci
             JOIN projects p ON p.id = ci.project_id
             JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
             JOIN playback_states ps ON ps.project_id = p.id
             WHERE ci.collection_id = ?1 AND (?2 IS NULL OR ci.season_number = ?2)",
            rusqlite::params![input.collection_id, input.season_number], |row| row.get(0))?;
        after_count();
        let snapshot_token = super::episode_snapshot::token(&transaction, &input.collection_id,
            input.season_number, collection.sort_mode.as_database_value())?;
        if input.expected_snapshot_token.as_ref().is_some_and(|expected| expected != &snapshot_token) {
            return Err(LibraryError::Conflict("合集已变化，请重新加载剧集".into()));
        }
        let items = repository.list_collection_episode_window(&input.collection_id, input.season_number, PAGE_LIMIT, input.offset)?;
        let loaded = input.offset + items.len() as i64;
        transaction.commit()?;
        Ok(CollectionEpisodePage { snapshot_token, collection_id: input.collection_id, season_number: input.season_number,
            offset: input.offset, items, total_count, next_offset: (loaded < total_count).then_some(loaded) })
    }
}
