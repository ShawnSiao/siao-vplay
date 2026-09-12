use super::{LibraryService, LibraryError, repository::LibraryRepository, overview_snapshot,
    overview_model::{CollectionOverviewInput, CollectionOverviewPage, OverviewPageInput, RootOverviewPage, OverviewPage, OverviewScope}};

const OVERVIEW_PAGE_LIMIT: i64 = 24;
fn validate(input: &OverviewPageInput) -> Result<(), LibraryError> {
    if !(0..=9_007_199_254_740_991).contains(&input.offset)
        || (input.offset > 0 && input.expected_snapshot_token.is_none())
        || input.expected_snapshot_token.as_ref().is_some_and(|token| token.len() != 64 || !token.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))) {
        return Err(LibraryError::Validation("概览分页位置或快照无效，请重新加载".to_owned()));
    }
    Ok(())
}
fn check_snapshot(input: &OverviewPageInput, actual: &str) -> Result<(), LibraryError> {
    if input.expected_snapshot_token.as_ref().is_some_and(|expected| expected != actual) {
        return Err(LibraryError::Conflict("概览列表已变化，请重新加载".to_owned()));
    }
    Ok(())
}
impl LibraryService {
    pub(crate) fn collection_overview_page(&self, input: CollectionOverviewInput) -> Result<CollectionOverviewPage, LibraryError> {
        self.collection_overview_with_checkpoint(input, || {})
    }
    pub(super) fn collection_overview_with_checkpoint(&self, input: CollectionOverviewInput, checkpoint: impl FnOnce()) -> Result<CollectionOverviewPage, LibraryError> {
        validate(&input.page)?;
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction()?;
        let (snapshot_token, total_count) = overview_snapshot::collections(&transaction, input.root_linked, &input.query)?;
        check_snapshot(&input.page, &snapshot_token)?;
        checkpoint();
        let items = LibraryRepository::new(&transaction).search_collection_summary_window(OVERVIEW_PAGE_LIMIT, input.page.offset, Some(input.root_linked), &input.query)?;
        let loaded = input.page.offset + items.len() as i64;
        transaction.commit()?;
        Ok(CollectionOverviewPage { scope: OverviewScope::Collections, root_linked: input.root_linked, query: input.query, page: OverviewPage {
            items, offset: input.page.offset, total_count, snapshot_token, next_offset: (loaded < total_count).then_some(loaded),
        } })
    }
    pub(crate) fn root_overview_page(&self, input: OverviewPageInput) -> Result<RootOverviewPage, LibraryError> {
        self.root_overview_with_checkpoint(input, || {})
    }
    pub(super) fn root_overview_with_checkpoint(&self, input: OverviewPageInput, checkpoint: impl FnOnce()) -> Result<RootOverviewPage, LibraryError> {
        validate(&input)?;
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction()?;
        let (snapshot_token, total_count) = overview_snapshot::roots(&transaction)?;
        check_snapshot(&input, &snapshot_token)?;
        checkpoint();
        let items = LibraryRepository::new(&transaction).list_root_window(OVERVIEW_PAGE_LIMIT, input.offset)?;
        let loaded = input.offset + items.len() as i64;
        transaction.commit()?;
        Ok(RootOverviewPage { scope: OverviewScope::Roots, page: OverviewPage { items, offset: input.offset, total_count,
            snapshot_token, next_offset: (loaded < total_count).then_some(loaded) } })
    }
}
