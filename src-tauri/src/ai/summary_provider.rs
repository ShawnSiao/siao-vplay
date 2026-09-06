use std::time::Duration;

use serde_json::Value;

use super::{
    connection,
    providers::{self, GenerationInput, ProviderFailure, ProviderOutput},
    request_coordinator::global_request_coordinator,
    types::AiExecutionTarget,
};

pub(crate) struct SummaryProviderInput<'a> {
    pub service_config_id: &'a str,
    pub service_revision: u64,
    pub model_id: &'a str,
    pub system: &'a str,
    pub prompt: String,
    pub schema_name: &'a str,
    pub schema: Value,
    pub max_output_tokens: u32,
    pub image_data_urls: Vec<String>,
}

pub(crate) fn receiver(
    id: &str,
    revision: u64,
) -> Result<super::types::AiServiceConfig, super::AiError> {
    let service = super::config::store()?.configured_service(id)?;
    if service.revision != revision {
        return Err(super::AiError::RevisionConflict);
    }
    Ok(service)
}

pub(crate) fn generate(
    input: SummaryProviderInput<'_>,
    store: &crate::store::ProjectStore,
    task_id: &str,
) -> Result<ProviderOutput, ProviderFailure> {
    let cancelled = super::task_cancellation::for_task(store, task_id);
    if cancelled()? {
        return Err(super::AiError::Cancelled.into());
    }
    let execution = AiExecutionTarget::Api {
        service_config_id: input.service_config_id.to_owned(),
        model_id: input.model_id.to_owned(),
    };
    let service = connection::resolve_execution(&execution, Some(input.service_revision))
        .map_err(ProviderFailure::from)?;
    let lane = service
        .service_config_id
        .as_deref()
        .unwrap_or(&service.base_url);
    let _permit = global_request_coordinator()
        .acquire_summary_cancellable(lane, || cancelled())?
        .ok_or(super::AiError::Cancelled)?;
    providers::generate(
        &service,
        &GenerationInput {
            model_id: input.model_id.to_owned(),
            system: input.system.to_owned(),
            prompt: input.prompt,
            schema_name: input.schema_name.to_owned(),
            schema: input.schema,
            image_data_urls: input.image_data_urls,
            max_output_tokens: input.max_output_tokens,
            timeout: Duration::from_secs(180),
            cancellation: Some(cancelled),
        },
    )
}
