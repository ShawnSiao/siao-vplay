use super::{
    LibraryError, LibraryPreviewStore, LibraryScanPreview, LibraryScanProgress,
    ScanLibraryFolderInput,
};

#[derive(Clone, Debug)]
pub(crate) struct LibraryScanService {
    preview_store: LibraryPreviewStore,
}

impl LibraryScanService {
    pub(crate) fn new(preview_store: LibraryPreviewStore) -> Self {
        Self { preview_store }
    }

    pub(crate) fn begin_scan(&self, scan_id: &str) -> Result<Arc<AtomicBool>, LibraryError> {
        self.preview_store.begin_scan(scan_id)
    }

    pub(crate) fn scan_started<F>(
        &self,
        input: ScanLibraryFolderInput,
        cancelled: Arc<AtomicBool>,
        on_progress: F,
    ) -> Result<LibraryScanPreview, LibraryError>
    where
        F: FnMut(LibraryScanProgress),
    {
        let scanned = match super::scanner::scan_library_folder(
            &input.scan_id,
            &input.root_path,
            cancelled.as_ref(),
            on_progress,
        ) {
            Ok(scanned) => scanned,
            Err(error) => {
                self.preview_store.fail_scan(&input.scan_id);
                return Err(error);
            }
        };
        self.preview_store.complete_scan(&input.scan_id, scanned)
    }

    pub(crate) fn cancel(&self, scan_id: &str) -> Result<(), LibraryError> {
        self.preview_store.cancel_scan(scan_id)
    }

    pub(crate) fn abort(&self, scan_id: &str) {
        self.preview_store.fail_scan(scan_id);
    }
}
use std::sync::{Arc, atomic::AtomicBool};
