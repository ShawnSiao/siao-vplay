mod binding;
use binding::task_paths;
pub use binding::{bind_configured_root, initialize_for_startup};
#[cfg(test)]
mod binding_tests;
mod contract;
mod ordering;
pub use contract::{ResourceNetworkStatus, ResourceDownloadSnapshot, ResourceDownloadTask, ResourceDownloadTaskState, CapabilityPreparation};
use std::{
    collections::{BTreeMap, HashMap},
    fs::{self, File, OpenOptions},
    io::{self, BufReader, Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    process::Command,
    sync::{
        Arc, Mutex, OnceLock, RwLock,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::{
    StatusCode,
    blocking::Client,
    header::{CONTENT_RANGE, RANGE},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
#[cfg(not(test))]
use tauri::Emitter;
use thiserror::Error;
use url::Url;
use uuid::Uuid;
use zip::ZipArchive;

use crate::{
    ai,
    local_resources::{
        self, LocalResourceError, ReceiptFile, ResourceArtifact, ResourceDefinition,
        ResourceReceipt,
    },
};

const TASK_STORE_SCHEMA_VERSION: u32 = 1;
const TASK_STORE_FILE_NAME: &str = "download-tasks.json";
#[cfg(not(test))]
const TASK_EVENT_NAME: &str = "local-resource-task-updated";
const PROGRESS_PERSIST_BYTES: u64 = 1024 * 1024;
const DOWNLOAD_READ_BUFFER_BYTES: usize = 256 * 1024;
const MAX_TRANSIENT_DOWNLOAD_RETRIES: usize = 4;
const FILE_DIGEST_BUFFER_BYTES: usize = 1024 * 1024;
const FILE_INSTALL_MARGIN_BYTES: u64 = 16 * 1024 * 1024;
const ARCHIVE_INSTALL_MARGIN_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ARCHIVE_EXPANSION_FACTOR: u64 = 20;

#[derive(Debug, Error)]
pub enum ResourceDownloadError {
    #[error("资源任务状态尚未恢复，已暂停任务操作：{0}")]
    BindingUnavailable(String),
    #[error(transparent)]
    LocalResource(#[from] LocalResourceError),
    #[error("资源任务文件操作失败：{0}")]
    FileSystem(#[from] io::Error),
    #[error("资源任务序列化失败：{0}")]
    Serialization(#[from] serde_json::Error),
    #[error("未找到资源下载任务：{0}")]
    TaskNotFound(String),
    #[error("资源下载任务状态不允许该操作：{0}")]
    InvalidTaskState(String),
    #[error("待恢复操作 ID 无效：{0}")]
    InvalidPendingAction(String),
    #[error("资源尚无可信下载制品：{0}")]
    ArtifactUnavailable(String),
    #[error("资源下载连接超时。已保留下载进度；请检查网络或代理设置后继续")]
    NetworkTimeout,
    #[error("无法连接资源下载服务。已保留下载进度；请检查网络或代理设置后继续")]
    NetworkConnect,
    #[error("资源下载服务返回 HTTP {0}")]
    HttpStatus(u16),
    #[error("资源下载失败：{0}")]
    Network(String),
    #[error("资源完整性校验失败：{0}")]
    Integrity(String),
    #[error("资源压缩包处理失败：{0}")]
    Archive(String),
    #[error("资源健康检查失败：{0}")]
    HealthCheck(String),
    #[error("资源存储空间不足：需要 {required_bytes} 字节，可用 {available_bytes} 字节")]
    InsufficientSpace {
        required_bytes: u64,
        available_bytes: u64,
    },
    #[error("删除本地资源前需要明确确认")]
    RemovalConfirmationRequired,
    #[error("资源正在下载，当前不能删除：{0}")]
    ResourceBusy(String),
}

impl ResourceDownloadError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::BindingUnavailable(_) => "local_resource_binding_unavailable",
            Self::LocalResource(LocalResourceError::RootUnavailable(_)) => "root_unavailable",
            Self::LocalResource(LocalResourceError::UnknownCapability(_)) => {
                "local_resource_capability_invalid"
            }
            Self::LocalResource(LocalResourceError::UnknownResource(_)) => "local_resource_invalid",
            Self::LocalResource(_) => "local_resource_error",
            Self::FileSystem(_) => "local_resource_filesystem_error",
            Self::Serialization(_) => "local_resource_serialization_error",
            Self::TaskNotFound(_) => "local_resource_task_not_found",
            Self::InvalidTaskState(_) => "local_resource_task_state_invalid",
            Self::InvalidPendingAction(_) => "pending_action_invalid",
            Self::ArtifactUnavailable(_) => "local_resource_artifact_unavailable",
            Self::NetworkTimeout => "local_resource_download_timeout",
            Self::NetworkConnect => "local_resource_download_connection_failed",
            Self::HttpStatus(_) => "local_resource_download_http_failed",
            Self::Network(_) => "local_resource_download_failed",
            Self::Integrity(_) => "local_resource_integrity_failed",
            Self::Archive(_) => "local_resource_archive_invalid",
            Self::HealthCheck(_) => "local_resource_health_check_failed",
            Self::InsufficientSpace { .. } => "local_resource_space_insufficient",
            Self::RemovalConfirmationRequired => "local_resource_removal_confirmation_required",
            Self::ResourceBusy(_) => "local_resource_busy",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareLocalCapabilityInput {
    pub capability_id: String,
    #[serde(default)]
    pub pending_action_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDownloadTaskInput {
    pub task_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairLocalResourceInput {
    pub resource_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveLocalResourceInput {
    pub resource_id: String,
    pub confirmed: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ResourceRemovalResult {
    pub resource_id: String,
    pub removed: bool,
    pub affected_capability_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadTaskStore {
    schema_version: u32,
    tasks: Vec<ResourceDownloadTask>,
}

struct DownloadManager {
    binding_error: Option<String>,
    generation: u64,
    root: Option<PathBuf>,
    tasks: BTreeMap<String, ResourceDownloadTask>,
}

#[derive(Default)]
struct DownloadControl {
    pause_requested: AtomicBool,
    cancel_requested: AtomicBool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DownloadOutcome {
    Complete,
    Paused,
    Cancelled,
}

static DOWNLOAD_MANAGER: OnceLock<RwLock<DownloadManager>> = OnceLock::new();
static ACTIVE_CONTROLS: OnceLock<Mutex<HashMap<String, Arc<DownloadControl>>>> = OnceLock::new();

#[cfg(test)]
pub fn initialize() -> Result<(), ResourceDownloadError> {
    bind_configured_root()
}

pub fn list_tasks() -> Result<Vec<ResourceDownloadTask>, ResourceDownloadError> {
    with_manager_read(|manager| Ok(manager.tasks.values().cloned().collect()))
}

pub fn task_snapshot_list() -> Result<ResourceDownloadSnapshot, ResourceDownloadError> {
    with_manager_read(|manager| Ok(ResourceDownloadSnapshot {
        generation: manager.generation,
        tasks: manager.tasks.values().cloned().collect(),
    }))
}

pub fn network_status() -> Result<ResourceNetworkStatus, ai::AiError> {
    ai::network::observed_settings().map(Into::into)
}

pub(crate) fn has_active_tasks() -> Result<bool, ResourceDownloadError> {
    Ok(list_tasks()?
        .iter()
        .any(|task| task.state.is_worker_active()))
}

pub(crate) fn resource_is_preparing(resource_id: &str) -> bool {
    DOWNLOAD_MANAGER
        .get()
        .and_then(|manager| manager.read().ok())
        .is_some_and(|manager| {
            manager.binding_error.is_none() && manager
                .tasks
                .values()
                .any(|task| task.resource_id == resource_id && task.state.is_worker_active())
        })
}

pub fn prepare_capability(
    capability_id: &str,
    pending_action_id: Option<&str>,
    app: Option<AppHandle>,
) -> Result<CapabilityPreparation, ResourceDownloadError> {
    if let Some(pending_action_id) = pending_action_id {
        Uuid::parse_str(pending_action_id).map_err(|_| {
            ResourceDownloadError::InvalidPendingAction(pending_action_id.to_owned())
        })?;
    }
    let resource_ids = local_resources::required_resource_ids(capability_id)?;
    let mut ready_resource_ids = Vec::new();
    let mut pending_resources = Vec::new();
    for resource_id in &resource_ids {
        if local_resources::resource_is_ready(resource_id)? {
            ready_resource_ids.push(resource_id.clone());
            continue;
        }
        let resource = local_resources::resource_definition(resource_id)?;
        if resource.artifact.is_none() {
            return Err(ResourceDownloadError::ArtifactUnavailable(resource.id));
        }
        pending_resources.push(resource);
    }

    let mut task_ids = Vec::new();
    let mut new_task_ids = Vec::new();
    with_manager_write(|manager| {
        manager.ensure_root_available()?;
        for resource in pending_resources {
            let (task_id, created) =
                manager.ensure_task_record(&resource, capability_id, pending_action_id, false)?;
            task_ids.push(task_id.clone());
            if created {
                new_task_ids.push(task_id);
            }
        }
        manager.persist()?;
        Ok(())
    })?;
    for task_id in new_task_ids {
        spawn_task(task_id, app.clone())?;
    }
    Ok(CapabilityPreparation {
        capability_id: capability_id.to_owned(),
        pending_action_id: pending_action_id.map(str::to_owned),
        state: if task_ids.is_empty() {
            "ready".to_owned()
        } else {
            "preparing".to_owned()
        },
        resource_ids,
        ready_resource_ids,
        task_ids,
    })
}

pub fn pause_task(task_id: &str) -> Result<ResourceDownloadTask, ResourceDownloadError> {
    let control = active_controls()
        .lock()
        .map_err(|_| io::Error::other("资源下载控制锁不可用"))?
        .get(task_id)
        .cloned();
    if let Some(control) = control {
        control.pause_requested.store(true, Ordering::Release);
        return task_snapshot(task_id);
    }
    update_task(task_id, None, |task| {
        if task.state != ResourceDownloadTaskState::Queued {
            return Err(ResourceDownloadError::InvalidTaskState(format!(
                "{} 当前为 {:?}",
                task.id, task.state
            )));
        }
        task.state = ResourceDownloadTaskState::Paused;
        task.error_code = Some("pause_requested".to_owned());
        task.error_message = Some("下载已暂停".to_owned());
        Ok(())
    })
}

pub fn resume_task(
    task_id: &str,
    app: Option<AppHandle>,
) -> Result<ResourceDownloadTask, ResourceDownloadError> {
    let task = update_task(task_id, app.as_ref(), |task| {
        if task.state != ResourceDownloadTaskState::Paused {
            return Err(ResourceDownloadError::InvalidTaskState(format!(
                "{} 当前为 {:?}",
                task.id, task.state
            )));
        }
        task.state = ResourceDownloadTaskState::Queued;
        task.error_code = None;
        task.error_message = None;
        task.attempt = task.attempt.saturating_add(1);
        Ok(())
    })?;
    spawn_task(task_id.to_owned(), app)?;
    Ok(task)
}

pub fn cancel_task(task_id: &str) -> Result<ResourceDownloadTask, ResourceDownloadError> {
    let control = active_controls()
        .lock()
        .map_err(|_| io::Error::other("资源下载控制锁不可用"))?
        .get(task_id)
        .cloned();
    if let Some(control) = control {
        control.cancel_requested.store(true, Ordering::Release);
        return update_task(task_id, None, |task| {
            task.state = ResourceDownloadTaskState::Cancelled;
            task.error_code = Some("cancelled".to_owned());
            task.error_message = Some("下载已取消".to_owned());
            Ok(())
        });
    }
    let task = task_snapshot(task_id)?;
    let _maintenance = crate::resource_leases::maintain_resource(&task.resource_id)?;
    local_resources::recover_changes_for_use()?;
    let (partial_path, staging_path) = task_paths(task_id)?;
    remove_file_if_exists(&partial_path)?;
    remove_directory_if_exists(&staging_path)?;
    update_task(task_id, None, |task| {
        if task.state.is_terminal() && task.state != ResourceDownloadTaskState::Failed {
            return Err(ResourceDownloadError::InvalidTaskState(format!(
                "{} 当前为 {:?}",
                task.id, task.state
            )));
        }
        task.state = ResourceDownloadTaskState::Cancelled;
        task.downloaded_bytes = 0;
        task.error_code = Some("cancelled".to_owned());
        task.error_message = Some("下载已取消".to_owned());
        Ok(())
    })
}

pub fn retry_task(
    task_id: &str,
    app: Option<AppHandle>,
) -> Result<ResourceDownloadTask, ResourceDownloadError> {
    let partial_bytes = task_paths(task_id)?
        .0
        .metadata()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let task = update_task(task_id, app.as_ref(), |task| {
        if !matches!(
            task.state,
            ResourceDownloadTaskState::Failed | ResourceDownloadTaskState::Cancelled
        ) {
            return Err(ResourceDownloadError::InvalidTaskState(format!(
                "{} 当前为 {:?}",
                task.id, task.state
            )));
        }
        task.state = ResourceDownloadTaskState::Queued;
        task.downloaded_bytes = partial_bytes.min(task.total_bytes);
        task.error_code = None;
        task.error_message = None;
        task.attempt = task.attempt.saturating_add(1);
        Ok(())
    })?;
    spawn_task(task_id.to_owned(), app)?;
    Ok(task)
}

pub fn repair_resource(
    resource_id: &str,
    app: Option<AppHandle>,
) -> Result<ResourceDownloadTask, ResourceDownloadError> {
    let resource = local_resources::resource_definition(resource_id)?;
    if resource.artifact.is_none() {
        return Err(ResourceDownloadError::ArtifactUnavailable(resource.id));
    }
    let (task_id, created) = with_manager_write(|manager| {
        manager.ensure_root_available()?;
        let result = manager.ensure_task_record(&resource, "repair", None, true)?;
        manager.persist()?;
        Ok(result)
    })?;
    if created {
        spawn_task(task_id.clone(), app)?;
    }
    task_snapshot(&task_id)
}

pub fn update_resource(
    resource_id: &str,
    app: Option<AppHandle>,
) -> Result<ResourceDownloadTask, ResourceDownloadError> {
    if !local_resources::resource_update_available(resource_id)? {
        return Err(ResourceDownloadError::InvalidTaskState(format!(
            "{resource_id} 当前没有可用更新"
        )));
    }
    let resource = local_resources::resource_definition(resource_id)?;
    if resource.artifact.is_none() {
        return Err(ResourceDownloadError::ArtifactUnavailable(resource.id));
    }
    let (task_id, created) = with_manager_write(|manager| {
        manager.ensure_root_available()?;
        let result = manager.ensure_task_record(&resource, "update", None, false)?;
        manager.persist()?;
        Ok(result)
    })?;
    if created {
        spawn_task(task_id.clone(), app)?;
    }
    task_snapshot(&task_id)
}

pub fn remove_resource(
    resource_id: &str,
    confirmed: bool,
) -> Result<ResourceRemovalResult, ResourceDownloadError> {
    let _maintenance = crate::resource_leases::maintain_resource(resource_id)?;
    if !confirmed {
        return Err(ResourceDownloadError::RemovalConfirmationRequired);
    }
    let busy = list_tasks()?
        .into_iter()
        .any(|task| task.resource_id == resource_id && task.state.is_worker_active());
    if busy {
        return Err(ResourceDownloadError::ResourceBusy(resource_id.to_owned()));
    }
    let affected_capability_ids = affected_capabilities(resource_id)?;
    let removed = local_resources::deactivate_resource(resource_id)?.is_some();
    Ok(ResourceRemovalResult {
        resource_id: resource_id.to_owned(),
        removed,
        affected_capability_ids,
    })
}

fn with_manager_read<T>(
    operation: impl FnOnce(&DownloadManager) -> Result<T, ResourceDownloadError>,
) -> Result<T, ResourceDownloadError> {
    let state = DOWNLOAD_MANAGER
        .get()
        .ok_or(ResourceDownloadError::LocalResource(
            LocalResourceError::NotInitialized,
        ))?;
    let state = state
        .read()
        .map_err(|_| io::Error::other("资源下载任务锁不可用"))?;
    state.ensure_bound()?;
    operation(&state)
}

fn with_manager_write<T>(
    operation: impl FnOnce(&mut DownloadManager) -> Result<T, ResourceDownloadError>,
) -> Result<T, ResourceDownloadError> {
    let state = DOWNLOAD_MANAGER
        .get()
        .ok_or(ResourceDownloadError::LocalResource(
            LocalResourceError::NotInitialized,
        ))?;
    let mut state = state
        .write()
        .map_err(|_| io::Error::other("资源下载任务锁不可用"))?;
    state.ensure_bound()?;
    operation(&mut state)
}

impl DownloadManager {
    fn load(root: Option<PathBuf>) -> Result<Self, ResourceDownloadError> {
        let mut manager = Self {
            binding_error: None,
            generation: ordering::next_generation()?,
            root,
            tasks: BTreeMap::new(),
        };
        let Some(root) = manager.root.as_ref() else {
            return Ok(manager);
        };
        if !root.is_dir() {
            return Ok(manager);
        }
        let store_path = root.join("state").join(TASK_STORE_FILE_NAME);
        if store_path.is_file() {
            let store = serde_json::from_slice::<DownloadTaskStore>(&fs::read(&store_path)?)?;
            if store.schema_version != TASK_STORE_SCHEMA_VERSION {
                return Err(ResourceDownloadError::Serialization(serde_json::Error::io(
                    io::Error::other(format!("不支持的下载任务版本 {}", store.schema_version)),
                )));
            }
            let mut discarded_invalid_task = false;
            for mut task in store.tasks {
                if validate_task_record(&task).is_err() || manager.tasks.contains_key(&task.id) {
                    discarded_invalid_task = true;
                    continue;
                }
                task.generation = manager.generation;
                task.revision = 1;
                manager.tasks.insert(task.id.clone(), task);
            }
            if discarded_invalid_task {
                manager.persist()?;
            }
        }
        let mut recovered = false;
        for task in manager.tasks.values_mut() {
            if task.state.is_worker_active() {
                task.state = ResourceDownloadTaskState::Paused;
                task.error_code = Some("interrupted".to_owned());
                task.error_message = Some("应用上次退出后，下载等待继续".to_owned());
                task.advance_revision()?;
                task.updated_at_ms = now_ms();
                recovered = true;
            }
        }
        for task in manager.tasks.values() {
            if task.state == ResourceDownloadTaskState::Cancelled {
                let _ = remove_file_if_exists(
                    &root.join("downloads").join(format!("{}.part", task.id)),
                );
                let _ = remove_directory_if_exists(&root.join("staging").join(&task.id));
            }
        }
        if recovered {
            manager.persist()?;
        }
        Ok(manager)
    }

    fn ensure_root_available(&self) -> Result<&Path, ResourceDownloadError> {
        self.ensure_bound()?;
        let root = self
            .root
            .as_deref()
            .ok_or(ResourceDownloadError::LocalResource(
                LocalResourceError::ConfirmationRequired,
            ))?;
        if !root.is_dir() {
            return Err(LocalResourceError::RootUnavailable(root.display().to_string()).into());
        }
        Ok(root)
    }

    fn ensure_task_record(
        &mut self,
        resource: &ResourceDefinition,
        capability_id: &str,
        pending_action_id: Option<&str>,
        force_reinstall: bool,
    ) -> Result<(String, bool), ResourceDownloadError> {
        if let Some(task) = self.tasks.values_mut().find(|task| {
            task.resource_id == resource.id
                && task.version == resource.version
                && task.force_reinstall == force_reinstall
                && !matches!(
                    task.state,
                    ResourceDownloadTaskState::Completed | ResourceDownloadTaskState::Cancelled
                )
        }) {
            let previous = task.clone();
            if !task
                .requested_by_capability_ids
                .iter()
                .any(|value| value == capability_id)
            {
                task.requested_by_capability_ids
                    .push(capability_id.to_owned());
                task.requested_by_capability_ids.sort();
            }
            if let Some(pending_action_id) = pending_action_id
                && !task
                    .pending_action_ids
                    .iter()
                    .any(|value| value == pending_action_id)
            {
                task.pending_action_ids.push(pending_action_id.to_owned());
                task.pending_action_ids.sort();
            }
            if *task != previous { task.advance_revision()?; task.updated_at_ms = now_ms(); }
            return Ok((task.id.clone(), false));
        }
        let artifact = resource
            .artifact
            .as_ref()
            .ok_or_else(|| ResourceDownloadError::ArtifactUnavailable(resource.id.clone()))?;
        let id = Uuid::new_v4().to_string();
        let timestamp = now_ms();
        self.tasks.insert(
            id.clone(),
            ResourceDownloadTask {
                generation: self.generation,
                revision: 1,
                id: id.clone(),
                resource_id: resource.id.clone(),
                version: resource.version.clone(),
                state: ResourceDownloadTaskState::Queued,
                downloaded_bytes: 0,
                total_bytes: artifact.size,
                requested_by_capability_ids: vec![capability_id.to_owned()],
                pending_action_ids: pending_action_id.into_iter().map(str::to_owned).collect(),
                attempt: 1,
                error_code: None,
                error_message: None,
                created_at_ms: timestamp,
                updated_at_ms: timestamp,
                force_reinstall,
            },
        );
        Ok((id, true))
    }

    fn persist(&self) -> Result<(), ResourceDownloadError> {
        let root = self.ensure_root_available()?;
        let store = DownloadTaskStore {
            schema_version: TASK_STORE_SCHEMA_VERSION,
            tasks: self.tasks.values().cloned().collect(),
        };
        persist_json_atomic(&root.join("state").join(TASK_STORE_FILE_NAME), &store)
    }
}

fn active_controls() -> &'static Mutex<HashMap<String, Arc<DownloadControl>>> {
    ACTIVE_CONTROLS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn spawn_task(task_id: String, app: Option<AppHandle>) -> Result<(), ResourceDownloadError> {
    let storage_usage = crate::resource_leases::storage_usage()?;
    let control = Arc::new(DownloadControl::default());
    {
        let mut controls = active_controls()
            .lock()
            .map_err(|_| io::Error::other("资源下载控制锁不可用"))?;
        if controls.contains_key(&task_id) {
            return Ok(());
        }
        controls.insert(task_id.clone(), Arc::clone(&control));
    }
    let worker_task_id = task_id.clone();
    let worker_app = app.clone();
    let spawn_result = thread::Builder::new()
        .name(format!("resource-download-{task_id}"))
        .spawn(move || {
            let _storage_usage = storage_usage;
            execute_task(&worker_task_id, &control, worker_app.as_ref());
            if let Ok(mut controls) = active_controls().lock() {
                controls.remove(&worker_task_id);
            }
        });
    match spawn_result {
        Ok(_) => Ok(()),
        Err(error) => {
            if let Ok(mut controls) = active_controls().lock() {
                controls.remove(&task_id);
            }
            let message = format!("无法启动资源下载任务：{error}");
            let _ = update_task(&task_id, app.as_ref(), |task| {
                task.state = ResourceDownloadTaskState::Failed;
                task.error_code = Some("worker_spawn_failed".to_owned());
                task.error_message = Some(message);
                Ok(())
            });
            Err(error.into())
        }
    }
}

fn execute_task(task_id: &str, control: &DownloadControl, app: Option<&AppHandle>) {
    if let Err(error) = execute_task_inner(task_id, control, app) {
        let paths = task_paths(task_id).ok();
        if should_discard_partial(&error)
            && let Some((partial_path, _)) = paths.as_ref()
        {
            let _ = remove_file_if_exists(partial_path);
        }
        if !local_resources::resource_change_pending().unwrap_or(true)
            && let Some((_, staging_path)) = paths.as_ref() {
            let _ = remove_directory_if_exists(staging_path);
        }
        let code = error.code().to_owned();
        let message = error.to_string();
        let _ = update_task(task_id, app, |task| {
            if task.state != ResourceDownloadTaskState::Cancelled {
                task.state = ResourceDownloadTaskState::Failed;
                task.error_code = Some(code);
                task.error_message = Some(message);
            }
            Ok(())
        });
    }
}

fn execute_task_inner(
    task_id: &str,
    control: &DownloadControl,
    app: Option<&AppHandle>,
) -> Result<(), ResourceDownloadError> {
    let task = task_snapshot(task_id)?;
    let _maintenance = crate::resource_leases::maintain_resource(&task.resource_id)?;
    local_resources::recover_changes_for_use()?;
    let resource = local_resources::resource_definition(&task.resource_id)?;
    if resource.version != task.version {
        return Err(ResourceDownloadError::Integrity(format!(
            "{} 的任务版本与内置清单不一致",
            task.resource_id
        )));
    }
    let artifact = resource
        .artifact
        .clone()
        .ok_or_else(|| ResourceDownloadError::ArtifactUnavailable(resource.id.clone()))?;
    let root = configured_available_root()?;
    let (partial_path, staging_path) = task_paths(task_id)?;
    let existing_bytes = partial_path
        .metadata()
        .map(|metadata| metadata.len())
        .unwrap_or(0)
        .min(artifact.size);
    ensure_available_space(
        available_space(&root),
        required_working_space(&resource, existing_bytes),
    )?;
    update_task(task_id, app, |task| {
        task.state = ResourceDownloadTaskState::Downloading;
        task.downloaded_bytes = existing_bytes;
        task.error_code = None;
        task.error_message = None;
        Ok(())
    })?;

    let client = build_download_client()?;
    let mut last_persisted = existing_bytes;
    let outcome = download_artifact(
        &client,
        &artifact,
        &partial_path,
        control,
        |downloaded_bytes| {
            if downloaded_bytes.saturating_sub(last_persisted) >= PROGRESS_PERSIST_BYTES
                || downloaded_bytes == artifact.size
            {
                update_task(task_id, app, |task| {
                    task.downloaded_bytes = downloaded_bytes.min(task.total_bytes);
                    Ok(())
                })?;
                last_persisted = downloaded_bytes;
            }
            Ok(())
        },
    )?;
    match outcome {
        DownloadOutcome::Paused => {
            update_task(task_id, app, |task| {
                task.state = ResourceDownloadTaskState::Paused;
                task.downloaded_bytes = partial_path
                    .metadata()
                    .map(|metadata| metadata.len())
                    .unwrap_or(task.downloaded_bytes)
                    .min(task.total_bytes);
                task.error_code = Some("pause_requested".to_owned());
                task.error_message = Some("下载已暂停".to_owned());
                Ok(())
            })?;
            return Ok(());
        }
        DownloadOutcome::Cancelled => {
            remove_file_if_exists(&partial_path)?;
            remove_directory_if_exists(&staging_path)?;
            update_task(task_id, app, |task| {
                task.state = ResourceDownloadTaskState::Cancelled;
                task.downloaded_bytes = 0;
                task.error_code = Some("cancelled".to_owned());
                task.error_message = Some("下载已取消".to_owned());
                Ok(())
            })?;
            return Ok(());
        }
        DownloadOutcome::Complete => {}
    }

    update_task(task_id, app, |task| {
        task.state = ResourceDownloadTaskState::Verifying;
        task.downloaded_bytes = task.total_bytes;
        Ok(())
    })?;
    verify_downloaded_file(&partial_path, artifact.size, &artifact.sha256)?;
    remove_directory_if_exists(&staging_path)?;
    let staged_payload = staging_path.join("payload");
    fs::create_dir_all(&staged_payload)?;
    install_to_staging(&resource, &artifact, &partial_path, &staged_payload)?;
    verify_entrypoints(&resource, &staged_payload)?;
    run_health_check(&resource, &staged_payload)?;
    let files = collect_file_manifest(&staged_payload)?;
    if control.cancel_requested.load(Ordering::Acquire) {
        remove_file_if_exists(&partial_path)?;
        remove_directory_if_exists(&staging_path)?;
        update_task(task_id, app, |task| {
            task.state = ResourceDownloadTaskState::Cancelled;
            task.downloaded_bytes = 0;
            task.error_code = Some("cancelled".to_owned());
            task.error_message = Some("下载已取消".to_owned());
            Ok(())
        })?;
        return Ok(());
    }
    update_task(task_id, app, |task| {
        task.state = ResourceDownloadTaskState::Installing;
        Ok(())
    })?;
    activate_staged_resource(&root, &resource, &staged_payload, files)?;
    remove_file_if_exists(&partial_path)?;
    remove_directory_if_exists(&staging_path)?;
    update_task(task_id, app, |task| {
        task.state = ResourceDownloadTaskState::Completed;
        task.downloaded_bytes = task.total_bytes;
        task.error_code = None;
        task.error_message = None;
        Ok(())
    })?;
    Ok(())
}

fn build_download_client() -> Result<Client, ResourceDownloadError> {
    let builder = Client::builder()
        .user_agent(format!(
            "SiaoVPlay local resource manager/{}",
            env!("CARGO_PKG_VERSION")
        ))
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(2 * 60 * 60));
    ai::network::build_client(builder).map_err(ResourceDownloadError::Network)
}


fn download_artifact(
    client: &Client,
    artifact: &ResourceArtifact,
    partial_path: &Path,
    control: &DownloadControl,
    mut progress: impl FnMut(u64) -> Result<(), ResourceDownloadError>,
) -> Result<DownloadOutcome, ResourceDownloadError> {
    if let Some(parent) = partial_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut existing_bytes = partial_path
        .metadata()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if existing_bytes > artifact.size {
        remove_file_if_exists(partial_path)?;
        existing_bytes = 0;
    }
    if control.cancel_requested.load(Ordering::Acquire) {
        return Ok(DownloadOutcome::Cancelled);
    }
    if control.pause_requested.load(Ordering::Acquire) {
        return Ok(DownloadOutcome::Paused);
    }
    if existing_bytes == artifact.size {
        progress(existing_bytes)?;
        return Ok(DownloadOutcome::Complete);
    }
    let mut buffer = vec![0_u8; DOWNLOAD_READ_BUFFER_BYTES];
    let mut retry_count = 0_usize;
    loop {
        if control.cancel_requested.load(Ordering::Acquire) {
            return Ok(DownloadOutcome::Cancelled);
        }
        if control.pause_requested.load(Ordering::Acquire) {
            return Ok(DownloadOutcome::Paused);
        }
        let mut request = client.get(&artifact.url);
        if existing_bytes > 0 {
            request = request.header(RANGE, format!("bytes={existing_bytes}-"));
        }
        let mut response = match request.send() {
            Ok(response) => response,
            Err(error) => {
                let classified = classify_request_error(error);
                if retry_count >= MAX_TRANSIENT_DOWNLOAD_RETRIES {
                    return Err(classified);
                }
                retry_count += 1;
                wait_before_download_retry(retry_count);
                continue;
            }
        };
        let append = if existing_bytes > 0 && response.status() == StatusCode::PARTIAL_CONTENT {
            validate_content_range(&response, existing_bytes)?;
            true
        } else if response.status().is_success() {
            existing_bytes = 0;
            false
        } else {
            return Err(ResourceDownloadError::HttpStatus(
                response.status().as_u16(),
            ));
        };
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(partial_path)?;
        if append {
            file.seek(SeekFrom::End(0))?;
        }
        let mut downloaded_bytes = existing_bytes;
        let interrupted = loop {
            if control.cancel_requested.load(Ordering::Acquire) {
                file.sync_all()?;
                return Ok(DownloadOutcome::Cancelled);
            }
            if control.pause_requested.load(Ordering::Acquire) {
                file.sync_all()?;
                return Ok(DownloadOutcome::Paused);
            }
            let count = match response.read(&mut buffer) {
                Ok(count) => count,
                Err(error) => break Some(error.to_string()),
            };
            if count == 0 {
                break (downloaded_bytes != artifact.size).then(|| {
                    format!(
                        "下载提前结束：已接收 {downloaded_bytes} 字节，预期 {} 字节",
                        artifact.size
                    )
                });
            }
            file.write_all(&buffer[..count])?;
            downloaded_bytes = downloaded_bytes.saturating_add(count as u64);
            if downloaded_bytes > artifact.size {
                return Err(ResourceDownloadError::Integrity(format!(
                    "下载内容超过清单大小 {} 字节",
                    artifact.size
                )));
            }
            progress(downloaded_bytes)?;
        };
        file.sync_all()?;
        progress(downloaded_bytes)?;
        if downloaded_bytes == artifact.size {
            return Ok(DownloadOutcome::Complete);
        }
        existing_bytes = downloaded_bytes;
        if retry_count >= MAX_TRANSIENT_DOWNLOAD_RETRIES {
            return Err(ResourceDownloadError::Network(
                interrupted.expect("interrupted download should have a reason"),
            ));
        }
        retry_count += 1;
        wait_before_download_retry(retry_count);
    }
}

fn wait_before_download_retry(retry_count: usize) {
    if cfg!(test) {
        return;
    }
    let delay_ms = 250_u64.saturating_mul(1_u64 << retry_count.min(4));
    thread::sleep(Duration::from_millis(delay_ms));
}

fn validate_content_range(
    response: &reqwest::blocking::Response,
    expected_start: u64,
) -> Result<(), ResourceDownloadError> {
    let value = response
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ResourceDownloadError::Network("续传响应缺少 Content-Range".to_owned()))?;
    let expected_prefix = format!("bytes {expected_start}-");
    if !value.starts_with(&expected_prefix) {
        return Err(ResourceDownloadError::Network(format!(
            "续传响应范围不匹配：{value}"
        )));
    }
    Ok(())
}

fn verify_downloaded_file(
    path: &Path,
    expected_size: u64,
    expected_sha256: &str,
) -> Result<(), ResourceDownloadError> {
    let (actual_size, actual_sha256) = file_digest(path)?;
    if actual_size != expected_size {
        return Err(ResourceDownloadError::Integrity(format!(
            "{} 大小为 {actual_size}，预期为 {expected_size}",
            path.display()
        )));
    }
    if !actual_sha256.eq_ignore_ascii_case(expected_sha256) {
        return Err(ResourceDownloadError::Integrity(format!(
            "{} 的 SHA-256 不匹配",
            path.display()
        )));
    }
    Ok(())
}

fn install_to_staging(
    resource: &ResourceDefinition,
    artifact: &ResourceArtifact,
    partial_path: &Path,
    staged_payload: &Path,
) -> Result<(), ResourceDownloadError> {
    match artifact.format.as_str() {
        "zip" => extract_zip(
            partial_path,
            staged_payload,
            artifact.strip_components.unwrap_or(0),
            artifact.size,
        ),
        "file" => {
            let relative = file_artifact_relative_path(resource, artifact)?;
            let destination = join_safe_relative(staged_payload, &relative)?;
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(partial_path, &destination)?;
            OpenOptions::new()
                .write(true)
                .open(destination)?
                .sync_all()?;
            Ok(())
        }
        other => Err(ResourceDownloadError::ArtifactUnavailable(format!(
            "{} 使用暂不支持的制品格式 {other}",
            resource.id
        ))),
    }
}

fn extract_zip(
    archive_path: &Path,
    destination_root: &Path,
    strip_components: u32,
    archive_size: u64,
) -> Result<(), ResourceDownloadError> {
    let file = File::open(archive_path)?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| ResourceDownloadError::Archive(error.to_string()))?;
    let maximum_extracted_bytes = archive_size
        .saturating_mul(MAX_ARCHIVE_EXPANSION_FACTOR)
        .max(ARCHIVE_INSTALL_MARGIN_BYTES);
    let mut extracted_bytes = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| ResourceDownloadError::Archive(error.to_string()))?;
        let raw_name = entry.name().replace('\\', "/");
        let relative = safe_archive_relative_path(&raw_name, strip_components)?;
        let Some(relative) = relative else {
            continue;
        };
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(ResourceDownloadError::Archive(format!(
                "压缩包包含符号链接：{raw_name}"
            )));
        }
        let destination = destination_root.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(destination)?;
            continue;
        }
        extracted_bytes = extracted_bytes.saturating_add(entry.size());
        if extracted_bytes > maximum_extracted_bytes {
            return Err(ResourceDownloadError::Archive(
                "压缩包展开大小超过安全上限".to_owned(),
            ));
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut output = File::create(&destination)?;
        io::copy(&mut entry, &mut output)?;
        output.sync_all()?;
    }
    Ok(())
}

fn safe_archive_relative_path(
    raw_name: &str,
    strip_components: u32,
) -> Result<Option<PathBuf>, ResourceDownloadError> {
    let path = Path::new(raw_name);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::Prefix(_) | Component::RootDir | Component::ParentDir
            )
        })
    {
        return Err(ResourceDownloadError::Archive(format!(
            "压缩包包含不安全路径：{raw_name}"
        )));
    }
    let components = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_owned()),
            Component::CurDir => None,
            _ => None,
        })
        .collect::<Vec<_>>();
    let strip = strip_components as usize;
    if components.len() <= strip {
        return Ok(None);
    }
    Ok(Some(components[strip..].iter().collect()))
}

fn verify_entrypoints(
    resource: &ResourceDefinition,
    staged_payload: &Path,
) -> Result<(), ResourceDownloadError> {
    for (name, relative) in effective_entrypoints(resource)? {
        let path = join_safe_relative(staged_payload, &relative)?;
        if !path.is_file() {
            return Err(ResourceDownloadError::Integrity(format!(
                "{} 缺少入口 {name}：{}",
                resource.id,
                path.display()
            )));
        }
    }
    Ok(())
}

pub(crate) fn run_health_check(
    resource: &ResourceDefinition,
    staged_payload: &Path,
) -> Result<(), ResourceDownloadError> {
    let entrypoints = effective_entrypoints(resource)?;
    match resource.health_check.as_str() {
        "ffmpeg-version" => {
            for (name, expected_marker) in
                [("ffmpeg", "ffmpeg version"), ("ffprobe", "ffprobe version")]
            {
                let relative = entrypoints.get(name).ok_or_else(|| {
                    ResourceDownloadError::HealthCheck(format!("缺少 {name} 入口"))
                })?;
                let output = hidden_command(&join_safe_relative(staged_payload, relative)?)
                    .arg("-version")
                    .output()
                    .map_err(|error| ResourceDownloadError::HealthCheck(error.to_string()))?;
                let text = format!(
                    "{}\n{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
                if !output.status.success() || !text.to_ascii_lowercase().contains(expected_marker)
                {
                    return Err(ResourceDownloadError::HealthCheck(format!(
                        "{} 未返回预期版本信息",
                        resource.id
                    )));
                }
            }
            let ffmpeg_relative = entrypoints
                .get("ffmpeg")
                .ok_or_else(|| ResourceDownloadError::HealthCheck("缺少 ffmpeg 入口".to_owned()))?;
            let output = hidden_command(&join_safe_relative(staged_payload, ffmpeg_relative)?)
                .args(["-hide_banner", "-encoders"])
                .output()
                .map_err(|error| ResourceDownloadError::HealthCheck(error.to_string()))?;
            let text = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            for encoder in ["libopenh264", "aac"] {
                if !output.status.success() || !encoder_list_contains(&text, encoder) {
                    return Err(ResourceDownloadError::HealthCheck(format!(
                        "{} 缺少所需编码器 {encoder}",
                        resource.id
                    )));
                }
            }
            Ok(())
        }
        "yt-dlp-version" => {
            let relative = entrypoints
                .get("ytDlp")
                .ok_or_else(|| ResourceDownloadError::HealthCheck("缺少 ytDlp 入口".to_owned()))?;
            let output = hidden_command(&join_safe_relative(staged_payload, relative)?)
                .arg("--version")
                .output()
                .map_err(|error| ResourceDownloadError::HealthCheck(error.to_string()))?;
            let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            if !output.status.success() || version != resource.version {
                return Err(ResourceDownloadError::HealthCheck(format!(
                    "{} 报告版本 {version}，预期为 {}",
                    resource.id, resource.version
                )));
            }
            Ok(())
        }
        "whisper-cli-version" => {
            let relative = entrypoints.get("whisperCli").ok_or_else(|| {
                ResourceDownloadError::HealthCheck("缺少 whisperCli 入口".to_owned())
            })?;
            let executable = join_safe_relative(staged_payload, relative)?;
            let output = hidden_command(&executable)
                .current_dir(executable.parent().unwrap_or(staged_payload))
                .arg("--version")
                .output()
                .map_err(|error| ResourceDownloadError::HealthCheck(error.to_string()))?;
            let text = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            if !output.status.success()
                || !text.contains(&format!("whisper.cpp version: {}", resource.version))
            {
                return Err(ResourceDownloadError::HealthCheck(format!(
                    "{} 未报告固定版本 {}",
                    resource.id, resource.version
                )));
            }
            Ok(())
        }
        "whisper-runtime-metadata-and-timeline" => {
            let backend = match resource.id.as_str() {
                "whisper-cpu" => "cpu",
                "whisper-vulkan" => "vulkan",
                _ => {
                    return Err(ResourceDownloadError::HealthCheck(format!(
                        "{} 不能使用字幕识别运行时检查",
                        resource.id
                    )));
                }
            };
            crate::transcription::verify_managed_runtime(backend, staged_payload)
                .map_err(|error| ResourceDownloadError::HealthCheck(error.to_string()))
        }
        "sha256" => Ok(()),
        other => Err(ResourceDownloadError::HealthCheck(format!(
            "{} 使用暂未实现的检查 {other}",
            resource.id
        ))),
    }
}

fn encoder_list_contains(value: &str, expected: &str) -> bool {
    value.lines().any(|line| {
        let mut fields = line.split_whitespace();
        fields.next().is_some() && fields.next() == Some(expected)
    })
}

pub(crate) fn verify_installed_payload(
    resource: &ResourceDefinition,
    payload: &Path,
    expected_manifest: Option<&[ReceiptFile]>,
) -> Result<Vec<ReceiptFile>, ResourceDownloadError> {
    if !payload.is_dir() {
        return Err(ResourceDownloadError::Integrity(format!(
            "{} 的候选安装目录不存在",
            resource.id
        )));
    }
    verify_entrypoints(resource, payload)?;
    let mut actual_manifest = collect_file_manifest(payload)?;
    if actual_manifest.is_empty() {
        return Err(ResourceDownloadError::Integrity(format!(
            "{} 的候选安装目录为空",
            resource.id
        )));
    }
    let actual_size = actual_manifest
        .iter()
        .fold(0_u64, |total, file| total.saturating_add(file.size));
    if let Some(expected_size) = resource.installed_size
        && actual_size != expected_size
    {
        return Err(ResourceDownloadError::Integrity(format!(
            "{} 安装后大小为 {actual_size}，预期为 {expected_size}",
            resource.id
        )));
    }
    if resource.kind == "archive" {
        let expected_manifest = expected_manifest.ok_or_else(|| {
            ResourceDownloadError::Integrity(format!(
                "{} 的已解压候选缺少可信文件清单",
                resource.id
            ))
        })?;
        let mut expected_manifest = expected_manifest.to_vec();
        expected_manifest.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        actual_manifest.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        if actual_manifest != expected_manifest {
            return Err(ResourceDownloadError::Integrity(format!(
                "{} 的文件清单或哈希不匹配",
                resource.id
            )));
        }
    } else if let Some(artifact) = resource.artifact.as_ref() {
        if artifact.format != "file" {
            return Err(ResourceDownloadError::Integrity(format!(
                "{} 的候选制品格式不可接管",
                resource.id
            )));
        }
        let relative = file_artifact_relative_path(resource, artifact)?;
        verify_downloaded_file(
            &join_safe_relative(payload, &relative)?,
            artifact.size,
            &artifact.sha256,
        )?;
    } else if resource.health_check != "whisper-runtime-metadata-and-timeline" {
        return Err(ResourceDownloadError::Integrity(format!(
            "{} 没有可用于接管的固定文件身份",
            resource.id
        )));
    }
    run_health_check(resource, payload)?;
    Ok(actual_manifest)
}

pub(crate) fn activate_staged_resource(
    root: &Path,
    resource: &ResourceDefinition,
    staged_payload: &Path,
    files: Vec<ReceiptFile>,
) -> Result<(), ResourceDownloadError> {
    let install_relative_path = install_relative_path(resource);
    let receipt = ResourceReceipt {
        schema_version: 1,
        resource_id: resource.id.clone(),
        version: resource.version.clone(),
        install_relative_path: install_relative_path.clone(),
        entrypoints: effective_entrypoints(resource)?,
        files,
        health_status: "passed".to_owned(),
        activated_at_ms: None,
    };
    local_resources::install_resource(root, staged_payload, receipt)?;
    Ok(())
}

pub(crate) fn effective_entrypoints(
    resource: &ResourceDefinition,
) -> Result<BTreeMap<String, String>, ResourceDownloadError> {
    if !resource.entrypoints.is_empty() {
        return Ok(resource.entrypoints.clone());
    }
    let artifact = resource
        .artifact
        .as_ref()
        .ok_or_else(|| ResourceDownloadError::ArtifactUnavailable(resource.id.clone()))?;
    let relative = file_artifact_relative_path(resource, artifact)?;
    let name = if resource.kind == "model" || resource.id.contains("vad") {
        "model"
    } else {
        "file"
    };
    Ok(BTreeMap::from([(name.to_owned(), relative)]))
}

fn file_artifact_relative_path(
    resource: &ResourceDefinition,
    artifact: &ResourceArtifact,
) -> Result<String, ResourceDownloadError> {
    if artifact.format != "file" {
        return Err(ResourceDownloadError::ArtifactUnavailable(format!(
            "{} 不是单文件制品",
            resource.id
        )));
    }
    if resource.entrypoints.len() == 1 {
        return Ok(resource
            .entrypoints
            .values()
            .next()
            .expect("single entrypoint should exist")
            .clone());
    }
    let url = Url::parse(&artifact.url)
        .map_err(|error| ResourceDownloadError::ArtifactUnavailable(error.to_string()))?;
    let name = url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| {
            ResourceDownloadError::ArtifactUnavailable(format!(
                "{} 的下载地址缺少文件名",
                resource.id
            ))
        })?;
    if Path::new(name).components().count() != 1 {
        return Err(ResourceDownloadError::Integrity(format!(
            "{} 的文件名不安全",
            resource.id
        )));
    }
    Ok(name.to_owned())
}

pub(crate) fn install_relative_path(resource: &ResourceDefinition) -> String {
    let category = if resource.kind == "model" {
        "models"
    } else {
        "packages"
    };
    format!("{category}/{}/{}", resource.id, resource.version)
}

pub(crate) fn collect_file_manifest(
    root: &Path,
) -> Result<Vec<ReceiptFile>, ResourceDownloadError> {
    let mut paths = Vec::new();
    collect_files(root, root, &mut paths)?;
    paths.sort();
    paths
        .into_iter()
        .map(|path| {
            let relative = path
                .strip_prefix(root)
                .map_err(|error| ResourceDownloadError::Integrity(error.to_string()))?
                .to_string_lossy()
                .replace('\\', "/");
            let (size, sha256) = file_digest(&path)?;
            Ok(ReceiptFile {
                relative_path: relative,
                size,
                sha256,
            })
        })
        .collect()
}

fn collect_files(
    root: &Path,
    directory: &Path,
    paths: &mut Vec<PathBuf>,
) -> Result<(), ResourceDownloadError> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            return Err(ResourceDownloadError::Integrity(format!(
                "资源包含符号链接：{}",
                path.display()
            )));
        }
        if file_type.is_dir() {
            collect_files(root, &path, paths)?;
        } else if file_type.is_file() {
            if !path.starts_with(root) {
                return Err(ResourceDownloadError::Integrity(
                    "资源文件超出安装目录".to_owned(),
                ));
            }
            paths.push(path);
        }
    }
    Ok(())
}

