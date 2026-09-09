use crate::{
    commands::CommandError,
    local_resources::{LocalResourceStatus, PlanLocalResourceLocationInput},
    resource_migration::{
        self, AdoptLocalResourcesInput, CleanupUnusedResourcesInput, InspectResourceMigrationInput,
        LocalResourceMovePlan, LocalResourceMoveResult, MoveLocalResourceRootInput,
        ReconnectLocalResourceRootInput, ResourceAdoptionResult, ResourceMigrationPreview,
        UnusedResourceCleanupPlan, UnusedResourceCleanupResult,
    },
};

async fn run<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, CommandError> + Send + 'static,
) -> Result<T, CommandError> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(CommandError::background_task_failed)?
}
#[tauri::command]
pub async fn inspect_local_resource_migration(
    input: InspectResourceMigrationInput,
) -> Result<ResourceMigrationPreview, CommandError> {
    run(move || resource_migration::inspect_resource_migration(input).map_err(Into::into)).await
}

#[tauri::command]
pub async fn adopt_local_resources(
    input: AdoptLocalResourcesInput,
    request_id: String,
) -> Result<ResourceAdoptionResult, CommandError> {
    run(move || resource_migration::adopt_local_resources(input, &request_id).map_err(Into::into)).await
}

#[tauri::command]
pub async fn plan_local_resource_move(
    input: PlanLocalResourceLocationInput,
) -> Result<LocalResourceMovePlan, CommandError> {
    run(move || resource_migration::plan_resource_root_move(&input.parent_path).map_err(Into::into))
        .await
}

#[tauri::command]
pub async fn move_local_resource_root(
    input: MoveLocalResourceRootInput,
    request_id: String,
) -> Result<LocalResourceMoveResult, CommandError> {
    let request = resource_migration::move_control::register(&request_id)?;
    run(move || request.run(|| resource_migration::move_resource_root(input, &request_id)).map_err(Into::into)).await
}

#[tauri::command]
pub fn cancel_local_resource_move(request_id: String) -> Result<bool, CommandError> {
    resource_migration::move_control::cancel(&request_id).map_err(Into::into)
}

#[tauri::command]
pub async fn reconnect_local_resource_root(
    input: ReconnectLocalResourceRootInput,
) -> Result<LocalResourceStatus, CommandError> {
    run(move || resource_migration::reconnect_resource_root(input).map_err(Into::into)).await
}

#[tauri::command]
pub async fn plan_unused_resource_cleanup() -> Result<UnusedResourceCleanupPlan, CommandError> {
    run(move || resource_migration::plan_unused_resource_cleanup().map_err(Into::into)).await
}

#[tauri::command]
pub async fn cleanup_unused_resources(
    input: CleanupUnusedResourcesInput,
) -> Result<UnusedResourceCleanupResult, CommandError> {
    run(move || resource_migration::cleanup_unused_resources(input).map_err(Into::into)).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filesystem_operations_do_not_run_on_the_command_thread() {
        let caller = std::thread::current().id();
        let worker =
            tauri::async_runtime::block_on(run(|| Ok(std::thread::current().id()))).unwrap();
        assert_ne!(caller, worker);
    }
}
