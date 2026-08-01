use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use uuid::Uuid;

use super::{LibraryError, LibraryRescanPreview, LibraryRootRelocationPreview};

const RECOVERY_PREVIEW_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_RECOVERY_PREVIEWS: usize = 8;

#[derive(Clone, Debug)]
pub(crate) struct LibraryRecoveryStore {
    inner: Arc<Mutex<HashMap<String, RecoveryEntry>>>,
    ttl: Duration,
}

#[derive(Debug)]
struct RecoveryEntry {
    preview: RecoveryPreview,
    created_at: Instant,
    expires_at: Instant,
}

#[derive(Debug)]
enum RecoveryPreview {
    Rescan(LibraryRescanPreview),
    Relocation(LibraryRootRelocationPreview),
}

#[derive(Debug)]
pub(super) struct RecoveryLease {
    token: String,
    entry: RecoveryEntry,
}

impl RecoveryLease {
    pub(super) fn rescan(&self) -> Result<&LibraryRescanPreview, LibraryError> {
        match &self.entry.preview {
            RecoveryPreview::Rescan(preview) => Ok(preview),
            RecoveryPreview::Relocation(_) => Err(LibraryError::Conflict(
                "恢复预览类型与重新扫描操作不一致".to_owned(),
            )),
        }
    }

    pub(super) fn relocation(&self) -> Result<&LibraryRootRelocationPreview, LibraryError> {
        match &self.entry.preview {
            RecoveryPreview::Relocation(preview) => Ok(preview),
            RecoveryPreview::Rescan(_) => Err(LibraryError::Conflict(
                "恢复预览类型与根目录重定位操作不一致".to_owned(),
            )),
        }
    }
}

impl Default for LibraryRecoveryStore {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            ttl: RECOVERY_PREVIEW_TTL,
        }
    }
}

impl LibraryRecoveryStore {
    pub(super) fn store_rescan(
        &self,
        mut preview: LibraryRescanPreview,
    ) -> Result<LibraryRescanPreview, LibraryError> {
        let (token, expires_at_ms) = self.next_identity()?;
        preview.preview_token.clone_from(&token);
        preview.expires_at_ms = expires_at_ms;
        self.insert(token, RecoveryPreview::Rescan(preview.clone()))?;
        Ok(preview)
    }

    pub(super) fn store_relocation(
        &self,
        mut preview: LibraryRootRelocationPreview,
    ) -> Result<LibraryRootRelocationPreview, LibraryError> {
        let (token, expires_at_ms) = self.next_identity()?;
        preview.preview_token.clone_from(&token);
        preview.expires_at_ms = expires_at_ms;
        self.insert(token, RecoveryPreview::Relocation(preview.clone()))?;
        Ok(preview)
    }

    pub(super) fn take(&self, token: &str) -> Result<RecoveryLease, LibraryError> {
        validate_token(token)?;
        let mut entries = self.lock()?;
        let entry = entries
            .remove(token)
            .ok_or_else(|| LibraryError::PreviewNotFound(token.to_owned()))?;
        if entry.expires_at <= Instant::now() {
            return Err(LibraryError::PreviewExpired(token.to_owned()));
        }
        prune_expired(&mut entries);
        Ok(RecoveryLease {
            token: token.to_owned(),
            entry,
        })
    }

    pub(super) fn restore(&self, lease: RecoveryLease) {
        if lease.entry.expires_at <= Instant::now() {
            return;
        }
        if let Ok(mut entries) = self.inner.lock() {
            prune_expired(&mut entries);
            entries.insert(lease.token, lease.entry);
        }
    }

    fn insert(&self, token: String, preview: RecoveryPreview) -> Result<(), LibraryError> {
        let mut entries = self.lock()?;
        prune_expired(&mut entries);
        if entries.len() >= MAX_RECOVERY_PREVIEWS
            && let Some(oldest) = entries
                .iter()
                .min_by_key(|(_, entry)| entry.created_at)
                .map(|(token, _)| token.clone())
        {
            entries.remove(&oldest);
        }
        let created_at = Instant::now();
        entries.insert(
            token,
            RecoveryEntry {
                preview,
                created_at,
                expires_at: created_at + self.ttl,
            },
        );
        Ok(())
    }

    fn next_identity(&self) -> Result<(String, i64), LibraryError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| LibraryError::Conflict(format!("系统时间早于 Unix 纪元：{error}")))?;
        let now_ms = i64::try_from(now.as_millis())
            .map_err(|_| LibraryError::Conflict("系统时间超出支持范围".to_owned()))?;
        let ttl_ms = i64::try_from(self.ttl.as_millis())
            .map_err(|_| LibraryError::Conflict("恢复预览有效期超出支持范围".to_owned()))?;
        let expires_at_ms = now_ms
            .checked_add(ttl_ms)
            .ok_or_else(|| LibraryError::Conflict("恢复预览过期时间超出支持范围".to_owned()))?;
        Ok((Uuid::new_v4().to_string(), expires_at_ms))
    }

    fn lock(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<String, RecoveryEntry>>, LibraryError> {
        self.inner
            .lock()
            .map_err(|_| LibraryError::Conflict("媒体库恢复预览状态不可用".to_owned()))
    }

    #[cfg(test)]
    fn with_ttl(ttl: Duration) -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            ttl,
        }
    }
}

fn validate_token(token: &str) -> Result<(), LibraryError> {
    Uuid::parse_str(token)
        .map(|_| ())
        .map_err(|_| LibraryError::Validation("媒体库恢复预览令牌无效".to_owned()))
}

fn prune_expired(entries: &mut HashMap<String, RecoveryEntry>) {
    let now = Instant::now();
    entries.retain(|_, entry| entry.expires_at > now);
}

#[cfg(test)]
mod tests {
    use std::{thread, time::Duration};

    use super::*;

    #[test]
    fn recovery_previews_expire_before_apply() {
        let store = LibraryRecoveryStore::with_ttl(Duration::from_millis(1));
        let preview = store
            .store_rescan(LibraryRescanPreview {
                preview_token: String::new(),
                root_id: "root".to_owned(),
                root_path: "C:\\Series".to_owned(),
                root_display_name: "Series".to_owned(),
                collection_id: "collection".to_owned(),
                root_offline: true,
                new_candidates: Vec::new(),
                missing_items: Vec::new(),
                changed_items: Vec::new(),
                available_item_count: 0,
                ignored_count: 0,
                expires_at_ms: 0,
            })
            .expect("stored preview");
        thread::sleep(Duration::from_millis(5));
        assert!(matches!(
            store.take(&preview.preview_token),
            Err(LibraryError::PreviewExpired(_))
        ));
    }
}
