use crate::{local_resources, resource_download, resource_migration::ResourceMigrationError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ResourceLocationResult {
    #[serde(flatten)]
    pub status: local_resources::LocalResourceStatus,
    pub configuration_fingerprint: String,
    pub binding_error: Option<String>,
    pub task_snapshot: Option<resource_download::ResourceDownloadSnapshot>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryResourceBindingInput {
    pub resource_root: String,
    pub configuration_fingerprint: String,
}
fn fingerprint() -> Result<String, ResourceMigrationError> {
    let snapshot = local_resources::configuration_snapshot();
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&("resource-binding-v1", snapshot))?)
    ))
}
pub(crate) fn finish(
    status: local_resources::LocalResourceStatus,
) -> Result<ResourceLocationResult, ResourceMigrationError> {
    let binding = resource_download::bind_configured_root()
        .and_then(|()| resource_download::task_snapshot_list());
    outcome(status, binding)
}
fn outcome(
    status: local_resources::LocalResourceStatus,
    binding: Result<
        resource_download::ResourceDownloadSnapshot,
        resource_download::ResourceDownloadError,
    >,
) -> Result<ResourceLocationResult, ResourceMigrationError> {
    let (task_snapshot, binding_error) = match binding {
        Ok(value) => (Some(value), None),
        Err(error) => (None, Some(error.to_string())),
    };
    Ok(ResourceLocationResult {
        status,
        configuration_fingerprint: fingerprint()?,
        binding_error,
        task_snapshot,
    })
}
pub fn inspect() -> Result<ResourceLocationResult, ResourceMigrationError> {
    let _maintenance = crate::resource_leases::maintain_all()?;
    outcome(
        local_resources::status()?,
        resource_download::task_snapshot_list(),
    )
}
pub fn retry(
    input: RetryResourceBindingInput,
) -> Result<ResourceLocationResult, ResourceMigrationError> {
    let _maintenance = crate::resource_leases::maintain_all()?;
    let status = local_resources::status()?;
    if status.resource_root.as_deref() != Some(input.resource_root.as_str())
        || fingerprint()? != input.configuration_fingerprint
    {
        return Err(ResourceMigrationError::Integrity(
            "资源保存位置或配置已变化，请重新核对后恢复任务状态".into(),
        ));
    }
    finish(status)
}
