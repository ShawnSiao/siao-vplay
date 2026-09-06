use super::{
    active_execution::ApiExecutionLease,
    providers::{self, GenerationInput, ProviderOutput},
    request_coordinator::global_request_coordinator,
    task_persistence::{self, AiTaskKind},
    task_types::AiTaskError,
    types::ResolvedAiService,
};
use crate::store::ProjectStore;

pub(crate) fn spawn<T>(
    lease: ApiExecutionLease,
    store: ProjectStore,
    task_id: String,
    kind: AiTaskKind,
    operation: impl FnOnce(&ProjectStore, &str) -> Result<T, AiTaskError> + Send + 'static,
) {
    std::thread::spawn(move || {
        let _lease = lease;
        if let Err(error) = operation(&store, &task_id) {
            let error = error.command_error();
            task_persistence::fail(
                &store,
                kind,
                &task_id,
                error.code,
                &error.message,
                error.provider_request_id.as_deref(),
            );
        }
    });
}

pub(crate) fn execute(
    store: &ProjectStore,
    kind: AiTaskKind,
    task_id: &str,
    service: &ResolvedAiService,
    mut input: GenerationInput,
) -> Result<ProviderOutput, AiTaskError> {
    let lane = service
        .service_config_id
        .as_deref()
        .unwrap_or(&service.base_url);
    let cancelled = super::task_cancellation::for_task(store, task_id);
    input.cancellation = Some(cancelled.clone());
    let _permit = global_request_coordinator()
        .acquire_interactive_cancellable(lane, || cancelled())?
        .ok_or(super::AiError::Cancelled)?;
    let output = providers::generate(service, &input)?;
    task_persistence::record_provider_output(
        store,
        kind,
        task_id,
        output.provider_request_id.as_deref(),
        output.usage.as_ref(),
    )?;
    Ok(output)
}

#[cfg(test)]
#[path = "task_execution_tests.rs"]
mod tests;