fn update_task(
    task_id: &str,
    app: Option<&AppHandle>,
    update: impl FnOnce(&mut ResourceDownloadTask) -> Result<(), ResourceDownloadError>,
) -> Result<ResourceDownloadTask, ResourceDownloadError> {
    let task = with_manager_write(|manager| manager.update_task_record(task_id, update))?;
    emit_task(app, &task);
    Ok(task)
}

fn task_snapshot(task_id: &str) -> Result<ResourceDownloadTask, ResourceDownloadError> {
    with_manager_read(|manager| {
        manager
            .tasks
            .get(task_id)
            .cloned()
            .ok_or_else(|| ResourceDownloadError::TaskNotFound(task_id.to_owned()))
    })
}

fn validate_task_record(task: &ResourceDownloadTask) -> Result<(), ResourceDownloadError> {
    Uuid::parse_str(&task.id)
        .map_err(|_| ResourceDownloadError::Integrity(format!("下载任务 ID 无效：{}", task.id)))?;
    let resource = local_resources::resource_definition(&task.resource_id)?;
    let artifact = resource
        .artifact
        .ok_or_else(|| ResourceDownloadError::ArtifactUnavailable(resource.id.clone()))?;
    if resource.version != task.version
        || task.total_bytes != artifact.size
        || task.downloaded_bytes > task.total_bytes
        || task
            .pending_action_ids
            .iter()
            .any(|pending_action_id| Uuid::parse_str(pending_action_id).is_err())
    {
        return Err(ResourceDownloadError::Integrity(format!(
            "下载任务 {} 与可信目录清单不一致",
            task.id
        )));
    }
    Ok(())
}

