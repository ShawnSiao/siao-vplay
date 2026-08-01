use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use uuid::Uuid;

use super::{LibraryError, LibraryScanPreview, scanner::ScannedLibraryFolder};

const PREVIEW_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_ACTIVE_SCANS: usize = 4;
const MAX_COMPLETED_PREVIEWS: usize = 8;

#[derive(Clone, Debug)]
pub(crate) struct LibraryPreviewStore {
    inner: Arc<Mutex<PreviewState>>,
    ttl: Duration,
}

#[derive(Debug, Default)]
struct PreviewState {
    active_scans: HashMap<String, Arc<AtomicBool>>,
    completed_previews: HashMap<String, PreviewEntry>,
}

#[derive(Debug)]
struct PreviewEntry {
    preview: LibraryScanPreview,
    created_at: Instant,
    expires_at: Instant,
}

impl Default for LibraryPreviewStore {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(PreviewState::default())),
            ttl: PREVIEW_TTL,
        }
    }
}

impl LibraryPreviewStore {
    pub(crate) fn begin_scan(&self, scan_id: &str) -> Result<Arc<AtomicBool>, LibraryError> {
        validate_scan_id(scan_id)?;
        let mut state = self.lock()?;
        prune_expired(&mut state);
        if state.active_scans.contains_key(scan_id) {
            return Err(LibraryError::Conflict(format!(
                "扫描任务已经存在：{scan_id}"
            )));
        }
        if state.active_scans.len() >= MAX_ACTIVE_SCANS {
            return Err(LibraryError::Conflict(format!(
                "同时最多执行 {MAX_ACTIVE_SCANS} 个媒体库扫描"
            )));
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        state
            .active_scans
            .insert(scan_id.to_owned(), Arc::clone(&cancelled));
        Ok(cancelled)
    }

    pub(super) fn complete_scan(
        &self,
        scan_id: &str,
        scanned: ScannedLibraryFolder,
    ) -> Result<LibraryScanPreview, LibraryError> {
        let mut state = self.lock()?;
        prune_expired(&mut state);
        let cancelled = state
            .active_scans
            .remove(scan_id)
            .ok_or_else(|| LibraryError::ScanNotFound(scan_id.to_owned()))?;
        if cancelled.load(Ordering::Relaxed) {
            return Err(LibraryError::ScanCancelled(scan_id.to_owned()));
        }
        let preview_token = Uuid::new_v4().to_string();
        let expires_at_ms = now_ms()?
            .checked_add(duration_ms(self.ttl)?)
            .ok_or_else(|| LibraryError::Conflict("预览过期时间超出支持范围".to_owned()))?;
        let needs_confirmation_count = scanned
            .candidates
            .iter()
            .filter(|candidate| candidate.needs_confirmation)
            .count() as u64;
        let preview = LibraryScanPreview {
            scan_id: scan_id.to_owned(),
            preview_token: preview_token.clone(),
            root_path: scanned.root_path,
            root_display_name: scanned.root_display_name,
            suggested_collection_title: scanned.suggested_collection_title,
            candidates: scanned.candidates,
            ignored_entries: scanned.ignored_entries,
            ignored_count: scanned.ignored_count,
            needs_confirmation_count,
            expires_at_ms,
        };
        if state.completed_previews.len() >= MAX_COMPLETED_PREVIEWS
            && let Some(oldest_token) = state
                .completed_previews
                .iter()
                .min_by_key(|(_, entry)| entry.created_at)
                .map(|(token, _)| token.clone())
        {
            state.completed_previews.remove(&oldest_token);
        }
        let created_at = Instant::now();
        state.completed_previews.insert(
            preview_token.clone(),
            PreviewEntry {
                preview: preview.clone(),
                created_at,
                expires_at: created_at + self.ttl,
            },
        );
        state
            .completed_previews
            .get(&preview_token)
            .map(|entry| entry.preview.clone())
            .ok_or_else(|| LibraryError::Conflict("扫描预览未能保存".to_owned()))
    }

    pub(super) fn fail_scan(&self, scan_id: &str) {
        if let Ok(mut state) = self.inner.lock() {
            state.active_scans.remove(scan_id);
            prune_expired(&mut state);
        }
    }

    pub(super) fn cancel_scan(&self, scan_id: &str) -> Result<(), LibraryError> {
        validate_scan_id(scan_id)?;
        let state = self.lock()?;
        let cancelled = state
            .active_scans
            .get(scan_id)
            .ok_or_else(|| LibraryError::ScanNotFound(scan_id.to_owned()))?;
        cancelled.store(true, Ordering::Relaxed);
        Ok(())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, PreviewState>, LibraryError> {
        self.inner
            .lock()
            .map_err(|_| LibraryError::Conflict("媒体库扫描状态不可用".to_owned()))
    }

    #[cfg(test)]
    fn with_ttl(ttl: Duration) -> Self {
        Self {
            inner: Arc::new(Mutex::new(PreviewState::default())),
            ttl,
        }
    }

    #[cfg(test)]
    fn completed_preview_count(&self) -> usize {
        let mut state = self.inner.lock().expect("preview state lock");
        prune_expired(&mut state);
        state.completed_previews.len()
    }

    #[cfg(test)]
    fn first_completed_scan_id(&self) -> Option<String> {
        let mut state = self.inner.lock().expect("preview state lock");
        prune_expired(&mut state);
        state
            .completed_previews
            .values()
            .next()
            .map(|entry| entry.preview.scan_id.clone())
    }
}

fn validate_scan_id(scan_id: &str) -> Result<(), LibraryError> {
    Uuid::parse_str(scan_id)
        .map(|_| ())
        .map_err(|_| LibraryError::Validation("扫描任务 ID 无效".to_owned()))
}

fn prune_expired(state: &mut PreviewState) {
    let now = Instant::now();
    state
        .completed_previews
        .retain(|_, entry| entry.expires_at > now);
}

fn now_ms() -> Result<i64, LibraryError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| LibraryError::Conflict(format!("系统时间早于 Unix 纪元：{error}")))?;
    i64::try_from(duration.as_millis())
        .map_err(|_| LibraryError::Conflict("系统时间超出支持范围".to_owned()))
}

