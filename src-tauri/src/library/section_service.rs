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
        if input.offset < 0 {
            return Err(LibraryError::Validation(
                "媒体库分页位置不能小于 0".to_owned(),
            ));
        }
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction()?;
        let repository = LibraryRepository::new(&transaction);
        let (items, total_count) = match input.section {
            LibraryMediaSection::ContinueWatching => (
                repository.list_continue_watching_page(LIBRARY_SECTION_PAGE_LIMIT, input.offset)?,
                repository.continue_watching_count()?,
            ),
            LibraryMediaSection::WatchLater => {
                let Some(collection) = repository.get_system_collection(WATCH_LATER_KEY)? else {
                    return Ok(LibrarySectionPage {
                        items: Vec::new(),
                        total_count: 0,
                        next_offset: None,
                    });
                };
                (
                    repository.list_watch_later_page(
                        &collection.id,
                        LIBRARY_SECTION_PAGE_LIMIT,
                        input.offset,
                    )?,
                    repository.collection_item_count(&collection.id)?,
                )
            }
            LibraryMediaSection::Unclassified => {
                let (_, _, total_count) = repository.counts()?;
                after_count();
                (
                    repository.list_unclassified_page(LIBRARY_SECTION_PAGE_LIMIT, input.offset)?,
                    total_count,
                )
            }
        };
        let loaded = input.offset + items.len() as i64;
        transaction.commit()?;
        Ok(LibrarySectionPage {
            items,
            total_count,
            next_offset: (loaded < total_count).then_some(loaded),
        })
    }
}
