use std::{
    collections::BTreeMap,
    path::Path,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

use serde::Serialize;
use siao_component_store_catalogs::{
    common_verified_windows_x86_64, siao_vplay_verified_transition_windows_x86_64,
};
use siao_component_store_core::{
    StoreError, StoreResult,
    catalog::{CatalogBundle, CatalogDocument, ComponentRef, ComponentRequirement},
    install::{InstallRequest, InstallResult, ProgressEvent},
    lease::Lease,
    operation::OperationJournal,
    store::{AcquiredComponent, ComponentStatus, ResolvedComponent, Store},
};
use thiserror::Error;

pub const CONSUMER_ID: &str = "siao-vplay";
const LEASE_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Debug, Error)]
pub enum ComponentManagerError {
    #[error("组件 catalog 无效：{0}")]
    Catalog(String),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("组件不在 SiaoVPlay catalog 中：{0}")]
    RequirementNotFound(String),
    #[error("共享组件 Store 尚未初始化")]
    NotInitialized,
}

pub type ComponentManagerResult<T> = Result<T, ComponentManagerError>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentCatalogInfo {
    pub catalog_id: String,
    pub catalog_digest: String,
    pub consumer_id: String,
    pub protocol_version: u32,
    pub schema_version: u32,
    pub requirement_count: usize,
}

#[derive(Clone)]
pub struct ComponentManager {
    store: Store,
    bundle: CatalogBundle,
}

#[allow(dead_code)]
impl ComponentManager {
    pub fn open() -> ComponentManagerResult<Self> {
        let common = common_verified_windows_x86_64()?;
        let consumer = siao_vplay_verified_transition_windows_x86_64()?;
        let bundle = CatalogBundle::new(common, consumer)
            .map_err(|error| ComponentManagerError::Catalog(error.to_string()))?;
        let store = Store::open_default(bundle.common.clone())?;
        Ok(Self { store, bundle })
    }

    pub fn from_store(store: Store, bundle: CatalogBundle) -> Self {
        Self { store, bundle }
    }

    pub fn resolve_component(
        &self,
        component_id: &str,
        variant: &[(&str, &str)],
    ) -> ComponentManagerResult<ComponentLeaseGuard> {
        let variant = variant
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect::<BTreeMap<_, _>>();
        let requirement = self
            .bundle
            .consumer
            .requirements
            .iter()
            .find(|requirement| {
                requirement.component_id == component_id && requirement.variant == variant
            })
            .ok_or_else(|| {
                ComponentManagerError::RequirementNotFound(format!(
                    "{component_id}[{}]",
                    variant
                        .iter()
                        .map(|(key, value)| format!("{key}={value}"))
                        .collect::<Vec<_>>()
                        .join(",")
                ))
            })?;
        let acquired = self.store.resolve_and_acquire(CONSUMER_ID, requirement)?;
        Ok(ComponentLeaseGuard::new(self.store.clone(), acquired))
    }

