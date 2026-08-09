use super::{
    config,
    error::AiCommandError,
    network, probe, task_orchestrator,
    task_types::{ResumeAiTaskInput, StartExplanationTaskInput, StartLearningTaskInput},
    types::{
        AiExecutionPreview, AiModelList, AiServiceProbeInput, AiServiceSettings,
        AiServiceTestResult, DeleteAiServiceInput, NetworkSettings, PreviewAiExecutionInput,
        SaveAiServiceInput, SetDefaultAiServiceInput, SetNetworkSettingsInput,
    },
};
use crate::{
    learning::LearningTask,
    local_resources::{self, SetLocalResourceProxyInput},
    resource_download::{self, ResourceNetworkStatus},
    store::ProjectStore,
    understanding::ExplanationTask,
};
use tauri::State;

#[tauri::command]
pub fn get_ai_service_settings() -> Result<AiServiceSettings, AiCommandError> {
    config::store()?.snapshot().map_err(Into::into)
}

#[tauri::command]
pub fn save_ai_service(input: SaveAiServiceInput) -> Result<AiServiceSettings, AiCommandError> {
    config::store()?.save(input).map_err(Into::into)
}

#[tauri::command]
pub fn delete_ai_service(input: DeleteAiServiceInput) -> Result<AiServiceSettings, AiCommandError> {
    config::store()?.delete(input).map_err(Into::into)
}

#[tauri::command]
pub fn set_default_ai_service(
    input: SetDefaultAiServiceInput,
) -> Result<AiServiceSettings, AiCommandError> {
    config::store()?.set_default(input).map_err(Into::into)
}

#[tauri::command]
pub fn list_ai_service_models(input: AiServiceProbeInput) -> Result<AiModelList, AiCommandError> {
    probe::list_models(input)
}

#[tauri::command]
pub fn test_ai_service(input: AiServiceProbeInput) -> Result<AiServiceTestResult, AiCommandError> {
    probe::test_service(input)
}

#[tauri::command]
pub fn preview_ai_execution(
    input: PreviewAiExecutionInput,
) -> Result<AiExecutionPreview, AiCommandError> {
    probe::preview_execution(input)
}

#[tauri::command]
pub async fn start_explanation_task(
    store: State<'_, ProjectStore>,
    input: StartExplanationTaskInput,
) -> Result<ExplanationTask, AiCommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        task_orchestrator::start_explanation(&store, input)
            .map_err(super::task_types::AiTaskError::command_error)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command]
pub async fn resume_explanation_task(
    store: State<'_, ProjectStore>,
    input: ResumeAiTaskInput,
) -> Result<ExplanationTask, AiCommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        task_orchestrator::resume_explanation(&store, input)
            .map_err(super::task_types::AiTaskError::command_error)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command]
pub async fn start_learning_task(
    store: State<'_, ProjectStore>,
    input: StartLearningTaskInput,
) -> Result<LearningTask, AiCommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        task_orchestrator::start_learning(&store, input)
            .map_err(super::task_types::AiTaskError::command_error)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command]
pub async fn resume_learning_task(
    store: State<'_, ProjectStore>,
    input: ResumeAiTaskInput,
) -> Result<LearningTask, AiCommandError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        task_orchestrator::resume_learning(&store, input)
            .map_err(super::task_types::AiTaskError::command_error)
    })
    .await
    .map_err(background_task_error)?
}

fn background_task_error(error: impl std::fmt::Display) -> AiCommandError {
    AiCommandError::task(
        "background_task_failed",
        format!("后台任务未能完成：{error}"),
        true,
        None,
    )
}

#[tauri::command]
pub fn get_network_settings() -> Result<NetworkSettings, AiCommandError> {
    network::settings().map_err(Into::into)
}

#[tauri::command]
pub fn set_network_settings(
    input: SetNetworkSettingsInput,
) -> Result<NetworkSettings, AiCommandError> {
    network::set_settings(input).map_err(Into::into)
}

#[tauri::command]
pub fn get_local_resource_network_status() -> ResourceNetworkStatus {
    resource_download::network_status()
}

#[tauri::command]
pub fn set_local_resource_proxy(
    input: SetLocalResourceProxyInput,
) -> Result<ResourceNetworkStatus, AiCommandError> {
    local_resources::set_proxy_url(input.proxy_url.as_deref()).map_err(|error| AiCommandError {
        code: "local_resource_proxy_invalid",
        message: error.to_string(),
        retryable: false,
        provider_request_id: None,
    })?;
    network::set_custom_proxy_compat(input.proxy_url.as_deref()).map_err(AiCommandError::from)?;
    Ok(resource_download::network_status())
}