fn configured_available_root() -> Result<PathBuf, ResourceDownloadError> {
    let root = local_resources::configured_root().ok_or(ResourceDownloadError::LocalResource(
        LocalResourceError::ConfirmationRequired,
    ))?;
    if !root.is_dir() {
        return Err(LocalResourceError::RootUnavailable(root.display().to_string()).into());
    }
    Ok(root)
}

fn affected_capabilities(resource_id: &str) -> Result<Vec<String>, ResourceDownloadError> {
    let catalog = local_resources::catalog()?;
    let mut affected = Vec::new();
    for capability in &catalog.capabilities {
        if local_resources::required_resource_ids(&capability.id)?
            .iter()
            .any(|value| value == resource_id)
        {
            affected.push(capability.id.clone());
        }
    }
    affected.sort();
    Ok(affected)
}

fn required_working_space(resource: &ResourceDefinition, existing_bytes: u64) -> u64 {
    let Some(artifact) = resource.artifact.as_ref() else {
        return 0;
    };
    let remaining = artifact.size.saturating_sub(existing_bytes);
    match artifact.format.as_str() {
        "zip" => remaining
            .saturating_add(artifact.size.saturating_mul(6))
            .saturating_add(ARCHIVE_INSTALL_MARGIN_BYTES),
        _ => remaining
            .saturating_add(artifact.size)
            .saturating_add(FILE_INSTALL_MARGIN_BYTES),
    }
}