    pub fn component_ref_for(
        &self,
        component_id: &str,
        variant: &[(&str, &str)],
    ) -> ComponentManagerResult<ComponentRef> {
        let variant = variant
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect::<BTreeMap<_, _>>();
        self.bundle
            .consumer
            .requirements
            .iter()
            .find(|requirement| {
                requirement.component_id == component_id && requirement.variant == variant
            })
            .map(ComponentRequirement::component_ref)
            .ok_or_else(|| ComponentManagerError::RequirementNotFound(component_id.to_owned()))
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    pub fn common_catalog(&self) -> &CatalogDocument {
        &self.bundle.common
    }

    pub fn consumer_catalog(&self) -> &CatalogDocument {
        &self.bundle.consumer
    }

    pub fn catalog_id(&self) -> &str {
        self.bundle.consumer.catalog_id.as_str()
    }

    pub fn catalog_digest(&self) -> StoreResult<String> {
        self.bundle.digest()
    }

    pub fn catalog_info(&self) -> ComponentManagerResult<ComponentCatalogInfo> {
        Ok(ComponentCatalogInfo {
            catalog_id: self.catalog_id().to_owned(),
            catalog_digest: self.catalog_digest()?,
            consumer_id: CONSUMER_ID.to_owned(),
            protocol_version: self.bundle.consumer.protocol_version,
            schema_version: self.bundle.consumer.schema_version,
            requirement_count: self.bundle.consumer.requirements.len(),
        })
    }

    pub fn list_installations(&self) -> ComponentManagerResult<Vec<ComponentStatus>> {
        Ok(self.store.list_installations()?)
    }

    pub fn install(
        &self,
        component: ComponentRef,
        observer: Option<&mut dyn FnMut(ProgressEvent)>,
    ) -> ComponentManagerResult<ComponentInstallResult> {
        self.requirement_for(&component)?;
        let result = self.store.install(
            InstallRequest::new(component.clone()).with_consumer(CONSUMER_ID),
            observer,
        )?;
        Ok(ComponentInstallResult::from_install_result(result))
    }

    pub fn pause(&self, operation_id: &str) -> ComponentManagerResult<OperationJournal> {
        Ok(self.store.pause(operation_id)?)
    }

    pub fn resume(
        &self,
        operation_id: &str,
        observer: Option<&mut dyn FnMut(ProgressEvent)>,
    ) -> ComponentManagerResult<ComponentInstallResult> {
        Ok(ComponentInstallResult::from_install_result(
            self.store.resume(operation_id, observer)?,
        ))
    }

    pub fn cancel(&self, operation_id: &str) -> ComponentManagerResult<OperationJournal> {
        Ok(self.store.cancel(operation_id)?)
    }

    pub fn operation_status(&self, operation_id: &str) -> ComponentManagerResult<OperationJournal> {
        Ok(self.store.operation_status(operation_id)?)
    }

    pub fn verify(
        &self,
        component: ComponentRef,
    ) -> ComponentManagerResult<siao_component_store_core::store::VerificationReport> {
        self.requirement_for(&component)?;
        Ok(self.store.verify(&component)?)
    }

    pub fn register_existing(
        &self,
        component: ComponentRef,
        path: impl AsRef<Path>,
    ) -> ComponentManagerResult<ComponentStatus> {
        self.requirement_for(&component)?;
        Ok(self
            .store
            .register_existing_for_consumer(&component, path, CONSUMER_ID)?)
    }

    pub fn resolve_and_acquire(
        &self,
        component: &ComponentRef,
    ) -> ComponentManagerResult<ComponentLeaseGuard> {
        let requirement = self.requirement_for(component)?.clone();
        let acquired = self.store.resolve_and_acquire(CONSUMER_ID, &requirement)?;
        Ok(ComponentLeaseGuard::new(self.store.clone(), acquired))
    }

    fn requirement_for(
        &self,
        component: &ComponentRef,
    ) -> ComponentManagerResult<&ComponentRequirement> {
        self.bundle
            .consumer
            .requirements
            .iter()
            .find(|requirement| requirement.component_ref() == *component)
            .ok_or_else(|| ComponentManagerError::RequirementNotFound(component_key(component)))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentInstallResult {
    pub operation_id: Option<String>,
    pub component: ComponentRef,
    pub identity_hash: String,
    pub payload_path: String,
    pub reused_existing: bool,
}

impl ComponentInstallResult {
    fn from_install_result(result: InstallResult) -> Self {
        Self {
            operation_id: result.operation_id,
            component: result.component,
            identity_hash: result.identity_hash,
            payload_path: result.payload_path.to_string_lossy().into_owned(),
            reused_existing: result.reused_existing,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentResolution {
    pub component: ComponentRef,
    pub artifact_sha256: String,
    pub root_path: String,
    pub entrypoints: BTreeMap<String, String>,
    pub lease_id: String,
    pub expires_at_ms: u64,
}

pub struct ComponentLeaseGuard {
    store: Store,
    lease: Lease,
    resolved: ResolvedComponent,
    heartbeat_stop: Arc<AtomicBool>,
    heartbeat_thread: Option<thread::JoinHandle<()>>,
}

impl ComponentLeaseGuard {
    fn new(store: Store, acquired: AcquiredComponent) -> Self {
        let heartbeat_stop = Arc::new(AtomicBool::new(false));
        let heartbeat_store = store.clone();
        let heartbeat_lease_id = acquired.lease.lease_id.clone();
        let heartbeat_stop_signal = heartbeat_stop.clone();
        let heartbeat_thread = thread::Builder::new()
            .name(format!("siao-component-lease-{}", heartbeat_lease_id))
            .spawn(move || {
                while !heartbeat_stop_signal.load(Ordering::Relaxed) {
                    for _ in 0..100 {
                        if heartbeat_stop_signal.load(Ordering::Relaxed) {
                            return;
                        }
                        thread::sleep(LEASE_HEARTBEAT_INTERVAL / 100);
                    }
                    if !heartbeat_stop_signal.load(Ordering::Relaxed) {
                        let _ = heartbeat_store.heartbeat(&heartbeat_lease_id);
                    }
                }
            })
            .ok();
        Self {
            store,
            lease: acquired.lease,
            resolved: acquired.resolved,
            heartbeat_stop,
            heartbeat_thread,
        }
    }

    pub fn resolution(&self) -> ComponentResolution {
        ComponentResolution {
            component: ComponentRef {
                component_id: self.resolved.component_id.clone(),
                version: self.resolved.version.clone(),
                variant: self.resolved.variant.clone(),
            },
            artifact_sha256: self.resolved.artifact_sha256.clone(),
            root_path: self.resolved.root_path.to_string_lossy().into_owned(),
            entrypoints: self
                .resolved
                .entrypoints
                .iter()
                .map(|(name, path)| (name.clone(), path.to_string_lossy().into_owned()))
                .collect(),
            lease_id: self.lease.lease_id.clone(),
            expires_at_ms: self.lease.expires_at_ms,
        }
    }

    pub fn entrypoint(&self, name: &str) -> ComponentManagerResult<std::path::PathBuf> {
        self.resolved.entrypoints.get(name).cloned().ok_or_else(|| {
            ComponentManagerError::RequirementNotFound(format!("组件入口点：{name}"))
        })
    }

    #[allow(dead_code)]
    pub fn heartbeat(&mut self) -> ComponentManagerResult<ComponentResolution> {
        self.lease = self.store.heartbeat(&self.lease.lease_id)?;
        Ok(self.resolution())
    }

    #[allow(dead_code)]
    pub fn release(mut self) -> ComponentManagerResult<()> {
        self.stop_heartbeat();
        self.store.release(&self.lease.lease_id)?;
        self.lease.expires_at_ms = 0;
        Ok(())
    }

    fn stop_heartbeat(&mut self) {
        self.heartbeat_stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.heartbeat_thread.take() {
            let _ = thread.join();
        }
    }
}

static GLOBAL_MANAGER: OnceLock<ComponentManager> = OnceLock::new();

pub fn initialize_global(manager: ComponentManager) -> ComponentManagerResult<()> {
    GLOBAL_MANAGER
        .set(manager)
        .map_err(|_| ComponentManagerError::Catalog("组件管理器重复初始化".to_owned()))
}

pub fn global() -> ComponentManagerResult<&'static ComponentManager> {
    GLOBAL_MANAGER
        .get()
        .ok_or(ComponentManagerError::NotInitialized)
}

impl Drop for ComponentLeaseGuard {
    fn drop(&mut self) {
        self.stop_heartbeat();
        let _ = self.store.release(&self.lease.lease_id);
    }
}

fn component_key(component: &ComponentRef) -> String {
    let variant = component
        .variant
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{}@{}[{}]",
        component.component_id, component.version, variant
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manager_uses_the_product_consumer_identity() {
        let manager = ComponentManager::open().expect("checked-in catalogs should load");
        assert_eq!(
            manager.consumer_catalog().consumer_id.as_deref(),
            Some(CONSUMER_ID)
        );
        assert_eq!(
            manager.catalog_id(),
            "siao-vplay.verified.windows-x86_64.v2"
        );
        assert!(manager.catalog_digest().is_ok());
    }

    #[test]
    fn component_key_is_deterministic() {
        let component = ComponentRef {
            component_id: "ffmpeg".into(),
            version: "8.1".into(),
            variant: [
                ("architecture".into(), "x86_64".into()),
                ("platform".into(), "windows".into()),
            ]
            .into_iter()
            .collect(),
        };
        assert_eq!(
            component_key(&component),
            "ffmpeg@8.1[architecture=x86_64,platform=windows]"
        );
    }
}
