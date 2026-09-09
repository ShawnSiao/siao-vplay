use super::*;
pub fn bind_configured_root() -> Result<(), ResourceDownloadError> {
    // Capture resource configuration before taking the task-manager lock.
    let root = local_resources::configured_root();
    let state = DOWNLOAD_MANAGER.get_or_init(|| {
        RwLock::new(DownloadManager {
            generation: 0,
            root: None,
            tasks: BTreeMap::new(),
            binding_error: Some("尚未连接资源目录".into()),
        })
    });
    let mut state = state
        .write()
        .map_err(|_| io::Error::other("资源下载任务锁不可用"))?;
    // Load once while excluding reads/writes. Never expose the previous manager after a failed bind.
    match DownloadManager::load(root) {
        Ok(manager) => {
            *state = manager;
            Ok(())
        }
        Err(error) => {
            let message = error.to_string();
            state.binding_error = Some(message.clone());
            Err(ResourceDownloadError::BindingUnavailable(message))
        }
    }
}
impl DownloadManager {
    pub(super) fn ensure_bound(&self) -> Result<(), ResourceDownloadError> {
        match &self.binding_error {
            Some(message) => Err(ResourceDownloadError::BindingUnavailable(message.clone())),
            None => Ok(()),
        }
    }
}
