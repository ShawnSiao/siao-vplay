use super::*;

pub fn adopt_local_resources(
    input: AdoptLocalResourcesInput,
    request_id: &str,
) -> Result<ResourceAdoptionResult, ResourceMigrationError> {
    let _maintenance = crate::resource_leases::maintain_all()?;
    if !input.confirmed {
        return Err(ResourceMigrationError::ConfirmationRequired);
    }
    if resource_download::has_active_tasks()? {
        return Err(ResourceMigrationError::Busy);
    }
    let (preview, verified) = adoption_confirmation::inspect(InspectResourceMigrationInput { source_path: input.source_path, source_kind: input.source_kind })?;
    adoption_confirmation::verify(&input.plan_fingerprint, &preview.plan_fingerprint)?;
    if preview.resource_root.as_deref() != Some(input.resource_root.as_str()) { return Err(ResourceMigrationError::AdoptionPlanChanged); }
    let root = local_resources::configured_root().ok_or(LocalResourceError::ConfirmationRequired)?;
    if !root.is_dir() || local_resources::resource_subdirectories().iter().any(|relative| !root.join(relative).is_dir()) {
        return Err(LocalResourceError::RootUnavailable(path_string(&root)).into());
    }
    let rejected = preview.candidates.iter().filter(|candidate| candidate.state == "rejected");
    let mut rejected_ids = rejected.map(|candidate| candidate.resource_id.clone()).collect::<Vec<_>>();
    let mut handled = BTreeSet::new();
    let items = verified.iter().filter(|candidate| handled.insert(candidate.public.resource_id.clone()))
        .map(|candidate| (candidate.public.resource_id.clone(), candidate.public.reusable_bytes, candidate)).collect::<Vec<_>>();
    let outcome = adoption_batch::run(&items, |candidate| local_resources::resource_is_ready(&candidate.public.resource_id).map_err(Into::into), |candidate| adopt_candidate(&root, candidate))?;
    let mut adopted = outcome.adopted; let mut already_active = outcome.active;
    let reusable_bytes = outcome.bytes;
    adopted.sort();
    already_active.sort();
    rejected_ids.sort();
    rejected_ids.dedup();
    Ok(ResourceAdoptionResult {
        interruption: outcome.interruption,
        resource_root: path_string(&root),
        plan_fingerprint: preview.plan_fingerprint,
        request_id: request_id.to_owned(),
        adopted_resource_ids: adopted,
        already_active_resource_ids: already_active,
        rejected_resource_ids: rejected_ids,
        reusable_bytes,
    })
}

pub fn move_resource_root(
    input: MoveLocalResourceRootInput,
    request_id: &str,
) -> Result<LocalResourceMoveResult, ResourceMigrationError> {
    let _maintenance = crate::resource_leases::maintain_all()?;
    if !input.confirmed {
        return Err(ResourceMigrationError::ConfirmationRequired);
    }
    if resource_download::has_active_tasks()? {
        return Err(ResourceMigrationError::Busy);
    }
    let plan = plan_resource_root_move(&input.parent_path)?;
    move_confirmation::verify(&input.plan_fingerprint, &plan.plan_fingerprint)?;
    if plan.destination_exists {
        return Err(ResourceMigrationError::DestinationExists(
            plan.resource_root,
        ));
    }
    let previous_root = PathBuf::from(&plan.previous_root);
    let selected_parent = PathBuf::from(&plan.selected_parent);
    let target_root = PathBuf::from(&plan.resource_root);
    let recovery = move_staging::Staging::open(&previous_root, &target_root)?;
    let staging = &recovery.path;
    #[cfg(test)]
    move_confirmation::run_before_copy();
    let verified = copy_root_verified_inner(
        &previous_root,
        &staging,
        MoveCopyOptions {
            available_bytes: plan.free_space_bytes,
            cross_volume: plan.cross_volume,
            fault: MoveFault::None,
        },
        true,
    )?;
    let reviewed_configuration = local_resources::configuration_snapshot()
        .ok_or(LocalResourceError::ConfirmationRequired)?;
    let copied_fingerprint = move_confirmation::fingerprint(&reviewed_configuration, &plan, &verified.manifest)?;
    move_confirmation::verify(&input.plan_fingerprint, &copied_fingerprint)?;
    if let Err(error) = move_control::begin_commit() {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if let Err(error) = fs::rename(&staging, &target_root) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error.into());
    }
    let previous_configuration = local_resources::configuration_snapshot()
        .ok_or(LocalResourceError::ConfirmationRequired)?;
    let mut configuration = previous_configuration.clone();
    configuration.selected_parent = path_string(&selected_parent);
    configuration.resource_root = path_string(&target_root);
    push_unique_string(&mut configuration.legacy_candidate_roots, &previous_root);
    move_commit::switch_configuration(&previous_configuration, &configuration,
        |configuration| local_resources::replace_configuration(configuration.clone()).map(|_| ()).map_err(Into::into),
        || {
            let downloads = resource_download::bind_configured_root();
            let runtime = crate::runtime::sync_managed_root();
            downloads?;
            runtime?;
            Ok(())
        })?;
    recovery.finish();
    Ok(LocalResourceMoveResult {
        plan_fingerprint: plan.plan_fingerprint,
        request_id: request_id.to_owned(),
        previous_root: path_string(&previous_root),
        current_root: path_string(&target_root),
        copied_bytes: verified.bytes,
        verified_file_count: verified.files,
        cross_volume: verified.cross_volume,
        previous_root_retained: true,
    })
}