fn ensure_available_space(
    available: Option<u64>,
    required: u64,
) -> Result<(), ResourceDownloadError> {
    if let Some(available) = available
        && available < required
    {
        return Err(ResourceDownloadError::InsufficientSpace {
            required_bytes: required,
            available_bytes: available,
        });
    }
    Ok(())
}

pub(crate) fn file_digest(path: &Path) -> Result<(u64, String), ResourceDownloadError> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut size = 0_u64;
    // Keep the large hashing buffer off the Windows thread stack. Release
    // executables reserve roughly one MiB by default, so a one-MiB stack array
    // can overflow before the first read when a migration plan hashes files.
    let mut buffer = vec![0_u8; FILE_DIGEST_BUFFER_BYTES];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        size = size.saturating_add(count as u64);
        hasher.update(&buffer[..count]);
    }
    Ok((size, format!("{:x}", hasher.finalize())))
}

pub(crate) fn join_safe_relative(
    root: &Path,
    relative: &str,
) -> Result<PathBuf, ResourceDownloadError> {
    let path = Path::new(relative);
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || !path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err(ResourceDownloadError::Integrity(format!(
            "不安全的资源相对路径：{relative}"
        )));
    }
    Ok(root.join(path))
}

fn remove_file_if_exists(path: &Path) -> Result<(), ResourceDownloadError> {
    if path.is_file() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn remove_directory_if_exists(path: &Path) -> Result<(), ResourceDownloadError> {
    if path.is_dir() {
        fs::remove_dir_all(path)?;
    }
    Ok(())
}

fn persist_json_atomic(path: &Path, value: &impl Serialize) -> Result<(), ResourceDownloadError> {
    let parent = path
        .parent()
        .ok_or_else(|| ResourceDownloadError::FileSystem(io::Error::other("任务文件没有父目录")))?;
    fs::create_dir_all(parent)?;
    let part_path = path.with_extension("json.part");
    let backup_path = path.with_extension("json.bak");
    let mut file = File::create(&part_path)?;
    serde_json::to_writer_pretty(&mut file, value)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    if path.exists() {
        remove_file_if_exists(&backup_path)?;
        fs::rename(path, &backup_path)?;
    }
    if let Err(error) = fs::rename(&part_path, path) {
        if backup_path.exists() {
            let _ = fs::rename(&backup_path, path);
        }
        return Err(error.into());
    }
    remove_file_if_exists(&backup_path)?;
    Ok(())
}

fn should_discard_partial(error: &ResourceDownloadError) -> bool {
    matches!(
        error,
        ResourceDownloadError::Integrity(_)
            | ResourceDownloadError::Archive(_)
            | ResourceDownloadError::HealthCheck(_)
    )
}

fn classify_request_error(error: reqwest::Error) -> ResourceDownloadError {
    if error.is_timeout() {
        ResourceDownloadError::NetworkTimeout
    } else if error.is_connect() {
        ResourceDownloadError::NetworkConnect
    } else {
        ResourceDownloadError::Network("下载请求未完成；已保留下载进度".to_owned())
    }
}

fn hidden_command(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

fn emit_task(app: Option<&AppHandle>, task: &ResourceDownloadTask) {
    #[cfg(not(test))]
    if let Some(app) = app {
        let _ = app.emit(TASK_EVENT_NAME, task);
    }
    #[cfg(test)]
    let _ = (app, task);
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

#[cfg(windows)]
fn available_space(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let wide = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut available = 0_u64;
    let result = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    (result != 0).then_some(available)
}

#[cfg(not(windows))]
fn available_space(_path: &Path) -> Option<u64> {
    None
}

#[cfg(test)]
#[path = "resource_download_retry_tests.rs"]
mod retry_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        net::TcpListener,
        sync::{Arc, Mutex},
        time::Instant,
    };
    use tempfile::tempdir;
    use zip::{ZipWriter, write::SimpleFileOptions};

    #[test]
    fn network_errors_have_actionable_stable_codes() {
        assert_eq!(
            ResourceDownloadError::NetworkTimeout.code(),
            "local_resource_download_timeout"
        );
        assert_eq!(
            ResourceDownloadError::NetworkConnect.code(),
            "local_resource_download_connection_failed"
        );
        assert_eq!(
            ResourceDownloadError::HttpStatus(403).code(),
            "local_resource_download_http_failed"
        );
    }

    struct TestServer {
        url: String,
        requests: Arc<Mutex<Vec<String>>>,
        thread: Option<thread::JoinHandle<()>>,
    }

    impl TestServer {
        fn once(body: Vec<u8>, honor_range: bool) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("test listener should bind");
            let address = listener.local_addr().expect("listener should have address");
            let requests = Arc::new(Mutex::new(Vec::new()));
            let request_log = Arc::clone(&requests);
            let server_thread = thread::spawn(move || {
                let (mut stream, _) = listener.accept().expect("request should arrive");
                let mut request = Vec::new();
                let mut buffer = [0_u8; 1024];
                loop {
                    let count = stream.read(&mut buffer).expect("request should read");
                    if count == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..count]);
                    if request.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&request).into_owned();
                request_log
                    .lock()
                    .expect("request log should lock")
                    .push(request.clone());
                let range_start = request.lines().find_map(|line| {
                    line.strip_prefix("Range: bytes=")
                        .or_else(|| line.strip_prefix("range: bytes="))
                        .and_then(|value| value.trim_end_matches('-').parse::<usize>().ok())
                });
                let (status, response_body, extra_headers) =
                    if let (true, Some(start)) = (honor_range, range_start) {
                        (
                            "206 Partial Content",
                            body[start..].to_vec(),
                            format!(
                                "Content-Range: bytes {start}-{}/{}\r\n",
                                body.len() - 1,
                                body.len()
                            ),
                        )
                    } else {
                        ("200 OK", body.clone(), String::new())
                    };
                let headers = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\n{extra_headers}Connection: close\r\n\r\n",
                    response_body.len()
                );
                stream
                    .write_all(headers.as_bytes())
                    .expect("headers should write");
                stream.write_all(&response_body).expect("body should write");
            });
            Self {
                url: format!("http://{address}/fixture.bin"),
                requests,
                thread: Some(server_thread),
            }
        }

        fn finish(mut self) -> Vec<String> {
            self.thread
                .take()
                .expect("server thread should exist")
                .join()
                .expect("server should finish");
            self.requests
                .lock()
                .expect("request log should lock")
                .clone()
        }
    }

    fn artifact(url: String, body: &[u8]) -> ResourceArtifact {
        ResourceArtifact {
            url,
            size: body.len() as u64,
            sha256: format!("{:x}", Sha256::digest(body)),
            format: "file".to_owned(),
            strip_components: None,
        }
    }

    #[test]
    fn file_digest_runs_on_a_small_thread_stack() {
        let directory = tempdir().expect("digest directory");
        let path = directory.path().join("fixture.bin");
        let body = b"small-stack digest fixture";
        fs::write(&path, body).expect("digest fixture should write");

        let result = thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(move || file_digest(&path))
            .expect("digest thread should start")
            .join()
            .expect("digest thread should not overflow")
            .expect("digest should succeed");

        assert_eq!(result.0, body.len() as u64);
        assert_eq!(result.1, format!("{:x}", Sha256::digest(body)));
    }

    #[test]
    fn range_server_resumes_an_existing_partial_download() {
        let body = b"0123456789abcdef";
        let server = TestServer::once(body.to_vec(), true);
        let directory = tempdir().expect("download directory");
        let path = directory.path().join("fixture.part");
        fs::write(&path, &body[..6]).expect("partial should write");
        let outcome = download_artifact(
            &Client::new(),
            &artifact(server.url.clone(), body),
            &path,
            &DownloadControl::default(),
            |_| Ok(()),
        )
        .expect("download should resume");
        assert_eq!(outcome, DownloadOutcome::Complete);
        assert_eq!(fs::read(path).expect("download should read"), body);
        let requests = server.finish();
        assert!(requests[0].to_ascii_lowercase().contains("range: bytes=6-"));
    }

    #[test]
    fn pause_cancel_and_continue_preserve_expected_partial_state() {
        let body = b"pause and continue fixture";
        let directory = tempdir().expect("download directory");
        let path = directory.path().join("fixture.part");
        fs::write(&path, &body[..5]).expect("partial should write");

        let pause_control = DownloadControl::default();
        pause_control.pause_requested.store(true, Ordering::Release);
        let outcome = download_artifact(
            &Client::new(),
            &artifact("http://127.0.0.1:9/unused".to_owned(), body),
            &path,
            &pause_control,
            |_| Ok(()),
        )
        .expect("download should pause");
        assert_eq!(outcome, DownloadOutcome::Paused);
        assert_eq!(fs::read(&path).expect("partial should read"), &body[..5]);

        let resume_server = TestServer::once(body.to_vec(), true);
        let outcome = download_artifact(
            &Client::new(),
            &artifact(resume_server.url.clone(), body),
            &path,
            &DownloadControl::default(),
            |_| Ok(()),
        )
        .expect("download should continue");
        assert_eq!(outcome, DownloadOutcome::Complete);
        resume_server.finish();
        assert_eq!(fs::read(&path).expect("download should read"), body);

        fs::write(&path, &body[..4]).expect("cancel partial should write");
        let cancel_control = DownloadControl::default();
        cancel_control
            .cancel_requested
            .store(true, Ordering::Release);
        let outcome = download_artifact(
            &Client::new(),
            &artifact("http://127.0.0.1:9/unused".to_owned(), body),
            &path,
            &cancel_control,
            |_| Ok(()),
        )
        .expect("download should cancel");
        assert_eq!(outcome, DownloadOutcome::Cancelled);
        assert_eq!(fs::read(path).expect("partial should remain"), &body[..4]);
    }

    #[test]
    fn non_range_server_restarts_without_duplicating_partial_bytes() {
        let body = b"range fallback fixture";
        let server = TestServer::once(body.to_vec(), false);
        let directory = tempdir().expect("download directory");
        let path = directory.path().join("fixture.part");
        fs::write(&path, &body[..5]).expect("partial should write");
        download_artifact(
            &Client::new(),
            &artifact(server.url.clone(), body),
            &path,
            &DownloadControl::default(),
            |_| Ok(()),
        )
        .expect("download should restart");
        assert_eq!(fs::read(path).expect("download should read"), body);
        let requests = server.finish();
        assert!(requests[0].to_ascii_lowercase().contains("range: bytes=5-"));
    }

    #[test]
    fn hash_mismatch_is_rejected_before_installation() {
        let directory = tempdir().expect("download directory");
        let path = directory.path().join("fixture.bin");
        fs::write(&path, b"changed").expect("fixture should write");
        let error =
            verify_downloaded_file(&path, 7, &"0".repeat(64)).expect_err("hash should be rejected");
        assert!(matches!(error, ResourceDownloadError::Integrity(_)));
    }

    #[test]
    fn missing_entrypoint_and_unknown_health_check_cannot_activate() {
        let directory = tempdir().expect("staging directory");
        let ffmpeg = local_resources::resource_definition("ffmpeg-cpu")
            .expect("FFmpeg resource should exist");
        let error = verify_entrypoints(&ffmpeg, directory.path())
            .expect_err("missing entrypoints should fail");
        assert!(matches!(error, ResourceDownloadError::Integrity(_)));

        let mut yt_dlp =
            local_resources::resource_definition("yt-dlp").expect("yt-dlp resource should exist");
        fs::write(directory.path().join("yt-dlp.exe"), b"fixture")
            .expect("fixture entrypoint should write");
        yt_dlp.health_check = "unsupported-test-check".to_owned();
        let error = run_health_check(&yt_dlp, directory.path())
            .expect_err("unknown health check should fail");
        assert!(matches!(error, ResourceDownloadError::HealthCheck(_)));
    }

    #[test]
    fn encoder_list_parser_requires_an_exact_encoder_name() {
        let fixture = " V..... libopenh264 OpenH264 H.264 encoder\n A..... aac AAC encoder";

        assert!(encoder_list_contains(fixture, "libopenh264"));
        assert!(encoder_list_contains(fixture, "aac"));
        assert!(!encoder_list_contains(fixture, "openh264"));
        assert!(!encoder_list_contains(fixture, "libx264"));
    }

    #[test]
    #[ignore = "requires SIAOVPLAY_FFMPEG_PAYLOAD"]
    fn managed_ffmpeg_payload_has_required_encoders() {
        let payload = std::env::var_os("SIAOVPLAY_FFMPEG_PAYLOAD")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_FFMPEG_PAYLOAD must be set");
        let resource = local_resources::resource_definition("ffmpeg-cpu")
            .expect("FFmpeg resource should exist");

        run_health_check(&resource, &payload).expect("FFmpeg health check should pass");
    }

    #[test]
    fn zip_parent_traversal_is_rejected() {
        let directory = tempdir().expect("archive directory");
        let archive_path = directory.path().join("unsafe.zip");
        let file = File::create(&archive_path).expect("archive should create");
        let mut writer = ZipWriter::new(file);
        writer
            .start_file("../outside.exe", SimpleFileOptions::default())
            .expect("entry should start");
        writer.write_all(b"unsafe").expect("entry should write");
        writer.finish().expect("archive should finish");
        let destination = directory.path().join("payload");
        let error = extract_zip(&archive_path, &destination, 0, 1024)
            .expect_err("unsafe archive should fail");
        assert!(matches!(error, ResourceDownloadError::Archive(_)));
        assert!(!directory.path().join("outside.exe").exists());
    }

    #[test]
    fn insufficient_space_is_reported_before_download() {
        let error =
            ensure_available_space(Some(1024), 2048).expect_err("insufficient space should fail");
        assert!(matches!(
            error,
            ResourceDownloadError::InsufficientSpace {
                required_bytes: 2048,
                available_bytes: 1024
            }
        ));
    }

    #[test]
    fn pending_action_id_must_be_a_uuid_before_a_task_is_created() {
        let error = prepare_capability("basic_media", Some("../not-an-id"), None)
            .expect_err("invalid pending action should fail before task creation");
        assert!(matches!(
            error,
            ResourceDownloadError::InvalidPendingAction(_)
        ));
    }

    #[test]
    fn interrupted_tasks_are_recovered_as_paused() {
        let root = tempdir().expect("resource root");
        fs::create_dir_all(root.path().join("state")).expect("state directory should create");
        let timestamp = now_ms();
        let task_id = "00000000-0000-4000-8000-000000000001";
        let resource = local_resources::resource_definition("ffmpeg-cpu")
            .expect("catalog resource should exist");
        let version = resource.version.clone();
        let total_bytes = resource
            .artifact
            .expect("FFmpeg should have an artifact")
            .size;
        let task = ResourceDownloadTask {
            generation: 0, revision: 0,
            id: task_id.to_owned(),
            resource_id: "ffmpeg-cpu".to_owned(),
            version,
            state: ResourceDownloadTaskState::Downloading,
            downloaded_bytes: 10,
            total_bytes,
            requested_by_capability_ids: vec!["basic_media".to_owned()],
            pending_action_ids: Vec::new(),
            attempt: 1,
            error_code: None,
            error_message: None,
            created_at_ms: timestamp,
            updated_at_ms: timestamp,
            force_reinstall: false,
        };
        persist_json_atomic(
            &root.path().join("state").join(TASK_STORE_FILE_NAME),
            &DownloadTaskStore {
                schema_version: TASK_STORE_SCHEMA_VERSION,
                tasks: vec![task],
            },
        )
        .expect("task store should persist");
        let manager = DownloadManager::load(Some(root.path().to_path_buf()))
            .expect("task store should recover");
        let recovered = manager.tasks.get(task_id).expect("task should remain");
        assert_eq!(recovered.state, ResourceDownloadTaskState::Paused);
        assert_eq!(recovered.error_code.as_deref(), Some("interrupted"));
    }

    #[test]
    fn tampered_task_identifiers_are_discarded_before_path_resolution() {
        let root = tempdir().expect("resource root");
        fs::create_dir_all(root.path().join("state")).expect("state directory should create");
        let total_bytes = local_resources::resource_definition("ffmpeg-cpu")
            .expect("catalog resource should exist")
            .artifact
            .expect("FFmpeg should have an artifact")
            .size;
        let timestamp = now_ms();
        persist_json_atomic(
            &root.path().join("state").join(TASK_STORE_FILE_NAME),
            &DownloadTaskStore {
                schema_version: TASK_STORE_SCHEMA_VERSION,
                tasks: vec![ResourceDownloadTask {
                    generation: 0, revision: 0,
                    id: "../outside".to_owned(),
                    resource_id: "ffmpeg-cpu".to_owned(),
                    version: "8.1".to_owned(),
                    state: ResourceDownloadTaskState::Paused,
                    downloaded_bytes: 0,
                    total_bytes,
                    requested_by_capability_ids: vec!["basic_media".to_owned()],
                    pending_action_ids: Vec::new(),
                    attempt: 1,
                    error_code: None,
                    error_message: None,
                    created_at_ms: timestamp,
                    updated_at_ms: timestamp,
                    force_reinstall: false,
                }],
            },
        )
        .expect("tampered task store should persist");
        let manager = DownloadManager::load(Some(root.path().to_path_buf()))
            .expect("manager should ignore tampered task");
        assert!(manager.tasks.is_empty());
        assert!(!root.path().join("outside.part").exists());
    }

    #[test]
    fn shared_ffmpeg_dependency_uses_one_task_record() {
        let root = tempdir().expect("resource root");
        fs::create_dir_all(root.path().join("state")).expect("state directory should create");
        let resource = local_resources::resource_definition("ffmpeg-cpu")
            .expect("catalog resource should exist");
        let mut manager = DownloadManager {
            binding_error: None,
            generation: 1,
            root: Some(root.path().to_path_buf()),
            tasks: BTreeMap::new(),
        };
        let (first, first_created) = manager
            .ensure_task_record(
                &resource,
                "basic_media",
                Some("00000000-0000-4000-8000-000000000010"),
                false,
            )
            .expect("first task should create");
        let (second, second_created) = manager
            .ensure_task_record(
                &resource,
                "url_import",
                Some("00000000-0000-4000-8000-000000000011"),
                false,
            )
            .expect("second request should reuse");
        assert!(first_created);
        assert!(!second_created);
        assert_eq!(first, second);
        assert_eq!(manager.tasks.len(), 1);
        assert_eq!(
            manager.tasks[&first].requested_by_capability_ids,
            vec!["basic_media".to_owned(), "url_import".to_owned()]
        );
        assert_eq!(
            manager.tasks[&first].pending_action_ids,
            vec![
                "00000000-0000-4000-8000-000000000010".to_owned(),
                "00000000-0000-4000-8000-000000000011".to_owned(),
            ]
        );
    }

    #[test]
    #[ignore = "downloads the pinned FFmpeg and yt-dlp artifacts into an explicit W: evidence root"]
    fn real_basic_media_and_url_import_prepare_from_clean_root() {
        let evidence_root = std::env::var_os("SIAOVPLAY_PHASE3_REAL_ROOT")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_PHASE3_REAL_ROOT is required");
        let data_directory = evidence_root.join("app-data");
        let resource_parent = evidence_root.join("resource-parent");
        fs::create_dir_all(&data_directory).expect("data directory should create");
        fs::create_dir_all(&resource_parent).expect("resource parent should create");
        local_resources::initialize(&data_directory).expect("local resources should initialize");
        local_resources::configure_location(
            resource_parent
                .to_str()
                .expect("resource path should be UTF-8"),
            true,
        )
        .expect("resource root should configure");
        initialize().expect("download manager should initialize");
        resume_failed_tasks(
            prepare_capability("basic_media", None, None).expect("basic media should start"),
        );
        wait_for_capability("basic_media", Duration::from_secs(900));
        resume_failed_tasks(
            prepare_capability("url_import", None, None).expect("URL import should start"),
        );
        wait_for_capability("url_import", Duration::from_secs(900));
        let status = local_resources::status().expect("resource status should resolve");
        assert!(
            status
                .capabilities
                .iter()
                .find(|capability| capability.id == "basic_media")
                .is_some_and(|capability| {
                    capability.state == local_resources::LocalResourceCapabilityState::Ready
                })
        );
        assert!(
            status
                .capabilities
                .iter()
                .find(|capability| capability.id == "url_import")
                .is_some_and(|capability| {
                    capability.state == local_resources::LocalResourceCapabilityState::Ready
                })
        );
        let yt_dlp_path = local_resources::resolve_entrypoint("yt-dlp", "ytDlp")
            .expect("yt-dlp entrypoint should resolve");
        fs::write(&yt_dlp_path, b"damaged fixture").expect("fixture should be damaged");
        let repair = repair_resource("yt-dlp", None).expect("repair should start");
        wait_for_task(&repair.id, Duration::from_secs(900));
        let yt_dlp = local_resources::resource_definition("yt-dlp")
            .expect("yt-dlp catalog entry should exist");
        let artifact = yt_dlp.artifact.expect("yt-dlp should have an artifact");
        verify_downloaded_file(&yt_dlp_path, artifact.size, &artifact.sha256)
            .expect("repair should restore the pinned executable");
        assert!(matches!(
            remove_resource("yt-dlp", false),
            Err(ResourceDownloadError::RemovalConfirmationRequired)
        ));
        let removal = remove_resource("yt-dlp", true).expect("confirmed removal should succeed");
        assert!(removal.removed);
        assert!(local_resources::resolve_entrypoint("yt-dlp", "ytDlp").is_none());
        resume_failed_tasks(
            prepare_capability("url_import", None, None)
                .expect("URL import reinstall should start"),
        );
        wait_for_capability("url_import", Duration::from_secs(900));
        let status = local_resources::status().expect("final resource status should resolve");
        let media_runtime = crate::media::media_runtime_status();
        assert!(media_runtime.available);
        let business_yt_dlp = crate::youtube_media::yt_dlp_path_for_status()
            .expect("URL import should resolve the active managed entrypoint");
        let evidence = serde_json::json!({
            "status": status,
            "tasks": list_tasks().expect("tasks should list"),
            "confirmedRemoval": removal,
            "mediaRuntime": media_runtime,
            "businessYtDlp": business_yt_dlp,
            "ffmpeg": local_resources::resolve_entrypoint("ffmpeg-cpu", "ffmpeg"),
            "ffprobe": local_resources::resolve_entrypoint("ffmpeg-cpu", "ffprobe"),
            "ytDlp": local_resources::resolve_entrypoint("yt-dlp", "ytDlp"),
        });
        fs::write(
            evidence_root.join("phase3-real-resource-evidence.json"),
            serde_json::to_vec_pretty(&evidence).expect("evidence should serialize"),
        )
        .expect("evidence should write");
    }

    #[test]
    #[ignore = "downloads and verifies the official Whisper archive into an explicit W: evidence root"]
    fn real_official_whisper_archive_downloads_through_effective_proxy() {
        let evidence_root = std::env::var_os("SIAOVPLAY_PROXY_DOWNLOAD_ROOT")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_PROXY_DOWNLOAD_ROOT is required");
        fs::create_dir_all(&evidence_root).expect("evidence root should create");
        ai::network::initialize(&evidence_root.join("network-settings"), None,
            crate::storage::StorageManager::initialize(&evidence_root, evidence_root.clone(), None).unwrap())
            .expect("isolated network settings should initialize");
        let resource = local_resources::resource_definition("whisper-cpu")
            .expect("Whisper CPU resource should exist");
        let artifact = resource
            .artifact
            .as_ref()
            .expect("Whisper CPU artifact should exist");
        let partial_path = evidence_root.join("whisper-cpu.zip");
        let staging_path = evidence_root.join("staging");
        remove_directory_if_exists(&staging_path).expect("old staging should be removable");
        let client = build_download_client().expect("download client should build");
        let outcome = download_artifact(
            &client,
            artifact,
            &partial_path,
            &DownloadControl::default(),
            |_| Ok(()),
        )
        .expect("official Whisper archive should download");
        assert_eq!(outcome, DownloadOutcome::Complete);
        verify_downloaded_file(&partial_path, artifact.size, &artifact.sha256)
            .expect("official Whisper archive should match the catalog");
        let payload = staging_path.join("payload");
        fs::create_dir_all(&payload).expect("payload directory should create");
        install_to_staging(&resource, artifact, &partial_path, &payload)
            .expect("official Whisper archive should extract");
        verify_entrypoints(&resource, &payload).expect("Whisper entrypoint should exist");
        run_health_check(&resource, &payload).expect("Whisper version should match the catalog");
        fs::write(
            evidence_root.join("proxy-download-evidence.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "network": network_status().expect("network status should read"),
                "resourceId": resource.id,
                "version": resource.version,
                "artifactSize": artifact.size,
                "artifactSha256": artifact.sha256,
                "healthCheck": resource.health_check,
            }))
            .expect("evidence should serialize"),
        )
        .expect("evidence should write");
    }

    fn resume_failed_tasks(preparation: CapabilityPreparation) {
        for task_id in preparation.task_ids {
            let task = task_snapshot(&task_id).expect("prepared task should exist");
            if task.state == ResourceDownloadTaskState::Failed {
                retry_task(&task_id, None).expect("failed task should retry");
            } else if task.state == ResourceDownloadTaskState::Paused {
                resume_task(&task_id, None).expect("paused task should continue");
            }
        }
    }

    fn wait_for_task(task_id: &str, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        loop {
            let task = task_snapshot(task_id).expect("task should remain available");
            match task.state {
                ResourceDownloadTaskState::Completed => return,
                ResourceDownloadTaskState::Failed => panic!("resource task failed: {task:?}"),
                ResourceDownloadTaskState::Cancelled => {
                    panic!("resource task was cancelled: {task:?}")
                }
                _ => {}
            }
            assert!(Instant::now() < deadline, "resource task timed out");
            thread::sleep(Duration::from_millis(250));
        }
    }

    fn wait_for_capability(capability_id: &str, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        loop {
            let status = local_resources::status().expect("status should resolve");
            let capability = status
                .capabilities
                .iter()
                .find(|capability| capability.id == capability_id)
                .expect("capability should exist");
            if capability.state == local_resources::LocalResourceCapabilityState::Ready {
                return;
            }
            let failed = list_tasks()
                .expect("tasks should list")
                .into_iter()
                .find(|task| {
                    task.requested_by_capability_ids
                        .iter()
                        .any(|value| value == capability_id)
                        && task.state == ResourceDownloadTaskState::Failed
                });
            if let Some(task) = failed {
                panic!("resource task failed: {task:?}");
            }
            assert!(Instant::now() < deadline, "resource preparation timed out");
            thread::sleep(Duration::from_millis(250));
        }
    }
}

#[cfg(test)]
mod activation_preflight_tests {
    use super::*;
    #[test]
    fn invalid_entrypoint_definition_preserves_both_old_and_staged_payloads() {
        let root = tempfile::tempdir().unwrap();
        let mut resource = local_resources::resource_definition("ffmpeg-cpu").unwrap();
        resource.entrypoints.clear(); resource.artifact = None;
        let destination = root.path().join(install_relative_path(&resource));
        let staged = root.path().join("staging/test/payload");
        fs::create_dir_all(&destination).unwrap(); fs::write(destination.join("old"), b"old").unwrap();
        fs::create_dir_all(&staged).unwrap(); fs::write(staged.join("new"), b"new").unwrap();
        assert!(activate_staged_resource(root.path(), &resource, &staged, Vec::new()).is_err());
        assert_eq!(fs::read(destination.join("old")).unwrap(), b"old");
        assert_eq!(fs::read(staged.join("new")).unwrap(), b"new");
    }
}
