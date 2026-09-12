use crate::{
    local_resources,
    resource_usage::{ResourceLease, ResourceUsage, Scope},
};
use std::{
    io,
    sync::{Arc, OnceLock},
};

fn registry() -> &'static Arc<ResourceUsage> {
    static REGISTRY: OnceLock<Arc<ResourceUsage>> = OnceLock::new();
    REGISTRY.get_or_init(|| Arc::new(ResourceUsage::default()))
}

pub(crate) fn configured(required_ids: &[&str]) -> io::Result<ResourceLease> {
    local_resources::recover_changes_for_use().map_err(|error| io::Error::other(error.to_string()))?;
    let lease = registry().read(|| {
        let mut versions = local_resources::configuration_snapshot()
            .map(|configuration| configuration.active_resources)
            .unwrap_or_default();
        versions.retain(|id, _| required_ids.contains(&id.as_str()));
        for id in required_ids {
            versions
                .entry((*id).to_owned())
                .or_insert_with(|| "external-or-unavailable".to_owned());
        }
        versions
    })?;
    if local_resources::resource_change_pending().map_err(|error| io::Error::other(error.to_string()))? {
        return Err(io::Error::new(io::ErrorKind::WouldBlock, "资源变更尚未恢复，请完成恢复后重试"));
    }
    Ok(lease)
}

pub(crate) fn maintain_all() -> io::Result<MaintenanceLease> {
    maintain(registry(), local_resources::storage_manager()?, Scope::All)
}
pub(crate) fn maintain_resource(id: &str) -> io::Result<MaintenanceLease> {
    maintain(registry(), local_resources::storage_manager()?, Scope::Resource(id.to_owned()))
}

pub(crate) fn maintain_policy() -> io::Result<MaintenanceLease> {
    maintain(registry(), local_resources::storage_manager()?, Scope::Policy)
}

pub(crate) struct MaintenanceLease {
    _resource: ResourceLease,
    _storage: Option<crate::storage::StorageLease>,
}
fn maintain(registry: &Arc<ResourceUsage>, storage: Option<crate::storage::StorageManager>, scope: Scope) -> io::Result<MaintenanceLease> {
    let storage = acquire_storage(storage)?;
    Ok(MaintenanceLease { _resource: registry.write(scope)?, _storage: storage })
}
#[cfg(test)]
#[path = "resource_leases_migration_tests.rs"]
mod migration_tests;

fn acquire_storage(storage: Option<crate::storage::StorageManager>) -> io::Result<Option<crate::storage::StorageLease>> {
    storage.map(|storage| storage.acquire_usage()).transpose()
        .map_err(|error| io::Error::new(io::ErrorKind::WouldBlock, error.to_string()))
}
pub(crate) fn storage_usage() -> io::Result<Option<crate::storage::StorageLease>> {
    acquire_storage(local_resources::storage_manager()?)
}
