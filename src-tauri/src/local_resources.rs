mod activation;
mod removal;
#[cfg(test)]
mod recovery_tests;
mod persistence;
use persistence::persist_json;
#[cfg(test)]
mod persistence_tests;
mod status_contract;
pub use status_contract::{LocalResourceRootState, LocalResourceCapabilityState, LocalResourceCapabilityStatus, LocalResourceStatus};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{self, Write},
    path::{Component, Path, PathBuf},
    sync::{OnceLock, RwLock},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

const CONFIG_FILE_NAME: &str = "local-resources.json";
const RESOURCE_DIRECTORY_NAME: &str = "SiaoVPlay";
const CONFIG_SCHEMA_VERSION: u32 = 1;
const RECEIPT_SCHEMA_VERSION: u32 = 1;
const DEFAULT_PROFILE: &str = "standard";
const CATALOG_JSON: &str = include_str!("../resources/local-resource-catalog.json");
const RESOURCE_SUBDIRECTORIES: [&str; 6] = [
    "packages",
    "models",
    "downloads",
    "staging",
    "receipts",
    "state",
];

#[derive(Debug, Error)]
pub enum LocalResourceError {
    #[error("本地资源管理器尚未初始化")]
    NotInitialized,
    #[error("需要先确认资源存储目录")]
    ConfirmationRequired,
    #[error("资源存储父目录无效：{0}")]
    InvalidParent(String),
    #[error("资源目录当前不可用：{0}")]
    RootUnavailable(String),
    #[error("本地资源尚未准备完成：{0}")]
    ResourceNotReady(String),
    #[error("未找到对应能力：{0}")]
    UnknownCapability(String),
    #[error("未找到对应字幕识别方式：{0}")]
    UnknownProfile(String),
    #[error("未找到对应资源：{0}")]
    UnknownResource(String),
    #[error("代理地址无效：{0}")]
    InvalidProxy(String),
    #[error("可信资源清单无效：{0}")]
    InvalidCatalog(String),
    #[error("资源安装凭据无效：{0}")]
    InvalidReceipt(String),
    #[error("本地资源文件操作失败：{0}")]
    FileSystem(#[from] io::Error),
    #[error("本地资源配置序列化失败：{0}")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalResourceCatalog {
    pub schema_version: u32,
    pub product_id: String,
    pub updated_at: String,
    pub package_profile: String,
    pub bundle_policy: BundlePolicy,
    pub capabilities: Vec<CapabilityDefinition>,
    pub profiles: Vec<ProfileDefinition>,
    pub resources: Vec<ResourceDefinition>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundlePolicy {
    pub maximum_exception_bytes: u64,
    pub allowlisted_resource_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDefinition {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub resource_ids: Vec<String>,
    #[serde(default)]
    pub profile_ids: Vec<String>,
    #[serde(default)]
    pub requires_capability_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDefinition {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub resource_ids: Vec<String>,
    pub recommended: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDefinition {
    pub id: String,
    pub version: String,
    pub platform: String,
    pub kind: String,
    pub bundled: bool,
    #[serde(default)]
    pub installed_size: Option<u64>,
    #[serde(default)]
    pub expected_download_size: Option<u64>,
    pub license: String,
    pub source_page: String,
    #[serde(default)]
    pub artifact: Option<ResourceArtifact>,
    #[serde(default)]
    pub entrypoints: BTreeMap<String, String>,
    pub health_check: String,
    #[serde(default)]
    pub source_commit: Option<String>,
    #[serde(default)]
    pub patch_sha256: Option<String>,
    #[serde(default)]
    pub requires: Option<String>,
    #[serde(default)]
    pub distribution: Option<ResourceDistribution>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceArtifact {
    pub url: String,
    pub size: u64,
    pub sha256: String,
    pub format: String,
    #[serde(default)]
    pub strip_components: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDistribution {
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalResourceConfiguration {
    pub schema_version: u32,
    pub selected_parent: String,
    pub resource_root: String,
    pub preferred_profile: String,
    #[serde(default)]
    pub active_resources: BTreeMap<String, String>,
    #[serde(default)]
    pub legacy_candidate_roots: Vec<String>,
    #[serde(default)]
    pub proxy_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanLocalResourceLocationInput {
    pub parent_path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureLocalResourceRootInput {
    pub parent_path: String,
    pub confirmed: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetLocalResourceProfileInput {
    pub profile_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetLocalResourceProxyInput {
    #[serde(default)]
    pub proxy_url: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalResourceLocationPlan {
    pub selected_parent: String,
    pub resource_root: String,
    pub parent_exists: bool,
    pub resource_root_exists: bool,
    pub free_space_bytes: Option<u64>,
    pub confirmation_required: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceReceipt {
    pub schema_version: u32,
    pub resource_id: String,
    pub version: String,
    pub install_relative_path: String,
    #[serde(default)]
    pub entrypoints: BTreeMap<String, String>,
    #[serde(default)]
    pub files: Vec<ReceiptFile>,
    pub health_status: String,
    #[serde(default)]
    pub activated_at_ms: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptFile {
    pub relative_path: String,
    pub size: u64,
    pub sha256: String,
}

struct LocalResourceManager {
    config_path: PathBuf,
    configuration: Option<LocalResourceConfiguration>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyRuntimeSettingsFile {
    storage_root: Option<String>,
    preferred_model: Option<String>,
}

struct LegacyRuntimeSettings {
    storage_root: Option<PathBuf>,
    preferred_model: Option<String>,
}

static MANAGER: OnceLock<RwLock<LocalResourceManager>> = OnceLock::new();
static CATALOG: OnceLock<Result<LocalResourceCatalog, String>> = OnceLock::new();

pub fn initialize(data_directory: &Path) -> Result<(), LocalResourceError> {
    validate_catalog(catalog()?)?;
    let manager = LocalResourceManager::load(data_directory)?;
    let state = MANAGER.get_or_init(|| RwLock::new(manager));
    let mut state = state
        .write()
        .map_err(|_| io::Error::other("本地资源设置锁不可用"))?;
    *state = LocalResourceManager::load(data_directory)?;
    Ok(())
}

pub fn catalog() -> Result<&'static LocalResourceCatalog, LocalResourceError> {
    CATALOG
        .get_or_init(|| {
            serde_json::from_str::<LocalResourceCatalog>(CATALOG_JSON)
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(|message| LocalResourceError::InvalidCatalog(message.clone()))
}

pub fn status() -> Result<LocalResourceStatus, LocalResourceError> {
    with_manager_read(LocalResourceManager::status)
}

pub fn plan_location(parent: &str) -> Result<LocalResourceLocationPlan, LocalResourceError> {
    with_manager_read(|manager| manager.plan_location(parent))
}

pub fn configure_location(
    parent: &str,
    confirmed: bool,
) -> Result<LocalResourceStatus, LocalResourceError> {
    let _maintenance = crate::resource_leases::maintain_all()?;
    with_manager_write(|manager| manager.configure_location(parent, confirmed))
}

pub fn repair_configured_root(confirmed: bool) -> Result<LocalResourceStatus, LocalResourceError> {
    let _maintenance = crate::resource_leases::maintain_all()?;
    with_manager_write(|manager| manager.repair_configured_root(confirmed))
}

pub fn set_preferred_profile(profile_id: &str) -> Result<LocalResourceStatus, LocalResourceError> {
    let _maintenance = crate::resource_leases::maintain_policy()?;
    with_manager_write(|manager| manager.set_preferred_profile(profile_id))
}

pub fn configured_root() -> Option<PathBuf> {
    MANAGER
        .get()
        .and_then(|state| state.read().ok())
        .and_then(|manager| manager.configuration.as_ref().map(configuration_root))
}

pub(crate) fn configured_proxy_url() -> Option<String> {
    configuration_snapshot().and_then(|configuration| configuration.proxy_url)
}

pub fn resolve_entrypoint(resource_id: &str, entrypoint: &str) -> Option<PathBuf> {
    MANAGER
        .get()
        .and_then(|state| state.read().ok())
        .and_then(|manager| manager.resolve_entrypoint(resource_id, entrypoint).ok())
}

pub(crate) fn resource_definition(
    resource_id: &str,
) -> Result<ResourceDefinition, LocalResourceError> {
    catalog()?
        .resources
        .iter()
        .find(|resource| resource.id == resource_id)
        .cloned()
        .ok_or_else(|| LocalResourceError::UnknownResource(resource_id.to_owned()))
}

pub(crate) fn required_resource_ids(
    capability_id: &str,
) -> Result<Vec<String>, LocalResourceError> {
    with_manager_read(|manager| manager.required_resource_ids(capability_id))
}

pub(crate) fn resource_is_ready(resource_id: &str) -> Result<bool, LocalResourceError> {
    with_manager_read(|manager| Ok(manager.resource_ready(resource_id)))
}

pub(crate) fn resource_update_available(resource_id: &str) -> Result<bool, LocalResourceError> {
    with_manager_read(|manager| Ok(manager.resource_update_available(resource_id)))
}

pub(crate) fn activate_resource(receipt: ResourceReceipt) -> Result<(), LocalResourceError> {
    with_manager_write(|manager| manager.activate_receipt(receipt))
}

pub(crate) fn active_receipt(
    resource_id: &str,
) -> Result<Option<ResourceReceipt>, LocalResourceError> {
    with_manager_read(|manager| manager.active_receipt(resource_id))
}

pub(crate) fn installed_receipts(
    resource_id: &str,
) -> Result<Vec<ResourceReceipt>, LocalResourceError> {
    with_manager_read(|manager| manager.installed_receipts(resource_id))
}

pub(crate) fn deactivate_resource(
    resource_id: &str,
) -> Result<Option<ResourceReceipt>, LocalResourceError> {
    with_manager_write(|manager| manager.deactivate_resource(resource_id))
}

pub(crate) fn remove_inactive_receipt(
    resource_id: &str,
    version: &str,
) -> Result<bool, LocalResourceError> {
    with_manager_write(|manager| manager.remove_inactive_receipt(resource_id, version))
}

pub(crate) fn configuration_snapshot() -> Option<LocalResourceConfiguration> {
    MANAGER
        .get()
        .and_then(|state| state.read().ok())
        .and_then(|manager| manager.configuration.clone())
}

pub(crate) fn replace_configuration(
    configuration: LocalResourceConfiguration,
) -> Result<LocalResourceStatus, LocalResourceError> {
    with_manager_write(|manager| manager.replace_configuration(configuration))
}

pub(crate) fn resource_subdirectories() -> &'static [&'static str] {
    &RESOURCE_SUBDIRECTORIES
}

pub(crate) fn available_space_for(path: &Path) -> Option<u64> {
    available_space(path)
}

pub(crate) fn selected_location_paths(raw: &str) -> Result<(PathBuf, PathBuf), LocalResourceError> {
    resolve_selected_location(raw)
}

pub(crate) fn validate_external_receipt(
    receipt: &ResourceReceipt,
    resource: &ResourceDefinition,
) -> Result<(), LocalResourceError> {
    validate_receipt(receipt, &resource.id, &resource.version)
}

pub(crate) fn development_path_override(name: &str) -> Option<PathBuf> {
    if cfg!(any(test, debug_assertions)) {
        std::env::var_os(name)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    } else {
        None
    }
}

pub(crate) fn resource_change_pending() -> Result<bool, LocalResourceError> {
    if MANAGER.get().is_none() { return Ok(false); }
    with_manager_read(|manager| Ok(activation::pending(&manager.config_path)? || removal::pending(&manager.config_path)?))
}

pub(crate) fn recover_changes_for_use() -> Result<(), LocalResourceError> {
    if MANAGER.get().is_none() { return Ok(()); }
    with_manager_write(|_| Ok(()))
}


fn with_manager_read<T>(
    operation: impl FnOnce(&LocalResourceManager) -> Result<T, LocalResourceError>,
) -> Result<T, LocalResourceError> {
    let state = MANAGER.get().ok_or(LocalResourceError::NotInitialized)?;
    let state = state
        .read()
        .map_err(|_| io::Error::other("本地资源设置锁不可用"))?;
    operation(&state)
}

fn with_manager_write<T>(
    operation: impl FnOnce(&mut LocalResourceManager) -> Result<T, LocalResourceError>,
) -> Result<T, LocalResourceError> {
    let state = MANAGER.get().ok_or(LocalResourceError::NotInitialized)?;
    let mut state = state
        .write()
        .map_err(|_| io::Error::other("本地资源设置锁不可用"))?;
    if recover_transactions(&state.config_path)? {
        state.configuration = persistence::load_configuration(&state.config_path)?;
    }
    operation(&mut state)
}

fn recover_transactions(config: &Path) -> Result<bool, LocalResourceError> {
    if activation::pending(config)? && removal::pending(config)? {
        return Err(LocalResourceError::InvalidReceipt("存在冲突的资源变更记录，已保留文件".into()));
    }
    let activated = activation::recover(config)? != activation::Recovery::None;
    Ok(removal::recover(config)? || activated)
}

impl LocalResourceManager {
    fn load(data_directory: &Path) -> Result<Self, LocalResourceError> {
        let config_path = data_directory.join(CONFIG_FILE_NAME);
        recover_transactions(&config_path)?;
        let mut configuration = persistence::load_configuration(&config_path)?;
        let legacy_settings = load_legacy_runtime_settings(data_directory);
        let mut changed = false;
        if let Some(legacy_root) = legacy_settings.storage_root {
            if let Some(existing) = configuration.as_mut() {
                if Path::new(&existing.resource_root) != legacy_root
                    && push_unique_path(&mut existing.legacy_candidate_roots, &legacy_root)
                {
                    changed = true;
                }
            } else if let Some(migrated) = migrate_legacy_configuration(
                &legacy_root,
                legacy_settings.preferred_model.as_deref(),
            ) {
                configuration = Some(migrated);
                changed = true;
            }
        }
        if changed && let Some(configuration) = configuration.as_ref() {
            persist_json(&config_path, configuration)?;
        }
        Ok(Self {
            config_path,
            configuration,
        })
    }

    fn plan_location(&self, parent: &str) -> Result<LocalResourceLocationPlan, LocalResourceError> {
        let (parent, root) = resolve_selected_location(parent)?;
        Ok(LocalResourceLocationPlan {
            selected_parent: path_string(&parent),
            resource_root: path_string(&root),
            parent_exists: true,
            resource_root_exists: root.is_dir(),
            free_space_bytes: available_space(&parent),
            confirmation_required: true,
        })
    }

    fn configure_location(
        &mut self,
        parent: &str,
        confirmed: bool,
    ) -> Result<LocalResourceStatus, LocalResourceError> {
        if !confirmed {
            return Err(LocalResourceError::ConfirmationRequired);
        }
        let (parent, root) = resolve_selected_location(parent)?;
        fs::create_dir_all(&root)?;
        for relative in RESOURCE_SUBDIRECTORIES {
            fs::create_dir_all(root.join(relative))?;
        }
        verify_writable(&root.join("state"))?;
        let existing_configuration = self
            .configuration
            .as_ref()
            .filter(|configuration| configuration_root(configuration) == root);
        let mut legacy_candidate_roots = self
            .configuration
            .as_ref()
            .map(|configuration| configuration.legacy_candidate_roots.clone())
            .unwrap_or_default();
        if let Some(previous) = self
            .configuration
            .as_ref()
            .map(configuration_root)
            .filter(|previous| previous != &root)
        {
            push_unique_path(&mut legacy_candidate_roots, &previous);
        }
        let configuration = LocalResourceConfiguration {
            schema_version: CONFIG_SCHEMA_VERSION,
            selected_parent: path_string(&parent),
            resource_root: path_string(&root),
            preferred_profile: existing_configuration
                .map(|configuration| configuration.preferred_profile.clone())
                .unwrap_or_else(|| DEFAULT_PROFILE.to_owned()),
            active_resources: existing_configuration
                .map(|configuration| configuration.active_resources.clone())
                .unwrap_or_default(),
            legacy_candidate_roots,
            proxy_url: self
                .configuration
                .as_ref()
                .and_then(|configuration| configuration.proxy_url.clone()),
        };
        persist_json(&self.config_path, &configuration)?;
        self.configuration = Some(configuration);
        self.status()
    }

    fn repair_configured_root(
        &mut self,
        confirmed: bool,
    ) -> Result<LocalResourceStatus, LocalResourceError> {
        if !confirmed {
            return Err(LocalResourceError::ConfirmationRequired);
        }
        let mut configuration = self
            .configuration
            .clone()
            .ok_or(LocalResourceError::ConfirmationRequired)?;
        let root = configuration_root(&configuration);
        let root_was_missing = !root.exists();
        fs::create_dir_all(&root)?;
        for relative in RESOURCE_SUBDIRECTORIES {
            fs::create_dir_all(root.join(relative))?;
        }
        verify_writable(&root.join("state"))?;
        if root_was_missing {
            configuration.active_resources.clear();
            persist_json(&self.config_path, &configuration)?;
            self.configuration = Some(configuration);
        }
        self.status()
    }

    fn replace_configuration(
        &mut self,
        mut configuration: LocalResourceConfiguration,
    ) -> Result<LocalResourceStatus, LocalResourceError> {
        configuration.schema_version = CONFIG_SCHEMA_VERSION;
        validate_configuration(&configuration)?;
        let root = configuration_root(&configuration);
        if !root.is_dir() {
            return Err(LocalResourceError::RootUnavailable(path_string(&root)));
        }
        for relative in RESOURCE_SUBDIRECTORIES {
            if !root.join(relative).is_dir() {
                return Err(LocalResourceError::RootUnavailable(format!(
                    "资源目录缺少 {relative}：{}",
                    root.display()
                )));
            }
        }
        verify_writable(&root.join("state"))?;
        persist_json(&self.config_path, &configuration)?;
        self.configuration = Some(configuration);
        self.status()
    }

    fn set_preferred_profile(
        &mut self,
        profile_id: &str,
    ) -> Result<LocalResourceStatus, LocalResourceError> {
        if !catalog()?
            .profiles
            .iter()
            .any(|profile| profile.id == profile_id)
        {
            return Err(LocalResourceError::UnknownProfile(profile_id.to_owned()));
        }
        let mut configuration = self
            .configuration
            .clone()
            .ok_or(LocalResourceError::ConfirmationRequired)?;
        configuration.preferred_profile = profile_id.to_owned();
        persist_json(&self.config_path, &configuration)?;
        self.configuration = Some(configuration.clone());
        self.status()
    }

    #[cfg(test)]
    fn set_proxy_url(&mut self, proxy_url: Option<&str>) -> Result<(), LocalResourceError> {
        let normalized = normalize_proxy_url(proxy_url)?;
        let mut configuration = self
            .configuration
            .clone()
            .ok_or(LocalResourceError::ConfirmationRequired)?;
        configuration.proxy_url = normalized;
        persist_json(&self.config_path, &configuration)?;
        self.configuration = Some(configuration);
        Ok(())
    }

    fn status(&self) -> Result<LocalResourceStatus, LocalResourceError> {
        let snapshot_revision = status_contract::next_snapshot_revision()?;
        let catalog = catalog()?;
        let Some(configuration) = self.configuration.as_ref() else {
            return Ok(LocalResourceStatus {
                snapshot_revision,
                configured: false,
                selected_parent: None,
                resource_root: None,
                root_state: LocalResourceRootState::SetupRequired,
                free_space_bytes: None,
                preferred_profile: DEFAULT_PROFILE.to_owned(),
                capabilities: capability_statuses(
                    catalog,
                    DEFAULT_PROFILE,
                    LocalResourceRootState::SetupRequired,
                    |_| false,
                    |_| false,
                    |_| false,
                ),
            });
        };
        let root = configuration_root(configuration);
        let root_state = if !root.is_dir() {
            LocalResourceRootState::RootUnavailable
        } else if RESOURCE_SUBDIRECTORIES
            .iter()
            .all(|relative| root.join(relative).is_dir())
        {
            LocalResourceRootState::Ready
        } else {
            LocalResourceRootState::RepairRequired
        };
        let free_space_bytes = root
            .is_dir()
            .then(|| available_space(&root))
            .flatten()
            .or_else(|| available_space(Path::new(&configuration.selected_parent)));
        let capabilities = capability_statuses(
            catalog,
            &configuration.preferred_profile,
            root_state.clone(),
            |resource_id| self.resource_ready(resource_id),
            crate::resource_download::resource_is_preparing,
            |resource_id| self.resource_update_available(resource_id),
        );
        Ok(LocalResourceStatus {
            snapshot_revision,
            configured: true,
            selected_parent: Some(configuration.selected_parent.clone()),
            resource_root: Some(configuration.resource_root.clone()),
            root_state,
            free_space_bytes,
            preferred_profile: configuration.preferred_profile.clone(),
            capabilities,
        })
    }

    fn resource_ready(&self, resource_id: &str) -> bool {
        let Some(configuration) = self.configuration.as_ref() else {
            return false;
        };
        let Some(version) = configuration.active_resources.get(resource_id) else {
            return false;
        };
        let Ok(receipt) = self.read_receipt(resource_id, version) else {
            return false;
        };
        if receipt.health_status != "passed" || receipt.entrypoints.is_empty() {
            return false;
        }
        receipt
            .entrypoints
            .keys()
            .all(|entrypoint| self.resolve_entrypoint(resource_id, entrypoint).is_ok())
    }

    fn resource_update_available(&self, resource_id: &str) -> bool {
        if !self.resource_ready(resource_id) {
            return false;
        }
        let Some(configuration) = self.configuration.as_ref() else {
            return false;
        };
        let Some(active_version) = configuration.active_resources.get(resource_id) else {
            return false;
        };
        catalog()
            .ok()
            .and_then(|catalog| {
                catalog
                    .resources
                    .iter()
                    .find(|resource| resource.id == resource_id)
            })
            .is_some_and(|resource| resource.version != *active_version)
    }

    fn required_resource_ids(
        &self,
        capability_id: &str,
    ) -> Result<Vec<String>, LocalResourceError> {
        let catalog = catalog()?;
        let profile = self
            .configuration
            .as_ref()
            .map(|configuration| configuration.preferred_profile.as_str())
            .unwrap_or(DEFAULT_PROFILE);
        let mut capability_ids = BTreeSet::new();
        let mut resource_ids = BTreeSet::new();
        collect_capability_resources(
            catalog,
            capability_id,
            profile,
            &mut capability_ids,
            &mut resource_ids,
        )?;
        Ok(resource_ids.into_iter().collect())
    }

    fn resolve_entrypoint(
        &self,
        resource_id: &str,
        entrypoint: &str,
    ) -> Result<PathBuf, LocalResourceError> {
        validate_identifier(resource_id, "资源 ID")?;
        validate_identifier(entrypoint, "入口名称")?;
        let configuration = self.configuration.as_ref().ok_or_else(|| {
            LocalResourceError::ResourceNotReady(format!("{resource_id} 尚未配置"))
        })?;
        let root = configuration_root(configuration);
        if !root.is_dir() {
            return Err(LocalResourceError::RootUnavailable(path_string(&root)));
        }
        let version = configuration
            .active_resources
            .get(resource_id)
            .ok_or_else(|| {
                LocalResourceError::ResourceNotReady(format!("{resource_id} 没有活动版本"))
            })?;
        let receipt = self.read_receipt(resource_id, version)?;
        if receipt.health_status != "passed" {
            return Err(LocalResourceError::ResourceNotReady(format!(
                "{resource_id} 的健康检查未通过"
            )));
        }
        let install_relative = safe_relative_path(&receipt.install_relative_path, "资源安装目录")?;
        let entrypoint_relative = safe_relative_path(
            receipt.entrypoints.get(entrypoint).ok_or_else(|| {
                LocalResourceError::ResourceNotReady(format!(
                    "{resource_id} 不包含入口 {entrypoint}"
                ))
            })?,
            "资源入口",
        )?;
        let path = root.join(install_relative).join(entrypoint_relative);
        if !path.is_file() {
            return Err(LocalResourceError::ResourceNotReady(format!(
                "资源入口不存在：{}",
                path.display()
            )));
        }
        Ok(path)
    }

    fn read_receipt(
        &self,
        resource_id: &str,
        version: &str,
    ) -> Result<ResourceReceipt, LocalResourceError> {
        validate_identifier(resource_id, "资源 ID")?;
        validate_identifier(version, "资源版本")?;
        let configuration = self.configuration.as_ref().ok_or_else(|| {
            LocalResourceError::ResourceNotReady(format!("{resource_id} 尚未配置"))
        })?;
        let path = configuration_root(configuration)
            .join("receipts")
            .join(resource_id)
            .join(format!("{version}.json"));
        let receipt =
            serde_json::from_slice::<ResourceReceipt>(&fs::read(&path).map_err(|_| {
                LocalResourceError::ResourceNotReady(format!(
                    "缺少资源安装凭据：{}",
                    path.display()
                ))
            })?)?;
        validate_receipt(&receipt, resource_id, version)?;
        Ok(receipt)
    }

    fn activate_receipt(&mut self, receipt: ResourceReceipt) -> Result<(), LocalResourceError> {
        activation::activate(self, receipt)
    }

    fn active_receipt(
        &self,
        resource_id: &str,
    ) -> Result<Option<ResourceReceipt>, LocalResourceError> {
        let Some(configuration) = self.configuration.as_ref() else {
            return Ok(None);
        };
        let Some(version) = configuration.active_resources.get(resource_id) else {
            return Ok(None);
        };
        self.read_receipt(resource_id, version).map(Some)
    }

    fn installed_receipts(
        &self,
        resource_id: &str,
    ) -> Result<Vec<ResourceReceipt>, LocalResourceError> {
        validate_identifier(resource_id, "资源 ID")?;
        let Some(configuration) = self.configuration.as_ref() else {
            return Ok(Vec::new());
        };
        let directory = configuration_root(configuration)
            .join("receipts")
            .join(resource_id);
        if !directory.is_dir() {
            return Ok(Vec::new());
        }
        let mut receipts = Vec::new();
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();
            if !entry.file_type()?.is_file()
                || path.extension().and_then(|value| value.to_str()) != Some("json")
            {
                continue;
            }
            let Ok(receipt) = serde_json::from_slice::<ResourceReceipt>(&fs::read(&path)?) else {
                continue;
            };
            if validate_receipt(&receipt, resource_id, &receipt.version).is_ok() {
                receipts.push(receipt);
            }
        }
        receipts.sort_by(|left, right| {
            right
                .activated_at_ms
                .unwrap_or_default()
                .cmp(&left.activated_at_ms.unwrap_or_default())
                .then(right.version.cmp(&left.version))
        });
        Ok(receipts)
    }

    fn deactivate_resource(
        &mut self,
        resource_id: &str,
    ) -> Result<Option<ResourceReceipt>, LocalResourceError> {
        removal::remove(self, resource_id)
    }

    fn remove_inactive_receipt(
        &mut self,
        resource_id: &str,
        version: &str,
    ) -> Result<bool, LocalResourceError> {
        validate_identifier(resource_id, "资源 ID")?;
        validate_identifier(version, "资源版本")?;
        let configuration = self
            .configuration
            .as_ref()
            .ok_or(LocalResourceError::ConfirmationRequired)?;
        if configuration
            .active_resources
            .get(resource_id)
            .is_some_and(|active| active == version)
        {
            return Err(LocalResourceError::ResourceNotReady(format!(
                "不能删除活动版本 {resource_id}@{version}"
            )));
        }
        let path = configuration_root(configuration)
            .join("receipts")
            .join(resource_id)
            .join(format!("{version}.json"));
        persistence::remove_record(&path)
    }
}

fn collect_capability_resources(
    catalog: &LocalResourceCatalog,
    capability_id: &str,
    preferred_profile: &str,
    visited_capability_ids: &mut BTreeSet<String>,
    resource_ids: &mut BTreeSet<String>,
) -> Result<(), LocalResourceError> {
    if !visited_capability_ids.insert(capability_id.to_owned()) {
        return Ok(());
    }
    let capability = catalog
        .capabilities
        .iter()
        .find(|capability| capability.id == capability_id)
        .ok_or_else(|| LocalResourceError::UnknownCapability(capability_id.to_owned()))?;
    for dependency in &capability.requires_capability_ids {
        collect_capability_resources(
            catalog,
            dependency,
            preferred_profile,
            visited_capability_ids,
            resource_ids,
        )?;
    }
    resource_ids.extend(capability.resource_ids.iter().cloned());
    if capability
        .profile_ids
        .iter()
        .any(|profile_id| profile_id == preferred_profile)
    {
        let profile = catalog
            .profiles
            .iter()
            .find(|profile| profile.id == preferred_profile)
            .ok_or_else(|| {
                LocalResourceError::InvalidCatalog(format!(
                    "能力 {capability_id} 引用了未知配置档 {preferred_profile}"
                ))
            })?;
        resource_ids.extend(profile.resource_ids.iter().cloned());
    }
    Ok(())
}

fn load_legacy_runtime_settings(data_directory: &Path) -> LegacyRuntimeSettings {
    let path = data_directory.join("runtime-settings.json");
    let parsed = fs::read(&path)
        .ok()
        .and_then(|contents| serde_json::from_slice::<LegacyRuntimeSettingsFile>(&contents).ok())
        .unwrap_or_default();
    let storage_root = parsed
        .storage_root
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && !path.is_file())
        .map(|path| dunce::canonicalize(&path).unwrap_or(path));
    LegacyRuntimeSettings {
        storage_root,
        preferred_model: parsed.preferred_model,
    }
}

fn migrate_legacy_configuration(
    legacy_root: &Path,
    preferred_model: Option<&str>,
) -> Option<LocalResourceConfiguration> {
    if !legacy_root.is_absolute() {
        return None;
    }
    let is_resource_root = legacy_root
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(RESOURCE_DIRECTORY_NAME));
    let (selected_parent, resource_root) = if is_resource_root {
        (
            legacy_root.parent()?.to_path_buf(),
            legacy_root.to_path_buf(),
        )
    } else {
        (
            legacy_root.to_path_buf(),
            legacy_root.join(RESOURCE_DIRECTORY_NAME),
        )
    };
    Some(LocalResourceConfiguration {
        schema_version: CONFIG_SCHEMA_VERSION,
        selected_parent: path_string(&selected_parent),
        resource_root: path_string(&resource_root),
        preferred_profile: if preferred_model == Some("base") {
            "fast".to_owned()
        } else {
            DEFAULT_PROFILE.to_owned()
        },
        active_resources: BTreeMap::new(),
        legacy_candidate_roots: vec![path_string(legacy_root)],
        proxy_url: None,
    })
}

fn normalize_proxy_url(proxy_url: Option<&str>) -> Result<Option<String>, LocalResourceError> {
    let Some(proxy_url) = proxy_url.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let parsed = url::Url::parse(proxy_url).map_err(|_| {
        LocalResourceError::InvalidProxy("请输入完整的 http:// 或 https:// 地址".to_owned())
    })?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(LocalResourceError::InvalidProxy(
            "仅支持不含账号、密码、查询参数的 HTTP(S) 代理地址".to_owned(),
        ));
    }
    Ok(Some(parsed.to_string().trim_end_matches('/').to_owned()))
}

fn push_unique_path(paths: &mut Vec<String>, path: &Path) -> bool {
    let value = path_string(path);
    if paths
        .iter()
        .any(|existing| existing.eq_ignore_ascii_case(&value))
    {
        false
    } else {
        paths.push(value);
        true
    }
}

fn capability_statuses(
    catalog: &LocalResourceCatalog,
    preferred_profile: &str,
    root_state: LocalResourceRootState,
    mut is_ready: impl FnMut(&str) -> bool,
    mut is_preparing: impl FnMut(&str) -> bool,
    mut has_update: impl FnMut(&str) -> bool,
) -> Vec<LocalResourceCapabilityStatus> {
    let profile_resources = catalog
        .profiles
        .iter()
        .find(|profile| profile.id == preferred_profile)
        .map(|profile| profile.resource_ids.as_slice())
        .unwrap_or_default();
    let mut ready_capabilities = BTreeSet::new();
    let mut statuses = Vec::with_capacity(catalog.capabilities.len());
    for capability in &catalog.capabilities {
        let mut required_resource_ids = capability.resource_ids.clone();
        if !capability.profile_ids.is_empty()
            && capability
                .profile_ids
                .iter()
                .any(|profile| profile == preferred_profile)
        {
            required_resource_ids.extend(profile_resources.iter().cloned());
        }
        required_resource_ids.sort();
        required_resource_ids.dedup();
        let missing_resource_ids = required_resource_ids
            .iter()
            .filter(|resource_id| !is_ready(resource_id))
            .cloned()
            .collect::<Vec<_>>();
        let dependencies_ready = capability
            .requires_capability_ids
            .iter()
            .all(|dependency| ready_capabilities.contains(dependency));
        let has_preparing_resource = required_resource_ids
            .iter()
            .any(|resource_id| is_preparing(resource_id));
        let has_update_available = required_resource_ids
            .iter()
            .any(|resource_id| has_update(resource_id));
        let state = match root_state {
            LocalResourceRootState::SetupRequired => LocalResourceCapabilityState::SetupRequired,
            LocalResourceRootState::RootUnavailable => {
                LocalResourceCapabilityState::RootUnavailable
            }
            LocalResourceRootState::RepairRequired => LocalResourceCapabilityState::RepairRequired,
            LocalResourceRootState::Ready
                if missing_resource_ids.is_empty() && dependencies_ready =>
            {
                ready_capabilities.insert(capability.id.clone());
                if has_update_available {
                    LocalResourceCapabilityState::UpdateAvailable
                } else {
                    LocalResourceCapabilityState::Ready
                }
            }
            LocalResourceRootState::Ready if has_preparing_resource => {
                LocalResourceCapabilityState::Preparing
            }
            LocalResourceRootState::Ready => LocalResourceCapabilityState::NotReady,
        };
        statuses.push(LocalResourceCapabilityStatus {
            id: capability.id.clone(),
            title: capability.title.clone(),
            state,
            required_resource_ids,
            missing_resource_ids,
        });
    }
    statuses
}

fn validate_catalog(catalog: &LocalResourceCatalog) -> Result<(), LocalResourceError> {
    if catalog.schema_version != 1
        || catalog.product_id != "siaovplay"
        || catalog.package_profile != "app-only"
    {
        return Err(LocalResourceError::InvalidCatalog(
            "清单版本、产品标识或安装包类型不符合预期".to_owned(),
        ));
    }
    let resource_ids = unique_ids(
        catalog
            .resources
            .iter()
            .map(|resource| resource.id.as_str()),
        "资源",
    )?;
    let profile_ids = unique_ids(
        catalog.profiles.iter().map(|profile| profile.id.as_str()),
        "配置档",
    )?;
    let capability_ids = unique_ids(
        catalog
            .capabilities
            .iter()
            .map(|capability| capability.id.as_str()),
        "能力",
    )?;
    if !profile_ids.contains(DEFAULT_PROFILE) {
        return Err(LocalResourceError::InvalidCatalog(
            "缺少默认 standard 配置档".to_owned(),
        ));
    }
    for resource in &catalog.resources {
        validate_identifier(&resource.id, "资源 ID")?;
        validate_identifier(&resource.version, "资源版本")?;
        if resource.bundled {
            return Err(LocalResourceError::InvalidCatalog(format!(
                "app-only 清单不能内置资源 {}",
                resource.id
            )));
        }
        if resource.expected_download_size == Some(0) {
            return Err(LocalResourceError::InvalidCatalog(format!(
                "{} 的预计下载大小无效",
                resource.id
            )));
        }
        if let Some(artifact) = &resource.artifact {
            if !artifact.url.starts_with("https://")
                || artifact.size == 0
                || !is_sha256(&artifact.sha256)
                || resource.installed_size.unwrap_or(0) == 0
                || resource
                    .expected_download_size
                    .is_some_and(|expected| expected != artifact.size)
            {
                return Err(LocalResourceError::InvalidCatalog(format!(
                    "{} 的下载地址、下载大小、安装后大小或 SHA-256 无效",
                    resource.id
                )));
            }
        } else {
            if resource
                .distribution
                .as_ref()
                .is_none_or(|distribution| distribution.status != "pending_release_asset")
                || resource.expected_download_size.unwrap_or(0) == 0
                || resource.installed_size.unwrap_or(0) == 0
            {
                return Err(LocalResourceError::InvalidCatalog(format!(
                    "{} 既没有可信下载制品，也没有完整的待发布大小信息",
                    resource.id
                )));
            }
        }
        for relative in resource.entrypoints.values() {
            safe_relative_path(relative, "清单资源入口")?;
        }
    }
    for profile in &catalog.profiles {
        require_known_ids(&profile.resource_ids, &resource_ids, "配置档资源")?;
    }
    for capability in &catalog.capabilities {
        require_known_ids(&capability.resource_ids, &resource_ids, "能力资源")?;
        require_known_ids(&capability.profile_ids, &profile_ids, "能力配置档")?;
        require_known_ids(
            &capability.requires_capability_ids,
            &capability_ids,
            "能力依赖",
        )?;
    }
    Ok(())
}

fn validate_configuration(
    configuration: &LocalResourceConfiguration,
) -> Result<(), LocalResourceError> {
    if configuration.schema_version != CONFIG_SCHEMA_VERSION {
        return Err(LocalResourceError::InvalidReceipt(format!(
            "不支持的资源配置版本 {}",
            configuration.schema_version
        )));
    }
    if !Path::new(&configuration.resource_root).is_absolute()
        || !Path::new(&configuration.selected_parent).is_absolute()
        || !Path::new(&configuration.resource_root).ends_with(RESOURCE_DIRECTORY_NAME)
    {
        return Err(LocalResourceError::InvalidReceipt(
            "资源配置包含无效目录".to_owned(),
        ));
    }
    for (resource_id, version) in &configuration.active_resources {
        validate_identifier(resource_id, "活动资源 ID")?;
        validate_identifier(version, "活动资源版本")?;
    }
    for candidate in &configuration.legacy_candidate_roots {
        if !Path::new(candidate).is_absolute() {
            return Err(LocalResourceError::InvalidReceipt(
                "旧资源候选目录不是绝对路径".to_owned(),
            ));
        }
    }
    if normalize_proxy_url(configuration.proxy_url.as_deref())? != configuration.proxy_url {
        return Err(LocalResourceError::InvalidProxy(
            "代理地址不是规范的 HTTP(S) 地址".to_owned(),
        ));
    }
    Ok(())
}

fn validate_receipt(
    receipt: &ResourceReceipt,
    expected_resource_id: &str,
    expected_version: &str,
) -> Result<(), LocalResourceError> {
    if receipt.schema_version != RECEIPT_SCHEMA_VERSION
        || receipt.resource_id != expected_resource_id
        || receipt.version != expected_version
        || !matches!(receipt.health_status.as_str(), "passed" | "failed")
    {
        return Err(LocalResourceError::InvalidReceipt(format!(
            "{expected_resource_id}@{expected_version} 的身份或状态不匹配"
        )));
    }
    safe_relative_path(&receipt.install_relative_path, "资源安装目录")?;
    if receipt.entrypoints.is_empty() {
        return Err(LocalResourceError::InvalidReceipt(format!(
            "{} 没有资源入口",
            receipt.resource_id
        )));
    }
    for (name, relative) in &receipt.entrypoints {
        validate_identifier(name, "资源入口名称")?;
        safe_relative_path(relative, "资源入口")?;
    }
    for file in &receipt.files {
        safe_relative_path(&file.relative_path, "资源文件")?;
        if !is_sha256(&file.sha256) {
            return Err(LocalResourceError::InvalidReceipt(format!(
                "{} 的文件 SHA-256 无效",
                receipt.resource_id
            )));
        }
    }
    Ok(())
}

fn validate_parent(raw: &str) -> Result<PathBuf, LocalResourceError> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err(LocalResourceError::InvalidParent("目录不能为空".to_owned()));
    }
    let path = PathBuf::from(raw);
    if !path.is_absolute() || !path.is_dir() {
        return Err(LocalResourceError::InvalidParent(format!(
            "目录不存在或不是绝对路径：{}",
            path.display()
        )));
    }
    dunce::canonicalize(&path).map_err(LocalResourceError::from)
}

fn resolve_selected_location(raw: &str) -> Result<(PathBuf, PathBuf), LocalResourceError> {
    let selected = validate_parent(raw)?;
    let selected_is_root = selected
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(RESOURCE_DIRECTORY_NAME));
    if selected_is_root {
        let parent = selected.parent().ok_or_else(|| {
            LocalResourceError::InvalidParent("资源根目录没有可用的父目录".to_owned())
        })?;
        Ok((parent.to_path_buf(), selected))
    } else {
        let root = selected.join(RESOURCE_DIRECTORY_NAME);
        Ok((selected, root))
    }
}

fn validate_identifier(value: &str, label: &str) -> Result<(), LocalResourceError> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(LocalResourceError::InvalidReceipt(format!(
            "{label} 包含不安全字符：{value}"
        )));
    }
    Ok(())
}

fn safe_relative_path(value: &str, label: &str) -> Result<PathBuf, LocalResourceError> {
    let path = PathBuf::from(value);
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || !path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err(LocalResourceError::InvalidReceipt(format!(
            "{label} 不是安全的相对路径：{value}"
        )));
    }
    Ok(path)
}

fn unique_ids<'a>(
    values: impl Iterator<Item = &'a str>,
    label: &str,
) -> Result<BTreeSet<String>, LocalResourceError> {
    let mut result = BTreeSet::new();
    for value in values {
        if !result.insert(value.to_owned()) {
            return Err(LocalResourceError::InvalidCatalog(format!(
                "{label} ID 重复：{value}"
            )));
        }
    }
    Ok(result)
}

fn require_known_ids(
    values: &[String],
    known: &BTreeSet<String>,
    label: &str,
) -> Result<(), LocalResourceError> {
    if let Some(value) = values.iter().find(|value| !known.contains(value.as_str())) {
        return Err(LocalResourceError::InvalidCatalog(format!(
            "{label} 引用了未知 ID：{value}"
        )));
    }
    Ok(())
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn configuration_root(configuration: &LocalResourceConfiguration) -> PathBuf {
    PathBuf::from(&configuration.resource_root)
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn verify_writable(directory: &Path) -> Result<(), LocalResourceError> {
    let probe = directory.join(format!(".write-probe-{}", std::process::id()));
    File::create(&probe)?.write_all(b"SiaoVPlay")?;
    fs::remove_file(probe)?;
    Ok(())
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
#[path = "local_resources_version_tests.rs"]
mod version_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn custom_proxy_requires_safe_http_address() {
        assert_eq!(
            normalize_proxy_url(Some(" http://127.0.0.1:7897/ "))
                .expect("local proxy should be accepted"),
            Some("http://127.0.0.1:7897".to_owned())
        );
        assert!(matches!(
            normalize_proxy_url(Some("socks5://127.0.0.1:1080")),
            Err(LocalResourceError::InvalidProxy(_))
        ));
        assert!(matches!(
            normalize_proxy_url(Some("http://user:secret@proxy.example:8080")),
            Err(LocalResourceError::InvalidProxy(_))
        ));
        assert_eq!(
            normalize_proxy_url(Some(" ")).expect("empty value should restore automatic mode"),
            None
        );
    }

    fn fixture_receipt(version: &str, health_status: &str) -> ResourceReceipt {
        ResourceReceipt {
            schema_version: RECEIPT_SCHEMA_VERSION,
            resource_id: "ffmpeg-cpu".to_owned(),
            version: version.to_owned(),
            install_relative_path: format!("packages/ffmpeg-cpu/{version}"),
            entrypoints: BTreeMap::from([
                ("ffmpeg".to_owned(), "bin/ffmpeg.exe".to_owned()),
                ("ffprobe".to_owned(), "bin/ffprobe.exe".to_owned()),
            ]),
            files: Vec::new(),
            health_status: health_status.to_owned(),
            activated_at_ms: None,
        }
    }

    #[test]
    fn embedded_catalog_is_valid_and_app_only() {
        let catalog = catalog().expect("catalog should parse");
        validate_catalog(catalog).expect("catalog should validate");
        assert_eq!(catalog.resources.len(), 5);
        assert!(catalog.resources.iter().all(|resource| !resource.bundled));
        let cpu = catalog
            .resources
            .iter()
            .find(|resource| resource.id == "whisper-cpu")
            .expect("CPU runtime should be catalogued");
        assert_eq!(cpu.installed_size, Some(20_355_072));
        let artifact = cpu
            .artifact
            .as_ref()
            .expect("official CPU runtime should be downloadable");
        assert_eq!(artifact.size, 7_982_101);
        assert_eq!(
            artifact.sha256,
            "7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539"
        );
        assert_eq!(cpu.health_check, "whisper-cli-version");
    }

    #[test]
    fn capability_reports_preparing_while_a_required_resource_is_active() {
        let statuses = capability_statuses(
            catalog().expect("catalog should parse"),
            DEFAULT_PROFILE,
            LocalResourceRootState::Ready,
            |_| false,
            |resource_id| resource_id == "ffmpeg-cpu",
            |_| false,
        );
        assert_eq!(
            statuses
                .iter()
                .find(|status| status.id == "basic_media")
                .expect("basic media should exist")
                .state,
            LocalResourceCapabilityState::Preparing
        );
    }

    #[test]
    fn planning_is_read_only_and_reports_child_root() {
        let data = tempdir().expect("data directory");
        let parent = tempdir().expect("resource parent");
        let manager = LocalResourceManager::load(data.path()).expect("manager should load");
        let plan = manager
            .plan_location(parent.path().to_str().expect("UTF-8 path"))
            .expect("plan should succeed");
        assert!(plan.confirmation_required);
        assert!(plan.resource_root.ends_with(RESOURCE_DIRECTORY_NAME));
        assert!(!parent.path().join(RESOURCE_DIRECTORY_NAME).exists());
        assert!(!data.path().join(CONFIG_FILE_NAME).exists());
    }

    #[test]
    fn legacy_runtime_settings_migration_matrix_is_safe_and_preserves_user_choice() {
        let missing = tempdir().expect("missing settings fixture");
        assert!(
            LocalResourceManager::load(missing.path())
                .expect("missing settings should load")
                .configuration
                .is_none()
        );

        let malformed = tempdir().expect("malformed settings fixture");
        fs::write(malformed.path().join("runtime-settings.json"), b"{not-json")
            .expect("malformed settings should write");
        assert!(
            LocalResourceManager::load(malformed.path())
                .expect("malformed settings should be ignored")
                .configuration
                .is_none()
        );

        for value in ["", "relative/runtime"] {
            let fixture = tempdir().expect("invalid path fixture");
            fs::write(
                fixture.path().join("runtime-settings.json"),
                serde_json::to_vec(&serde_json::json!({
                    "storageRoot": value,
                    "preferredModel": "small"
                }))
                .expect("settings should serialize"),
            )
            .expect("settings should write");
            assert!(
                LocalResourceManager::load(fixture.path())
                    .expect("invalid path should be ignored")
                    .configuration
                    .is_none()
            );
        }

        let fixture = tempdir().expect("legacy root fixture");
        let legacy_root = fixture.path().join("runtime-storage");
        fs::create_dir_all(&legacy_root).expect("legacy root should create");
        fs::write(
            fixture.path().join("runtime-settings.json"),
            serde_json::to_vec(&serde_json::json!({
                "storageRoot": legacy_root,
                "preferredModel": "base"
            }))
            .expect("settings should serialize"),
        )
        .expect("settings should write");
        let migrated = LocalResourceManager::load(fixture.path())
            .expect("legacy settings should migrate")
            .configuration
            .expect("migration should create configuration");
        assert_eq!(Path::new(&migrated.selected_parent), legacy_root);
        assert_eq!(
            Path::new(&migrated.resource_root),
            legacy_root.join(RESOURCE_DIRECTORY_NAME)
        );
        assert_eq!(migrated.preferred_profile, "fast");
        assert_eq!(
            migrated.legacy_candidate_roots,
            vec![path_string(&legacy_root)]
        );
        assert!(fixture.path().join(CONFIG_FILE_NAME).is_file());

        let root_named_fixture = tempdir().expect("named root fixture");
        let named_root = root_named_fixture.path().join(RESOURCE_DIRECTORY_NAME);
        fs::create_dir_all(&named_root).expect("named root should create");
        fs::write(
            root_named_fixture.path().join("runtime-settings.json"),
            serde_json::to_vec(&serde_json::json!({
                "storageRoot": named_root,
                "preferredModel": "small"
            }))
            .expect("settings should serialize"),
        )
        .expect("settings should write");
        let migrated = LocalResourceManager::load(root_named_fixture.path())
            .expect("named root should migrate")
            .configuration
            .expect("migration should create configuration");
        assert_eq!(Path::new(&migrated.resource_root), named_root);
        assert_eq!(
            Path::new(&migrated.selected_parent),
            named_root.parent().expect("named root has parent")
        );
        assert_eq!(migrated.preferred_profile, DEFAULT_PROFILE);
    }

    #[test]
    fn configuration_requires_confirmation_without_writing() {
        let data = tempdir().expect("data directory");
        let parent = tempdir().expect("resource parent");
        let mut manager = LocalResourceManager::load(data.path()).expect("manager should load");
        let error = manager
            .configure_location(parent.path().to_str().expect("UTF-8 path"), false)
            .expect_err("confirmation should be required");
        assert!(matches!(error, LocalResourceError::ConfirmationRequired));
        assert!(!parent.path().join(RESOURCE_DIRECTORY_NAME).exists());
        assert!(!data.path().join(CONFIG_FILE_NAME).exists());
    }

    #[test]
    fn confirmed_configuration_persists_and_detects_unavailable_root() {
        let data = tempdir().expect("data directory");
        let parent = tempdir().expect("resource parent");
        let mut manager = LocalResourceManager::load(data.path()).expect("manager should load");
        let status = manager
            .configure_location(parent.path().to_str().expect("UTF-8 path"), true)
            .expect("configuration should succeed");
        assert_eq!(status.root_state, LocalResourceRootState::Ready);
        for relative in RESOURCE_SUBDIRECTORIES {
            assert!(
                parent
                    .path()
                    .join(RESOURCE_DIRECTORY_NAME)
                    .join(relative)
                    .is_dir()
            );
        }
        let reloaded =
            LocalResourceManager::load(data.path()).expect("configuration should reload");
        assert_eq!(reloaded.configuration, manager.configuration);
        fs::remove_dir_all(parent.path().join(RESOURCE_DIRECTORY_NAME))
            .expect("test root should remove");
        assert_eq!(
            reloaded.status().expect("status should resolve").root_state,
            LocalResourceRootState::RootUnavailable
        );
    }

    #[test]
    fn preferred_profile_persists_and_unknown_profiles_are_rejected() {
        let data = tempdir().expect("data directory");
        let parent = tempdir().expect("resource parent");
        let mut manager = LocalResourceManager::load(data.path()).expect("manager should load");
        manager
            .configure_location(parent.path().to_str().expect("UTF-8 path"), true)
            .expect("configuration should succeed");

        let status = manager
            .set_preferred_profile("fast")
            .expect("known profile should persist");
        assert_eq!(status.preferred_profile, "fast");
        let reloaded = LocalResourceManager::load(data.path()).expect("manager should reload");
        assert_eq!(
            reloaded
                .configuration
                .as_ref()
                .map(|configuration| configuration.preferred_profile.as_str()),
            Some("fast")
        );

        let error = manager
            .set_preferred_profile("unknown")
            .expect_err("unknown profile should fail");
        assert!(matches!(error, LocalResourceError::UnknownProfile(_)));
        assert_eq!(
            manager
                .configuration
                .as_ref()
                .map(|configuration| configuration.preferred_profile.as_str()),
            Some("fast")
        );
    }

    #[test]
    fn custom_proxy_persists_and_can_return_to_automatic_mode() {
        let data = tempdir().expect("data directory");
        let parent = tempdir().expect("resource parent");
        let mut manager = LocalResourceManager::load(data.path()).expect("manager should load");
        manager
            .configure_location(parent.path().to_str().expect("UTF-8 path"), true)
            .expect("configuration should succeed");
        manager
            .set_proxy_url(Some("http://127.0.0.1:7897"))
            .expect("custom proxy should persist");
        let reloaded = LocalResourceManager::load(data.path()).expect("manager should reload");
        assert_eq!(
            reloaded
                .configuration
                .as_ref()
                .and_then(|configuration| configuration.proxy_url.as_deref()),
            Some("http://127.0.0.1:7897")
        );
        manager
            .set_proxy_url(None)
            .expect("automatic proxy mode should persist");
        assert_eq!(
            LocalResourceManager::load(data.path())
                .expect("manager should reload")
                .configuration
                .and_then(|configuration| configuration.proxy_url),
            None
        );
    }

    #[test]
    fn external_resource_root_survives_upgrade_reinstall_and_app_removal_simulation() {
        let data = tempdir().expect("persistent app data");
        let resource_parent = tempdir().expect("external resource parent");
        let install_directory = tempdir().expect("application install directory");
        fs::write(install_directory.path().join("SiaoVPlay.exe"), b"app")
            .expect("app fixture should write");
        let mut manager = LocalResourceManager::load(data.path()).expect("manager should load");
        manager
            .configure_location(resource_parent.path().to_str().expect("UTF-8 path"), true)
            .expect("configuration should succeed");
        let root = resource_parent.path().join(RESOURCE_DIRECTORY_NAME);
        let install = root.join("packages/ffmpeg-cpu/8.1/bin");
        fs::create_dir_all(&install).expect("resource install should create");
        fs::write(install.join("ffmpeg.exe"), b"ffmpeg").expect("ffmpeg should write");
        fs::write(install.join("ffprobe.exe"), b"ffprobe").expect("ffprobe should write");
        manager
            .activate_receipt(fixture_receipt("8.1", "passed"))
            .expect("resource should activate");

        drop(install_directory);
        assert!(
            root.is_dir(),
            "default app removal must not touch external resources"
        );
        assert!(data.path().join(CONFIG_FILE_NAME).is_file());
        let expected_root = path_string(&root);
        let upgraded = LocalResourceManager::load(data.path())
            .expect("upgrade or reinstall should reuse persistent settings");
        assert_eq!(
            upgraded
                .configuration
                .as_ref()
                .map(|configuration| configuration.resource_root.as_str()),
            Some(expected_root.as_str())
        );
        assert!(upgraded.resource_ready("ffmpeg-cpu"));
    }

    #[test]
    fn resolver_uses_active_receipt_and_rejects_unsafe_paths() {
        let data = tempdir().expect("data directory");
        let parent = tempdir().expect("resource parent");
        let mut manager = LocalResourceManager::load(data.path()).expect("manager should load");
        manager
            .configure_location(parent.path().to_str().expect("UTF-8 path"), true)
            .expect("configuration should succeed");
        let root = parent.path().join(RESOURCE_DIRECTORY_NAME);
        let install = root.join("packages/ffmpeg-cpu/8.1");
        fs::create_dir_all(install.join("bin")).expect("install path should create");
        fs::write(install.join("bin/ffmpeg.exe"), b"fixture").expect("entrypoint should write");
        let mut entrypoints = BTreeMap::new();
        entrypoints.insert("ffmpeg".to_owned(), "bin/ffmpeg.exe".to_owned());
        manager
            .activate_receipt(ResourceReceipt {
                schema_version: RECEIPT_SCHEMA_VERSION,
                resource_id: "ffmpeg-cpu".to_owned(),
                version: "8.1".to_owned(),
                install_relative_path: "packages/ffmpeg-cpu/8.1".to_owned(),
                entrypoints,
                files: Vec::new(),
                health_status: "passed".to_owned(),
                activated_at_ms: None,
            })
            .expect("receipt should activate");
        manager
            .configure_location(parent.path().to_str().expect("UTF-8 path"), true)
            .expect("confirming the same root should preserve active resources");
        assert_eq!(
            manager
                .resolve_entrypoint("ffmpeg-cpu", "ffmpeg")
                .expect("entrypoint should resolve"),
            install.join("bin/ffmpeg.exe")
        );
        let receipt_path = root.join("receipts/ffmpeg-cpu/8.1.json");
        assert!(receipt_path.is_file());
        let removed = manager
            .deactivate_resource("ffmpeg-cpu")
            .expect("resource should deactivate")
            .expect("active receipt should return");
        assert_eq!(removed.resource_id, "ffmpeg-cpu");
        assert!(!receipt_path.exists());
        assert!(manager.resolve_entrypoint("ffmpeg-cpu", "ffmpeg").is_err());
        assert!(safe_relative_path("../outside.exe", "fixture").is_err());
    }
}
