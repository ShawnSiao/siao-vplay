use super::{
    LibraryError, LibraryMediaSection, LibrarySectionPage, LibraryService, ListLibrarySectionInput,
    repository::LibraryRepository,
};

const WATCH_LATER_KEY: &str = "watch_later";
const LIBRARY_SECTION_PAGE_LIMIT: i64 = 24;

impl LibraryService {
    pub(crate) fn list_section(
        &self,
        input: ListLibrarySectionInput,
    ) -> Result<LibrarySectionPage, LibraryError> {
        self.list_section_with_checkpoint(input, || {})
    }

    pub(super) fn list_section_with_checkpoint(
        &self,
        input: ListLibrarySectionInput,
        after_count: impl FnOnce(),
    ) -> Result<LibrarySectionPage, LibraryError> {
        if input.offset < 0 || input.offset > 9_007_199_254_740_991
            || (input.offset > 0 && input.expected_snapshot_token.is_none()) {
            return Err(LibraryError::Validation("媒体库分页位置或快照无效，请重新加载列表".to_owned()));
        }
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction()?;
        let (snapshot_token, total_count) = super::section_snapshot::read(&transaction, input.section)?;
        if input.expected_snapshot_token.as_ref().is_some_and(|expected| expected != &snapshot_token) {
            return Err(LibraryError::Conflict("媒体列表已变化，请重新加载".to_owned()));
        }
        after_count();
        let repository = LibraryRepository::new(&transaction);
        let items = match input.section {
            LibraryMediaSection::ContinueWatching =>
                repository.list_continue_watching_page(LIBRARY_SECTION_PAGE_LIMIT, input.offset)?,
            LibraryMediaSection::WatchLater => match repository.get_system_collection(WATCH_LATER_KEY)? {
                Some(collection) => repository.list_watch_later_page(&collection.id, LIBRARY_SECTION_PAGE_LIMIT, input.offset)?,
                None => Vec::new(),
            },
            LibraryMediaSection::Unclassified =>
                repository.list_unclassified_page(LIBRARY_SECTION_PAGE_LIMIT, input.offset)?,
        };
        let loaded = input.offset + items.len() as i64;
        transaction.commit()?;
        Ok(LibrarySectionPage {
            section: input.section, offset: input.offset, snapshot_token,
            items, total_count, next_offset: (loaded < total_count).then_some(loaded),
        })
    }
}