pub fn reconnect_resource_root(
    input: ReconnectLocalResourceRootInput,
) -> Result<crate::local_resources::LocalResourceStatus, ResourceMigrationError> {
    let _maintenance = crate::resource_leases::maintain_all()?;
    if !input.confirmed {
        return Err(ResourceMigrationError::ConfirmationRequired);
    }
    if resource_download::has_active_tasks()? {
        return Err(ResourceMigrationError::Busy);
    }
    let (selected_parent, root) = local_resources::selected_location_paths(&input.parent_path)?;
    if !root.is_dir()
        || local_resources::resource_subdirectories()
            .iter()
            .any(|relative| !root.join(relative).is_dir())
    {
        return Err(ResourceMigrationError::InvalidSource(format!(
            "所选目录不是完整的 SiaoVPlay 资源目录：{}",
            root.display()
        )));
    }
    let mut active_resources = BTreeMap::new();
    for resource in &local_resources::catalog()?.resources {
        if verified_receipt_candidate(&root, resource)?.is_some() {
            active_resources.insert(resource.id.clone(), resource.version.clone());
        }
    }
    let previous = local_resources::configuration_snapshot();
    let mut legacy_candidate_roots = previous
        .as_ref()
        .map(|configuration| configuration.legacy_candidate_roots.clone())
        .unwrap_or_default();
    if let Some(previous_root) = previous
        .as_ref()
        .map(|value| PathBuf::from(&value.resource_root))
        && !paths_equal(&previous_root, &root)
    {
        push_unique_string(&mut legacy_candidate_roots, &previous_root);
    }
    let status = local_resources::replace_configuration(LocalResourceConfiguration {
        schema_version: 1,
        selected_parent: path_string(&selected_parent),
        resource_root: path_string(&root),
        preferred_profile: previous
            .as_ref()
            .map(|configuration| configuration.preferred_profile.clone())
            .unwrap_or_else(|| "standard".to_owned()),
        active_resources,
        legacy_candidate_roots,
        proxy_url: previous
            .as_ref()
            .and_then(|configuration| configuration.proxy_url.clone()),
    })?;
    resource_download::bind_configured_root()?;
    crate::runtime::sync_managed_root()?;
    Ok(status)
}

pub fn cleanup_unused_resources(
    input: CleanupUnusedResourcesInput,
) -> Result<UnusedResourceCleanupResult, ResourceMigrationError> {
    let _maintenance = crate::resource_leases::maintain_all()?;
    if !input.confirmed {
        return Err(ResourceMigrationError::ConfirmationRequired);
    }
    if resource_download::has_active_tasks()? {
        return Err(ResourceMigrationError::Busy);
    }
    let plan = plan_unused_resource_cleanup()?;
    crate::cleanup_confirmation::verify(&input.plan_fingerprint, &plan.plan_fingerprint)?;
    let mut items = Vec::new();
    for resource_id in &plan.resource_ids {
        let receipt = local_resources::active_receipt(resource_id)?
            .ok_or_else(|| LocalResourceError::ResourceNotReady(resource_id.clone()))?;
        let bytes = receipt
            .files
            .iter()
            .try_fold(0_u64, |sum, file| sum.checked_add(file.size))
            .ok_or_else(|| LocalResourceError::InvalidReceipt("资源大小超出范围".into()))?;
        items.push((resource_id.clone(), bytes));
    }
    let outcome = crate::cleanup_batch::run(items, |id| {
        let result =
            resource_download::remove_resource(id, true).map_err(|error| error.to_string())?;
        if !result.removed {
            return Err("资源状态已变化，请重新检查清单".into());
        }
        Ok(())
    })?;
    Ok(UnusedResourceCleanupResult {
        removed_resource_ids: outcome.completed_ids,
        reclaimed_bytes: outcome.reclaimed_bytes,
        interruption: outcome.interruption,
    })
}
