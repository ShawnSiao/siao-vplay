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

pub(super) fn task_paths(task_id: &str) -> Result<(PathBuf, PathBuf), ResourceDownloadError> {
    Uuid::parse_str(task_id)
        .map_err(|_| ResourceDownloadError::Integrity(format!("下载任务 ID 无效：{task_id}")))?;
    // Never acquire the resource configuration lock while holding the task lock.
    let configured = configured_available_root()?;
    with_manager_read(|manager| {
        let root = manager.ensure_root_available()?;
        if root != configured {
            return Err(ResourceDownloadError::BindingUnavailable(
                "任务所属目录与当前保存位置不一致".into(),
            ));
        }
        if !manager.tasks.contains_key(task_id) {
            return Err(ResourceDownloadError::TaskNotFound(task_id.to_owned()));
        }
        Ok((
            root.join("downloads").join(format!("{task_id}.part")),
            root.join("staging").join(task_id),
        ))
    })
}