fn duration_ms(duration: Duration) -> Result<i64, LibraryError> {
    i64::try_from(duration.as_millis())
        .map_err(|_| LibraryError::Conflict("预览有效期超出支持范围".to_owned()))
}

#[cfg(test)]
mod tests {
    use std::{thread, time::Duration};

    use super::*;
    use crate::library::{EpisodeRecognition, LibraryScanCandidate};

    fn scanned_folder() -> ScannedLibraryFolder {
        ScannedLibraryFolder {
            root_path: "C:\\Series".to_owned(),
            root_display_name: "Series".to_owned(),
            suggested_collection_title: "Series".to_owned(),
            candidates: vec![LibraryScanCandidate {
                candidate_id: Uuid::new_v4().to_string(),
                relative_path: "S01E01.mp4".to_owned(),
                display_title: "S01E01".to_owned(),
                season_number: Some(1),
                episode_number: Some(1),
                absolute_order: 0,
                recognition: EpisodeRecognition::SxxExx,
                needs_confirmation: false,
                confirmation_reason: None,
                source_size_bytes: 10,
                source_modified_at_ms: Some(1),
                quick_fingerprint: "fingerprint".to_owned(),
            }],
            ignored_entries: Vec::new(),
            ignored_count: 0,
        }
    }

    #[test]
    fn scan_ids_are_unique_and_cancellable() {
        let store = LibraryPreviewStore::default();
        let scan_id = Uuid::new_v4().to_string();
        let cancelled = store.begin_scan(&scan_id).expect("begin scan");
        assert!(matches!(
            store.begin_scan(&scan_id),
            Err(LibraryError::Conflict(_))
        ));
        store.cancel_scan(&scan_id).expect("cancel scan");
        assert!(cancelled.load(Ordering::Relaxed));
        assert!(matches!(
            store.complete_scan(&scan_id, scanned_folder()),
            Err(LibraryError::ScanCancelled(_))
        ));
    }

    #[test]
    fn completed_previews_expire() {
        let store = LibraryPreviewStore::with_ttl(Duration::from_millis(1));
        let scan_id = Uuid::new_v4().to_string();
        store.begin_scan(&scan_id).expect("begin scan");
        store
            .complete_scan(&scan_id, scanned_folder())
            .expect("complete scan");
        assert_eq!(store.completed_preview_count(), 1);
        assert_eq!(
            store.first_completed_scan_id().as_deref(),
            Some(scan_id.as_str())
        );
        thread::sleep(Duration::from_millis(5));
        assert_eq!(store.completed_preview_count(), 0);
    }
}
