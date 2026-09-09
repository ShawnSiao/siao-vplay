use super::*;

pub fn rollback_resource(
    input: RollbackLocalResourceInput,
) -> Result<ResourceRollbackResult, ResourceDiagnosticsError> {
    let _maintenance = crate::resource_leases::maintain_resource(&input.resource_id)?;
    if !input.confirmed {
        return Err(ResourceDiagnosticsError::ConfirmationRequired);
    }
    if resource_download::list_tasks()?.iter().any(|task| {
        task.resource_id == input.resource_id
            && matches!(
                task.state,
                crate::resource_download::ResourceDownloadTaskState::Queued
                    | crate::resource_download::ResourceDownloadTaskState::Downloading
                    | crate::resource_download::ResourceDownloadTaskState::Verifying
                    | crate::resource_download::ResourceDownloadTaskState::Installing
            )
    }) {
        return Err(ResourceDiagnosticsError::Busy(input.resource_id));
    }
    let configuration = local_resources::configuration_snapshot()
        .ok_or(LocalResourceError::ConfirmationRequired)?;
    let previous_version = configuration
        .active_resources
        .get(&input.resource_id)
        .cloned()
        .ok_or_else(|| {
            ResourceDiagnosticsError::VersionNotFound(
                input.resource_id.clone(),
                input.version.clone(),
            )
        })?;
    let receipt = local_resources::installed_receipts(&input.resource_id)?
        .into_iter()
        .find(|receipt| receipt.version == input.version)
        .ok_or_else(|| {
            ResourceDiagnosticsError::VersionNotFound(
                input.resource_id.clone(),
                input.version.clone(),
            )
        })?;
    verify_historic_receipt(&configuration.resource_root, &receipt)?;
    local_resources::activate_resource(receipt)?;
    Ok(ResourceRollbackResult {
        resource_id: input.resource_id,
        previous_version,
        active_version: input.version,
    })
}

pub fn cleanup_old_versions(
    input: CleanupOldResourceVersionsInput,
) -> Result<OldResourceVersionCleanupResult, ResourceDiagnosticsError> {
    let _maintenance = crate::resource_leases::maintain_all()?;
    if !input.confirmed {
        return Err(ResourceDiagnosticsError::ConfirmationRequired);
    }
    if resource_download::has_active_tasks()? {
        return Err(ResourceDiagnosticsError::Busy("all".to_owned()));
    }
    let configuration = local_resources::configuration_snapshot()
        .ok_or(LocalResourceError::ConfirmationRequired)?;
    let plan = plan_old_version_cleanup()?;
    crate::cleanup_confirmation::verify(&input.plan_fingerprint, &plan.plan_fingerprint)?;
    let mut removed_versions = Vec::new();
    let mut reclaimed_bytes = 0_u64;
    for candidate in plan.candidates {
        if configuration
            .active_resources
            .get(&candidate.resource_id)
            .is_some_and(|active| active == &candidate.version)
        {
            return Err(ResourceDiagnosticsError::ActiveVersionProtected(
                candidate.resource_id,
                candidate.version,
            ));
        }
        if !local_resources::remove_inactive_resource(&candidate.resource_id, &candidate.version)? {
            return Err(ResourceDiagnosticsError::VersionNotFound(
                candidate.resource_id,
                candidate.version,
            ));
        }
        reclaimed_bytes = reclaimed_bytes.saturating_add(candidate.reclaimable_bytes);
        removed_versions.push(format!("{}@{}", candidate.resource_id, candidate.version));
    }
    Ok(OldResourceVersionCleanupResult {
        removed_versions,
        reclaimed_bytes,
    })
}
