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
    #[error("未找到对应资源：{0}")]
    UnknownResource(String),
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

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalResourceRootState {
    SetupRequired,
    Ready,
    RootUnavailable,
    RepairRequired,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum LocalResourceCapabilityState {
    SetupRequired,
    NotReady,
    Preparing,
    Ready,
    RepairRequired,
    RootUnavailable,
    UpdateAvailable,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalResourceCapabilityStatus {
    pub id: String,
    pub title: String,
    pub state: LocalResourceCapabilityState,
    pub required_resource_ids: Vec<String>,
    pub missing_resource_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalResourceStatus {
    pub configured: bool,
    pub selected_parent: Option<String>,
    pub resource_root: Option<String>,
    pub root_state: LocalResourceRootState,
    pub free_space_bytes: Option<u64>,
    pub preferred_profile: String,
    pub capabilities: Vec<LocalResourceCapabilityStatus>,
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
    with_manager_write(|manager| manager.configure_location(parent, confirmed))
}

pub fn configured_root() -> Option<PathBuf> {
    MANAGER
        .get()
        .and_then(|state| state.read().ok())
        .and_then(|manager| manager.configuration.as_ref().map(configuration_root))
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

pub(crate) fn activate_resource(receipt: ResourceReceipt) -> Result<(), LocalResourceError> {
    with_manager_write(|manager| manager.activate_receipt(receipt))
}

pub(crate) fn active_receipt(
    resource_id: &str,
) -> Result<Option<ResourceReceipt>, LocalResourceError> {
    with_manager_read(|manager| manager.active_receipt(resource_id))
}

pub(crate) fn deactivate_resource(
    resource_id: &str,
) -> Result<Option<ResourceReceipt>, LocalResourceError> {
    with_manager_write(|manager| manager.deactivate_resource(resource_id))
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
    operation(&mut state)
}

impl LocalResourceManager {
    fn load(data_directory: &Path) -> Result<Self, LocalResourceError> {
        let config_path = data_directory.join(CONFIG_FILE_NAME);
        let configuration = if config_path.is_file() {
            let configuration =
                serde_json::from_slice::<LocalResourceConfiguration>(&fs::read(&config_path)?)?;
            validate_configuration(&configuration)?;
            Some(configuration)
        } else {
            None
        };
        Ok(Self {
            config_path,
            configuration,
        })
    }

    fn plan_location(&self, parent: &str) -> Result<LocalResourceLocationPlan, LocalResourceError> {
        let parent = validate_parent(parent)?;
        let root = parent.join(RESOURCE_DIRECTORY_NAME);
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
        let parent = validate_parent(parent)?;
        let root = parent.join(RESOURCE_DIRECTORY_NAME);
        fs::create_dir_all(&root)?;
        for relative in RESOURCE_SUBDIRECTORIES {
            fs::create_dir_all(root.join(relative))?;
        }
        verify_writable(&root.join("state"))?;
        let existing_configuration = self
            .configuration
            .as_ref()
            .filter(|configuration| configuration_root(configuration) == root);
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
        };
        persist_json(&self.config_path, &configuration)?;
        self.configuration = Some(configuration);
        self.status()
    }

    fn status(&self) -> Result<LocalResourceStatus, LocalResourceError> {
        let catalog = catalog()?;
        let Some(configuration) = self.configuration.as_ref() else {
            return Ok(LocalResourceStatus {
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
        );
        Ok(LocalResourceStatus {
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
        let configuration = self
            .configuration
            .as_mut()
            .ok_or_else(|| LocalResourceError::ResourceNotReady(receipt.resource_id.clone()))?;
        validate_receipt(&receipt, &receipt.resource_id, &receipt.version)?;
        let receipt_directory = configuration_root(configuration)
            .join("receipts")
            .join(&receipt.resource_id);
        fs::create_dir_all(&receipt_directory)?;
        persist_json(
            &receipt_directory.join(format!("{}.json", receipt.version)),
            &receipt,
        )?;
        configuration
            .active_resources
            .insert(receipt.resource_id.clone(), receipt.version.clone());
        persist_json(&self.config_path, configuration)
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

    fn deactivate_resource(
        &mut self,
        resource_id: &str,
    ) -> Result<Option<ResourceReceipt>, LocalResourceError> {
        let receipt = self.active_receipt(resource_id)?;
        let Some(receipt) = receipt else {
            return Ok(None);
        };
        let configuration = self.configuration.as_mut().ok_or_else(|| {
            LocalResourceError::ResourceNotReady(format!("{resource_id} 尚未配置"))
        })?;
        configuration.active_resources.remove(resource_id);
        persist_json(&self.config_path, configuration)?;
        let receipt_path = configuration_root(configuration)
            .join("receipts")
            .join(resource_id)
            .join(format!("{}.json", receipt.version));
        if receipt_path.is_file() {
            fs::remove_file(receipt_path)?;
        }
        Ok(Some(receipt))
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

fn capability_statuses(
    catalog: &LocalResourceCatalog,
    preferred_profile: &str,
    root_state: LocalResourceRootState,
    mut is_ready: impl FnMut(&str) -> bool,
    mut is_preparing: impl FnMut(&str) -> bool,
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
                LocalResourceCapabilityState::Ready
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
        if let Some(artifact) = &resource.artifact {
            if !artifact.url.starts_with("https://")
                || artifact.size == 0
                || !is_sha256(&artifact.sha256)
                || resource.installed_size.unwrap_or(0) == 0
            {
                return Err(LocalResourceError::InvalidCatalog(format!(
                    "{} 的下载地址、下载大小、安装后大小或 SHA-256 无效",
                    resource.id
                )));
            }
        } else if resource
            .distribution
            .as_ref()
            .is_none_or(|distribution| distribution.status != "pending_release_asset")
        {
            return Err(LocalResourceError::InvalidCatalog(format!(
                "{} 既没有可信下载制品，也没有待发布标记",
                resource.id
            )));
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

fn verify_writable(directory: &Path) -> Result<(), LocalResourceError> {
    let probe = directory.join(format!(".write-probe-{}", std::process::id()));
    File::create(&probe)?.write_all(b"SiaoVPlay")?;
    fs::remove_file(probe)?;
    Ok(())
}

fn persist_json(path: &Path, value: &impl Serialize) -> Result<(), LocalResourceError> {
    let parent = path
        .parent()
        .ok_or_else(|| LocalResourceError::FileSystem(io::Error::other("配置路径没有父目录")))?;
    fs::create_dir_all(parent)?;
    let part_path = path.with_extension("json.part");
    let backup_path = path.with_extension("json.bak");
    let mut file = File::create(&part_path)?;
    serde_json::to_writer_pretty(&mut file, value)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    if path.exists() {
        if backup_path.exists() {
            fs::remove_file(&backup_path)?;
        }
        fs::rename(path, &backup_path)?;
    }
    if let Err(error) = fs::rename(&part_path, path) {
        if backup_path.exists() {
            let _ = fs::rename(&backup_path, path);
        }
        return Err(error.into());
    }
    if backup_path.exists() {
        fs::remove_file(backup_path)?;
    }
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
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn embedded_catalog_is_valid_and_app_only() {
        let catalog = catalog().expect("catalog should parse");
        validate_catalog(catalog).expect("catalog should validate");
        assert_eq!(catalog.resources.len(), 7);
        assert!(catalog.resources.iter().all(|resource| !resource.bundled));
    }

    #[test]
    fn capability_reports_preparing_while_a_required_resource_is_active() {
        let statuses = capability_statuses(
            catalog().expect("catalog should parse"),
            DEFAULT_PROFILE,
            LocalResourceRootState::Ready,
            |_| false,
            |resource_id| resource_id == "ffmpeg-cpu",
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
