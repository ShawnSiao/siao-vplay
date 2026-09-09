use super::{LibraryService, LibraryHome, LibraryError, repository::LibraryRepository};

const HOME_CONTINUE_LIMIT: i64 = 12;
const HOME_UNCLASSIFIED_LIMIT: i64 = 24;
const HOME_RECENTLY_ADDED_LIMIT: i64 = 5;

impl LibraryService {
    pub(crate) fn get_home(&self) -> Result<LibraryHome, LibraryError> {
        self.get_home_with_checkpoint(|| {})
    }

    pub(super) fn get_home_with_checkpoint(&self, after_count: impl FnOnce()) -> Result<LibraryHome, LibraryError> {
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction()?;
        let repository = LibraryRepository::new(&transaction);
        let (total_project_count, collection_item_count, unclassified_count) =
            repository.counts()?;
        after_count();
        let home = LibraryHome {
            continue_watching: repository.list_continue_watching(HOME_CONTINUE_LIMIT)?,
            continue_watching_count: repository.continue_watching_count()?,
            collections: repository.list_collection_summaries()?,
            folders: repository.list_roots()?,
            unclassified: repository.list_unclassified(HOME_UNCLASSIFIED_LIMIT)?,
            recently_added: repository.list_recently_added(HOME_RECENTLY_ADDED_LIMIT)?,
            total_project_count,
            collection_item_count,
            unclassified_count,
        };
        transaction.commit()?;
        Ok(home)
    }

}
